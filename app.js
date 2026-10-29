/* 在宅移行初期管理 指示書作成
 * 入力フォーム → A4 1枚の指示書（プレビュー・印刷）。
 * 入力内容・設定・履歴はこのブラウザ（localStorage）にのみ保存し、外部へ送信しない。
 */
(function () {
  'use strict';

  const U = window.Util;
  const KEYS = {
    settings: 'homeTransitionOrder.settings.v1',
    defaults: 'homeTransitionOrder.defaults.v1',
    draft: 'homeTransitionOrder.draft.v1',
    history: 'homeTransitionOrder.history.v1',
  };
  const HISTORY_LIMIT = 500;
  const MAX_MONTHS = 6;
  const OTHER = '__other';

  // チェック項目。参考にした様式（訪問薬剤管理指導依頼書・情報提供書、指示書）の項目をまとめたもの
  const GROUPS = {
    drugs_ref: { other: false, items: ['処方せん及びお薬手帳を参照'] },
    reason: {
      label: '通院が困難な理由・服薬管理に係る支援が必要な状態',
      other: true,
      items: [
        '認知症',
        '精神障害',
        '障害児（児童福祉法に規定する障害児）',
        '末期の悪性腫瘍',
        '注射による麻薬の投与が必要',
        '身体機能の低下（歩行困難・寝たきり等）',
        '独居・介護力の不足',
      ],
    },
    initial: {
      label: '在宅移行初期の訪問で依頼する事項',
      other: true,
      items: [
        '服薬状況・残薬の確認と整理',
        '他医療機関の処方薬・市販薬・健康食品等の確認',
        '服薬管理方法の検討（一包化・服薬カレンダー等）',
        '剤形・調剤方法の検討',
        '生活状況・療養環境の把握',
        '介護者の負担軽減に向けた支援',
        '多職種（ケアマネジャー・訪問看護等）との情報共有',
      ],
    },
    purpose: {
      label: '訪問の目的',
      other: true,
      items: [
        '薬を理解、納得してきちんと服用できるように服薬指導および支援する',
        '薬効の確認および副作用を継続的にチェック（有効かつ安全な薬物治療を援助）',
        '薬によるADL・QOLへの影響を継続的にチェック',
      ],
    },
    instruction: {
      label: '指示事項',
      other: true,
      items: [
        '①コンプライアンス',
        '②服薬指導（管理・保管も含む）',
        '③服薬時間',
        '④薬剤の相互作用',
        '⑤薬剤に影響のある食品等',
        '⑥処方薬以外の服用',
        '⑦不要薬剤の処理',
        '⑧副作用情報',
        '⑨在宅介護用品の供給・相談応需',
      ],
    },
    condition: {
      label: '服薬にあたっての情報',
      other: true,
      items: ['運動機能障害', '寝たきり', '嚥下障害', '失語症', '視覚障害', '聴覚障害', '認知症', '抑うつ傾向'],
    },
    medical: {
      label: '特別な医療',
      other: true,
      items: ['経管栄養', '疼痛の管理', '褥瘡の処置', 'ストーマの処置', 'カテーテル（コンドームカテーテル、留置カテーテル等）', '点滴の管理', '中心静脈栄養'],
    },
  };

  // 「既定値として保存」の対象（患者ごとに変わらない定型項目）
  const TEMPLATE_FIELDS = ['kubun', 'pharmacy', 'doctor', 'department'].concat(
    Object.keys(GROUPS).flatMap((g) => [`chk_${g}`, `other_${g}`]),
  );

  const DEFAULT_SETTINGS = {
    title: '訪問薬剤管理指導に係る情報提供書 及び 指示書（在宅移行初期）',
    clinic: '', address: '', tel: '', fax: '',
    doctors: [], departments: [], pharmacies: [],
    showUnchecked: true,
  };
  const BUILTIN_DEFAULTS = { months: MAX_MONTHS, fields: { chk_drugs_ref: [GROUPS.drugs_ref.items[0]] } };

  const $ = (sel) => document.querySelector(sel);
  const form = $('#order-form');
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let defaults = BUILTIN_DEFAULTS;
  let history = [];
  let currentHistoryId = null;
  let saveTimer = null;

  // ---------- 保存 ----------
  function read(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      alert('ブラウザに保存できませんでした（容量不足の可能性があります）。');
      return false;
    }
  }

  // ---------- フォーム ⇔ データ ----------
  function renderChecks() {
    document.querySelectorAll('.checks[data-group]').forEach((box) => {
      const g = box.dataset.group;
      const def = GROUPS[g];
      const items = def.items.map((it) => `<label><input type="checkbox" name="chk_${g}" value="${U.esc(it)}"> ${U.esc(it)}</label>`);
      if (def.other) {
        items.push(`<label class="other"><input type="checkbox" name="chk_${g}" value="${OTHER}"> その他
          <input type="text" name="other_${g}" placeholder="内容"></label>`);
      }
      box.innerHTML = items.join('');
    });
  }

  function formToDoc() {
    const doc = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') {
        if (!doc[el.name]) doc[el.name] = [];
        if (el.checked) doc[el.name].push(el.value);
      } else if (el.type === 'radio') {
        if (!(el.name in doc)) doc[el.name] = '';
        if (el.checked) doc[el.name] = el.value;
      } else {
        doc[el.name] = el.value;
      }
    }
    return doc;
  }

  function docToForm(doc) {
    for (const el of form.elements) {
      if (!el.name) continue;
      const v = doc[el.name];
      if (el.type === 'checkbox') el.checked = Array.isArray(v) && v.includes(el.value);
      else if (el.type === 'radio') el.checked = v === el.value;
      else el.value = v == null ? '' : v;
    }
  }

  function newDoc() {
    const today = U.todayIso();
    return Object.assign({}, defaults.fields, {
      createdDate: today,
      periodStart: today,
      periodEnd: U.periodEnd(today, defaults.months || MAX_MONTHS),
    });
  }

  function hasPatientInput(doc) {
    return Object.keys(doc).some((k) => !TEMPLATE_FIELDS.includes(k)
      && !['createdDate', 'periodStart', 'periodEnd'].includes(k)
      && (Array.isArray(doc[k]) ? doc[k].length : String(doc[k] || '').trim()));
  }

  function loadDoc(doc, historyId) {
    form.reset();
    docToForm(doc);
    currentHistoryId = historyId || null;
    onFormChange();
  }

  // ---------- 入力の補助 ----------
  function updateAge() {
    const doc = formToDoc();
    const age = U.calcAge(doc.pt_birth, doc.createdDate || U.todayIso());
    if (age != null) form.elements.pt_age.value = age;
    $('#age-hint').textContent = doc.pt_birth ? '（作成日時点で自動計算）' : '';
  }

  function setPeriodMonths(n) {
    const start = form.elements.periodStart.value || form.elements.createdDate.value || U.todayIso();
    form.elements.periodStart.value = start;
    form.elements.periodEnd.value = U.periodEnd(start, n);
    onFormChange();
  }

  function onPickPatient(p) {
    const doc = formToDoc();
    if (doc.pt_name && doc.pt_name !== p.name) {
      if (!confirm(`入力中の「${doc.pt_name} 様」を「${p.name} 様」に入れ替えます。\n病状・治療など患者ごとの入力欄は空にして、新規作成します。よろしいですか？`)) return;
      loadDoc(newDoc(), null);
    }
    const f = form.elements;
    f.pt_name.value = p.name;
    f.pt_kana.value = p.kana;
    f.pt_sex.value = p.sex === '男' || p.sex === '女' ? p.sex : '';
    f.pt_id.value = p.id;
    f.pt_birth.value = p.birth || '';
    f.pt_age.value = window.Master.ageOf(p, f.createdDate.value || U.todayIso());
    f.pt_zip.value = p.zip || '';
    f.pt_tel.value = p.tel || '';
    f.pt_address.value = p.address;
    onFormChange();
    f.disease.focus();
  }

  function renderWareki() {
    document.querySelectorAll('[data-wareki]').forEach((el) => {
      const v = form.elements[el.dataset.wareki].value;
      el.textContent = v ? U.formatWareki(v) : '';
    });
    const { periodStart: s, periodEnd: e } = form.elements;
    $('#period-text').textContent = s.value && e.value ? `${U.formatWareki(s.value)} から ${U.formatWareki(e.value)} まで` : '';
  }

  function validate(doc) {
    const msgs = [];
    if (!doc.pt_name) msgs.push('患者氏名が未入力です。');
    if (!doc.pharmacy) msgs.push('宛先（薬局）が未入力です。');
    if (!doc.kubun) msgs.push('区分（在宅患者訪問薬剤管理指導／居宅療養管理指導）を選択してください。');
    if (!doc.periodStart || !doc.periodEnd) msgs.push('指示期間を入力してください。');
    else if (doc.periodEnd < doc.periodStart) msgs.push('指示期間の終了日が開始日より前になっています。');
    else if (doc.periodEnd > U.periodEnd(doc.periodStart, MAX_MONTHS)) msgs.push(`指示期間が6月を超えています（${U.formatWareki(U.periodEnd(doc.periodStart, MAX_MONTHS))} までにしてください）。`);
    if (!doc.doctor) msgs.push('医師氏名が未入力です。');
    if (!settings.clinic) msgs.push('医療機関名が未設定です（「医療機関・医師・薬局の設定」）。');
    return msgs;
  }

  // ---------- 指示書の組み立て ----------
  function checksHtml(doc, g, opts) {
    const def = GROUPS[g];
    const sel = doc[`chk_${g}`] || [];
    const other = String(doc[`other_${g}`] || '').trim();
    const all = settings.showUnchecked;
    const out = def.items
      .filter((it) => all || sel.includes(it))
      .map((it) => `<span class="ck${sel.includes(it) ? ' on' : ''}">${sel.includes(it) ? '■' : '□'}${U.esc(it)}</span>`);
    if (def.other) {
      const on = sel.includes(OTHER) || other !== '';
      if (all || on) out.push(`<span class="ck${on ? ' on' : ''}">${on ? '■' : '□'}その他（${U.esc(other) || '<span class="blank"></span>'}）</span>`);
    }
    return `<div class="cks${opts && opts.cols2 ? ' cols2' : ''}">${out.join('')}</div>`;
  }

  function choiceHtml(values, selected) {
    return values.map((v) => `<span class="opt${v === selected ? ' on' : ''}">${U.esc(v)}</span>`).join('・');
  }

  function text(v) {
    return `<div class="txt">${U.esc(String(v || '').trim())}</div>`;
  }

  function dateText(iso) {
    return iso ? U.formatWareki(iso) : '<span class="blank-date">　　年　　月　　日</span>';
  }

  function buildSheet(doc) {
    const age = doc.pt_age !== '' && doc.pt_age != null ? `（${U.esc(doc.pt_age)}歳）` : '（　　歳）';
    const birth = doc.pt_birth ? `${U.formatWareki(doc.pt_birth)}生` : '明・大・昭・平・令　　年　　月　　日生';
    const cm = [doc.cm_name, doc.cm_office && `（${doc.cm_office}）`].filter(Boolean).join(' ');
    const statement = doc.kubun === '居宅療養管理指導'
      ? '上記の目標を達成するべく、薬剤師の居宅療養管理指導の実施を指示します。'
      : '上記の目標を達成するべく、薬剤師の訪問薬剤管理指導の実施を指示します。';
    return `
      <div class="s-date">${dateText(doc.createdDate)}</div>
      <h1 class="s-title">${U.esc(settings.title)}</h1>
      <div class="s-head">
        <div class="s-to"><span class="s-pharm">${U.esc(doc.pharmacy) || '<span class="blank wide"></span>'}</span> 殿</div>
        <div class="s-period">指示期間（6月以内に限る）：${dateText(doc.periodStart)} 〜 ${dateText(doc.periodEnd)}</div>
      </div>
      <table class="s-table">
        <colgroup><col class="c-h"><col><col class="c-h2"><col class="c-v2"></colgroup>
        <tr><th>区分</th><td colspan="3">${['在宅患者訪問薬剤管理指導', '居宅療養管理指導'].map((v) => `<span class="ck${doc.kubun === v ? ' on' : ''}">${doc.kubun === v ? '■' : '□'}${v}</span>`).join('　　')}</td></tr>
        <tr><th>ふりがな<br>患者氏名</th>
          <td><div class="kana">${U.esc(doc.pt_kana)}</div><div class="pname">${U.esc(doc.pt_name)}<span class="sama">様</span></div></td>
          <th>性別</th><td class="center">${choiceHtml(['男', '女'], doc.pt_sex)}</td></tr>
        <tr><th>生年月日</th><td colspan="3">${birth}${age}</td></tr>
        <tr><th>住所</th><td colspan="3">〒${U.esc(doc.pt_zip) || '　　　-　　　　'}<br>${U.esc(doc.pt_address)}</td></tr>
        <tr><th>電話番号</th><td>${U.esc(doc.pt_tel)}</td><th>介護度</th><td>${U.esc(doc.care_level)}</td></tr>
        <tr><th>介護支援専門員</th><td colspan="3">${U.esc(cm)}</td></tr>
        <tr><th>疾病名</th><td>${text(doc.disease)}</td><th>疾病告知</th><td class="center">${choiceHtml(['無', '有'], doc.disclosure)}</td></tr>
        <tr><th>既往歴・経過</th><td colspan="3" class="tall">${text(doc.history)}</td></tr>
        <tr><th>治療状況</th><td colspan="3" class="tall">${text(doc.treatment)}</td></tr>
        <tr><th>使用薬剤</th><td colspan="3">${checksHtml(doc, 'drugs_ref')}${text(doc.drugs)}</td></tr>
        <tr><th>在宅移行</th><td colspan="3">
          <div>退院（予定）日：${dateText(doc.dischargeDate)}　　在宅療養開始（予定）日：${dateText(doc.homeStartDate)}</div>
          <div class="sub">${GROUPS.reason.label}</div>${checksHtml(doc, 'reason')}</td></tr>
        <tr><th>在宅移行初期の<br>依頼事項</th><td colspan="3">
          <div class="sub">計画的な訪問薬剤管理指導の開始前に患家を訪問し、以下について対応をお願いします。</div>${checksHtml(doc, 'initial')}</td></tr>
        <tr><th>訪問の目的</th><td colspan="3">${checksHtml(doc, 'purpose')}</td></tr>
        <tr><th>指示事項</th><td colspan="3">${checksHtml(doc, 'instruction', { cols2: true })}</td></tr>
        <tr><th>特記事項</th><td colspan="3">
          <div class="sub">${GROUPS.condition.label}</div>${checksHtml(doc, 'condition')}
          <div class="sub">${GROUPS.medical.label}</div>${checksHtml(doc, 'medical')}</td></tr>
        <tr><th>その他</th><td colspan="3">${text(doc.remarks)}</td></tr>
      </table>
      <p class="s-statement">${statement}</p>
      <table class="s-sign">
        <tr><th>医療機関名</th><td>${U.esc(settings.clinic)}</td></tr>
        <tr><th>所在地</th><td>${U.esc(settings.address)}</td></tr>
        <tr><th>電話番号</th><td>${U.esc(settings.tel)}${settings.fax ? `　　FAX ${U.esc(settings.fax)}` : ''}</td></tr>
        <tr><th>医師氏名</th><td>${doc.department ? `${U.esc(doc.department)}　` : ''}${U.esc(doc.doctor)}<span class="seal">印</span></td></tr>
      </table>`;
  }

  function renderPreview() {
    const doc = formToDoc();
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="sheet-inner">${buildSheet(doc)}</div>`;
    const shrink = fitSheet(sheet);
    const msgs = validate(doc);
    if (shrink < 1) msgs.push(`内容が多いため、A4 1枚に収まるよう ${Math.floor(shrink * 100)}% に縮小して印刷します。`);
    $('#form-warnings').innerHTML = msgs.map((m) => `<div class="warn">${U.esc(m)}</div>`).join('');
    fitPreview();
  }

  // 内容がA4 1枚を超える場合は縮小して収める。縮小率を返す
  function fitSheet(sheet) {
    const inner = sheet.querySelector('.sheet-inner');
    inner.style.transform = '';
    inner.style.width = '';
    const cs = getComputedStyle(sheet);
    const avail = sheet.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const scale = Math.min(1, avail / inner.scrollHeight);
    if (scale < 1) {
      inner.style.transform = `scale(${scale})`;
      inner.style.width = `${100 / scale}%`;
    }
    return scale;
  }

  function fitPreview() {
    const wrap = $('.preview-scroll');
    const sheet = $('#sheet');
    const scale = Math.min(1, (wrap.clientWidth - 16) / sheet.offsetWidth);
    const box = $('#preview-scale');
    box.style.transform = `scale(${scale})`;
    box.style.width = `${sheet.offsetWidth * scale}px`;
    box.style.height = `${sheet.offsetHeight * scale}px`;
  }

  function onFormChange(e) {
    // その他の内容を入力したら「その他」にもチェック
    if (e && e.target.name && e.target.name.startsWith('other_') && e.target.value.trim()) {
      const g = e.target.name.slice(6);
      const cb = form.querySelector(`input[name="chk_${g}"][value="${OTHER}"]`);
      if (cb) cb.checked = true;
    }
    if (e && ['pt_birth', 'createdDate'].includes(e.target.name)) updateAge();
    renderWareki();
    renderPreview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
  }

  function saveDraft() {
    write(KEYS.draft, { doc: formToDoc(), historyId: currentHistoryId });
    $('#draft-status').textContent = `入力内容を一時保存しました（${new Date().toLocaleTimeString('ja-JP')}）`;
  }

  // ---------- 印刷・履歴 ----------
  function printSheet() {
    const doc = formToDoc();
    const msgs = validate(doc);
    if (msgs.length && !confirm(`次の点を確認してください。\n\n${msgs.map((m) => `・${m}`).join('\n')}\n\nこのまま印刷しますか？`)) return;
    saveToHistory(doc);
    renderPreview();
    $('#print-area').innerHTML = $('#sheet').outerHTML.replace(' id="sheet"', '');
    window.print();
  }

  function saveToHistory(doc) {
    const now = new Date().toISOString();
    const idx = currentHistoryId ? history.findIndex((h) => h.id === currentHistoryId) : -1;
    if (idx >= 0) {
      history[idx] = Object.assign({}, history[idx], { doc, savedAt: now });
    } else {
      currentHistoryId = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      history.unshift({ id: currentHistoryId, savedAt: now, doc });
    }
    history = history.slice(0, HISTORY_LIMIT);
    write(KEYS.history, history);
    saveDraft();
  }

  function renderHistory() {
    const terms = $('#history-search').value.split(/[\s　]+/).map(U.normalize).filter(Boolean);
    const rows = history.filter((h) => {
      const hay = [h.doc.pt_name, h.doc.pt_kana, h.doc.pt_id, h.doc.pharmacy].map(U.normalize).join('\n');
      return terms.every((t) => hay.includes(t));
    });
    $('#history-table tbody').innerHTML = rows.map((h) => `<tr data-id="${h.id}"${h.id === currentHistoryId ? ' class="checked"' : ''}>
        <td>${U.esc(U.formatWareki(h.doc.createdDate))}</td>
        <td>${U.esc(h.doc.pt_name)}<br><small class="hint">${U.esc(h.doc.pt_kana)}${h.doc.pt_id ? `　ID:${U.esc(h.doc.pt_id)}` : ''}</small></td>
        <td>${U.esc(U.formatWareki(h.doc.periodStart))} 〜<br>${U.esc(U.formatWareki(h.doc.periodEnd))}</td>
        <td>${U.esc(h.doc.pharmacy)}</td>
        <td class="ops">
          <button type="button" class="btn small" data-act="open">開く</button>
          <button type="button" class="btn small" data-act="copy">複製して作成</button>
          <button type="button" class="btn small danger-outline" data-act="delete">削除</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">履歴はありません（「履歴に保存して印刷」で保存されます）</td></tr>';
  }

  function onHistoryClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const h = history.find((x) => x.id === btn.closest('tr').dataset.id);
    if (!h) return;
    if (btn.dataset.act === 'delete') {
      if (!confirm(`${h.doc.pt_name || '（氏名なし）'} 様の履歴を削除しますか？`)) return;
      history = history.filter((x) => x !== h);
      if (currentHistoryId === h.id) currentHistoryId = null;
      write(KEYS.history, history);
      renderHistory();
      return;
    }
    if (hasPatientInput(formToDoc()) && !confirm('入力中の内容は置き換わります。よろしいですか？')) return;
    if (btn.dataset.act === 'open') {
      loadDoc(h.doc, h.id);
    } else {
      const today = U.todayIso();
      loadDoc(Object.assign({}, h.doc, {
        createdDate: today,
        periodStart: today,
        periodEnd: U.periodEnd(today, defaults.months || MAX_MONTHS),
      }), null);
      updateAge();
      onFormChange();
    }
    $('#history-dialog').close();
  }

  // ---------- 設定 ----------
  function lines(v) {
    return v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  function openSettings() {
    $('#set-title').value = settings.title;
    $('#set-clinic').value = settings.clinic;
    $('#set-address').value = settings.address;
    $('#set-tel').value = settings.tel;
    $('#set-fax').value = settings.fax;
    $('#set-doctors').value = settings.doctors.join('\n');
    $('#set-departments').value = settings.departments.join('\n');
    $('#set-pharmacies').value = settings.pharmacies.join('\n');
    $('#settings-dialog').showModal();
  }

  function saveSettings() {
    Object.assign(settings, {
      title: $('#set-title').value.trim() || DEFAULT_SETTINGS.title,
      clinic: $('#set-clinic').value.trim(),
      address: $('#set-address').value.trim(),
      tel: $('#set-tel').value.trim(),
      fax: $('#set-fax').value.trim(),
      doctors: lines($('#set-doctors').value),
      departments: lines($('#set-departments').value),
      pharmacies: lines($('#set-pharmacies').value),
    });
    write(KEYS.settings, settings);
    $('#settings-dialog').close();
    renderSettingsLists();
    renderPreview();
  }

  function renderSettingsLists() {
    const opts = (arr) => arr.map((v) => `<option value="${U.esc(v)}"></option>`).join('');
    $('#doctor-list').innerHTML = opts(settings.doctors);
    $('#department-list').innerHTML = opts(settings.departments);
    $('#pharmacy-list').innerHTML = opts(settings.pharmacies);
    $('#clinic-summary').textContent = settings.clinic
      ? `医療機関: ${settings.clinic}　${settings.address}　TEL ${settings.tel}${settings.fax ? `　FAX ${settings.fax}` : ''}`
      : '医療機関名・所在地などは「医療機関・医師・薬局の設定」で登録します。';
  }

  function saveDefaults() {
    const doc = formToDoc();
    const fields = {};
    TEMPLATE_FIELDS.forEach((k) => { if (k in doc) fields[k] = doc[k]; });
    let months = defaults.months || MAX_MONTHS;
    if (doc.periodStart && doc.periodEnd) {
      const m = [1, 2, 3, 4, 5, 6].find((n) => U.periodEnd(doc.periodStart, n) === doc.periodEnd);
      if (m) months = m;
    }
    defaults = { months, fields };
    write(KEYS.defaults, defaults);
    alert(`次の項目を既定値として保存しました。「新規作成」でこの内容から始まります。\n\n・区分、宛先（薬局）、医師氏名、診療科\n・チェック項目（使用薬剤／在宅移行／依頼事項／訪問の目的／指示事項／特記事項）\n・指示期間の長さ：${months}か月`);
  }

  // ---------- 初期化 ----------
  function init() {
    settings = Object.assign({}, DEFAULT_SETTINGS, read(KEYS.settings, {}));
    defaults = read(KEYS.defaults, BUILTIN_DEFAULTS);
    history = read(KEYS.history, []);
    renderChecks();
    renderSettingsLists();
    $('#opt-show-unchecked').checked = settings.showUnchecked;

    window.Master.onEvent((type, p) => { if (type === 'pick') onPickPatient(p); });
    window.Master.init();

    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('input', onFormChange);
    form.addEventListener('change', onFormChange);
    document.querySelectorAll('[data-months]').forEach((b) => b.addEventListener('click', () => setPeriodMonths(Number(b.dataset.months))));

    $('#btn-new').addEventListener('click', () => {
      if (hasPatientInput(formToDoc()) && !confirm('入力中の内容を消去して、既定値から新規作成します。よろしいですか？')) return;
      loadDoc(newDoc(), null);
      $('#patient-search').focus();
    });
    $('#btn-save-default').addEventListener('click', saveDefaults);
    $('#btn-print').addEventListener('click', printSheet);
    $('#opt-show-unchecked').addEventListener('change', (e) => {
      settings.showUnchecked = e.target.checked;
      write(KEYS.settings, settings);
      renderPreview();
    });

    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-settings-cancel').addEventListener('click', () => $('#settings-dialog').close());
    $('#btn-settings-ok').addEventListener('click', saveSettings);

    $('#btn-history').addEventListener('click', () => { $('#history-search').value = ''; renderHistory(); $('#history-dialog').showModal(); });
    $('#btn-history-close').addEventListener('click', () => $('#history-dialog').close());
    $('#history-search').addEventListener('input', renderHistory);
    $('#history-table').addEventListener('click', onHistoryClick);

    $('#btn-clear-all').addEventListener('click', () => {
      if (!confirm('このブラウザに保存した患者マスタ・入力中の内容・作成履歴・設定・既定値をすべて削除します。よろしいですか？')) return;
      Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
      window.Master.clearStorage();
      settings = Object.assign({}, DEFAULT_SETTINGS);
      defaults = BUILTIN_DEFAULTS;
      history = [];
      renderSettingsLists();
      loadDoc(newDoc(), null);
      $('#draft-status').textContent = '';
    });

    window.addEventListener('resize', fitPreview);
    window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });

    const draft = read(KEYS.draft, null);
    if (draft && draft.doc) loadDoc(draft.doc, draft.historyId);
    else loadDoc(newDoc(), null);
  }

  window.App = { baseDate: () => form.elements.createdDate.value || U.todayIso() };
  init();
})();
