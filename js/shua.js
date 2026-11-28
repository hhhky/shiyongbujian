/**
 * 刷题部件：题库导入、五种模式刷题、错题本与统计
 * 交互与数据均在本机完成，不联网、不上传
 */
(function () {
  'use strict';

  var S = {
    loaded: false,
    banks: [],
    session: null,
    questions: [],
    questionMap: {},
    current: null,
    selected: [],
    answered: false,
    isCorrect: false,
    showAnswer: false,
    favorite: false,
    killed: false,
    fillValue: '',
    speedLeft: 0,
    examMode: false,
    examFinished: false,
    examReport: null,
    examAnswers: {},
    autoTimer: null,
    autoPaused: false,
    speedSec: 3,
    lastUsedMs: 0,
    sessionMs: 0,
    lastTimeMark: 0,
    questionStartAt: 0,
    parsed: null,
    setup: { bankId: null, mode: 'SEQUENTIAL', status: 'ALL', chapters: [], types: [], subtypes: [], bank: null, questions: [], count: 0 },
    wrongGroups: [],
    detail: null,
    editor: { bankId: null, list: [], qid: null },
    groups: [],
    search: '',
    searchResults: [],
    stats: null,
    statsBanks: [],
    heatYear: new Date().getFullYear(),
    heatMonth: new Date().getMonth()
  };

  try {
    var savedSpeed = Number(localStorage.getItem('shua-speed'));
    if (savedSpeed >= 1 && savedSpeed <= 10) S.speedSec = savedSpeed;
  } catch (e) { S.speedSec = 3; }

  function core() { return window.ShuaCore; }
  function store() { return window.ShuaStore; }

  function el(id) { return document.getElementById(id); }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function formatUsed(sec) {
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m < 60) return m + ' 分' + (s ? s + ' 秒' : '');
    return Math.floor(m / 60) + ' 时' + (m % 60) + ' 分';
  }

  function typeLabel(t) { return core().TYPE_LABELS[t] || ''; }

  function modeLabel(id) {
    var m = core().MODES.find(function (x) { return x.id === id; });
    return m ? m.text : '';
  }

  // ── 初始化 ────────────────────────────────
  var restorePromise = null;

  function ensureRestored() {
    if (!restorePromise) restorePromise = restoreSession();
    return restorePromise;
  }

  async function initShua() {
    await ensureRestored();
    return refreshShuaHeader();
  }

  async function restoreSession() {
    var saved = store().getSession();
    if (!saved || !saved.ids || !saved.ids.length) return;
    try {
      var qs;
      if (saved.bankId) {
        qs = await store().getQuestions(saved.bankId);
      } else {
        var bs = await store().getBanks();
        var lists = await Promise.all(bs.map(function (b) { return store().getQuestions(b.id); }));
        qs = [].concat.apply([], lists);
      }
      var map = {};
      qs.forEach(function (q) { map[q.qid] = q; });
      var ids = saved.ids.filter(function (id) { return map[id]; });
      if (!ids.length) { store().saveSession(null); return; }
      var records = saved.bankId ? await store().getRecordsByBank(saved.bankId) : await store().getRecords();
      S.questionMap = map;
      S.examAnswers = {};
      S.session = {
        bankId: saved.bankId,
        bankName: saved.bankName,
        mode: saved.mode,
        ids: ids,
        index: Math.min(saved.index || 0, ids.length - 1),
        filter: saved.filter || {},
        startedAt: saved.startedAt || Date.now(),
        results: core().lastResultMap(records)
      };
    } catch (e) {
      console.warn('恢复刷题会话失败', e);
    }
  }

  async function refreshShuaHeader() {
    S.banks = await store().getBanks();
    var badge = el('header-badge');
    if (badge) badge.textContent = S.banks.length + ' 个题库';
    var foot = el('sidebar-footer-text');
    if (foot) foot.textContent = S.banks.length + ' 个题库';
  }

  // ── 页面调度 ──────────────────────────────
  async function renderShua(page) {
    await ensureRestored();
    await refreshShuaHeader();
    if (page === 'shua-banks') return renderShuaBanks();
    if (page === 'shua-study') return renderShuaStudy();
    if (page === 'shua-wrong') return renderShuaWrong();
    if (page === 'shua-stats') return renderShuaStats();
  }

  // ── 题库页 ────────────────────────────────
  async function renderShuaBanks() {
    var box = el('shua-bank-list');
    if (!box) return;
    var banks = await store().getBanks();
    S.banks = banks;
    S.searchCache = null;
    if (el('shua-search-input') && !el('shua-search-input').value) el('shua-search-results').innerHTML = '';
    await renderShuaGroups();
    var records = await store().getRecords();
    if (!banks.length) {
      box.innerHTML = '<div class="shua-card p-7 text-center">'
        + '<p class="font-semibold text-sm" style="color: var(--text-primary);">还没有题库</p>'
        + '<p class="text-xs mt-1.5 mb-4 leading-relaxed" style="color: var(--text-tertiary);">支持 Excel、CSV，以及文字型 Word（.docx）和 PDF 题库；扫描件需要先转成文字。</p>'
        + '<button onclick="shuaOpenImport()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold">导入题库</button>'
        + '</div>';
      var foot0 = el('shua-bank-foot');
      if (foot0) foot0.classList.add('hidden');
      return;
    }
    box.innerHTML = banks.map(function (b) {
      var rs = records.filter(function (r) { return r.bankId === b.id; });
      var correct = rs.filter(function (r) { return r.correct; }).length;
      var accuracy = rs.length ? Math.round(correct / rs.length * 100) : null;
      var meta = (b.count || 0) + ' 题 · 已做 ' + rs.length + (accuracy === null ? '' : ' · 正确率 ' + accuracy + '%');
      return '<div class="shua-card p-4 flex items-center gap-3">'
        + '<button class="flex-1 min-w-0 text-left" onclick="shuaOpenSetup(' + b.id + ')">'
        + '<p class="font-semibold text-sm truncate" style="color: var(--text-primary);">' + esc(b.name) + '</p>'
        + '<p class="text-xs mt-1" style="color: var(--text-tertiary);">' + meta + '</p>'
        + '</button>'
        + '<button onclick="shuaOpenBankMenu(' + b.id + ')" class="shua-icon-btn" aria-label="题库操作">'
        + '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
        + '</button>'
        + '</div>';
    }).join('');
    var foot = el('shua-bank-foot');
    if (foot) foot.classList.remove('hidden');
  }

  // ── 导入题库 ──────────────────────────────
  var IMPORT_PROMPT = '请把我上传的 PDF 题库整理成 CSV 表格，只输出表格内容，不要任何解释。\n'
    + '要求：\n'
    + '1. 第一行固定表头：题干,A,B,C,D,E,F,答案,解析,章节\n'
    + '2. 每道题占一行，题干里不要带题号和选项\n'
    + '3. 选项按 A、B、C… 分列，没有的列留空\n'
    + '4. 答案只写字母，多选连写，如 AB\n'
    + '5. 解析和章节没有就留空\n'
    + '6. 用英文逗号分隔，字段里有逗号时用英文双引号包起来';

  function shuaOpenImport() {
    el('shua-import-guide-modal').classList.remove('hidden');
  }

  function shuaCloseImportGuide() {
    el('shua-import-guide-modal').classList.add('hidden');
  }

  function shuaCopyImportPrompt() {
    copyText(IMPORT_PROMPT);
    toast('提示词已复制');
  }

  function shuaGoImportPanel() {
    shuaCloseImportGuide();
    shuaOpenImportPanel();
  }

  function shuaOpenImportPanel() {
    S.parsed = null;
    el('shua-import-name').value = '';
    el('shua-import-text').value = '';
    el('shua-import-preview').innerHTML = '';
    el('shua-import-preview').classList.add('hidden');
    el('shua-import-result').classList.add('hidden');
    var banner = el('shua-import-target');
    if (banner) {
      if (S.importTarget) {
        banner.classList.remove('hidden');
        banner.textContent = '将追加到「' + S.importTarget.name + '」';
        el('shua-import-name').value = S.importTarget.name;
        el('shua-import-name').disabled = true;
      } else {
        banner.classList.add('hidden');
        el('shua-import-name').disabled = false;
      }
    }
    el('shua-import-modal').classList.remove('hidden');
  }

  function shuaCloseImport() {
    el('shua-import-modal').classList.add('hidden');
    S.importTarget = null;
    var banner = el('shua-import-target');
    if (banner) banner.classList.add('hidden');
    var nameInput = el('shua-import-name');
    if (nameInput) nameInput.disabled = false;
  }

  function shuaFillSample() {
    var sample = [
      {
        chapter: '第一章',
        type: '单选',
        stem: '以下哪项是质数？',
        options: ['A. 4', 'B. 7', 'C. 9', 'D. 15'],
        answer: 'B',
        analysis: '7 只能被 1 和它自身整除。'
      },
      {
        chapter: '第一章',
        type: '判断',
        stem: 'Java 是编译型语言。',
        answer: '对',
        analysis: 'Java 先编译成字节码，再由 JVM 执行。'
      }
    ];
    el('shua-import-text').value = JSON.stringify(sample, null, 2);
    el('shua-import-name').value = '示例题库';
    el('shua-import-preview').classList.add('hidden');
    el('shua-import-result').classList.add('hidden');
  }

  function readTextFile(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function rowsToCsv(rows) {
    return rows.map(function (row) {
      return (row || []).map(function (cell) {
        var s = String(cell == null ? '' : cell);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).filter(function (line) {
      return line.replace(/,/g, '').trim();
    }).join('\n');
  }

  async function shuaChooseFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    var name = file.name || '';
    try {
      var text;
      var lower = name.toLowerCase();
      if (/\.(xlsx|xls)$/.test(lower)) {
        if (typeof XLSX === 'undefined' && typeof loadScript === 'function') {
          try { await loadScript('js/xlsx.full.min.js'); } catch (e) { /* 下面统一提示 */ }
        }
        if (typeof XLSX === 'undefined') { toast('表格解析组件未加载，请先把表格另存为 CSV'); return; }
        var buf = await file.arrayBuffer();
        var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) { toast('表格里没有内容'); return; }
        var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
        text = rowsToCsv(rows);
      } else if (/\.docx$/.test(lower)) {
        if (typeof mammoth === 'undefined' && typeof loadScript === 'function') {
          try { await loadScript('js/mammoth.browser.min.js'); } catch (e) { /* 下面统一提示 */ }
        }
        if (typeof mammoth === 'undefined') { toast('Word 解析组件未加载'); return; }
        var ab = await file.arrayBuffer();
        var docx = await mammoth.extractRawText({ arrayBuffer: ab });
        text = docx.value || '';
      } else if (/\.pdf$/.test(lower)) {
        if (typeof pdfjsLib === 'undefined') { toast('PDF 解析组件未加载'); return; }
        var pb = await file.arrayBuffer();
        var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pb) }).promise;
        var parts = [];
        for (var p = 1; p <= pdf.numPages; p++) {
          var page = await pdf.getPage(p);
          var content = await page.getTextContent();
          // 按文本行的 y 坐标归并，尽量还原原始换行，题干/选项才不会被黏成一行
          var lines = {};
          content.items.forEach(function (it) {
            if (!it.str || !it.transform) return;
            var y = Math.round(it.transform[5]);
            if (!lines[y]) lines[y] = [];
            lines[y].push(it.str);
          });
          Object.keys(lines)
            .sort(function (a, b) { return Number(b) - Number(a); })
            .forEach(function (y) { parts.push(lines[y].join('').trim()); });
          parts.push('');
        }
        text = parts.join('\n');
        if (!text.trim()) { toast('这个 PDF 没有文字层，可能是扫描件'); return; }
      } else {
        text = await readTextFile(file);
      }
      el('shua-import-text').value = text;
      el('shua-import-name').value = name.replace(/\.[^.]+$/, '');
      el('shua-import-preview').classList.add('hidden');
      el('shua-import-result').classList.add('hidden');
      shuaPreviewImport();
    } catch (e) {
      toast('读取文件失败');
    }
  }

  function shuaDetectAndParse(text) {
    var t = String(text || '').trim();
    if (!t) throw new Error('内容为空');
    if (t[0] === '{' || t[0] === '[' || t.indexOf('```') === 0) return core().parseBankJson(text);
    var firstLine = (t.split(/\r?\n/)[0] || '');
    var looksCsv = firstLine.indexOf('\t') >= 0 ||
      (firstLine.split(',').length >= 3 && /题干|题目|stem|question/i.test(firstLine));
    if (looksCsv) return core().parseCsv(text);
    return core().parseTextBank(text);
  }

  function shuaPreviewImport() {
    var text = el('shua-import-text').value;
    var previewBox = el('shua-import-preview');
    var resultBox = el('shua-import-result');
    if (!String(text || '').trim()) { toast('先粘贴内容或选择文件'); return; }
    try {
      var parsed = shuaDetectAndParse(text);
      var typeCount = {};
      parsed.questions.forEach(function (q) { typeCount[q.type] = (typeCount[q.type] || 0) + 1; });
      var typeText = core().TYPES.filter(function (t) { return typeCount[t]; })
        .map(function (t) { return typeLabel(t) + ' ' + typeCount[t]; }).join('，');
      S.parsed = parsed;
      var samples = parsed.questions.slice(0, 3).map(function (q) {
        return q.stem.replace(/\s+/g, ' ').slice(0, 40);
      });
      previewBox.classList.remove('hidden');
      previewBox.innerHTML = '<p class="text-xs">识别到 <b>' + parsed.questions.length + '</b> 题'
        + (parsed.invalid ? '，跳过 ' + parsed.invalid + ' 条' : '') + '</p>'
        + (typeText ? '<p class="text-[11px] mt-1" style="color: var(--text-tertiary);">' + esc(typeText) + '</p>' : '')
        + samples.map(function (s, i) {
          return '<p class="text-[11px] mt-1 leading-relaxed" style="color: var(--text-secondary);">' + (i + 1) + '. ' + esc(s) + '</p>';
        }).join('');
      resultBox.classList.add('hidden');
      if (!el('shua-import-name').value && parsed.name) el('shua-import-name').value = parsed.name;
    } catch (e) {
      S.parsed = null;
      previewBox.classList.add('hidden');
      resultBox.classList.remove('hidden');
      resultBox.className = 'shua-result shua-result-bad';
      resultBox.textContent = '解析失败：' + (e.message || '未知错误');
    }
  }

  async function shuaConfirmImport() {
    if (!S.parsed) { toast('请先点「解析预览」'); return; }
    var resultBox = el('shua-import-result');
    try {
      if (S.importTarget) {
        var added = await store().addQuestions(S.importTarget.bankId, S.parsed.questions);
        var targetName = S.importTarget.name;
        shuaCloseImport();
        S.parsed = null;
        await renderShuaBanks();
        await refreshShuaHeader();
        toast('已向「' + targetName + '」追加 ' + added + ' 题');
        return;
      }
      var name = String(el('shua-import-name').value || '').trim() || S.parsed.name || '未命名题库';
      var id = await store().addBank(name, S.parsed.questions);
      shuaCloseImport();
      S.parsed = null;
      await renderShuaBanks();
      await refreshShuaHeader();
      toast('已导入「' + name + '」共 ' + (await store().getBank(id)).count + ' 题');
    } catch (e) {
      resultBox.classList.remove('hidden');
      resultBox.className = 'shua-result shua-result-bad';
      resultBox.textContent = '导入失败：' + (e.message || '未知错误');
    }
  }

  // ── 题库操作 ──────────────────────────────
  async function shuaOpenBankMenu(bankId) {
    var bank = await store().getBank(bankId);
    if (!bank) return;
    el('shua-bank-menu-title').textContent = bank.name;
    el('shua-bank-menu-meta').textContent = (bank.count || 0) + ' 题';
    el('shua-bank-menu-modal').dataset.bankId = String(bank.id);
    el('shua-bank-menu-modal').classList.remove('hidden');
  }

  function shuaCloseBankMenu() {
    el('shua-bank-menu-modal').classList.add('hidden');
  }

  async function shuaMenuStart() {
    var id = shuaMenuBankId();
    shuaCloseBankMenu();
    await shuaOpenSetup(id);
  }

  function shuaMenuBankId() {
    return Number(el('shua-bank-menu-modal').dataset.bankId);
  }

  async function shuaExportBank() {
    var id = shuaMenuBankId();
    shuaCloseBankMenu();
    try {
      var text = await store().exportBankJson(id);
      copyText(text);
      toast('题库 JSON 已复制');
    } catch (e) {
      toast(e.message || '导出失败');
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  async function shuaAskRename() {
    var id = shuaMenuBankId();
    var bank = await store().getBank(id);
    shuaCloseBankMenu();
    if (!bank) return;
    el('shua-rename-input').value = bank.name;
    el('shua-rename-modal').dataset.bankId = String(id);
    el('shua-rename-modal').classList.remove('hidden');
    setTimeout(function () { el('shua-rename-input').focus(); }, 120);
  }

  function shuaCancelRename() {
    el('shua-rename-modal').classList.add('hidden');
  }

  async function shuaDoRename() {
    var id = Number(el('shua-rename-modal').dataset.bankId);
    var name = String(el('shua-rename-input').value || '').trim();
    if (!name) { toast('名称不能为空'); return; }
    await store().renameBank(id, name);
    shuaCancelRename();
    await renderShuaBanks();
  }

  async function shuaDeleteBank() {
    var id = shuaMenuBankId();
    var bank = await store().getBank(id);
    shuaCloseBankMenu();
    if (!bank) return;
    if (!await confirmDialog('删除「' + bank.name + '」及 ' + (bank.count || 0) + ' 道题？作答记录会保留。')) return;
    await store().removeBank(id);
    if (S.session && S.session.bankId === id) {
      S.session = null;
      store().saveSession(null);
    }
    await renderShuaBanks();
    await refreshShuaHeader();
    toast('已删除');
  }

  // ── 开始设置 ──────────────────────────────
  async function shuaOpenSetup(bankId) {
    var bank = await store().getBank(bankId);
    if (!bank) return;
    var questions = await store().getQuestions(bankId);
    S.setup = {
      bankId: bank.id,
      groupId: null,
      groupBankIds: [],
      bank: bank,
      questions: questions,
      mode: 'SEQUENTIAL',
      status: 'ALL',
      chapters: [],
      types: [],
      subtypes: [],
      count: questions.length
    };
    await loadSetupContext();
    el('shua-setup-title').textContent = bank.name;
    el('shua-setup-modal').classList.remove('hidden');
    renderSetupSheet();
  }

  function shuaCloseSetup() {
    el('shua-setup-modal').classList.add('hidden');
  }

  function shuaSetupFiltered() {
    var lastResult = core().lastResultMap(S.setup.lastRecords || []);
    var flags = S.setup.flags || {};
    var list = core().filterQuestions(S.setup.questions, {
      chapters: S.setup.chapters,
      types: S.setup.types,
      status: S.setup.status
    }, lastResult, flags);
    var subs = S.setup.subtypes || [];
    if (subs.length) {
      list = list.filter(function (q) { return subs.indexOf(q.subtype || '') >= 0; });
    }
    return list;
  }
  function renderSetupSheet() {
    var box = el('shua-setup-body');
    if (!box) return;
    var questions = S.setup.questions || [];
    var chapters = core().chapterList(questions);
    var types = core().typeList(questions);
    var html = '';
    html += '<p class="shua-field-label">模式</p><div class="shua-chip-row">'
      + core().MODES.map(function (m) {
        return '<button class="shua-chip' + (S.setup.mode === m.id ? ' is-on' : '') + '" onclick="shuaSetMode(\'' + m.id + '\')">' + m.text + '</button>';
      }).join('') + '</div>';
    html += '<p class="shua-field-label">状态</p><div class="shua-chip-row">'
      + core().STATUS_OPTIONS.map(function (s) {
        return '<button class="shua-chip' + (S.setup.status === s.id ? ' is-on' : '') + '" onclick="shuaSetStatus(\'' + s.id + '\')">' + s.text + '</button>';
      }).join('') + '</div>';
    if (chapters.length > 1) {
      html += '<p class="shua-field-label">章节</p><div class="shua-chip-row">'
        + chapters.map(function (c) {
          return '<button class="shua-chip' + (S.setup.chapters.indexOf(c) >= 0 ? ' is-on' : '') + '" onclick="shuaToggleChapter(' + JSON.stringify(c).replace(/"/g, '&quot;') + ')">' + esc(c) + '</button>';
        }).join('') + '</div>';
    }
    if (types.length > 1) {
      html += '<p class="shua-field-label">题型</p><div class="shua-chip-row">'
        + types.map(function (t) {
          return '<button class="shua-chip' + (S.setup.types.indexOf(t) >= 0 ? ' is-on' : '') + '" onclick="shuaToggleType(\'' + t + '\')">' + typeLabel(t) + '</button>';
        }).join('') + '</div>';
    }
    var subtypes = [];
    questions.forEach(function (q) {
      if (q.subtype && subtypes.indexOf(q.subtype) < 0) subtypes.push(q.subtype);
    });
    if (subtypes.length > 1) {
      var chosenSubs = S.setup.subtypes || [];
      html += '<p class="shua-field-label">亚型</p><div class="shua-chip-row">'
        + subtypes.map(function (t) {
          return '<button class="shua-chip' + (chosenSubs.indexOf(t) >= 0 ? ' is-on' : '') + '" onclick="shuaToggleSubtype(\'' + t + '\')">' + esc(t) + ' 型</button>';
        }).join('') + '</div>';
    }
    if (S.setup.mode === 'SPEED') {
      html += '<p class="shua-field-label">速刷间隔</p><div class="shua-chip-row">'
        + [1, 2, 3, 4, 5, 6, 8, 10].map(function (n) {
          return '<button class="shua-chip' + (S.speedSec === n ? ' is-on' : '') + '" onclick="shuaSetSpeed(' + n + ')">' + n + ' 秒</button>';
        }).join('') + '</div>';
    }
    var count = shuaSetupFiltered().length;
    html += '<p class="text-center text-xs my-3" style="color: var(--text-tertiary);">当前筛选共 ' + count + ' 题</p>';
    html += '<button onclick="shuaBeginStudy()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold">开始刷题</button>';
    box.innerHTML = html;
  }

  async function loadSetupContext() {
    var records;
    if (S.setup.groupId) {
      var lists = await Promise.all((S.setup.groupBankIds || []).map(function (id) { return store().getRecordsByBank(id); }));
      records = [].concat.apply([], lists);
    } else {
      records = await store().getRecordsByBank(S.setup.bankId);
    }
    S.setup.lastRecords = records;
    S.setup.flags = await store().getFlags();
  }

  async function shuaSetMode(id) { S.setup.mode = id; renderSetupSheet(); }
  async function shuaSetStatus(id) { S.setup.status = id; await loadSetupContext(); renderSetupSheet(); }

  async function shuaToggleChapter(name) {
    var i = S.setup.chapters.indexOf(name);
    if (i >= 0) S.setup.chapters.splice(i, 1); else S.setup.chapters.push(name);
    await loadSetupContext();
    renderSetupSheet();
  }

  async function shuaToggleType(t) {
    var i = S.setup.types.indexOf(t);
    if (i >= 0) S.setup.types.splice(i, 1); else S.setup.types.push(t);
    await loadSetupContext();
    renderSetupSheet();
  }

  async function shuaToggleSubtype(t) {
    var i = S.setup.subtypes.indexOf(t);
    if (i >= 0) S.setup.subtypes.splice(i, 1); else S.setup.subtypes.push(t);
    renderSetupSheet();
  }

  async function shuaBeginStudy() {
    await loadSetupContext();
    var list = shuaSetupFiltered();
    if (!list.length) { toast('当前筛选没有题目'); return; }
    shuaCloseSetup();
    startSession(S.setup.groupId ? null : S.setup.bankId, S.setup.bank.name, list, S.setup.mode, {
      chapters: S.setup.chapters.slice(),
      types: S.setup.types.slice(),
      status: S.setup.status
    });
  }

  // 把当前会话已用时间累加到当天，防止切走 / 退出时漏记
  function shuaFlushSessionTime() {
    if (!S.session || !S.lastTimeMark) return;
    var delta = Math.round((Date.now() - S.lastTimeMark) / 1000);
    S.lastTimeMark = Date.now();
    if (delta >= 3) {
      try { store().addStudySeconds(delta); } catch (e) { /* ignore */ }
    }
  }

  function startSession(bankId, bankName, list, mode, filter) {
    shuaFlushSessionTime();
    var sequence = core().buildSequence(list, mode);
    var map = {};
    sequence.forEach(function (q) { map[q.qid] = q; });
    S.questionMap = map;
    S.examAnswers = {};
    S.session = {
      bankId: bankId,
      bankName: bankName,
      mode: mode,
      ids: sequence.map(function (q) { return q.qid; }),
      index: 0,
      filter: filter || {},
      results: {},
      startedAt: Date.now()
    };
    S.examMode = mode === 'EXAM';
    S.examFinished = false;
    S.examReport = null;
    S.lastTimeMark = Date.now();
    clearAutoNext();
    persistSession();
    loadCurrentQuestion();
    switchTab('shua-study');
  }

  function persistSession() {
    if (!S.session) { store().saveSession(null); return; }
    store().saveSession({
      bankId: S.session.bankId,
      bankName: S.session.bankName,
      mode: S.session.mode,
      ids: S.session.ids,
      index: S.session.index,
      filter: S.session.filter,
      startedAt: S.session.startedAt
    });
  }

  function loadCurrentQuestion() {
    var s = S.session;
    if (!s) { S.current = null; return; }
    var qid = s.ids[s.index];
    S.current = S.questionMap[qid] || null;
    S.questionStartAt = Date.now();
    S.lastUsedMs = 0;
    S.answered = false;
    S.isCorrect = false;
    S.fillValue = '';
    S.selected = [];
    S.showAnswer = s.mode === 'RECITE';
  }

  async function renderShuaStudy() {
    var root = el('shua-study-root');
    if (!root) return;
    if (S.examFinished && S.examReport) { renderExamReport(root); return; }
    if (S.session && !S.current && S.session.ids.length) loadCurrentQuestion();
    if (!S.session || !S.current) {
      root.innerHTML = '<div class="shua-card p-8 text-center">'
        + '<p class="font-semibold text-sm" style="color: var(--text-primary);">还没有开始刷题</p>'
        + '<p class="text-xs mt-1.5 mb-4 leading-relaxed" style="color: var(--text-tertiary);">回到题库选一本，设置模式和筛选后开始。</p>'
        + '<button onclick="switchTab(\'shua-banks\')" class="btn-shua w-full py-3 rounded-full text-sm font-semibold">去选题库</button>'
        + '</div>';
      return;
    }
    var s = S.session;
    var q = S.current;
    var flag = await store().getFlag(q.qid);
    S.favorite = !!flag.favorite;
    S.killed = !!flag.killed;
    S.starred = !!flag.starred;
    var isRecite = s.mode === 'RECITE';
    var revealed = isRecite || S.answered;
    var subjective = q.type === 'SHORT_ANSWER' || q.type === 'TERM';
    var fillMode = q.type === 'FILL';
    var optionCls = buildOptionClass(q, isRecite ? [] : S.selected, revealed);
    var progress = (s.index + 1) + ' / ' + s.ids.length;
    var last = s.index >= s.ids.length - 1;

    var html = '<div class="flex items-center justify-between gap-3 mb-4">'
      + '<button onclick="shuaExitStudy()" class="text-sm shrink-0" style="color: var(--text-secondary);">‹ 退出</button>'
      + '<div class="flex items-center gap-2 min-w-0">'
      + '<span class="text-sm font-semibold" style="color: var(--text-primary);">' + progress + '</span>'
      + '<span class="shua-pill">' + esc(modeLabel(s.mode)) + '</span>'
      + '</div>'
      + '<button onclick="shuaOpenSheet()" class="shua-pill shrink-0">答题卡</button>'
      + '</div>';

    html += '<div class="shua-swipe" ontouchstart="shuaSwipeStart(event)" ontouchmove="shuaSwipeMove(event)" ontouchend="shuaSwipeEnd(event)" ontouchcancel="shuaSwipeEnd(event)">';
    html += '<div id="shua-card" class="shua-card p-5 mb-4">';
    html += '<div class="flex items-center gap-2 mb-3 flex-wrap">'
      + '<span class="shua-pill is-accent">' + typeLabel(q.type) + '</span>'
      + (q.chapter ? '<span class="shua-pill">' + esc(q.chapter) + '</span>' : '')
      + '</div>';
    if (q.sharedStem) {
      html += '<div class="shua-shared mb-3">' + esc(q.sharedStem).replace(/\n/g, '<br>') + '</div>';
    }
    html += '<p class="shua-stem">' + esc(q.stem).replace(/\n/g, '<br>') + '</p>';

    if (!subjective && !fillMode) {
      html += (q.options || []).map(function (o) {
        return '<button class="shua-opt ' + (optionCls[o.key] || '') + '" onclick="shuaSelectOption(\'' + o.key + '\')">'
          + '<span class="shua-opt-key">' + esc(o.key) + '</span>'
          + '<span class="shua-opt-text">' + esc(o.text) + '</span>'
          + '</button>';
      }).join('');
      if (q.type === 'MULTIPLE' && !S.answered) {
        html += '<button onclick="shuaConfirmMulti()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold mt-2">'
          + (S.examMode ? '记录答案' : '确认答案') + '</button>';
      }
    } else if (fillMode) {
      html += '<input id="shua-fill-input" class="shua-input" placeholder="填写答案" value="' + esc(S.fillValue) + '" oninput="shuaOnFillInput(this.value)"' + (S.answered ? ' disabled' : '') + '>';
      if (!S.answered) {
        html += '<button onclick="shuaSubmitFill()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold mt-3">'
          + (S.examMode ? '记录答案' : '提交答案') + '</button>';
      }
    } else {
      if (!S.answered && !S.examMode) {
        html += '<div class="flex gap-3 mt-2">'
          + '<button onclick="shuaSelfJudge(false)" class="shua-plain-btn flex-1">没答对</button>'
          + '<button onclick="shuaSelfJudge(true)" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">答对了</button>'
          + '</div>';
      }
      if (S.examMode) {
        html += '<p class="text-[11px] mt-2" style="color: var(--text-tertiary);">主观题不参与自动判分，交卷后按未答处理。</p>';
      }
    }

    if (S.showAnswer) {
      html += '<div class="mt-4 pt-4" style="border-top: 0.5px solid rgba(128,128,128,0.18);">'
        + '<p class="text-sm font-semibold" style="color: #059669;">答案：' + esc(q.answer) + '</p>'
        + (q.analysis ? '<p class="text-xs mt-1.5 leading-relaxed whitespace-pre-wrap" style="color: var(--text-secondary);">' + esc(q.analysis) + '</p>' : '')
        + (S.answered && S.lastUsedMs ? '<p class="text-[11px] mt-2" style="color: var(--text-tertiary);">本题用时 ' + (S.lastUsedMs / 1000).toFixed(1) + ' 秒</p>' : '')
        + '</div>';
    }
    html += '</div></div>';

    html += '<div class="flex gap-3 mb-3">'
      + '<button onclick="shuaPrev()" class="shua-plain-btn flex-1' + (s.index > 0 ? '' : ' is-disabled') + '">上一题</button>'
      + (last
        ? (S.examMode
          ? '<button onclick="shuaFinishExam()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">交卷</button>'
          : '<button onclick="shuaExitStudy()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">完成</button>')
        : '<button onclick="shuaNext()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">下一题</button>')
      + '</div>';

    html += '<div class="flex justify-center gap-3 mt-1 flex-wrap">'
      + '<button onclick="shuaToggleFavorite()" class="shua-pill' + (S.favorite ? ' is-accent' : '') + '">' + (S.favorite ? '已收藏' : '收藏') + '</button>'
      + '<button onclick="shuaToggleStar()" class="shua-pill' + (S.starred ? ' is-accent' : '') + '">' + (S.starred ? '已标重点' : '重点') + '</button>'
      + '<button onclick="shuaToggleKill()" class="shua-pill' + (S.killed ? ' is-accent' : '') + '">' + (S.killed ? '已斩题' : '斩题') + '</button>'
      + '</div>';

    if (S.speedLeft > 0 || S.autoPaused) {
      html += '<div class="flex items-center justify-center gap-2 mt-3">'
        + '<p class="text-xs" style="color: var(--shua-accent);">' + (S.autoPaused ? '已暂停自动翻页' : (S.speedLeft + ' 秒后进入下一题')) + '</p>'
        + '<button onclick="shuaToggleAutoPause()" class="shua-pill' + (S.autoPaused ? ' is-accent' : '') + '">' + (S.autoPaused ? '继续' : '暂停') + '</button>'
        + '</div>';
    }

    root.innerHTML = html;
  }

  function renderExamReport(root) {
    var r = S.examReport;
    var html = '<div class="shua-card p-5">'
      + '<p class="font-bold text-sm mb-3" style="color: var(--text-primary);">测试报告</p>'
      + '<div class="grid grid-cols-3 gap-2.5 mb-4">'
      + '<div class="shua-ov"><p class="shua-ov-label">正确率</p><p class="shua-ov-value">' + r.accuracy + '%</p></div>'
      + '<div class="shua-ov"><p class="shua-ov-label">答对</p><p class="shua-ov-value">' + r.correct + '/' + r.total + '</p></div>'
      + '<div class="shua-ov"><p class="shua-ov-label">用时</p><p class="shua-ov-value">' + esc(r.usedText) + '</p></div>'
      + '</div>';
    if (r.chapters && r.chapters.length > 1) {
      html += '<p class="text-xs font-semibold mb-1.5" style="color: var(--text-secondary);">分章节正确率</p>'
        + r.chapters.map(function (c) {
          return '<div class="flex items-center gap-2 mb-1.5">'
            + '<span class="flex-1 min-w-0 truncate text-[11px]" style="color: var(--text-secondary);">' + esc(c.chapter) + '</span>'
            + '<span class="text-[11px] shrink-0" style="color: var(--text-tertiary);">' + c.correct + '/' + c.total + ' · ' + c.accuracy + '%</span>'
            + '</div><div class="shua-bar mb-2"><div class="shua-bar-fill" style="width:' + c.accuracy + '%"></div></div>';
        }).join('');
    }
    if (r.wrong.length) {
      html += '<p class="text-xs font-semibold mb-1.5" style="color: var(--text-secondary);">错题（点开看解析）</p>'
        + r.wrong.map(function (w, i) {
          return '<button class="block w-full text-left text-xs leading-relaxed py-1" style="color: var(--text-tertiary);" onclick="shuaOpenDetail(' + w.qid + ',' + (w.bankId || 0) + ')">' + (i + 1) + '. ' + esc(w.stem) + '</button>';
        }).join('');
    }
    html += '<button onclick="shuaCloseExam()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold mt-4">返回题库</button>'
      + '</div>';
    root.innerHTML = html;
  }

  function buildOptionClass(q, selected, revealed) {
    var map = {};
    var correctKeys = revealed ? (core().resolveToLetters(q.answer, q.options) || String(q.answer || '')).toUpperCase() : '';
    (q.options || []).forEach(function (o) {
      var cls = '';
      if (selected.indexOf(o.key) >= 0) cls += ' is-picked';
      if (revealed) {
        if (correctKeys.indexOf(o.key) >= 0) cls += ' is-right';
        else if (selected.indexOf(o.key) >= 0) cls += ' is-wrong';
      }
      map[o.key] = cls.trim();
    });
    return map;
  }

  // ── 左右滑动切题 ──────────────────────────
  var swipeState = null;

  function shuaSwipeStart(e) {
    if (!S.session || S.examFinished) return;
    var t = e.touches && e.touches[0];
    if (!t) return;
    swipeState = { x: t.clientX, y: t.clientY, dx: 0, horizontal: false, el: document.getElementById('shua-card') };
  }

  function shuaSwipeMove(e) {
    if (!swipeState) return;
    var t = e.touches && e.touches[0];
    if (!t) return;
    var dx = t.clientX - swipeState.x;
    var dy = t.clientY - swipeState.y;
    if (!swipeState.horizontal) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        swipeState.horizontal = true;
      } else if (Math.abs(dy) > 12) {
        swipeState = null;
        return;
      }
    }
    if (!swipeState.horizontal) return;
    if (e.cancelable) e.preventDefault();
    swipeState.dx = dx;
    if (swipeState.el) swipeState.el.style.transform = 'translateX(' + (dx * 0.55) + 'px)';
  }

  function shuaSwipeEnd() {
    if (!swipeState) return;
    var st = swipeState;
    swipeState = null;
    if (st.el) {
      st.el.style.transition = 'transform .18s ease';
      st.el.style.transform = '';
      setTimeout(function () { if (st.el) st.el.style.transition = ''; }, 200);
    }
    if (!st.horizontal) return;
    if (st.dx <= -70) shuaNext();
    else if (st.dx >= 70) shuaPrev();
  }

  // ── 题目详情 ──────────────────────────────
  async function shuaOpenDetail(qid, bankId) {
    var q = S.questionMap[qid];
    if (!q) {
      var id = Number(bankId) || Math.floor(Number(qid) / 1000000);
      if (!id) return;
      var list = await store().getQuestions(id);
      q = list.find(function (x) { return x.qid === Number(qid); });
    }
    if (!q) return;
    var flag = await store().getFlag(q.qid);
    S.detail = { q: q, flag: flag };
    renderDetail();
    el('shua-detail-modal').classList.remove('hidden');
  }

  function renderDetail() {
    var box = el('shua-detail-body');
    if (!box || !S.detail) return;
    var q = S.detail.q;
    var flag = S.detail.flag || {};
    var correctKeys = (core().resolveToLetters(q.answer, q.options) || String(q.answer || '')).toUpperCase();
    var html = '<div class="flex items-center gap-2 mb-3 flex-wrap">'
      + '<span class="shua-pill is-accent">' + typeLabel(q.type) + '</span>'
      + (q.chapter ? '<span class="shua-pill">' + esc(q.chapter) + '</span>' : '')
      + (flag.starred ? '<span class="shua-pill is-accent">重点</span>' : '')
      + (flag.favorite ? '<span class="shua-pill is-accent">已收藏</span>' : '')
      + '</div>';
    if (q.sharedStem) html += '<div class="shua-shared mb-3">' + esc(q.sharedStem).replace(/\n/g, '<br>') + '</div>';
    html += '<p class="shua-stem">' + esc(q.stem).replace(/\n/g, '<br>') + '</p>';
    if (q.options && q.options.length) {
      html += q.options.map(function (o) {
        var cls = correctKeys.indexOf(o.key) >= 0 ? ' is-right' : '';
        return '<div class="shua-opt ' + cls + '"><span class="shua-opt-key">' + esc(o.key) + '</span>'
          + '<span class="shua-opt-text">' + esc(o.text) + '</span></div>';
      }).join('');
    }
    html += '<div class="mt-4 pt-4" style="border-top: 0.5px solid rgba(128,128,128,0.18);">'
      + '<p class="text-sm font-semibold" style="color: #059669;">答案：' + esc(q.answer || '（暂无）') + '</p>'
      + (q.analysis ? '<p class="text-xs mt-1.5 leading-relaxed whitespace-pre-wrap" style="color: var(--text-secondary);">' + esc(q.analysis) + '</p>' : '')
      + '</div>';
    box.innerHTML = html;
  }

  function shuaCloseDetail() {
    el('shua-detail-modal').classList.add('hidden');
    S.detail = null;
  }

  async function shuaDetailFlag(field) {
    if (!S.detail) return;
    var qid = S.detail.q.qid;
    var next = !(S.detail.flag && S.detail.flag[field]);
    await store().setFlag(qid, field, next);
    S.detail.flag = S.detail.flag || {};
    S.detail.flag[field] = next;
    renderDetail();
    if (S.current && S.current.qid === qid) renderShuaStudy();
    toast(next ? (field === 'starred' ? '已标为重点' : '已收藏') : '已取消');
  }

  // ── 答题动作 ──────────────────────────────
  async function shuaSelectOption(key) {
    if (S.showAnswer || S.answered) return;
    var q = S.current;
    if (!q) return;
    if (q.type === 'MULTIPLE') {
      var i = S.selected.indexOf(key);
      if (i >= 0) S.selected.splice(i, 1); else S.selected.push(key);
      renderShuaStudy();
      return;
    }
    if (S.examMode) {
      S.examAnswers[q.qid] = [key];
      S.selected = [key];
      renderShuaStudy();
      return;
    }
    submitAnswer([key]);
  }

  async function shuaConfirmMulti() {
    if (!S.selected.length) { toast('请先选择答案'); return; }
    if (S.examMode) {
      if (S.current) S.examAnswers[S.current.qid] = S.selected.slice();
      toast('已记录');
      return;
    }
    submitAnswer(S.selected.slice());
  }

  function shuaOnFillInput(v) {
    S.fillValue = v;
  }

  async function shuaSubmitFill() {
    var q = S.current;
    if (!q) return;
    var value = String(S.fillValue || '').trim();
    if (!value) { toast('请先填写答案'); return; }
    if (S.examMode) {
      S.examAnswers[q.qid] = [value];
      toast('已记录');
      return;
    }
    await recordAnswer(value, core().judgeAnswer(q, value));
  }

  async function shuaSelfJudge(ok) {
    var q = S.current;
    if (!q || S.answered) return;
    await recordAnswer(ok ? String(q.answer || '') : '', ok);
  }

  async function submitAnswer(selected) {
    var q = S.current;
    if (!q) return;
    var answerText = selected.join('');
    var correct = core().judgeAnswer(q, answerText);
    await recordAnswer(answerText, correct, selected);
  }

  async function recordAnswer(answerText, correct, selected) {
    var q = S.current;
    if (!q || !S.session) return;
    var usedMs = Math.max(0, Date.now() - (S.questionStartAt || Date.now()));
    S.lastUsedMs = usedMs;
    S.session.results = S.session.results || {};
    S.session.results[q.qid] = !!correct;
    if (selected) S.selected = selected;
    S.answered = true;
    S.isCorrect = !!correct;
    S.showAnswer = true;
    renderShuaStudy();
    store().addRecord({
      bankId: q.bankId || S.session.bankId,
      qid: q.qid,
      answer: answerText,
      correct: !!correct,
      usedMs: usedMs,
      at: Date.now()
    });
    if (S.session.mode === 'SPEED') startAutoNext();
  }

  function startAutoNext() {
    clearAutoNext();
    S.autoPaused = false;
    S.speedLeft = S.speedSec;
    renderShuaStudy();
    S.autoTimer = setInterval(function () {
      if (S.autoPaused) return;
      S.speedLeft--;
      if (S.speedLeft <= 0) {
        var timer = S.autoTimer;
        S.autoTimer = null;
        S.speedLeft = 0;
        if (timer) clearInterval(timer);
        shuaNext();
      } else {
        renderShuaStudy();
      }
    }, 1000);
  }

  function clearAutoNext() {
    if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; }
    S.speedLeft = 0;
    S.autoPaused = false;
  }

  function shuaToggleAutoPause() {
    if (!S.autoTimer) return;
    S.autoPaused = !S.autoPaused;
    renderShuaStudy();
  }

  function shuaSetSpeed(n) {
    var v = Math.min(10, Math.max(1, Number(n) || 3));
    S.speedSec = v;
    try { localStorage.setItem('shua-speed', String(v)); } catch (e) { /* ignore */ }
    renderSetupSheet();
  }

  function shuaPauseAutoNext() {
    clearAutoNext();
    shuaFlushSessionTime();
  }

  async function shuaNext() {
    var s = S.session;
    if (!s) return;
    if (s.index >= s.ids.length - 1) {
      if (S.examMode && !S.examFinished) { shuaFinishExam(); }
      else if (!S.examMode) { toast('已经是最后一题'); }
      return;
    }
    clearAutoNext();
    s.index++;
    persistSession();
    loadCurrentQuestion();
    renderShuaStudy();
  }

  function shuaPrev() {
    var s = S.session;
    if (!s || s.index <= 0) return;
    clearAutoNext();
    s.index--;
    persistSession();
    loadCurrentQuestion();
    renderShuaStudy();
  }

  async function shuaExitStudy() {
    if (!await confirmDialog('退出刷题？退出后可在题库里重新开始。')) return;
    clearAutoNext();
    shuaFlushSessionTime();
    store().saveSession(null);
    S.session = null;
    S.current = null;
    S.examFinished = false;
    S.examReport = null;
    switchTab('shua-banks');
    renderShuaBanks();
  }

  async function shuaToggleFavorite() {
    var q = S.current;
    if (!q) return;
    S.favorite = !S.favorite;
    await store().setFlag(q.qid, 'favorite', S.favorite);
    toast(S.favorite ? '已收藏' : '已取消收藏');
    renderShuaStudy();
  }

  async function shuaToggleStar() {
    var q = S.current;
    if (!q) return;
    S.starred = !S.starred;
    await store().setFlag(q.qid, 'starred', S.starred);
    toast(S.starred ? '已标为重点' : '已取消重点');
    renderShuaStudy();
  }

  async function shuaToggleKill() {
    var q = S.current;
    if (!q) return;
    S.killed = !S.killed;
    await store().setFlag(q.qid, 'killed', S.killed);
    toast(S.killed ? '已斩题，标准模式不再出现' : '已恢复');
    renderShuaStudy();
  }

  // ── 答题卡 ────────────────────────────────
  async function shuaOpenSheet() {
    var s = S.session;
    if (!s) return;
    var html = '<div class="flex items-center gap-4 mb-3 flex-wrap text-[11px]" style="color: var(--text-tertiary);">'
      + '<span class="flex items-center gap-1.5"><span class="shua-dot"></span>未答</span>'
      + '<span class="flex items-center gap-1.5"><span class="shua-dot is-right"></span>答对</span>'
      + '<span class="flex items-center gap-1.5"><span class="shua-dot is-wrong"></span>答错</span>'
      + (S.examMode ? '<span class="flex items-center gap-1.5"><span class="shua-dot is-answered"></span>已答</span>' : '')
      + '</div>';
    html += '<div class="grid grid-cols-5 gap-2">'
      + s.ids.map(function (qid, i) {
        var status = 'undone';
        if (S.examMode) {
          var ans = S.examAnswers[qid];
          status = ans && ans.length ? 'answered' : 'undone';
        } else {
          var r = (s.results || {})[qid];
          status = r === true ? 'right' : r === false ? 'wrong' : 'undone';
        }
        var cls = 'shua-sheet-cell is-' + status + (i === s.index ? ' is-current' : '');
        return '<button class="' + cls + '" onclick="shuaJump(' + i + ')">' + (i + 1) + '</button>';
      }).join('')
      + '</div>';
    el('shua-sheet-body').innerHTML = html;
    el('shua-sheet-modal').classList.remove('hidden');
  }

  function shuaCloseSheet() {
    el('shua-sheet-modal').classList.add('hidden');
  }

  function shuaJump(index) {
    var s = S.session;
    if (!s || index < 0 || index >= s.ids.length) return;
    s.index = index;
    persistSession();
    shuaCloseSheet();
    loadCurrentQuestion();
    renderShuaStudy();
  }

  // ── 测试模式 ──────────────────────────────
  async function shuaFinishExam() {
    var s = S.session;
    if (!s) return;
    var ids = s.ids;
    var correct = 0;
    var wrong = [];
    var tasks = [];
    var chapterStat = {};
    ids.forEach(function (qid) {
      var q = S.questionMap[qid];
      var answer = (S.examAnswers[qid] || []).join('');
      var ok = q && core().judgeAnswer(q, answer);
      if (ok) correct++;
      else if (q) wrong.push({ qid: qid, bankId: q.bankId || s.bankId, stem: q.stem.slice(0, 40) });
      if (q) {
        var ck = q.chapter || '未分章';
        if (!chapterStat[ck]) chapterStat[ck] = { chapter: ck, total: 0, correct: 0 };
        chapterStat[ck].total++;
        if (ok) chapterStat[ck].correct++;
      }
      tasks.push(store().addRecord({
        bankId: (q && q.bankId) || s.bankId,
        qid: qid,
        answer: answer,
        correct: !!ok,
        usedMs: 0,
        at: Date.now()
      }));
    });
    await Promise.all(tasks);
    var usedSec = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    shuaFlushSessionTime();
    S.examFinished = true;
    S.examReport = {
      total: ids.length,
      correct: correct,
      accuracy: ids.length ? Math.round(correct / ids.length * 100) : 0,
      usedText: formatUsed(usedSec),
      wrong: wrong.slice(0, 30),
      chapters: Object.keys(chapterStat).map(function (k) {
        var c = chapterStat[k];
        return { chapter: c.chapter, total: c.total, correct: c.correct, accuracy: Math.round(c.correct / c.total * 100) };
      }).sort(function (a, b) { return a.accuracy - b.accuracy; })
    };
    store().saveSession(null);
    S.session = null;
    renderShuaStudy();
  }

  function shuaCloseExam() {
    S.examFinished = false;
    S.examReport = null;
    S.current = null;
    switchTab('shua-banks');
    renderShuaBanks();
  }

  // ── 错题本 ────────────────────────────────
  async function renderShuaWrong() {
    var box = el('shua-wrong-list');
    if (!box) return;
    var res = await Promise.all([store().getRecords(), store().getBanks()]);
    var lastResult = core().lastResultMap(res[0]);
    var banks = res[1];
    var wrongIds = Object.keys(lastResult).filter(function (qid) { return lastResult[qid] === false; }).map(Number);
    var groups = [];
    for (var i = 0; i < banks.length; i++) {
      var bank = banks[i];
      var qs = await store().getQuestions(bank.id);
      var hit = qs.filter(function (q) { return wrongIds.indexOf(q.qid) >= 0; });
      if (!hit.length) continue;
      groups.push({ bankId: bank.id, bankName: bank.name, items: hit.slice(0, 50) });
    }
    S.wrongGroups = groups;
    if (!groups.length) {
      box.innerHTML = '<div class="shua-card p-7 text-center">'
        + '<p class="font-semibold text-sm" style="color: var(--text-primary);">没有错题</p>'
        + '<p class="text-xs mt-1.5 leading-relaxed" style="color: var(--text-tertiary);">答错的题会自动收进来，可以单独重刷。</p>'
        + '</div>';
      return;
    }
    box.innerHTML = groups.map(function (g) {
      var head = '<div class="flex items-center justify-between gap-3 mb-2 px-1">'
        + '<p class="text-xs font-semibold truncate" style="color: var(--text-secondary);">' + esc(g.bankName) + '</p>'
        + '<button class="shua-pill is-accent shrink-0" onclick="shuaRetryWrong(' + g.bankId + ')">重刷本库</button>'
        + '</div>';
      var items = g.items.map(function (q) {
        return '<button class="shua-wrong-item" onclick="shuaOpenWrong(' + q.qid + ',' + g.bankId + ')">'
          + '<span class="flex-1 min-w-0 text-left text-xs leading-relaxed" style="color: var(--text-secondary);">' + esc(q.stem.slice(0, 50)) + '</span>'
          + '<span class="shua-pill shrink-0">' + typeLabel(q.type) + '</span>'
          + '</button>';
      }).join('');
      return '<div class="mb-4">' + head + items + '</div>';
    }).join('');
  }

  async function shuaOpenWrong(qid, bankId) {
    var qs = await store().getQuestions(bankId);
    var q = qs.find(function (x) { return x.qid === qid; });
    if (!q) return;
    var bank = await store().getBank(bankId) || { name: '' };
    startSession(bankId, bank.name, [q], 'RECITE', { status: 'WRONG' });
  }

  async function shuaRetryWrong(bankId) {
    var res = await Promise.all([store().getRecords(), store().getQuestions(bankId), store().getBank(bankId)]);
    var lastResult = core().lastResultMap(res[0].filter(function (r) { return r.bankId === Number(bankId); }));
    var questions = res[1].filter(function (q) { return lastResult[q.qid] === false; });
    if (!questions.length) { toast('本库没有错题'); return; }
    var bank = res[2] || { name: '' };
    startSession(bankId, bank.name, questions, 'SEQUENTIAL', { status: 'WRONG' });
  }

  // ── 统计 ──────────────────────────────────
  // ── 统计：时长 / 热力图 / 每日明细 ─────────
  function shuaDayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function shuaFormatMinutes(sec) {
    var s = Math.round(Number(sec) || 0);
    if (s < 60) return s + ' 秒';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    return h + ' 小时' + (m % 60 ? ' ' + (m % 60) + ' 分' : '');
  }

  function shuaCssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function shuaAccentRgba(alpha) {
    var hex = shuaCssVar('--shua-accent', '#7c3aed');
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 'rgba(124,58,237,' + alpha + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  // 答题量分档，配色与专注热力图同一套强度
  function shuaHeatLevel(n) {
    if (!n) return { bg: 'rgba(128,128,128,0.10)', strong: false };
    if (n <= 5) return { bg: shuaAccentRgba(0.18), strong: false };
    if (n <= 15) return { bg: shuaAccentRgba(0.34), strong: false };
    if (n <= 30) return { bg: shuaAccentRgba(0.50), strong: false };
    if (n <= 60) return { bg: shuaAccentRgba(0.66), strong: true };
    if (n <= 100) return { bg: shuaAccentRgba(0.82), strong: true };
    return { bg: shuaAccentRgba(0.96), strong: true };
  }

  function shuaHeatPrev() {
    S.heatMonth--;
    if (S.heatMonth < 0) { S.heatMonth = 11; S.heatYear--; }
    renderShuaStats();
  }

  function shuaHeatNext() {
    S.heatMonth++;
    if (S.heatMonth > 11) { S.heatMonth = 0; S.heatYear++; }
    renderShuaStats();
  }

  function shuaRoundRect(ctx, x, y, w, h, r) {
    if (w < 0) w = 0;
    if (h < 0) h = 0;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 与专注页的打卡热力图同一种画法：按月排布、圆角格子、越深表示越多
  function drawShuaHeatmap(byDay) {
    var c = el('shua-heatmap');
    if (!c) return;
    var y = S.heatYear;
    var m = S.heatMonth;
    var label = el('shua-heat-label');
    if (label) label.textContent = y + ' 年 ' + (m + 1) + ' 月';

    var dayCount = new Date(y, m + 1, 0).getDate();
    var firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
    var rows = Math.ceil((firstDow + dayCount) / 7);
    var parent = c.parentElement;
    var W = Math.floor((parent && parent.clientWidth) || c.clientWidth || 320);
    if (W < 120) W = 320;
    var gap = 4;
    var top = 20;
    var bottom = 4;
    var cell = Math.floor((W - gap * 6) / 7);
    cell = Math.max(18, Math.min(38, cell));
    var H = top + rows * (cell + gap) + bottom;

    var dpr = window.devicePixelRatio || 1;
    c.style.width = '100%';
    c.style.height = H + 'px';
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var gridW = 7 * cell + 6 * gap;
    var ox = Math.max(0, (W - gridW) / 2);
    var oy = 18;
    var textColor = shuaCssVar('--text-tertiary', '#8e8e93');
    var primary = shuaCssVar('--text-primary', '#1d1d1f');
    var todayKey = shuaDayKey(Date.now());

    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    var wd = ['一', '二', '三', '四', '五', '六', '日'];
    for (var w = 0; w < 7; w++) {
      ctx.fillText(wd[w], ox + w * (cell + gap) + cell / 2, 8);
    }

    for (var d = 1; d <= dayCount; d++) {
      var key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var n = byDay[key] || 0;
      var idx = firstDow + d - 1;
      var x = ox + (idx % 7) * (cell + gap);
      var yy = oy + Math.floor(idx / 7) * (cell + gap);
      var lvl = shuaHeatLevel(n);
      ctx.fillStyle = lvl.bg;
      shuaRoundRect(ctx, x, yy, cell, cell, 4);
      ctx.fill();

      ctx.font = (cell >= 30 ? '11px' : '9px') + ' -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = lvl.strong ? '#ffffff' : (n > 0 ? primary : textColor);
      ctx.fillText(String(d), x + cell / 2, yy + cell / 2 + 0.5);

      if (key === todayKey) {
        ctx.strokeStyle = lvl.strong ? 'rgba(255,255,255,0.95)' : shuaAccentRgba(0.95);
        ctx.lineWidth = 1.5;
        shuaRoundRect(ctx, x - 1, yy - 1, cell + 2, cell + 2, 5);
        ctx.stroke();
      }
    }
  }


  function renderDaily(box, records) {
    if (!box) return;
    var byDay = {};
    records.forEach(function (r) {
      var key = shuaDayKey(r.at || Date.now());
      var d = byDay[key] || (byDay[key] = { total: 0, correct: 0, last: {} });
      d.total++;
      if (r.correct) d.correct++;
      d.last[r.qid] = r.correct;
    });
    var keys = Object.keys(byDay).sort().reverse().slice(0, 14);
    if (!keys.length) {
      box.innerHTML = '<p class="text-xs text-center py-4" style="color: var(--text-tertiary);">还没有作答记录</p>';
      return;
    }
    box.innerHTML = keys.map(function (key) {
      var d = byDay[key];
      var wrong = Object.keys(d.last).filter(function (q) { return d.last[q] === false; }).length;
      return '<div class="flex items-center gap-2 py-1.5">'
        + '<span class="flex-1 text-xs" style="color: var(--text-primary);">' + key.slice(5).replace('-', '/') + '</span>'
        + '<span class="text-[11px]" style="color: var(--text-tertiary);">' + d.total + ' 题 · '
        + (d.total ? Math.round(d.correct / d.total * 100) : 0) + '%</span>'
        + (wrong ? '<button class="shua-pill is-accent" onclick="shuaRetryDay(\'' + key + '\')">当日错题 ' + wrong + '</button>' : '')
        + '</div>';
    }).join('');
  }

  function shuaRetryDay(key) {
    return Promise.all([store().getRecords(), store().getBanks()]).then(function (res) {
      var records = res[0];
      var banks = res[1];
      var last = {};
      records.filter(function (r) { return shuaDayKey(r.at || 0) === key; })
        .forEach(function (r) { last[r.qid] = r.correct; });
      var wrongIds = Object.keys(last).filter(function (q) { return last[q] === false; }).map(Number);
      if (!wrongIds.length) { toast('当天没有错题'); return; }
      return Promise.all(banks.map(function (b) { return store().getQuestions(b.id); })).then(function (lists) {
        var all = [].concat.apply([], lists);
        var list = all.filter(function (q) { return wrongIds.indexOf(q.qid) >= 0; });
        if (!list.length) { toast('题目已被删除'); return; }
        startSession(null, '当日错题', list, 'SEQUENTIAL', { status: 'WRONG' });
      });
    });
  }

  async function renderShuaStats() {
    var res = await Promise.all([store().getRecords(), store().getBanks(), store().getStudyTime()]);
    var records = res[0];
    var banks = res[1];
    var timeRows = res[2] || [];
    var recordCountEl = el('shua-record-count');
    if (recordCountEl) recordCountEl.textContent = '共 ' + records.length + ' 条';
    var questionCount = banks.reduce(function (n, b) { return n + (b.count || 0); }, 0);
    var stats = core().statsOf(records, null);
    var lastResult = core().lastResultMap(records);
    var wrongCount = Object.keys(lastResult).filter(function (k) { return lastResult[k] === false; }).length;

    var ov = el('shua-ov-grid');
    if (ov) {
      ov.innerHTML = [
        { label: '累计作答', value: stats.total + ' 次' },
        { label: '正确率', value: stats.accuracy + '%' },
        { label: '今日', value: stats.todayTotal + ' 次' },
        { label: '错题', value: wrongCount + ' 题' }
      ].map(function (c) {
        return '<div class="shua-ov-card"><p class="shua-ov-label">' + c.label + '</p><p class="shua-ov-value">' + c.value + '</p></div>';
      }).join('');
    }

    var todayKey = shuaDayKey(Date.now());
    var todaySec = 0;
    var totalSec = 0;
    timeRows.forEach(function (r) {
      totalSec += r.seconds || 0;
      if (r.date === todayKey) todaySec += r.seconds || 0;
    });
    var tToday = el('shua-time-today');
    if (tToday) tToday.textContent = shuaFormatMinutes(todaySec);
    var tAll = el('shua-time-all');
    if (tAll) tAll.textContent = shuaFormatMinutes(totalSec);

    var byDay = {};
    records.forEach(function (r) {
      var k = shuaDayKey(r.at || Date.now());
      byDay[k] = (byDay[k] || 0) + 1;
    });
    drawShuaHeatmap(byDay);
    renderDaily(el('shua-daily-list'), records);

    var rank = el('shua-rank-list');
    if (rank) {
      var rows = banks.map(function (b) {
        var rs = records.filter(function (r) { return r.bankId === b.id; });
        var done = rs.length;
        var correct = rs.filter(function (r) { return r.correct; }).length;
        return {
          id: b.id,
          name: b.name,
          count: b.count || 0,
          done: done,
          accuracy: done ? Math.round(correct / done * 100) : 0,
          barWidth: b.count ? Math.min(100, Math.round(done / b.count * 100)) : 0
        };
      }).sort(function (a, b) { return b.done - a.done; });
      if (!rows.length) {
        rank.innerHTML = '<p class="text-xs text-center py-6" style="color: var(--text-tertiary);">导入题库后这里会显示进度</p>';
      } else {
        rank.innerHTML = rows.map(function (r) {
          return '<div class="mb-3 last:mb-0">'
            + '<div class="flex items-center gap-2 mb-1.5">'
            + '<span class="flex-1 min-w-0 truncate text-xs" style="color: var(--text-primary);">' + esc(r.name) + '</span>'
            + '<span class="text-[11px] shrink-0" style="color: var(--text-tertiary);">' + r.done + '/' + r.count + ' · ' + r.accuracy + '%</span>'
            + '</div>'
            + '<div class="shua-bar"><div class="shua-bar-fill" style="width:' + r.barWidth + '%"></div></div>'
            + '</div>';
        }).join('');
      }
    }
    var side = el('shua-total-count');
    if (side) side.textContent = '共 ' + questionCount + ' 题';
  }

  // ── 题库组 ────────────────────────────────
  async function renderShuaGroups() {
    var box = el('shua-group-list');
    if (!box) return;
    var groups = await store().getGroups();
    S.groups = groups;
    if (!groups.length) { box.innerHTML = ''; return; }
    var banks = S.banks || [];
    box.innerHTML = groups.map(function (g) {
      var members = banks.filter(function (b) { return (g.bankIds || []).indexOf(b.id) >= 0; });
      var count = members.reduce(function (n, b) { return n + (b.count || 0); }, 0);
      return '<div class="shua-card p-4 flex items-center gap-3">'
        + '<button class="flex-1 min-w-0 text-left" onclick="shuaStartGroup(' + g.id + ')">'
        + '<p class="font-semibold text-sm truncate" style="color: var(--text-primary);">' + esc(g.name) + '</p>'
        + '<p class="text-xs mt-1" style="color: var(--text-tertiary);">' + members.length + ' 个题库 · ' + count + ' 题</p>'
        + '</button>'
        + '<button onclick="shuaOpenGroupManager()" class="shua-pill shrink-0">管理</button>'
        + '</div>';
    }).join('');
  }

  async function shuaStartGroup(id) {
    var res = await Promise.all([store().getGroups(), store().getBanks()]);
    var group = res[0].find(function (g) { return g.id === Number(id); });
    if (!group) return;
    var members = res[1].filter(function (b) { return (group.bankIds || []).indexOf(b.id) >= 0; });
    if (!members.length) { toast('组里还没有题库'); return; }
    var lists = await Promise.all(members.map(function (b) { return store().getQuestions(b.id); }));
    var questions = [].concat.apply([], lists);
    S.setup = {
      groupId: group.id,
      groupBankIds: (group.bankIds || []).slice(),
      bankId: null,
      bank: { name: group.name },
      questions: questions,
      mode: 'SEQUENTIAL',
      status: 'ALL',
      chapters: [],
      types: [],
      subtypes: [],
      count: questions.length
    };
    await loadSetupContext();
    el('shua-setup-title').textContent = group.name;
    el('shua-setup-modal').classList.remove('hidden');
    renderSetupSheet();
  }

  async function shuaOpenGroupManager() {
    S.banks = await store().getBanks();
    S.groups = await store().getGroups();
    S.groupEdit = null;
    renderGroupManager();
    el('shua-group-modal').classList.remove('hidden');
  }

  function shuaCloseGroupManager() {
    el('shua-group-modal').classList.add('hidden');
    S.groupEdit = null;
  }

  function renderGroupManager() {
    var box = el('shua-group-body');
    if (!box) return;
    if (S.groupEdit) {
      var edit = S.groupEdit;
      box.innerHTML = '<label class="shua-field-label">组名</label>'
        + '<input id="shua-group-name" class="shua-input mb-3" placeholder="例如：内科学" value="' + esc(edit.name) + '" oninput="shuaGroupNameInput(this.value)">'
        + '<p class="shua-field-label">包含题库</p>'
        + (S.banks.length ? S.banks.map(function (b) {
          var on = edit.bankIds.indexOf(b.id) >= 0;
          return '<button class="shua-menu-btn" onclick="shuaGroupToggleBank(' + b.id + ')" style="'
            + (on ? 'background: var(--shua-accent-soft); color: var(--shua-accent);' : '') + '">'
            + (on ? '✓ ' : '') + esc(b.name) + ' <span style="opacity:.6">（' + (b.count || 0) + ' 题）</span></button>';
        }).join('') : '<p class="text-xs" style="color: var(--text-tertiary);">还没有题库</p>')
        + '<div class="flex gap-3 mt-3">'
        + '<button onclick="shuaGroupCancel()" class="flex-1 py-3 rounded-[20px] font-semibold text-gray-500 bg-gray-100 text-sm">取消</button>'
        + '<button onclick="shuaGroupSave()" class="btn-shua flex-1 py-3 rounded-[20px] text-sm font-semibold">保存</button>'
        + '</div>';
      return;
    }
    box.innerHTML = (S.groups.length ? S.groups.map(function (g) {
      return '<div class="flex items-center gap-2 mb-2">'
        + '<span class="flex-1 min-w-0 truncate text-sm" style="color: var(--text-primary);">' + esc(g.name) + '</span>'
        + '<button class="shua-pill" onclick="shuaGroupEdit(' + g.id + ')">编辑</button>'
        + '<button class="shua-pill" onclick="shuaGroupDelete(' + g.id + ')">删除</button>'
        + '</div>';
    }).join('') : '<p class="text-xs text-center py-3" style="color: var(--text-tertiary);">还没有题库组</p>')
      + '<button onclick="shuaGroupNew()" class="btn-shua w-full py-3 rounded-[20px] text-sm font-semibold mt-3">＋ 新建题库组</button>';
  }

  function shuaGroupNew() {
    S.groupEdit = { id: null, name: '', bankIds: [] };
    renderGroupManager();
  }

  function shuaGroupEdit(id) {
    var g = (S.groups || []).find(function (x) { return x.id === Number(id); });
    if (!g) return;
    S.groupEdit = { id: g.id, name: g.name, bankIds: (g.bankIds || []).slice() };
    renderGroupManager();
  }

  function shuaGroupCancel() {
    S.groupEdit = null;
    renderGroupManager();
  }

  function shuaGroupNameInput(v) {
    if (S.groupEdit) S.groupEdit.name = v;
  }

  function shuaGroupToggleBank(id) {
    if (!S.groupEdit) return;
    var i = S.groupEdit.bankIds.indexOf(id);
    if (i >= 0) S.groupEdit.bankIds.splice(i, 1); else S.groupEdit.bankIds.push(id);
    renderGroupManager();
  }

  async function shuaGroupSave() {
    if (!S.groupEdit) return;
    var name = String((el('shua-group-name') || {}).value || '').trim();
    if (!name) { toast('请填写组名'); return; }
    if (!S.groupEdit.bankIds.length) { toast('至少选择一个题库'); return; }
    if (S.groupEdit.id) {
      await store().updateGroup(S.groupEdit.id, { name: name, bankIds: S.groupEdit.bankIds });
    } else {
      await store().addGroup(name, S.groupEdit.bankIds);
    }
    S.groupEdit = null;
    S.groups = await store().getGroups();
    renderGroupManager();
    await renderShuaBanks();
    toast('题库组已保存');
  }

  async function shuaGroupDelete(id) {
    if (!await confirmDialog('删除这个题库组？题库本身不会被删除。')) return;
    await store().removeGroup(id);
    S.groups = await store().getGroups();
    renderGroupManager();
    await renderShuaBanks();
  }

  // ── 追加题目 / 编辑器 ──────────────────────
  async function shuaMenuAppend() {
    var id = shuaMenuBankId();
    var bank = await store().getBank(id);
    shuaCloseBankMenu();
    if (!bank) return;
    S.importTarget = { bankId: id, name: bank.name };
    shuaOpenImportPanel();
  }

  async function shuaMenuEdit() {
    var id = shuaMenuBankId();
    shuaCloseBankMenu();
    await shuaOpenEditor(id);
  }

  async function shuaOpenEditor(bankId) {
    var bank = await store().getBank(bankId);
    if (!bank) return;
    var list = await store().getQuestions(bankId);
    S.editor = { bankId: bankId, list: list, qid: null };
    el('shua-editor-title').textContent = '编辑「' + bank.name + '」';
    renderEditor();
    el('shua-editor-modal').classList.remove('hidden');
  }

  function shuaCloseEditor() {
    el('shua-editor-modal').classList.add('hidden');
    S.editor = { bankId: null, list: [], qid: null };
  }

  function renderEditor() {
    var box = el('shua-editor-body');
    var e = S.editor;
    if (!box || !e || !e.bankId) return;

    if (e.qid) {
      var q = e.list.find(function (x) { return x.qid === e.qid; });
      if (!q) { e.qid = null; renderEditor(); return; }
      box.innerHTML = '<label class="shua-field-label">题干</label>'
        + '<textarea id="shua-edit-stem" rows="3" class="shua-input mb-2" style="resize:vertical">' + esc(q.stem) + '</textarea>'
        + '<div class="flex gap-2">'
        + '<div class="flex-1"><label class="shua-field-label">章节</label><input id="shua-edit-chapter" class="shua-input mb-2" value="' + esc(q.chapter || '') + '"></div>'
        + '<div class="flex-1"><label class="shua-field-label">题型</label><select id="shua-edit-type" class="shua-input mb-2">'
        + core().TYPES.map(function (t) { return '<option value="' + t + '"' + (q.type === t ? ' selected' : '') + '>' + typeLabel(t) + '</option>'; }).join('')
        + '</select></div></div>'
        + '<label class="shua-field-label">选项（每行一个，如 A. 选项内容；无选项留空）</label>'
        + '<textarea id="shua-edit-options" rows="4" class="shua-input mb-2" style="resize:vertical">'
        + esc((q.options || []).map(function (o) { return o.key + '. ' + o.text; }).join('\n')) + '</textarea>'
        + '<label class="shua-field-label">答案</label>'
        + '<input id="shua-edit-answer" class="shua-input mb-2" value="' + esc(q.answer || '') + '">'
        + '<label class="shua-field-label">解析</label>'
        + '<textarea id="shua-edit-analysis" rows="3" class="shua-input mb-2" style="resize:vertical">' + esc(q.analysis || '') + '</textarea>'
        + '<div class="flex gap-3 mt-2">'
        + '<button onclick="shuaEditorBack()" class="flex-1 py-3 rounded-[20px] font-semibold text-gray-500 bg-gray-100 text-sm">返回</button>'
        + '<button onclick="shuaEditorSave()" class="btn-shua flex-1 py-3 rounded-[20px] text-sm font-semibold">保存</button>'
        + '</div>';
      return;
    }

    var keyword = String(e.filter || '').toLowerCase();
    var list = e.list.filter(function (q) {
      if (!keyword) return true;
      return (q.stem + ' ' + (q.chapter || '')).toLowerCase().indexOf(keyword) >= 0;
    });
    box.innerHTML = '<input class="shua-input mb-3" placeholder="搜索题干或章节" value="' + esc(e.filter || '') + '" oninput="shuaEditorFilter(this.value)">'
      + '<div class="mb-3 max-h-[38vh] overflow-y-auto">'
      + (list.length ? list.map(function (q) {
        return '<button class="shua-wrong-item" onclick="shuaEditorPick(' + q.qid + ')">'
          + '<span class="flex-1 min-w-0 text-left text-xs leading-relaxed" style="color: var(--text-secondary);">' + q.id + '. ' + esc(q.stem.slice(0, 50)) + '</span>'
          + '<span class="shua-pill shrink-0">' + typeLabel(q.type) + '</span>'
          + '</button>';
      }).join('') : '<p class="text-xs text-center py-3" style="color: var(--text-tertiary);">没有匹配的题目</p>')
      + '</div>'
      + '<p class="shua-field-label">批量设置章节</p>'
      + '<div class="flex gap-2 mb-2">'
      + '<input id="shua-chapter-from" class="shua-input" placeholder="从第几题" inputmode="numeric">'
      + '<input id="shua-chapter-to" class="shua-input" placeholder="到第几题" inputmode="numeric">'
      + '</div>'
      + '<input id="shua-chapter-name" class="shua-input mb-2" placeholder="章节名，如 第二章">'
      + '<button onclick="shuaChapterApply()" class="shua-plain-btn w-full py-2.5 text-sm">应用到该范围</button>';
  }

  function shuaEditorFilter(v) {
    S.editor.filter = v;
    renderEditor();
  }

  function shuaEditorPick(qid) {
    S.editor.qid = Number(qid);
    renderEditor();
  }

  function shuaEditorBack() {
    S.editor.qid = null;
    renderEditor();
  }

  async function shuaEditorSave() {
    var e = S.editor;
    var q = e.list.find(function (x) { return x.qid === e.qid; });
    if (!q) return;
    var stem = el('shua-edit-stem').value.trim();
    if (!stem) { toast('题干不能为空'); return; }
    var optionsText = el('shua-edit-options').value.trim();
    var options = optionsText ? optionsText.split(/\n+/).map(function (line, i) {
      var m = /^([A-Za-z])\s*[.、．)）:：]?\s*([\s\S]*)$/.exec(line.trim());
      if (m) return { key: m[1].toUpperCase(), text: m[2].trim() };
      return { key: String.fromCharCode(65 + i), text: line.trim() };
    }).filter(function (o) { return o.text; }) : [];
    var updates = {
      stem: stem,
      chapter: el('shua-edit-chapter').value.trim(),
      answer: el('shua-edit-answer').value.trim(),
      analysis: el('shua-edit-analysis').value.trim(),
      type: el('shua-edit-type').value,
      options: options
    };
    await store().updateQuestion(q.qid, updates);
    Object.assign(q, updates);
    e.qid = null;
    renderEditor();
    toast('已保存');
  }

  async function shuaChapterApply() {
    var from = Number(el('shua-chapter-from').value);
    var to = Number(el('shua-chapter-to').value);
    var name = el('shua-chapter-name').value.trim();
    if (!from || !to || !name) { toast('填写题号范围与章节名'); return; }
    var n = await store().setChapterRange(S.editor.bankId, Math.min(from, to), Math.max(from, to), name);
    S.editor.list = await store().getQuestions(S.editor.bankId);
    renderEditor();
    toast('已更新 ' + n + ' 题');
  }

  // ── 全库搜索 ──────────────────────────────
  var searchTimer = null;

  function shuaSearch(term) {
    clearTimeout(searchTimer);
    var q = String(term || '').trim();
    var box = el('shua-search-results');
    if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    searchTimer = setTimeout(function () { runShuaSearch(q); }, 220);
  }

  async function runShuaSearch(term) {
    var box = el('shua-search-results');
    if (!S.searchCache) {
      var banks = await store().getBanks();
      var lists = await Promise.all(banks.map(function (b) { return store().getQuestions(b.id); }));
      S.searchCache = banks.map(function (b, i) { return { bank: b, questions: lists[i] }; });
    }
    var low = term.toLowerCase();
    var hits = [];
    S.searchCache.forEach(function (entry) {
      entry.questions.forEach(function (q) {
        if (hits.length >= 30) return;
        var hay = (q.stem + ' ' + (q.analysis || '') + ' ' + (q.options || []).map(function (o) { return o.text; }).join(' ')).toLowerCase();
        if (hay.indexOf(low) >= 0) hits.push({ q: q, bank: entry.bank });
      });
    });
    if (!hits.length) {
      box.innerHTML = '<p class="text-xs text-center py-2" style="color: var(--text-tertiary);">没有匹配的题目</p>';
      return;
    }
    box.innerHTML = hits.map(function (h) {
      return '<button class="shua-wrong-item" onclick="shuaOpenDetail(' + h.q.qid + ',' + h.bank.id + ')">'
        + '<span class="flex-1 min-w-0 text-left text-xs leading-relaxed" style="color: var(--text-secondary);">' + esc(h.q.stem.slice(0, 60)) + '</span>'
        + '<span class="shua-pill shrink-0">' + esc(h.bank.name.slice(0, 6)) + '</span>'
        + '</button>';
    }).join('');
  }

  // ── 作答记录批量删除 ─────────────────────
  async function shuaOpenDeleteRecords() {
    var res = await Promise.all([store().getBanks(), store().getRecords()]);
    var banks = res[0];
    var records = res[1];
    var sel = el('shua-records-bank');
    if (sel) {
      sel.innerHTML = '<option value="">全部题库</option>' + banks.map(function (b) {
        return '<option value="' + b.id + '">' + esc(b.name) + '（' + (b.count || 0) + ' 题）</option>';
      }).join('');
    }
    var summary = el('shua-records-summary');
    if (summary) summary.textContent = '当前共 ' + records.length + ' 条作答记录，可选择按题库删除或全部清空。';
    el('shua-records-modal').classList.remove('hidden');
  }

  function shuaCloseDeleteRecords() {
    el('shua-records-modal').classList.add('hidden');
  }

  async function shuaConfirmDeleteRecords() {
    var raw = el('shua-records-bank').value;
    var count = 0;
    try {
      if (raw) count = await store().deleteRecordsByBank(Number(raw));
      else count = await store().deleteAllRecords();
    } catch (e) {
      toast('删除失败：' + (e.message || '未知错误'));
      return;
    }
    shuaCloseDeleteRecords();
    toast('已删除 ' + count + ' 条作答记录');
    await renderShuaStats();
    await renderShuaWrong();
  }

  // ── 全量导出 / 导入 ──────────────────────
  async function shuaExportAllData() {
    try {
      var text = await store().exportAll();
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'shua-data-' + shuaDayKey(Date.now()).replace(/-/g, '') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      toast('已导出全部刷题数据');
    } catch (e) {
      toast('导出失败：' + (e.message || '未知错误'));
    }
  }

  function shuaImportAllOpen() {
    var input = el('shua-all-file');
    if (input) input.click();
  }

  function shuaImportAllChosen(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    input.value = '';
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ''));
        if (!data || data.app !== 'shiyongbujian-shua') throw new Error('不是本 App 导出的刷题数据');
        S.pendingImport = data;
        var bankCount = (data.banks || []).length;
        var qCount = (data.questions || []).length;
        var rCount = (data.records || []).length;
        el('shua-data-summary').textContent = '共 ' + bankCount + ' 个题库、' + qCount + ' 道题'
          + (rCount ? '、' + rCount + ' 条作答记录' : '') + '。追加导入只添加题库内容，覆盖导入会先清空现有题库与进度。';
        el('shua-data-modal').classList.remove('hidden');
      } catch (e) {
        toast('读取失败：' + (e.message || '格式错误'));
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  }

  function shuaCloseDataModal() {
    el('shua-data-modal').classList.add('hidden');
    S.pendingImport = null;
  }

  async function shuaImportAll(mode) {
    var data = S.pendingImport;
    if (!data) return;
    if (mode === 'replace' && !await confirmDialog('覆盖导入会清空现有题库、进度与标记，确定继续？')) return;
    try {
      await store().importAll(data, mode);
      if (mode === 'replace') {
        store().saveSession(null);
        S.session = null;
        S.current = null;
      }
      shuaCloseDataModal();
      await renderShuaBanks();
      await refreshShuaHeader();
      toast(mode === 'replace' ? '已覆盖导入' : '已追加导入');
    } catch (e) {
      toast('导入失败：' + (e.message || '未知错误'));
    }
  }

  // ── 导出到全局（供 onclick 调用）────────────
  window.initShua = initShua;
  window.renderShua = renderShua;
  window.renderShuaBanks = renderShuaBanks;
  window.renderShuaStudy = renderShuaStudy;
  window.renderShuaWrong = renderShuaWrong;
  window.renderShuaStats = renderShuaStats;
  window.shuaPauseAutoNext = shuaPauseAutoNext;
  window.shuaFlushSessionTime = shuaFlushSessionTime;
  window.shuaToggleAutoPause = shuaToggleAutoPause;
  window.shuaSetSpeed = shuaSetSpeed;
  window.shuaSwipeStart = shuaSwipeStart;
  window.shuaSwipeMove = shuaSwipeMove;
  window.shuaSwipeEnd = shuaSwipeEnd;
  window.shuaOpenDetail = shuaOpenDetail;
  window.shuaCloseDetail = shuaCloseDetail;
  window.shuaDetailFlag = shuaDetailFlag;
  window.shuaToggleStar = shuaToggleStar;
  window.shuaOpenImport = shuaOpenImport;
  window.shuaCloseImportGuide = shuaCloseImportGuide;
  window.shuaCopyImportPrompt = shuaCopyImportPrompt;
  window.shuaGoImportPanel = shuaGoImportPanel;
  window.shuaOpenImportPanel = shuaOpenImportPanel;
  window.shuaCloseImport = shuaCloseImport;
  window.shuaFillSample = shuaFillSample;
  window.shuaChooseFile = shuaChooseFile;
  window.shuaPreviewImport = shuaPreviewImport;
  window.shuaConfirmImport = shuaConfirmImport;
  window.shuaOpenBankMenu = shuaOpenBankMenu;
  window.shuaCloseBankMenu = shuaCloseBankMenu;
  window.shuaMenuStart = shuaMenuStart;
  window.shuaExportBank = shuaExportBank;
  window.shuaAskRename = shuaAskRename;
  window.shuaCancelRename = shuaCancelRename;
  window.shuaDoRename = shuaDoRename;
  window.shuaDeleteBank = shuaDeleteBank;
  window.shuaOpenSetup = shuaOpenSetup;
  window.shuaCloseSetup = shuaCloseSetup;
  window.shuaSetMode = shuaSetMode;
  window.shuaSetStatus = shuaSetStatus;
  window.shuaToggleChapter = shuaToggleChapter;
  window.shuaToggleType = shuaToggleType;
  window.shuaToggleSubtype = shuaToggleSubtype;
  window.shuaBeginStudy = shuaBeginStudy;
  window.shuaSelectOption = shuaSelectOption;
  window.shuaConfirmMulti = shuaConfirmMulti;
  window.shuaOnFillInput = shuaOnFillInput;
  window.shuaSubmitFill = shuaSubmitFill;
  window.shuaSelfJudge = shuaSelfJudge;
  window.shuaNext = shuaNext;
  window.shuaPrev = shuaPrev;
  window.shuaExitStudy = shuaExitStudy;
  window.shuaToggleFavorite = shuaToggleFavorite;
  window.shuaToggleKill = shuaToggleKill;
  window.shuaOpenSheet = shuaOpenSheet;
  window.shuaCloseSheet = shuaCloseSheet;
  window.shuaJump = shuaJump;
  window.shuaFinishExam = shuaFinishExam;
  window.shuaCloseExam = shuaCloseExam;
  window.shuaOpenWrong = shuaOpenWrong;
  window.shuaRetryWrong = shuaRetryWrong;
  window.shuaStartGroup = shuaStartGroup;
  window.shuaOpenGroupManager = shuaOpenGroupManager;
  window.shuaCloseGroupManager = shuaCloseGroupManager;
  window.shuaGroupNew = shuaGroupNew;
  window.shuaGroupEdit = shuaGroupEdit;
  window.shuaGroupCancel = shuaGroupCancel;
  window.shuaGroupNameInput = shuaGroupNameInput;
  window.shuaGroupToggleBank = shuaGroupToggleBank;
  window.shuaGroupSave = shuaGroupSave;
  window.shuaGroupDelete = shuaGroupDelete;
  window.shuaMenuAppend = shuaMenuAppend;
  window.shuaMenuEdit = shuaMenuEdit;
  window.shuaOpenEditor = shuaOpenEditor;
  window.shuaCloseEditor = shuaCloseEditor;
  window.shuaEditorFilter = shuaEditorFilter;
  window.shuaEditorPick = shuaEditorPick;
  window.shuaEditorBack = shuaEditorBack;
  window.shuaEditorSave = shuaEditorSave;
  window.shuaChapterApply = shuaChapterApply;
  window.shuaSearch = shuaSearch;
  window.shuaExportAllData = shuaExportAllData;
  window.shuaImportAllOpen = shuaImportAllOpen;
  window.shuaImportAllChosen = shuaImportAllChosen;
  window.shuaCloseDataModal = shuaCloseDataModal;
  window.shuaImportAll = shuaImportAll;
  window.shuaOpenDeleteRecords = shuaOpenDeleteRecords;
  window.shuaCloseDeleteRecords = shuaCloseDeleteRecords;
  window.shuaConfirmDeleteRecords = shuaConfirmDeleteRecords;

  window.shuaHeatPrev = shuaHeatPrev;
  window.shuaHeatNext = shuaHeatNext;
  window.shuaRetryDay = shuaRetryDay;

  // 切到后台时把本次刷题时长补记到当天
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') shuaFlushSessionTime();
  });
})();
