/* 共通ユーティリティ（文字列・日付・和暦） */
(function () {
  'use strict';

  const ERAS = [
    { name: '令和', abbr: 'R', start: '2019-05-01', base: 2019 },
    { name: '平成', abbr: 'H', start: '1989-01-08', base: 1989 },
    { name: '昭和', abbr: 'S', start: '1926-12-25', base: 1926 },
    { name: '大正', abbr: 'T', start: '1912-07-30', base: 1912 },
    { name: '明治', abbr: 'M', start: '1868-01-25', base: 1868 },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 検索・判別用の正規化：全角半角統一、カタカナ→ひらがな、小文字化、空白除去
  function normalize(s) {
    return toHiragana(String(s == null ? '' : s).normalize('NFKC').toLowerCase()).replace(/[\s　・･]/g, '');
  }

  function cleanText(v) {
    return String(v == null ? '' : v).normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function makeIso(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!y || !m || !d) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function eraBase(token) {
    const t = token.toUpperCase();
    const era = ERAS.find((e) => e.name === token || e.abbr === t);
    return era ? era.base : null;
  }

  // Excelのセル値（シリアル値・文字列・和暦など）を YYYY-MM-DD に変換。解釈できなければ null
  function parseDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) return makeIso(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    if (typeof raw === 'number') {
      if (raw >= 18000101 && raw <= 29991231) {
        const s = String(Math.trunc(raw));
        return makeIso(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8));
      }
      if (raw > 0 && raw < 2958466) {
        const p = XLSX.SSF.parse_date_code(raw);
        return p ? makeIso(p.y, p.m, p.d) : null;
      }
      return null;
    }
    const s = String(raw).normalize('NFKC').replace(/\s/g, '');
    let m = s.match(/^(明治|大正|昭和|平成|令和|[MTSHRmtshr])\.?(\d{1,2}|元)[年.\/\-](\d{1,2})[月.\/\-](\d{1,2})日?$/);
    if (m) {
      const base = eraBase(m[1]);
      const n = m[2] === '元' ? 1 : Number(m[2]);
      return base ? makeIso(base + n - 1, m[3], m[4]) : null;
    }
    m = s.match(/^(\d{4})[年.\/\-](\d{1,2})[月.\/\-](\d{1,2})日?/);
    if (m) return makeIso(m[1], m[2], m[3]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return makeIso(m[1], m[2], m[3]);
    if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
    return null;
  }

  function todayIso() {
    const d = new Date();
    return makeIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function calcAge(birthIso, atIso) {
    if (!birthIso || !atIso) return null;
    const [by, bm, bd] = birthIso.split('-').map(Number);
    const [ty, tm, td] = atIso.split('-').map(Number);
    let age = ty - by;
    if (tm < bm || (tm === bm && td < bd)) age -= 1;
    return age >= 0 ? age : null;
  }

  function toWareki(iso) {
    const era = ERAS.find((e) => iso >= e.start);
    if (!era) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return { era, year: y - era.base + 1, m, d };
  }

  // 2026-10-29 → 令和8年10月29日（明治より前は西暦）
  function formatWareki(iso) {
    if (!iso) return '';
    const w = toWareki(iso);
    if (!w) {
      const [y, m, d] = iso.split('-').map(Number);
      return `${y}年${m}月${d}日`;
    }
    return `${w.era.name}${w.year === 1 ? '元' : w.year}年${w.m}月${w.d}日`;
  }

  // 期間の終了日：開始日から nか月後の前日（例: 4/1 から 6か月 → 9/30、8/31 から 6か月 → 2/28）
  function periodEnd(startIso, months) {
    if (!startIso) return '';
    const [y, m, d] = startIso.split('-').map(Number);
    const ty = y + Math.floor((m - 1 + months) / 12);
    const tm = ((m - 1 + months) % 12) + 1;
    const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    const end = new Date(Date.UTC(ty, tm - 1, Math.min(d, last)));
    end.setUTCDate(end.getUTCDate() - (d > last ? 0 : 1));
    return makeIso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
  }

  window.Util = { ERAS, esc, normalize, cleanText, pad2, makeIso, parseDate, todayIso, calcAge, toWareki, formatWareki, periodEnd };
})();
