/* 住所 → 郵便番号
 * 日本郵便の郵便番号データ（KEN_ALL.CSV / utf_ken_all.csv、またはそのzip）を読み込み、
 * このブラウザ（IndexedDB）に保存して、住所の文字列から郵便番号を引く。通信は行わない。
 */
(function () {
  'use strict';

  const DB_NAME = 'homeTransitionOrder';
  const STORE = 'kv';
  const DATA_KEY = 'zipdata.v1';
  const CANDIDATE_LIMIT = 10;

  let meta = null; // { count, importedAt, fileName }
  let index = null; // Map 都道府県 → Map 市区町村(正規化) → { city, towns: [{ key, list }]（長い順）, byKey: Map }
  let readyPromise = null;

  // ---------- IndexedDB ----------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbOp(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  // ---------- 正規化 ----------
  // 全角半角の統一、空白除去、「ヶ・ケ・ヵ・が」の表記ゆれを吸収
  function nz(s) {
    return String(s == null ? '' : s).normalize('NFKC').replace(/[\s　]/g, '').replace(/[ヶヵケが]/g, 'ケ');
  }

  function formatZip(z) {
    return `${z.slice(0, 3)}-${z.slice(3)}`;
  }

  // ---------- CSV の読込 ----------
  function decode(u8) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(u8);
    }
  }

  async function readCsvText(file) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name) || (u8[0] === 0x50 && u8[1] === 0x4b)) {
      const zip = XLSX.CFB.read(u8, { type: 'array' });
      const entry = zip.FileIndex.find((f) => f.type === 2 && /\.csv$/i.test(f.name) && f.content && f.content.length);
      if (!entry) throw new Error('zipの中にCSVファイルが見つかりません。');
      return decode(entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content));
    }
    return decode(u8);
  }

  // KEN_ALL の行を [都道府県, 市区町村, 町域, 郵便番号] にする。
  // 町域が長く複数行に分かれている「（…）」はつなげる
  function parseKenAll(text) {
    const rows = [];
    let open = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split(',').map((v) => v.replace(/^"|"$/g, ''));
      if (c.length < 9 || !/^\d{7}$/.test(c[2])) continue;
      const [zip, pref, city, town] = [c[2], c[6], c[7], c[8]];
      if (open && open.zip === zip && open.city === city) {
        open.town += town;
        if (town.includes('）')) { rows.push([open.pref, open.city, open.town, open.zip]); open = null; }
        continue;
      }
      if (open) { rows.push([open.pref, open.city, open.town, open.zip]); open = null; }
      if (town.includes('（') && !town.includes('）')) open = { zip, pref, city, town };
      else rows.push([pref, city, town, zip]);
    }
    if (open) rows.push([open.pref, open.city, open.town, open.zip]);
    if (rows.length < 100) throw new Error('郵便番号データとして読み込める行がありません。日本郵便の「住所の郵便番号（KEN_ALL）」のファイルを選んでください。');
    return rows;
  }

  // ---------- 索引 ----------
  function splitTown(town) {
    const t = town.normalize('NFKC');
    if (t === '以下に掲載がない場合' || /の次に番地がくる場合$/.test(t) || /^(.+[町村])一円$/.test(t)) return { base: '', note: '' };
    const m = t.match(/^([^(]*)\((.*)\)?$/);
    return m ? { base: m[1], note: m[2].replace(/\)$/, '') } : { base: t, note: '' };
  }

  function buildIndex(text) {
    const idx = new Map();
    for (const line of text.split('\n')) {
      const [pref, city, town, zip] = line.split('\t');
      if (!zip) continue;
      const { base, note } = splitTown(town);
      if (!idx.has(pref)) idx.set(pref, new Map());
      const cities = idx.get(pref);
      const cityKeys = [nz(city)];
      const gun = city.match(/^.+?郡(.+)$/); // 「○○郡」を省略した住所にも対応
      if (gun) cityKeys.push(nz(gun[1]));
      for (const ck of cityKeys) {
        if (!cities.has(ck)) cities.set(ck, { city, byKey: new Map() });
        const c = cities.get(ck);
        const tk = nz(base);
        if (!c.byKey.has(tk)) c.byKey.set(tk, []);
        const list = c.byKey.get(tk);
        if (!list.some((e) => e.zip === zip && e.note === note)) list.push({ zip, pref, city, town: base, note });
      }
    }
    idx.forEach((cities) => cities.forEach((c) => {
      c.towns = [...c.byKey.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
    }));
    return idx;
  }

  // ---------- 検索 ----------
  // 「１～３丁目」「４丁目」「１、２丁目」などの注記と、住所の丁目の数字が合うか
  function noteMatchesChome(note, n) {
    const s = note.normalize('NFKC');
    if (!/丁目/.test(s)) return null;
    for (const part of s.split(/[、,]/)) {
      const r = part.match(/(\d+)[~～〜-](\d+)丁目/);
      if (r && n >= Number(r[1]) && n <= Number(r[2])) return true;
      const one = part.match(/^(\d+)(丁目)?$/) || part.match(/(\d+)丁目/);
      if (one && Number(one[1]) === n) return true;
    }
    return false;
  }

  function narrow(list, rest) {
    const m = rest.match(/^(\d+)/);
    if (!m || list.length < 2) return list;
    const n = Number(m[1]);
    const hit = list.filter((e) => noteMatchesChome(e.note, n) === true);
    return hit.length ? hit : list;
  }

  function lookupInCity(c, rest) {
    const r = rest.replace(/^(大字|字)/, '');
    for (const tries of [rest, r]) {
      const t = c.towns.find((k) => tries.startsWith(k));
      if (t) return narrow(c.byKey.get(t), tries.slice(t.length));
    }
    return c.byKey.get('') || [];
  }

  function lookup(address) {
    if (!index) return { status: 'nodata', candidates: [] };
    let a = nz(address).replace(/^〒?\d{3}-?\d{4}/, '');
    if (!a) return { status: 'none', candidates: [] };
    let prefs = [...index.keys()].filter((p) => a.startsWith(p));
    if (prefs.length) a = a.slice(prefs[0].length);
    else prefs = [...index.keys()];
    const found = [];
    for (const p of prefs) {
      const cities = index.get(p);
      let best = null;
      cities.forEach((c, ck) => { if (a.startsWith(ck) && (!best || ck.length > best.length)) best = ck; });
      if (best) found.push(...lookupInCity(cities.get(best), a.slice(best.length)));
    }
    const seen = new Set();
    const candidates = found.filter((e) => !seen.has(e.zip) && seen.add(e.zip))
      .map((e) => Object.assign({}, e, { zip: formatZip(e.zip) }));
    if (!candidates.length) return { status: 'none', candidates };
    return { status: candidates.length === 1 ? 'one' : 'many', candidates: candidates.slice(0, CANDIDATE_LIMIT), total: candidates.length };
  }

  // ---------- 公開 ----------
  async function load() {
    try {
      const data = await dbOp('readonly', (s) => s.get(DATA_KEY));
      if (data && data.text) {
        index = buildIndex(data.text);
        meta = { count: data.count, importedAt: data.importedAt, fileName: data.fileName };
      }
    } catch (e) {
      console.warn(e);
    }
  }

  function ready() {
    if (!readyPromise) readyPromise = load();
    return readyPromise;
  }

  async function importFile(file) {
    const rows = parseKenAll(await readCsvText(file));
    const text = rows.map((r) => r.join('\t')).join('\n');
    const data = { text, count: rows.length, importedAt: new Date().toISOString(), fileName: file.name };
    await dbOp('readwrite', (s) => s.put(data, DATA_KEY));
    index = buildIndex(text);
    meta = { count: data.count, importedAt: data.importedAt, fileName: data.fileName };
    readyPromise = Promise.resolve();
    return meta;
  }

  async function clear() {
    await dbOp('readwrite', (s) => s.delete(DATA_KEY));
    index = null;
    meta = null;
  }

  window.ZipCode = { ready, lookup, importFile, clear, info: () => meta };
})();
