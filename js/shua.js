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
    questionStartAt: 0,
    parsed: null,
    setup: { bankId: null, mode: 'SEQUENTIAL', status: 'ALL', chapters: [], types: [], bank: null, questions: [], count: 0 },
    wrongGroups: [],
    stats: null,
    statsBanks: []
  };

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
      var qs = await store().getQuestions(saved.bankId);
      var map = {};
      qs.forEach(function (q) { map[q.qid] = q; });
      var ids = saved.ids.filter(function (id) { return map[id]; });
      if (!ids.length) { store().saveSession(null); return; }
      var records = await store().getRecordsByBank(saved.bankId);
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
    var records = await store().getRecords();
    if (!banks.length) {
      box.innerHTML = '<div class="shua-card p-7 text-center">'
        + '<p class="font-semibold text-sm" style="color: var(--text-primary);">还没有题库</p>'
        + '<p class="text-xs mt-1.5 mb-4 leading-relaxed" style="color: var(--text-tertiary);">支持 JSON、CSV 和纯文本题目，也可以粘贴其他设备导出的题库。</p>'
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
  function shuaOpenImport() {
    S.parsed = null;
    el('shua-import-name').value = '';
    el('shua-import-text').value = '';
    el('shua-import-preview').innerHTML = '';
    el('shua-import-preview').classList.add('hidden');
    el('shua-import-result').classList.add('hidden');
    el('shua-import-modal').classList.remove('hidden');
  }

  function shuaCloseImport() {
    el('shua-import-modal').classList.add('hidden');
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

  function shuaChooseFile(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      el('shua-import-text').value = String(reader.result || '');
      el('shua-import-name').value = (file.name || '').replace(/\.[^.]+$/, '');
      el('shua-import-preview').classList.add('hidden');
      el('shua-import-result').classList.add('hidden');
      shuaPreviewImport();
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
    input.value = '';
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
    var name = String(el('shua-import-name').value || '').trim() || S.parsed.name || '未命名题库';
    var resultBox = el('shua-import-result');
    try {
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
      bank: bank,
      questions: questions,
      mode: 'SEQUENTIAL',
      status: 'ALL',
      chapters: [],
      types: [],
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
    return core().filterQuestions(S.setup.questions, {
      chapters: S.setup.chapters,
      types: S.setup.types,
      status: S.setup.status
    }, lastResult, flags);
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
    var count = shuaSetupFiltered().length;
    html += '<p class="text-center text-xs my-3" style="color: var(--text-tertiary);">当前筛选共 ' + count + ' 题</p>';
    html += '<button onclick="shuaBeginStudy()" class="btn-shua w-full py-3 rounded-full text-sm font-semibold">开始刷题</button>';
    box.innerHTML = html;
  }

  async function loadSetupContext() {
    var res = await Promise.all([
      store().getRecordsByBank(S.setup.bankId),
      store().getFlags()
    ]);
    S.setup.lastRecords = res[0];
    S.setup.flags = res[1];
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

  async function shuaBeginStudy() {
    await loadSetupContext();
    var list = shuaSetupFiltered();
    if (!list.length) { toast('当前筛选没有题目'); return; }
    shuaCloseSetup();
    startSession(S.setup.bankId, S.setup.bank.name, list, S.setup.mode, {
      chapters: S.setup.chapters.slice(),
      types: S.setup.types.slice(),
      status: S.setup.status
    });
  }

  function startSession(bankId, bankName, list, mode, filter) {
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

    html += '<div class="shua-card p-5 mb-4">';
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
        + '</div>';
    }
    html += '</div>';

    html += '<div class="flex gap-3 mb-3">'
      + '<button onclick="shuaPrev()" class="shua-plain-btn flex-1' + (s.index > 0 ? '' : ' is-disabled') + '">上一题</button>'
      + (last
        ? (S.examMode
          ? '<button onclick="shuaFinishExam()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">交卷</button>'
          : '<button onclick="shuaExitStudy()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">完成</button>')
        : '<button onclick="shuaNext()" class="btn-shua flex-1 py-3 rounded-full text-sm font-semibold">下一题</button>')
      + '</div>';

    html += '<div class="flex justify-center gap-3 mt-1">'
      + '<button onclick="shuaToggleFavorite()" class="shua-pill' + (S.favorite ? ' is-accent' : '') + '">' + (S.favorite ? '已收藏' : '收藏') + '</button>'
      + '<button onclick="shuaToggleKill()" class="shua-pill' + (S.killed ? ' is-accent' : '') + '">' + (S.killed ? '已斩题' : '斩题') + '</button>'
      + '</div>';

    if (S.speedLeft > 0) {
      html += '<p class="text-center text-xs mt-3" style="color: var(--shua-accent);">' + S.speedLeft + ' 秒后进入下一题</p>';
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
    if (r.wrong.length) {
      html += '<p class="text-xs font-semibold mb-1.5" style="color: var(--text-secondary);">错题</p>'
        + r.wrong.map(function (w, i) {
          return '<p class="text-xs leading-relaxed py-0.5" style="color: var(--text-tertiary);">' + (i + 1) + '. ' + esc(w.stem) + '</p>';
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
    S.session.results = S.session.results || {};
    S.session.results[q.qid] = !!correct;
    if (selected) S.selected = selected;
    S.answered = true;
    S.isCorrect = !!correct;
    S.showAnswer = true;
    renderShuaStudy();
    store().addRecord({
      bankId: S.session.bankId,
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
    S.speedLeft = 3;
    renderShuaStudy();
    S.autoTimer = setInterval(function () {
      S.speedLeft--;
      if (S.speedLeft <= 0) {
        clearAutoNext();
        shuaNext();
      } else {
        renderShuaStudy();
      }
    }, 1000);
  }

  function clearAutoNext() {
    if (S.autoTimer) { clearInterval(S.autoTimer); S.autoTimer = null; }
    S.speedLeft = 0;
  }

  function shuaPauseAutoNext() {
    clearAutoNext();
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
    ids.forEach(function (qid) {
      var q = S.questionMap[qid];
      var answer = (S.examAnswers[qid] || []).join('');
      var ok = q && core().judgeAnswer(q, answer);
      if (ok) correct++;
      else if (q) wrong.push({ qid: qid, stem: q.stem.slice(0, 40) });
      tasks.push(store().addRecord({
        bankId: s.bankId,
        qid: qid,
        answer: answer,
        correct: !!ok,
        usedMs: 0,
        at: Date.now()
      }));
    });
    await Promise.all(tasks);
    var usedSec = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    S.examFinished = true;
    S.examReport = {
      total: ids.length,
      correct: correct,
      accuracy: ids.length ? Math.round(correct / ids.length * 100) : 0,
      usedText: formatUsed(usedSec),
      wrong: wrong.slice(0, 30)
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
  async function renderShuaStats() {
    var res = await Promise.all([store().getRecords(), store().getBanks()]);
    var records = res[0];
    var banks = res[1];
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

  // ── 导出到全局（供 onclick 调用）────────────
  window.initShua = initShua;
  window.renderShua = renderShua;
  window.renderShuaBanks = renderShuaBanks;
  window.renderShuaStudy = renderShuaStudy;
  window.renderShuaWrong = renderShuaWrong;
  window.renderShuaStats = renderShuaStats;
  window.shuaPauseAutoNext = shuaPauseAutoNext;
  window.shuaOpenImport = shuaOpenImport;
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
})();
