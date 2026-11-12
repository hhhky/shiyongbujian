/**
 * 刷题核心：题库解析、题型归一、判分、筛选、统计
 * 移植自 review-miniapp 的 utils/shua-core.js，逻辑保持一致，仅去掉 CommonJS 导出
 */
(function () {
  'use strict';

  const TYPES = ['SINGLE', 'MULTIPLE', 'JUDGE', 'FILL', 'SHORT_ANSWER', 'TERM'];

  const TYPE_LABELS = {
    SINGLE: '单选',
    MULTIPLE: '多选',
    JUDGE: '判断',
    FILL: '填空',
    SHORT_ANSWER: '简答',
    TERM: '名词解释'
  };

  const SUBTYPES = ['A1', 'A2', 'A3', 'B'];

  const STATUS_OPTIONS = [
    { id: 'ALL', text: '全部' },
    { id: 'UNDONE', text: '未做' },
    { id: 'WRONG', text: '错题' },
    { id: 'FAVORITE', text: '收藏' },
    { id: 'KILLED', text: '已斩' }
  ];

  const MODES = [
    { id: 'SEQUENTIAL', text: '标准' },
    { id: 'SPEED', text: '速刷' },
    { id: 'RECITE', text: '背题' },
    { id: 'RANDOM', text: '随机' },
    { id: 'EXAM', text: '测试' }
  ];

  const TYPE_ALIASES = {
    '单选': 'SINGLE', '单选题': 'SINGLE', '单项选择': 'SINGLE', '单项选择题': 'SINGLE',
    'single': 'SINGLE', 'radio': 'SINGLE', 'singlechoice': 'SINGLE', 'choice': 'SINGLE',
    '多选': 'MULTIPLE', '多选题': 'MULTIPLE', '多项选择': 'MULTIPLE', '多项选择题': 'MULTIPLE',
    'multiple': 'MULTIPLE', 'checkbox': 'MULTIPLE', 'multiplechoice': 'MULTIPLE',
    '判断': 'JUDGE', '判断题': 'JUDGE', 'judge': 'JUDGE', 'truefalse': 'JUDGE', 'boolean': 'JUDGE',
    '填空': 'FILL', '填空题': 'FILL', 'fill': 'FILL', 'blank': 'FILL',
    '简答': 'SHORT_ANSWER', '简答题': 'SHORT_ANSWER', '问答': 'SHORT_ANSWER', '问答题': 'SHORT_ANSWER',
    'shortanswer': 'SHORT_ANSWER', 'essay': 'SHORT_ANSWER',
    '名词解释': 'TERM', '名词解释题': 'TERM', '术语解释': 'TERM', 'term': 'TERM'
  };

  // ── 文本归一 ──────────────────────────────────
  function normalizeText(s) {
    let out = '';
    const raw = String(s == null ? '' : s);
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if ('，,、。.．；;：:（()） 　\t\n\r“”"\'「」【】[]'.indexOf(c) >= 0) continue;
      out += c.toLowerCase();
    }
    return out;
  }

  function trimText(v) {
    return String(v == null ? '' : v).trim();
  }

  // ── 题型归一 ──────────────────────────────────
  function inferType(options, answer, stem) {
    const opts = options || [];
    const ans = trimText(answer);
    const st = trimText(stem);
    if (!opts.length && (ans.indexOf('___') >= 0 || st.indexOf('___') >= 0)) return 'FILL';
    if (!opts.length) return 'SHORT_ANSWER';
    if (opts.length === 2) {
      const a = trimText(opts[0].text);
      const b = trimText(opts[1].text);
      if ((a.indexOf('对') === 0 || a.indexOf('正确') === 0) && (b.indexOf('错') === 0 || b.indexOf('错误') === 0)) return 'JUDGE';
    }
    const letters = lettersOf(ans);
    if (letters && letters.length > 1) return 'MULTIPLE';
    return 'SINGLE';
  }

  function normalizeType(raw, options, answer, stem) {
    const key = trimText(raw).toLowerCase().replace(/\s/g, '').replace(/型$/, '');
    if (key) {
      if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
      const upper = key.toUpperCase();
      if (TYPES.indexOf(upper) >= 0) return upper;
      const compact = upper.replace(/[_-]/g, '');
      if (compact.indexOf('SINGLE') === 0 || compact.indexOf('RADIO') === 0) return 'SINGLE';
      if (compact.indexOf('MULTIPLE') === 0 || compact.indexOf('CHECKBOX') === 0) return 'MULTIPLE';
      if (compact.indexOf('JUDGE') === 0 || compact.indexOf('TRUEFALSE') === 0) return 'JUDGE';
      if (compact.indexOf('FILL') === 0 || compact.indexOf('BLANK') === 0) return 'FILL';
      if (compact.indexOf('TERM') === 0 || compact.indexOf('GLOSSARY') === 0) return 'TERM';
      if (compact.indexOf('SHORT') === 0 || compact.indexOf('ESSAY') === 0) return 'SHORT_ANSWER';
    }
    return inferType(options, answer, stem);
  }

  // ── 选项归一（四种常见写法）──────────────────
  function splitKeyedOption(raw, fallbackKey) {
    const text = trimText(raw);
    const m = /^\s*([A-Za-z])\s*[.、．)）:：]\s*([\s\S]+)$/.exec(text);
    if (m) return { key: m[1].toUpperCase(), text: trimText(m[2]) };
    return { key: fallbackKey, text };
  }

  function normalizeOptionList(raw) {
    const out = [];
    if (raw == null) return out;
    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item == null) return;
        if (typeof item === 'string' || typeof item === 'number') {
          out.push(splitKeyedOption(item, String.fromCharCode(65 + out.length)));
          return;
        }
        if (typeof item === 'object') {
          const key = item.key || item.label || item.letter || item.K || item.name;
          const text = item.text || item.content || item.value || item.option || item.T || item.desc;
          if (text != null) {
            out.push({
              key: key != null ? trimText(key).toUpperCase().slice(0, 2) : String.fromCharCode(65 + out.length),
              text: trimText(text)
            });
            return;
          }
          const keys = Object.keys(item);
          if (keys.length) {
            out.push({ key: keys[0].toUpperCase().slice(0, 2), text: trimText(item[keys[0]]) });
          }
        }
      });
      return out;
    }
    if (typeof raw === 'object') {
      Object.keys(raw).forEach(k => {
        const v = raw[k];
        if (v == null) return;
        out.push({ key: trimText(k).toUpperCase().slice(0, 2), text: trimText(v) });
      });
    }
    return out;
  }

  // ── 答案字母化 ────────────────────────────────
  function lettersOf(raw) {
    const text = trimText(raw);
    if (!text) return null;
    if (!/^[\sA-Za-z,，、;；/]+$/.test(text)) return null;
    const letters = text.toUpperCase().match(/[A-E]/g);
    if (!letters || !letters.length) return null;
    return letters.join('');
  }

  function resolveToLetters(raw, options) {
    const text = trimText(raw);
    if (!text) return null;
    const direct = lettersOf(text);
    if (direct) return direct;
    const m = /^\(?([A-Ea-e]{1,5})\)?\s*[、.．,，:：)\s]?([\s\S]*)$/.exec(text);
    if (m) return m[1].toUpperCase();
    const target = normalizeText(text);
    const hit = (options || []).find(o => normalizeText(o.text) === target);
    return hit ? hit.key : null;
  }

  // ── 判断题：永远 A=正确 / B=错误 ─────────────
  const TRUE_WORDS = ['对', '正确', '是', '√', '✓', '✔', 'T', 'Y', 'TRUE', 'YES', 'A', '1'];
  const FALSE_WORDS = ['错', '错误', '否', '×', '✗', '✘', 'F', 'N', 'FALSE', 'NO', 'B', '0'];

  function truthValue(raw) {
    const t = trimText(raw).toUpperCase().replace(/\s/g, '');
    if (!t) return null;
    if (TRUE_WORDS.indexOf(t) >= 0) return true;
    if (FALSE_WORDS.indexOf(t) >= 0) return false;
    if (t.indexOf('对') === 0 || t.indexOf('正确') === 0 || t.indexOf('√') === 0) return true;
    if (t.indexOf('错') === 0 || t.indexOf('错误') === 0 || t.indexOf('×') === 0) return false;
    return null;
  }

  function judgeLetter(raw) {
    const v = truthValue(raw);
    if (v === true) return 'A';
    if (v === false) return 'B';
    return null;
  }

  function ensureJudgeOptions(options, answer) {
    let opts = (options || []).slice();
    if (opts.length < 2) opts = [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
    const letter = judgeLetter(answer);
    if (letter && !opts.some(o => o.key === letter)) {
      opts = [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }];
    }
    return { options: opts, answer: letter || answer };
  }

  // ── 判分 ──────────────────────────────────────
  function judgeAnswer(question, userAnswer) {
    const expectedRaw = trimText(question.answer);
    if (!expectedRaw) return false;

    if (question.type === 'JUDGE') {
      const normalized = ensureJudgeOptions(question.options, question.answer);
      const expected = judgeLetter(normalized.answer) || judgeLetter(question.answer);
      const actual = judgeLetter(userAnswer) ||
        (normalized.options.find(o => normalizeText(o.text) === normalizeText(userAnswer)) || {}).key;
      if (expected && actual) return expected === actual;
    }

    if (question.type === 'FILL' || question.type === 'SHORT_ANSWER' || question.type === 'TERM') {
      return normalizeText(expectedRaw) === normalizeText(userAnswer);
    }

    const options = question.options || [];
    const expected = resolveToLetters(expectedRaw, options) || expectedRaw.toUpperCase();
    const actual = resolveToLetters(userAnswer, options) || trimText(userAnswer).toUpperCase();
    if (expected === actual) return true;

    const isLetterExpected = /^[A-E]{1,5}$/.test(expected);
    const isLetterActual = /^[A-E]{1,5}$/.test(actual);
    if (isLetterExpected && isLetterActual) {
      const exp = options.filter(o => expected.indexOf(o.key) >= 0).map(o => normalizeText(o.text)).sort();
      const act = options.filter(o => actual.indexOf(o.key) >= 0).map(o => normalizeText(o.text)).sort();
      return exp.length > 0 && exp.length === act.length && exp.join('|') === act.join('|');
    }
    return normalizeText(expected) === normalizeText(actual);
  }

  // ── 单题归一 ──────────────────────────────────
  function normalizeQuestion(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const stem = trimText(raw.stem || raw.question || raw.title || raw.content || raw['题干'] || raw['题目']);
    if (!stem) return null;

    const options = normalizeOptionList(raw.options || raw.choices || raw.items || raw['选项']);
    const answer = trimText(
      raw.answer != null ? raw.answer :
      raw.correct != null ? raw.correct :
      raw['答案'] != null ? raw['答案'] : ''
    );
    const type = normalizeType(raw.type || raw['题型'], options, answer, stem);
    const q = {
      id: index,
      chapter: trimText(raw.chapter || raw['章节'] || raw.section),
      type,
      subtype: trimText(raw.subtype || raw['亚型']).toUpperCase() || null,
      stem,
      sharedStem: trimText(raw.sharedStem || raw['共用题干']) || null,
      sharedOptions: normalizeOptionList(raw.sharedOptions),
      options,
      answer,
      analysis: trimText(raw.analysis || raw.explain || raw.explanation || raw['解析'])
    };
    if (q.type === 'JUDGE') {
      const normalized = ensureJudgeOptions(q.options, q.answer);
      q.options = normalized.options;
      q.answer = normalized.answer;
    }
    return q;
  }

  // ── JSON 题库 ────────────────────────────────
  function stripCodeFence(text) {
    let s = trimText(text);
    const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/;
    const m = fence.exec(s);
    if (m) s = m[1];
    return s.trim();
  }

  function parseBankJson(text) {
    const raw = stripCodeFence(text);
    if (!raw) throw new Error('内容为空');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error('JSON 格式有误：' + (e.message || '无法解析'));
    }

    let name = '';
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.questions)) { list = data.questions; name = trimText(data.name); }
    else if (data && data.data && Array.isArray(data.data.questions)) { list = data.data.questions; name = trimText(data.data.name); }
    else if (data && (data.stem || data.question || data['题干'])) list = [data];
    if (!list) throw new Error('没有找到题目数组（questions）');

    const questions = [];
    let invalid = 0;
    list.forEach(item => {
      const q = normalizeQuestion(item, questions.length + 1);
      if (q) questions.push(q); else invalid++;
    });
    if (!questions.length) throw new Error('没有解析出有效题目');
    return { name, questions, invalid, source: 'json' };
  }

  // ── CSV / TSV ────────────────────────────────
  function splitCsvLine(line, delim) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') {
          if (line[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === delim) {
        cells.push(cell); cell = '';
      } else {
        cell += c;
      }
    }
    cells.push(cell);
    return cells.map(s => s.trim());
  }

  function detectDelimiter(lines) {
    const sample = lines.slice(0, 3).join('\n');
    const tabs = (sample.match(/\t/g) || []).length;
    const commas = (sample.match(/,/g) || []).length;
    return tabs >= commas ? '\t' : ',';
  }

  function headerIndex(headers, names) {
    for (let i = 0; i < headers.length; i++) {
      const h = normalizeText(headers[i]);
      if (names.indexOf(h) >= 0) return i;
    }
    return -1;
  }

  function parseCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => trimText(l));
    if (lines.length < 2) throw new Error('内容太少，至少需要表头和一行题目');
    const delim = detectDelimiter(lines);
    const rows = lines.map(l => splitCsvLine(l, delim));
    const headers = rows[0];

    const stemIdx = headerIndex(headers, ['题干', '题目', 'stem', 'question', '题目内容']);
    const answerIdx = headerIndex(headers, ['答案', '正确答案', 'answer', 'correct']);
    const analysisIdx = headerIndex(headers, ['解析', '答案解析', 'analysis', 'explain', 'explanation']);
    const chapterIdx = headerIndex(headers, ['章节', '章节名', 'chapter', '分类']);
    const typeIdx = headerIndex(headers, ['题型', 'type']);

    const optionCols = [];
    headers.forEach((h, i) => {
      const key = normalizeText(h);
      if (/^[a-h]$/.test(key)) optionCols.push({ key: key.toUpperCase(), index: i });
      else {
        const m = /^选项([a-h])$/.exec(key);
        if (m) optionCols.push({ key: m[1].toUpperCase(), index: i });
      }
    });

    if (stemIdx < 0) throw new Error('表头里找不到「题干」列');

    const questions = [];
    let invalid = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const stem = trimText(row[stemIdx]);
      if (!stem) { invalid++; continue; }
      const options = optionCols
        .map(col => ({ key: col.key, text: trimText(row[col.index]) }))
        .filter(o => o.text);
      const q = normalizeQuestion({
        stem,
        options,
        answer: answerIdx >= 0 ? row[answerIdx] : '',
        analysis: analysisIdx >= 0 ? row[analysisIdx] : '',
        chapter: chapterIdx >= 0 ? row[chapterIdx] : '',
        type: typeIdx >= 0 ? row[typeIdx] : ''
      }, questions.length + 1);
      if (q) questions.push(q); else invalid++;
    }
    if (!questions.length) throw new Error('没有解析出有效题目');
    return { name: '', questions, invalid, source: 'csv' };
  }

  // ── 纯文本题库 ───────────────────────────────
  function parseTextBank(text) {
    const lines = String(text || '').split(/\r?\n/);
    const questions = [];
    let current = null;
    let chapter = '';
    let invalid = 0;

    function flush() {
      if (!current) return;
      const q = normalizeQuestion(current, questions.length + 1);
      if (q) questions.push(q); else invalid++;
      current = null;
    }

    lines.forEach(line => {
      const t = trimText(line);
      if (!t) return;

      const chapterMatch = /^(第[一二三四五六七八九十百零\d]+[章节部分]|[A-Za-z]+\s*Chapter)/.exec(t);
      if (chapterMatch && t.length <= 40) {
        chapter = t;
        return;
      }

      const stemMatch = /^(\d{1,4})\s*[.、．)）]\s*(.+)$/.exec(t);
      if (stemMatch) {
        flush();
        current = {
          chapter,
          stem: stemMatch[2],
          options: [],
          answer: '',
          analysis: ''
        };
        return;
      }

      if (!current) return;

      const optionMatch = /^([A-Ha-h])\s*[.、．)）:：]\s*(.+)$/.exec(t);
      if (optionMatch) {
        current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
        return;
      }

      const answerMatch = /^(答案|正确答案|参考答案)\s*[:：]\s*(.+)$/.exec(t);
      if (answerMatch) {
        current.answer = answerMatch[2].trim();
        return;
      }

      const analysisMatch = /^(解析|答案解析|分析)\s*[:：]\s*(.+)$/.exec(t);
      if (analysisMatch) {
        current.analysis = analysisMatch[2].trim();
        return;
      }

      if (current.options.length === 0 && !current.answer) {
        current.stem += '\n' + t;
      } else if (current.analysis) {
        current.analysis += '\n' + t;
      } else {
        current.stem += '\n' + t;
      }
    });
    flush();

    if (!questions.length) throw new Error('没有识别出题目，请确认题干以「1.」「1、」开头');
    return { name: '', questions, invalid, source: 'text' };
  }

  // ── 筛选与序列 ────────────────────────────────
  function filterQuestions(questions, filter, lastResultOf, flags) {
    const f = filter || {};
    const chapters = f.chapters || [];
    const types = f.types || [];
    const status = f.status || 'ALL';

    return questions.filter(q => {
      if (chapters.length && chapters.indexOf(q.chapter) < 0) return false;
      if (types.length && types.indexOf(q.type) < 0) return false;

      const flag = (flags && flags[q.qid]) || {};
      if (status === 'FAVORITE') return !!flag.favorite;
      if (status === 'KILLED') return !!flag.killed;
      if (status === 'WRONG') return lastResultOf && lastResultOf[q.qid] === false;
      if (status === 'UNDONE') return !lastResultOf || lastResultOf[q.qid] == null;
      if (flag.killed) return false;
      return true;
    });
  }

  function shuffle(list, seed) {
    const arr = list.slice();
    let s = seed || Date.now();
    function rnd() {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    }
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildSequence(questions, mode, seed) {
    if (mode === 'RANDOM' || mode === 'EXAM') return shuffle(questions, seed);
    return questions.slice();
  }

  // ── 统计 ──────────────────────────────────────
  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function statsOf(records, questions, now) {
    const n = now || Date.now();
    const today0 = startOfDay(n);
    let total = 0;
    let correct = 0;
    let todayTotal = 0;
    let todayCorrect = 0;
    const byDay = {};

    records.forEach(r => {
      total++;
      if (r.correct) correct++;
      const r0 = startOfDay(r.at || n);
      if (r0 === today0) {
        todayTotal++;
        if (r.correct) todayCorrect++;
      }
      const key = new Date(r0).toISOString().slice(0, 10);
      byDay[key] = (byDay[key] || 0) + 1;
    });

    const questionCount = questions ? questions.length : 0;
    return {
      total,
      correct,
      accuracy: total ? Math.round(correct / total * 100) : 0,
      todayTotal,
      todayCorrect,
      todayAccuracy: todayTotal ? Math.round(todayCorrect / todayTotal * 100) : 0,
      questionCount,
      byDay
    };
  }

  function lastResultMap(records) {
    const map = {};
    records.forEach(r => { map[r.qid] = !!r.correct; });
    return map;
  }

  function chapterList(questions) {
    const seen = {};
    const out = [];
    questions.forEach(q => {
      const c = q.chapter || '未分章';
      if (seen[c]) return;
      seen[c] = true;
      out.push(c);
    });
    return out;
  }

  function typeList(questions) {
    const seen = {};
    const out = [];
    questions.forEach(q => {
      if (seen[q.type]) return;
      seen[q.type] = true;
      out.push(q.type);
    });
    return out;
  }

  window.ShuaCore = {
    TYPES, TYPE_LABELS, SUBTYPES, STATUS_OPTIONS, MODES,
    normalizeText, inferType, normalizeType,
    normalizeOptionList, ensureJudgeOptions,
    resolveToLetters, judgeLetter, judgeAnswer,
    normalizeQuestion, parseBankJson, parseCsv, parseTextBank,
    filterQuestions, buildSequence, shuffle,
    statsOf, lastResultMap, startOfDay, chapterList, typeList
  };
})();
