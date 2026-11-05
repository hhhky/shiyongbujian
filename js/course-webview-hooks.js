// ─────────────────────────────────────────────
// 课表解析钩子（注入到内嵌 WebView 的每个页面）
//
// 默认已内置通用识别：
//   1. 扫描页面（含同源 iframe）里以「星期一…星期日」为表头的课表表格
//   2. 扫描页面脚本里常见的课表数组（强智 / 正方 / URP 等系统的 kbList 之类）
// 解析全部在本机页面内完成，不上传页面内容。
//
// 需要为某所学校做更精确的适配时，可在页面里注册专用解析器：
//   registerCourseParser(function (doc) {
//     return [{ name: '高等数学', teacher: '张老师', room: 'A101',
//               dayOfWeek: 1, sections: '1-2', weeks: '1-16' }];
//   });
// 专用解析器优先于通用识别执行。
// ─────────────────────────────────────────────
(function () {
  if (window.CourseImportHooks) return;

  var parsers = [];
  var CN_NUM = '一二三四五六七八九十';

  // ── 基础工具 ──────────────────────────────
  function norm(s) {
    return String(s == null ? '' : s).replace(/ /g, ' ').replace(/\r/g, '');
  }

  function cleanLines(text) {
    return norm(text).split('\n').map(function (line) {
      return line.replace(/[ \t]+/g, ' ').trim();
    }).filter(function (line) { return !!line; });
  }

  function weekDayNumber(text) {
    var s = norm(text).replace(/\s/g, '');
    var m = s.match(/(?:星期|周|礼拜)([一二三四五六日天])/);
    if (!m && /^[一二三四五六日天]$/.test(s)) m = [null, s];
    if (!m) return 0;
    var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
    return map[m[1]] || 0;
  }

  function parseWeeks(value) {
    var s = norm(value).replace(/[，、；;]/g, ',');
    if (!/\d/.test(s)) return null;
    var out = [];
    var re = /(?:第)?\s*(\d{1,2})\s*(?:[-~－至到]\s*(\d{1,2}))?\s*周?\s*(?:[（(]\s*([单双])\s*[)）]|([单双])周?)?/g;
    var m;
    while ((m = re.exec(s))) {
      var a = parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : a;
      if (b < a) { var t = a; a = b; b = t; }
      var parity = m[3] || m[4] || '';
      for (var w = a; w <= b; w++) {
        if (parity === '单' && w % 2 === 0) continue;
        if (parity === '双' && w % 2 === 1) continue;
        if (w >= 1 && w <= 60 && out.indexOf(w) < 0) out.push(w);
      }
    }
    out.sort(function (x, y) { return x - y; });
    return out.length ? out : null;
  }

  function parseSections(value, fallback) {
    var s = norm(value);
    var m = s.match(/(?:第)?\s*(\d{1,2})\s*[-~－至到]\s*(\d{1,2})\s*节?/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
    m = s.match(/(?:第)?\s*(\d{1,2})\s*节/);
    if (m) return { start: parseInt(m[1], 10), end: parseInt(m[1], 10) };
    m = s.replace(/\s/g, '').match(/^([一二三四五六七八九十])(?:大节)?$/);
    if (m) {
      var n = CN_NUM.indexOf(m[1]) + 1;
      if (n > 0) return { start: n * 2 - 1, end: n * 2 };
    }
    return fallback || null;
  }

  function looksLikeRoom(line) {
    if (/楼|栋|教室|实验室|校区|馆|中心/.test(line)) return true;
    return /^[A-Za-z]{0,4}-?\d{2,4}[A-Za-z]?$/.test(line);
  }

  function looksLikeTeacher(line) {
    if (/\d/.test(line)) return false;
    if (/周|节|课|楼|室|校区/.test(line)) return false;
    return /^[一-龥·、A-Za-z]{2,12}$/.test(line);
  }

  function cleanRoom(room) {
    return norm(room).replace(/^[^\s]*校区\s*/, '').trim();
  }

  // ── 表格矩阵 ──────────────────────────────
  function directRows(table) {
    var rows = [];
    var all = table.rows || [];
    for (var i = 0; i < all.length; i++) {
      var tr = all[i];
      var owner = tr.closest ? tr.closest('table') : null;
      if (!owner || owner === table) rows.push(tr);
    }
    return rows;
  }

  function cellText(cell) {
    try {
      var txt = cell.innerText || '';
      if (txt.indexOf('\n') >= 0) return norm(txt);
      // 隐藏页面 / 不可见 iframe 里 innerText 可能丢掉换行，手动把 <br> 与块级元素展开
      var doc = cell.ownerDocument || document;
      var clone = cell.cloneNode(true);
      var brs = clone.querySelectorAll('br');
      for (var i = 0; i < brs.length; i++) {
        if (brs[i].parentNode) brs[i].parentNode.replaceChild(doc.createTextNode('\n'), brs[i]);
      }
      var blocks = clone.querySelectorAll('div,p,li,tr');
      for (var j = 0; j < blocks.length; j++) {
        blocks[j].appendChild(doc.createTextNode('\n'));
      }
      return norm(clone.textContent || txt);
    } catch (e) {
      return norm(cell.textContent || '');
    }
  }

  function buildMatrix(rows) {
    var grid = [];
    rows.forEach(function (tr, ri) {
      if (!grid[ri]) grid[ri] = [];
      var ci = 0;
      for (var i = 0; i < tr.cells.length; i++) {
        var cell = tr.cells[i];
        while (grid[ri][ci] !== undefined) ci++;
        var text = cellText(cell);
        var rs = cell.rowSpan || 1;
        var cs = cell.colSpan || 1;
        for (var dr = 0; dr < rs; dr++) {
          if (!grid[ri + dr]) grid[ri + dr] = [];
          for (var dc = 0; dc < cs; dc++) grid[ri + dr][ci + dc] = text;
        }
        ci += cs;
      }
    });
    return grid;
  }

  function findHeader(grid) {
    for (var r = 0; r < Math.min(grid.length, 10); r++) {
      var row = grid[r] || [];
      var map = {};
      var days = {};
      for (var c = 0; c < row.length; c++) {
        var d = weekDayNumber(row[c]);
        if (d) { map[c] = d; days[d] = 1; }
      }
      if (Object.keys(days).length >= 4) return { row: r, map: map };
    }
    return null;
  }

  function sectionFromRow(row, limit, order) {
    for (var c = 0; c < Math.min(limit, row.length); c++) {
      var s = norm(row[c]).replace(/\s/g, '');
      if (!s) continue;
      var sec = parseSections(s, null);
      if (sec) return sec;
    }
    return { start: order * 2 + 1, end: order * 2 + 2 };
  }

  // ── 单元格文本 → 课程 ──────────────────────
  function parseSlashLine(line, fallbackSec, day) {
    var parts = line.split('/');
    if (parts.length < 2) return null;
    var name = norm(parts[0]).trim();
    if (!name) return null;
    var secPart = norm(parts[1]);
    var sec = parseSections(secPart, fallbackSec);
    var weekSource = secPart.replace(/[（(][^）)]*节[^）)]*[)）]/g, '');
    var weeks = parseWeeks(weekSource);
    var room = cleanRoom(parts.length > 2 ? parts[2] : '');
    var teacher = norm(parts.length > 3 ? parts[3] : '').trim();
    return {
      name: name,
      teacher: teacher,
      room: room,
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      weeks: weeks
    };
  }

  function parseBlock(lines, fallbackSec, day) {
    var sec = { start: fallbackSec.start, end: fallbackSec.end };
    var weekSet = [];
    var remain = [];
    lines.forEach(function (raw) {
      var line = norm(raw);
      var weekMatches = line.match(/(?:第\s*)?\d{1,2}(?:\s*[-~－至到]\s*\d{1,2})?\s*周(?:\s*[（(]?\s*[单双]\s*[）)]?)?/g);
      if (weekMatches && weekMatches.length) {
        weekMatches.forEach(function (w) {
          var parsed = parseWeeks(w);
          if (parsed) weekSet = weekSet.concat(parsed);
        });
        line = line.replace(/(?:第\s*)?\d{1,2}(?:\s*[-~－至到]\s*\d{1,2})?\s*周(?:\s*[（(]?\s*[单双]\s*[）)]?)?/g, ' ');
      }
      var sm = line.match(/[（(]?\s*(\d{1,2})\s*[-~－至到]\s*(\d{1,2})\s*节\s*[)）]?/);
      if (sm) {
        sec = { start: parseInt(sm[1], 10), end: parseInt(sm[2], 10) };
        line = line.replace(sm[0], ' ');
      }
      line = line.replace(/\s+/g, ' ').trim();
      if (line) remain.push(line);
    });
    if (!remain.length) return null;

    var name = '';
    var teacher = '';
    var room = '';
    if (remain.length === 1) {
      var tokens = remain[0].split(' ').filter(Boolean);
      if (tokens.length >= 3) {
        name = tokens[0];
        if (looksLikeRoom(tokens[tokens.length - 1])) {
          room = tokens[tokens.length - 1];
          teacher = tokens.slice(1, -1).join(' ');
        } else {
          teacher = tokens[1];
          room = tokens.slice(2).join(' ');
        }
      } else {
        name = remain[0];
      }
    } else {
      remain.forEach(function (line) {
        if (!room && looksLikeRoom(line)) { room = line; return; }
        if (!name) { name = line; return; }
        if (!teacher && looksLikeTeacher(line)) { teacher = line; return; }
        if (!room) room = line;
      });
    }
    if (!name) return null;
    weekSet = weekSet.filter(function (w, i) { return weekSet.indexOf(w) === i; }).sort(function (a, b) { return a - b; });
    return {
      name: name,
      teacher: teacher,
      room: cleanRoom(room),
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      weeks: weekSet.length ? weekSet : null
    };
  }

  function splitBlocks(lines) {
    var blocks = [];
    var cur = [];
    var weekLines = 0;
    lines.forEach(function (line) {
      if (/\d{1,2}\s*周/.test(line)) weekLines++;
    });
    if (weekLines < 2) return [lines];
    lines.forEach(function (line) {
      cur.push(line);
      if (/\d{1,2}\s*周/.test(line)) {
        blocks.push(cur);
        cur = [];
      }
    });
    if (cur.length) {
      if (blocks.length) blocks[blocks.length - 1] = blocks[blocks.length - 1].concat(cur);
      else blocks.push(cur);
    }
    return blocks;
  }

  function parseCellText(text, fallbackSec, day) {
    var lines = cleanLines(text);
    if (!lines.length) return [];
    var slashLines = lines.filter(function (line) { return line.split('/').length >= 3; });
    if (slashLines.length && slashLines.length === lines.length) {
      return lines.map(function (line) { return parseSlashLine(line, fallbackSec, day); }).filter(Boolean);
    }
    if (slashLines.length) {
      var out = [];
      lines.forEach(function (line) {
        var item = line.split('/').length >= 3 ? parseSlashLine(line, fallbackSec, day) : null;
        if (item) out.push(item);
      });
      if (out.length) return out;
    }
    var blocks = splitBlocks(lines);
    return blocks.map(function (block) { return parseBlock(block, fallbackSec, day); }).filter(Boolean);
  }

  function parseMatrix(grid) {
    var head = findHeader(grid);
    if (!head) return [];
    var dayCols = Object.keys(head.map).map(Number).sort(function (a, b) { return a - b; });
    var minCol = dayCols[0];
    var out = [];
    var order = 0;
    for (var r = head.row + 1; r < grid.length; r++) {
      var row = grid[r] || [];
      var isHeaderRow = dayCols.filter(function (c) { return weekDayNumber(row[c]); }).length >= 4;
      if (isHeaderRow) continue;
      var any = dayCols.some(function (c) { return norm(row[c]).trim(); });
      if (!any) continue;
      var sec = sectionFromRow(row, minCol, order);
      order++;
      dayCols.forEach(function (c) {
        var text = norm(row[c]).trim();
        if (!text) return;
        parseCellText(text, sec, head.map[c]).forEach(function (item) {
          if (item) out.push(item);
        });
      });
    }
    return out;
  }

  function parseTable(table) {
    var rows = directRows(table);
    if (rows.length < 2) return [];
    return parseMatrix(buildMatrix(rows));
  }

  // 现代教务系统常用 role="grid" 的 div 网格
  function buildAriaMatrix(gridEl, rows) {
    var matrix = [];
    rows.forEach(function (rowEl, ri) {
      if (!matrix[ri]) matrix[ri] = [];
      var cells = [];
      try {
        cells = rowEl.querySelectorAll('[role="gridcell"],[role="cell"],[role="columnheader"],[role="rowheader"]');
      } catch (e) { cells = []; }
      var ci = 0;
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i];
        var ownerRow = cell.closest ? cell.closest('[role="row"]') : null;
        if (ownerRow !== rowEl) continue;
        while (matrix[ri][ci] !== undefined) ci++;
        var text = cellText(cell);
        var rs = parseInt(cell.getAttribute('aria-rowspan'), 10) || 1;
        var cs = parseInt(cell.getAttribute('aria-colspan'), 10) || 1;
        for (var dr = 0; dr < rs; dr++) {
          if (!matrix[ri + dr]) matrix[ri + dr] = [];
          for (var dc = 0; dc < cs; dc++) matrix[ri + dr][ci + dc] = text;
        }
        ci += cs;
      }
    });
    return matrix;
  }

  function parseAriaGrids(doc) {
    var out = [];
    var grids = [];
    try { grids = doc.querySelectorAll('[role="grid"],[role="table"]'); } catch (e) { grids = []; }
    for (var i = 0; i < grids.length; i++) {
      var gridEl = grids[i];
      var rows = [];
      try {
        rows = gridEl.querySelectorAll('[role="row"]');
      } catch (e) { rows = []; }
      var direct = [];
      for (var r = 0; r < rows.length; r++) {
        var owner = rows[r].closest ? rows[r].closest('[role="grid"],[role="table"]') : null;
        if (owner === gridEl) direct.push(rows[r]);
      }
      if (direct.length < 2) continue;
      try {
        parseMatrix(buildAriaMatrix(gridEl, direct)).forEach(function (item) { out.push(item); });
      } catch (e) { /* 单个网格失败忽略 */ }
    }
    return out;
  }

  // ── 页面脚本里的课表数组 ────────────────────
  function pickField(obj, names) {
    var keys = Object.keys(obj);
    for (var i = 0; i < names.length; i++) {
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase() === names[i]) return obj[keys[k]];
      }
    }
    return undefined;
  }

  function mapCourseObject(item) {
    if (!item || typeof item !== 'object') return null;
    var rawName = pickField(item, ['kcmc', 'coursename', 'course', 'coursetitle', 'name', 'title']);
    var rawDay = pickField(item, ['xqj', 'dayofweek', 'weekday', 'xingqi', 'day']);
    var rawSec = pickField(item, ['jcs', 'jcor', 'sections', 'section', 'skjc', 'jc']);
    var rawWeek = pickField(item, ['zcd', 'kkzc', 'weeks', 'week', 'zc']);
    var name = norm(rawName).trim();
    var day = weekDayNumber(rawDay) || parseInt(rawDay, 10) || 0;
    if (!name || !day) return null;
    var sec = parseSections(rawSec, null);
    if (!sec && rawSec != null && /^\d{4}$/.test(String(rawSec))) {
      sec = { start: parseInt(String(rawSec).slice(0, 2), 10), end: parseInt(String(rawSec).slice(2), 10) };
    }
    if (!sec) return null;
    var weeks = parseWeeks(rawWeek);
    var teacher = norm(pickField(item, ['jsxm', 'teacher', 'teachername', 'skjs', 'js']) || '').trim();
    var room = cleanRoom(pickField(item, ['cdmc', 'room', 'classroom', 'place', 'jsmc', 'skdd']) || '');
    return {
      name: name,
      teacher: teacher,
      room: room,
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      weeks: weeks
    };
  }

  function looksLikeCourseArray(arr) {
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > 2000) return false;
    var sample = arr[0];
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return false;
    var keys = Object.keys(sample).map(function (k) { return k.toLowerCase(); });
    var hasName = keys.some(function (k) {
      return ['kcmc', 'coursename', 'course', 'coursetitle', 'name', 'title'].indexOf(k) >= 0;
    });
    var hasDay = keys.some(function (k) {
      return ['xqj', 'dayofweek', 'weekday', 'xingqi', 'day'].indexOf(k) >= 0;
    });
    var hasSec = keys.some(function (k) {
      return ['jcs', 'jcor', 'sections', 'section', 'skjc', 'jc'].indexOf(k) >= 0;
    });
    return hasName && (hasDay || hasSec);
  }

  function parseGlobalArrays() {
    var out = [];
    var seen = 0;
    for (var key in window) {
      if (++seen > 4000) break;
      try {
        var value = window[key];
        if (!looksLikeCourseArray(value)) continue;
        for (var i = 0; i < value.length && i < 800; i++) {
          var item = mapCourseObject(value[i]);
          if (item) out.push(item);
        }
        if (out.length) return out;
      } catch (e) { /* 忽略不可访问的属性 */ }
    }
    return out;
  }

  // ── 文档收集（含同源 iframe）────────────────
  function collectDocuments(root, depth, out) {
    out.push(root);
    if (depth > 2) return out;
    var frames = [];
    try { frames = root.querySelectorAll('iframe, frame'); } catch (e) { frames = []; }
    for (var i = 0; i < frames.length; i++) {
      try {
        var doc = frames[i].contentDocument;
        if (doc) collectDocuments(doc, depth + 1, out);
      } catch (e) { /* 跨域 iframe 跳过 */ }
    }
    return out;
  }

  function mergeText(a, b) {
    a = norm(a).trim();
    b = norm(b).trim();
    if (!a) return b;
    if (!b || a === b) return a;
    var list = a.split(/[\/、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (list.indexOf(b) < 0) list.push(b);
    return list.join('/');
  }

  function mergeCourses(list) {
    var map = {};
    var order = [];
    list.forEach(function (item) {
      if (!item || !item.name || !item.dayOfWeek) return;
      var start = Math.max(1, Math.min(16, item.startSection || 1));
      var end = Math.max(start, Math.min(16, item.endSection || start));
      var key = [item.name, item.dayOfWeek, start, end].join('|');
      var cur = map[key];
      if (!cur) {
        cur = {
          name: item.name,
          teacher: norm(item.teacher).trim(),
          room: cleanRoom(item.room),
          dayOfWeek: item.dayOfWeek,
          startSection: start,
          endSection: end,
          weeks: item.weeks && item.weeks.length ? item.weeks.slice() : null
        };
        map[key] = cur;
        order.push(key);
        return;
      }
      if (item.weeks && item.weeks.length) {
        if (!cur.weeks) cur.weeks = [];
        item.weeks.forEach(function (w) {
          if (cur.weeks.indexOf(w) < 0) cur.weeks.push(w);
        });
      }
      if (item.teacher) cur.teacher = mergeText(cur.teacher, item.teacher);
      if (item.room) cur.room = mergeText(cur.room, cleanRoom(item.room));
    });
    return order.map(function (key) {
      var cur = map[key];
      if (cur.weeks) cur.weeks.sort(function (a, b) { return a - b; });
      return {
        name: cur.name,
        teacher: cur.teacher,
        room: cur.room,
        dayOfWeek: cur.dayOfWeek,
        sections: cur.startSection === cur.endSection ? String(cur.startSection) : cur.startSection + '-' + cur.endSection,
        weeks: cur.weeks
      };
    });
  }

  // ── 通用识别 ──────────────────────────────
  function genericParser(doc) {
    var docs = collectDocuments(doc, 0, []);
    var all = [];
    docs.forEach(function (d) {
      var tables = [];
      try { tables = d.querySelectorAll('table'); } catch (e) { tables = []; }
      for (var i = 0; i < tables.length; i++) {
        try {
          parseTable(tables[i]).forEach(function (item) { all.push(item); });
        } catch (e) { /* 单张表解析失败不影响其他表 */ }
      }
      try {
        parseAriaGrids(d).forEach(function (item) { all.push(item); });
      } catch (e) { /* ARIA 网格解析失败忽略 */ }
    });
    if (all.length) return mergeCourses(all);

    try {
      var fromData = parseGlobalArrays();
      if (fromData.length) return mergeCourses(fromData);
    } catch (e) { /* 忽略 */ }
    return [];
  }

  window.CourseImportHooks = {
    parsers: parsers,
    register: function (fn) {
      if (typeof fn === 'function') parsers.push(fn);
    },
    run: function () {
      // 专用解析器优先，其次才是通用识别
      for (var i = 0; i < parsers.length; i++) {
        try {
          var list = parsers[i](document);
          if (list && list.length) return { ok: true, courses: mergeCourses(list) };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }
      try {
        var generic = genericParser(document);
        if (generic.length) return { ok: true, courses: generic };
        return { ok: false, error: 'no_course' };
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
  };

  window.registerCourseParser = function (fn) {
    window.CourseImportHooks.register(fn);
  };
})();
