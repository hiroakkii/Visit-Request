/* 患者マスタ（Excel）の取込・検索
 * Excelの題名（見出し）から列を自動判別し、取込確認画面で確認してから取り込む。
 * データはすべてブラウザ内で処理し、外部へ送信しない。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'homeTransitionOrder.master.v1';
  const SEARCH_LIMIT = 50;
  const PREVIEW_LIMIT = 20;
  const HEADER_SCAN_ROWS = 10;

  // 取込先の項目定義。題名（見出し）の自動判別に使うキーワードを持つ。
  // exact: 題名と完全一致、partial: 題名に含まれる、exclude: 含まれていたら部分一致では判別しない
  const FIELDS = [
    {
      key: 'id', label: 'ID',
      exact: ['ID', '患者ID', '患者番号', '患者No', '患者No.', 'カルテ番号', 'カルテNo', 'カルテNo.', 'カルテID', '患者コード', '利用者ID', '利用者番号', '番号', 'No', 'No.', 'コード'],
      partial: ['患者ID', '患者番号', '患者コード', '利用者ID', '利用者番号', 'カルテ', 'ID'],
      exclude: ['保険', '郵便', '電話', '受給', '記号', '医療機関', '施設', 'TEL', 'FAX', 'メール'],
    },
    {
      key: 'kana', label: 'ふりがな',
      exact: ['ふりがな', 'フリガナ', 'かな', 'カナ', 'よみ', 'よみがな', 'カナ氏名', '氏名カナ', '患者名カナ', 'カナ患者名', '患者カナ', '患者名ふりがな', '氏名ふりがな', '氏名(カナ)', '氏名(ふりがな)', '患者名(カナ)', '患者名(ふりがな)'],
      partial: ['ふりがな', 'フリガナ', 'カナ', 'よみ'],
      exclude: ['住所', '家族', '保護者', '緊急', '担当', '医師', 'ケアマネ', '連絡'],
    },
    {
      key: 'name', label: '氏名',
      exact: ['氏名', '患者名', '名前', '患者氏名', 'お名前', '漢字氏名', '氏名漢字', '患者名漢字', '利用者名', '利用者氏名', '氏名(漢字)', '患者名(漢字)'],
      partial: ['氏名', '患者名', '利用者名', '名前'],
      exclude: ['カナ', 'ふりがな', 'よみ', 'ローマ', '英字', '家族', '保護者', '緊急', '担当', '医師', 'ケアマネ', '連絡', '施設'],
    },
    {
      key: 'sex', label: '性別',
      exact: ['性別', '性', '男女', '男女区分', '性別区分'],
      partial: ['性別'],
      exclude: [],
    },
    {
      key: 'birth', label: '生年月日',
      exact: ['生年月日', '誕生日', '生年', '生年月日(西暦)', '生年月日(和暦)'],
      partial: ['生年月日', '誕生'],
      exclude: [],
    },
    {
      key: 'age', label: '年齢',
      exact: ['年齢', '歳', '才'],
      partial: ['年齢'],
      exclude: ['生年月日'],
    },
    {
      key: 'zip', label: '郵便番号',
      exact: ['郵便番号', '〒', '郵便', '郵便No', '郵便No.', '〒番号'],
      partial: ['郵便', '〒'],
      exclude: ['緊急', '家族', '勤務', '施設', '医療機関'],
    },
    {
      key: 'address', label: '住所',
      exact: ['住所', '現住所', '住所1', '所在地', '自宅住所', '患者住所', '住所(1)'],
      partial: ['住所', '所在地'],
      exclude: ['郵便', '〒', 'カナ', 'ふりがな', '緊急', '家族', '勤務', 'メール', 'MAIL', '2', '3', '番地', '建物', '方書'],
    },
    {
      key: 'address2', label: '住所（続き）',
      exact: ['住所2', '住所(2)', '番地', '方書', '建物', '建物名', 'マンション名', '住所(番地)', '住所(建物)'],
      partial: ['住所2', '番地', '建物', '方書'],
      exclude: ['郵便', 'カナ', 'ふりがな'],
    },
    {
      key: 'tel', label: '電話番号',
      exact: ['電話', '電話番号', 'TEL', 'TEL番号', '自宅電話', '自宅TEL', '連絡先', '連絡先電話番号', '携帯', '携帯電話', '携帯番号'],
      partial: ['電話', 'TEL'],
      exclude: ['緊急', '家族', '勤務', 'FAX', 'ケアマネ', '医療機関', '施設', '担当'],
    },
  ];
  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  // ---------- 状態 ----------
  const state = { patients: [], importMeta: null };
  let pending = null; // 取込確認中のデータ
  let lastWorkbook = null; // 「取込設定を再確認」用（このページを開いている間のみ保持）
  const listeners = [];

  const $ = (sel) => document.querySelector(sel);
  const U = window.Util;

  // ---------- 保存 ----------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('患者マスタをブラウザに保存できませんでした（容量不足の可能性があります）。このページを開いている間は利用できます。');
    }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!data) return;
      state.patients = Array.isArray(data.patients) ? data.patients : [];
      state.importMeta = data.importMeta || null;
    } catch (e) {
      console.warn(e);
    }
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
    state.patients = [];
    state.importMeta = null;
    lastWorkbook = null;
    notify();
  }

  // ---------- 値の整形 ----------
  function normalizeSex(v) {
    const s = U.cleanText(v);
    const k = s.toLowerCase();
    if (['1', '男', '男性', 'm', 'male', 'おとこ'].includes(k)) return '男';
    if (['2', '女', '女性', 'f', 'female', 'おんな'].includes(k)) return '女';
    return s;
  }

  function normalizeZip(v) {
    const s = U.cleanText(v).replace(/^〒\s*/, '');
    const m = s.match(/^(\d{3})-?(\d{4})$/);
    return m ? `${m[1]}-${m[2]}` : s;
  }

  // ---------- Excel 読込 ----------
  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) {
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        text = new TextDecoder('shift_jis').decode(buf);
      }
      // raw: true で先頭の 0 などを文字列のまま保持する
      return XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
    }
    return XLSX.read(buf, { type: 'array' });
  }

  function readSheet(wb, sheetName) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) return { fmt: [], raw: [], rowOffset: 0, colOffset: 0 };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const opts = { header: 1, defval: '', blankrows: true };
    return {
      fmt: XLSX.utils.sheet_to_json(ws, Object.assign({ raw: false }, opts)),
      raw: XLSX.utils.sheet_to_json(ws, Object.assign({ raw: true }, opts)),
      rowOffset: range.s.r,
      colOffset: range.s.c,
    };
  }

  // 題名1つに対する項目ごとのスコア
  function scoreHeader(field, header) {
    const h = U.normalize(header);
    if (!h) return 0;
    if (field.exact.some((k) => U.normalize(k) === h)) return 1000;
    if (field.exclude.some((k) => h.includes(U.normalize(k)))) return 0;
    let best = 0;
    for (const k of field.partial) {
      const nk = U.normalize(k);
      if (h.includes(nk)) best = Math.max(best, 100 + nk.length * 10 - (h.length - nk.length));
    }
    return best;
  }

  // 題名から 項目 → 列番号 を自動判別（1列は1項目にのみ割当）
  function autoMap(headers) {
    const cands = [];
    FIELDS.forEach((f) => headers.forEach((h, col) => {
      const s = scoreHeader(f, h);
      if (s > 0) cands.push({ field: f.key, col, score: s });
    }));
    cands.sort((a, b) => b.score - a.score || a.col - b.col);
    const mapping = {};
    const usedCols = new Set();
    for (const c of cands) {
      if (mapping[c.field] != null || usedCols.has(c.col)) continue;
      mapping[c.field] = c.col;
      usedCols.add(c.col);
    }
    return mapping;
  }

  // 先頭10行の中から、最も多くの項目を判別できた行を見出し行とする
  function guessHeaderRow(rows) {
    let best = -1;
    let bestCount = 0;
    for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
      const cnt = Object.keys(autoMap(rows[r].map(U.cleanText))).length;
      if (cnt > bestCount) { best = r; bestCount = cnt; }
    }
    if (best >= 0) return best;
    const firstNonEmpty = rows.findIndex((row) => row.some((v) => U.cleanText(v) !== ''));
    return Math.max(firstNonEmpty, 0);
  }

  function colLetter(i) {
    return XLSX.utils.encode_col(i);
  }

  // 見出し行・割当に従って患者データを組み立てる
  function buildPatients(p) {
    const { sheet, headerRow, mapping } = p;
    const get = (rowArr, key) => (mapping[key] != null ? rowArr[mapping[key]] : '');
    const out = [];
    for (let r = headerRow + 1; r < sheet.fmt.length; r++) {
      const fmt = sheet.fmt[r] || [];
      const raw = sheet.raw[r] || [];
      const mappedValues = Object.values(mapping).map((c) => U.cleanText(fmt[c]));
      if (mappedValues.every((v) => v === '')) continue;
      const birthText = U.cleanText(get(fmt, 'birth'));
      out.push({
        row: r + sheet.rowOffset + 1,
        id: U.cleanText(get(fmt, 'id')),
        kana: U.cleanText(get(fmt, 'kana')),
        name: U.cleanText(get(fmt, 'name')),
        sex: normalizeSex(get(fmt, 'sex')),
        birth: U.parseDate(get(raw, 'birth')) || U.parseDate(birthText),
        birthRaw: birthText,
        ageRaw: U.cleanText(get(fmt, 'age')),
        zip: normalizeZip(get(fmt, 'zip')),
        address: [U.cleanText(get(fmt, 'address')), U.cleanText(get(fmt, 'address2'))].filter(Boolean).join(' '),
        tel: U.cleanText(get(fmt, 'tel')),
      });
    }
    // 重複しないキーを割り当てる（IDがあればID、重複・未設定なら行番号を付加）
    const seen = new Map();
    out.forEach((pt) => seen.set(pt.id, (seen.get(pt.id) || 0) + 1));
    out.forEach((pt) => {
      if (!pt.id) pt.key = `row:${pt.row}`;
      else pt.key = seen.get(pt.id) === 1 ? `id:${pt.id}` : `id:${pt.id}#row${pt.row}`;
    });
    return out;
  }

  // ---------- 取込確認画面 ----------
  async function onFileSelected(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let wb;
    try {
      wb = await readWorkbook(file);
    } catch (err) {
      alert('ファイルを読み込めませんでした。\n' + err.message);
      return;
    }
    lastWorkbook = { wb, fileName: file.name };
    openImportDialog(wb, file.name, null);
  }

  function openImportDialog(wb, fileName, prevMeta) {
    const sheetName = prevMeta && wb.SheetNames.includes(prevMeta.sheetName)
      ? prevMeta.sheetName
      : pickSheet(wb);
    pending = { wb, fileName, manual: new Set() };
    $('#import-file-name').textContent = `ファイル: ${fileName}`;
    const sel = $('#sheet-select');
    sel.innerHTML = wb.SheetNames.map((n) => `<option value="${U.esc(n)}">${U.esc(n)}</option>`).join('');
    sel.value = sheetName;
    $('#sheet-label').style.display = wb.SheetNames.length > 1 ? '' : 'none';
    loadSheetIntoPending(sheetName, prevMeta);
    $('#import-dialog').showModal();
  }

  // 複数シートの場合、最も多く項目を判別できたシートを初期選択にする
  function pickSheet(wb) {
    let best = wb.SheetNames[0];
    let bestCount = -1;
    for (const name of wb.SheetNames) {
      const sheet = readSheet(wb, name);
      const hr = guessHeaderRow(sheet.fmt);
      const cnt = Object.keys(autoMap((sheet.fmt[hr] || []).map(U.cleanText))).length;
      if (cnt > bestCount) { best = name; bestCount = cnt; }
    }
    return best;
  }

  function loadSheetIntoPending(sheetName, prevMeta) {
    pending.sheetName = sheetName;
    pending.sheet = readSheet(pending.wb, sheetName);
    const useSaved = prevMeta && prevMeta.sheetName === sheetName;
    pending.headerRow = useSaved ? prevMeta.headerRow : guessHeaderRow(pending.sheet.fmt);
    $('#header-row').value = pending.headerRow + pending.sheet.rowOffset + 1;
    pending.manual = new Set(useSaved ? prevMeta.manual || [] : []);
    pending.mapping = useSaved ? Object.assign({}, prevMeta.mapping) : autoMap(headersOf());
    renderImportDialog();
  }

  function headersOf() {
    return (pending.sheet.fmt[pending.headerRow] || []).map(U.cleanText);
  }

  function setHeaderRow(excelRow) {
    const r = excelRow - pending.sheet.rowOffset - 1;
    if (!Number.isInteger(r) || r < 0 || r >= pending.sheet.fmt.length) return;
    pending.headerRow = r;
    pending.manual = new Set();
    pending.mapping = autoMap(headersOf());
    renderImportDialog();
  }

  function renderImportDialog() {
    const sheet = pending.sheet;
    const headers = headersOf();
    const width = Math.max(headers.length, ...sheet.fmt.slice(pending.headerRow, pending.headerRow + 50).map((r) => r.length), 0);
    const colToField = {};
    Object.entries(pending.mapping).forEach(([k, c]) => { colToField[c] = k; });

    const rowsHtml = [];
    for (let c = 0; c < width; c++) {
      const samples = [];
      for (let r = pending.headerRow + 1; r < sheet.fmt.length && samples.length < 3; r++) {
        const v = U.cleanText((sheet.fmt[r] || [])[c]);
        if (v) samples.push(v);
      }
      if (!headers[c] && samples.length === 0) continue;
      const fk = colToField[c] || '';
      const opts = ['<option value="">（取り込まない）</option>']
        .concat(FIELDS.map((f) => `<option value="${f.key}"${f.key === fk ? ' selected' : ''}>${U.esc(f.label)}</option>`))
        .join('');
      const badge = fk ? (pending.manual.has(fk) ? '<span class="badge manual">手動</span>' : '<span class="badge auto">自動判別</span>') : '';
      rowsHtml.push(`<tr class="${fk ? 'mapped' : ''}">
        <td>${colLetter(c + sheet.colOffset)}列</td>
        <td>${U.esc(headers[c]) || '<span class="hint">（題名なし）</span>'}</td>
        <td class="sample" title="${U.esc(samples.join(' / '))}">${U.esc(samples.join(' / '))}</td>
        <td><select data-col="${c}">${opts}</select></td>
        <td>${badge}</td>
      </tr>`);
    }
    $('#mapping-table tbody').innerHTML = rowsHtml.join('') || '<tr><td colspan="5" class="empty">データがありません</td></tr>';

    const patients = buildPatients(pending);
    renderPreview(patients);
    renderWarnings(patients);
  }

  function renderPreview(patients) {
    $('#preview-info').textContent = `（取込対象 ${patients.length} 件${patients.length > PREVIEW_LIMIT ? `、先頭 ${PREVIEW_LIMIT} 件を表示` : ''}）`;
    const html = patients.slice(0, PREVIEW_LIMIT).map((p) => `<tr>
        <td class="num">${p.row}</td>
        <td>${U.esc(p.id)}</td><td>${U.esc(p.kana)}</td><td>${U.esc(p.name)}</td><td>${U.esc(p.sex)}</td>
        <td>${U.esc(p.birth ? U.formatWareki(p.birth) : p.birthRaw)}</td>
        <td class="num">${U.esc(ageOf(p, U.todayIso()))}</td>
        <td>${U.esc(p.zip)}</td>
        <td class="addr">${U.esc(p.address)}</td>
        <td>${U.esc(p.tel)}</td>
      </tr>`).join('');
    $('#preview-table tbody').innerHTML = html || '<tr><td colspan="10" class="empty">取込対象の行がありません</td></tr>';
  }

  function renderWarnings(patients) {
    const m = pending.mapping;
    const msgs = [];
    const canImport = m.name != null && patients.length > 0;
    if (m.name == null) msgs.push({ error: true, text: '「氏名」の列を指定してください。' });
    else if (patients.length === 0) msgs.push({ error: true, text: '見出し行より下に取込対象のデータがありません。見出しの行を確認してください。' });

    const missing = ['kana', 'sex', 'address']
      .filter((k) => m[k] == null).map((k) => FIELD_BY_KEY[k].label);
    if (m.birth == null && m.age == null) missing.push('年齢（または生年月日）');
    if (missing.length) msgs.push({ text: `未割当の項目: ${missing.join('、')}（空欄で取り込まれます）` });

    if (m.id != null) {
      const counts = new Map();
      patients.forEach((p) => { if (p.id) counts.set(p.id, (counts.get(p.id) || 0) + 1); });
      const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
      if (dups.length) msgs.push({ text: `IDが重複しています: ${dups.slice(0, 10).join('、')}${dups.length > 10 ? ` ほか${dups.length - 10}件` : ''}` });
    }
    if (m.birth != null) {
      const bad = patients.filter((p) => !p.birth && p.birthRaw);
      if (bad.length) msgs.push({ text: `生年月日を日付として解釈できない行が ${bad.length} 件あります（例: ${bad.slice(0, 3).map((p) => `${p.row}行目「${p.birthRaw}」`).join('、')}）。生年月日は空欄で取り込みます。` });
    }

    $('#mapping-warnings').innerHTML = msgs.map((w) => `<div class="warn${w.error ? ' error' : ''}">${U.esc(w.text)}</div>`).join('');
    $('#btn-import-ok').disabled = !canImport;
  }

  function onMappingChange(e) {
    const sel = e.target.closest('select[data-col]');
    if (!sel) return;
    const col = Number(sel.dataset.col);
    const field = sel.value;
    Object.keys(pending.mapping).forEach((k) => {
      if (pending.mapping[k] === col || k === field) {
        delete pending.mapping[k];
        pending.manual.delete(k);
      }
    });
    if (field) {
      pending.mapping[field] = col;
      pending.manual.add(field);
    }
    renderImportDialog();
  }

  function confirmImport() {
    state.patients = buildPatients(pending);
    state.importMeta = {
      fileName: pending.fileName,
      sheetName: pending.sheetName,
      headerRow: pending.headerRow,
      mapping: pending.mapping,
      manual: [...pending.manual],
      importedAt: new Date().toISOString(),
    };
    save();
    $('#import-dialog').close();
    pending = null;
    notify();
  }

  // ---------- 検索 ----------
  // 生年月日があれば基準日時点で計算、無ければマスタの年齢列
  function ageOf(p, atIso) {
    const a = U.calcAge(p.birth, atIso);
    if (a != null) return a;
    const n = parseInt(String(p.ageRaw || '').normalize('NFKC'), 10);
    return Number.isFinite(n) ? n : '';
  }

  function search(q) {
    const terms = String(q || '').split(/[\s　]+/).map(U.normalize).filter(Boolean);
    if (!terms.length) return [];
    return state.patients.filter((p) => {
      const hay = [p.id, p.kana, p.name, p.address, p.tel].map(U.normalize).join('\n');
      return terms.every((t) => hay.includes(t));
    });
  }

  function renderStatus() {
    const m = state.importMeta;
    $('#master-status').textContent = m
      ? `患者マスタ: ${m.fileName}（${state.patients.length}件、${new Date(m.importedAt).toLocaleString('ja-JP')} 取込）`
      : '患者マスタ未取込';
    $('#btn-remap').disabled = !lastWorkbook;
    $('#patient-search').disabled = state.patients.length === 0;
    $('#patient-search').placeholder = state.patients.length
      ? '氏名・ふりがな・ID・住所・電話で検索（スペース区切りで複数条件）'
      : '患者マスタ（Excel）を取り込むと検索できます';
  }

  function renderResults() {
    const q = $('#patient-search').value;
    const box = $('#search-results');
    const results = search(q);
    if (!U.normalize(q)) { box.hidden = true; box.innerHTML = ''; return; }
    const at = window.App ? window.App.baseDate() : U.todayIso();
    box.hidden = false;
    box.innerHTML = results.slice(0, SEARCH_LIMIT).map((p) => {
      const age = ageOf(p, at);
      return `<li data-key="${U.esc(p.key)}" tabindex="0">
        <span class="r-name">${U.esc(p.name)}<small>${U.esc(p.kana)}</small></span>
        <span class="r-meta">${U.esc([p.id && `ID:${p.id}`, p.sex, age !== '' && `${age}歳`].filter(Boolean).join('　'))}</span>
        <span class="r-addr">${U.esc(p.address)}</span>
      </li>`;
    }).join('') + (results.length > SEARCH_LIMIT
      ? `<li class="more">ほか ${results.length - SEARCH_LIMIT} 件。条件を絞り込んでください</li>`
      : '') + (results.length ? '' : '<li class="more">該当する患者がいません</li>');
  }

  function pick(li) {
    if (!li || !li.dataset.key) return;
    const p = state.patients.find((x) => x.key === li.dataset.key);
    if (!p) return;
    $('#patient-search').value = '';
    renderResults();
    listeners.forEach((fn) => fn('pick', p));
  }

  function notify() {
    renderStatus();
    renderResults();
    listeners.forEach((fn) => fn('change'));
  }

  function init() {
    load();
    $('#file-input').addEventListener('change', onFileSelected);
    $('#btn-remap').addEventListener('click', () => {
      if (lastWorkbook) openImportDialog(lastWorkbook.wb, lastWorkbook.fileName, state.importMeta);
    });
    $('#sheet-select').addEventListener('change', (e) => loadSheetIntoPending(e.target.value, null));
    $('#header-row').addEventListener('change', (e) => setHeaderRow(Number(e.target.value)));
    $('#mapping-table').addEventListener('change', onMappingChange);
    $('#btn-import-cancel').addEventListener('click', () => { $('#import-dialog').close(); pending = null; });
    $('#btn-import-ok').addEventListener('click', confirmImport);

    const input = $('#patient-search');
    const box = $('#search-results');
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { const f = box.querySelector('li[data-key]'); if (f) { e.preventDefault(); f.focus(); } }
      if (e.key === 'Enter') { e.preventDefault(); pick(box.querySelector('li[data-key]')); }
      if (e.key === 'Escape') { input.value = ''; renderResults(); }
    });
    box.addEventListener('click', (e) => pick(e.target.closest('li')));
    box.addEventListener('keydown', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      if (e.key === 'Enter') { e.preventDefault(); pick(li); }
      if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling || input).focus(); }
      if (e.key === 'Escape') { input.value = ''; renderResults(); input.focus(); }
    });
    renderStatus();
  }

  window.Master = {
    init,
    clearStorage,
    ageOf,
    onEvent: (fn) => listeners.push(fn),
    rerender: renderResults,
  };
})();
