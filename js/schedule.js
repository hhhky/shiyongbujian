// ─────────────────────────────────────────────
// 课表模块：课程增删改、周次视图、备忘录关联、Excel/CSV 导入
// 数据表 courses 在 db.js 中定义，备忘录通过 courseId 关联课程
// ─────────────────────────────────────────────

var SCHEDULE_SETTINGS_KEY = 'schedule-settings';
var SCHEDULE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
var SCHEDULE_COLORS = [
  '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#10b981', '#14b8a6', '#64748b'
];

var scheduleCourses = [];
var scheduleSettings = { semesterStart: '', totalWeeks: 20, sections: 12 };
var scheduleViewWeek = null;        // null = 跟随当前周
var scheduleEditingCourseId = null;
var scheduleDetailCourseId = null;
var scheduleFormColor = SCHEDULE_COLORS[0];
var scheduleInited = false;
var scheduleLoaded = false; // 数据未读完前不渲染空状态，避免“还没有课程”一闪而过
var scheduleImportConflict = 'skip';

function schedPad2(n) { return n < 10 ? '0' + n : String(n); }

function schedDayKey(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + schedPad2(d.getMonth() + 1) + '-' + schedPad2(d.getDate());
}

function schedStartOfDay(ts) {
  var d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function loadScheduleSettings() {
  try {
    var raw = JSON.parse(localStorage.getItem(SCHEDULE_SETTINGS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      scheduleSettings.semesterStart = raw.semesterStart || '';
      scheduleSettings.totalWeeks = parseInt(raw.totalWeeks, 10) || 20;
      scheduleSettings.sections = parseInt(raw.sections, 10) || 12;
    }
  } catch (e) { /* 使用默认值 */ }
  scheduleSettings.totalWeeks = Math.max(1, Math.min(30, scheduleSettings.totalWeeks));
  scheduleSettings.sections = Math.max(6, Math.min(16, scheduleSettings.sections));
}

function saveScheduleSettings() {
  try { localStorage.setItem(SCHEDULE_SETTINGS_KEY, JSON.stringify(scheduleSettings)); } catch (e) { /* ignore */ }
}

// 当前教学周：有开学日期就按日期算，否则从第 1 周开始
function scheduleComputedWeek() {
  if (!scheduleSettings.semesterStart) return 1;
  var start = new Date(scheduleSettings.semesterStart + 'T00:00:00');
  if (isNaN(start.getTime())) return 1;
  var diffDays = Math.floor((schedStartOfDay(Date.now()) - start.getTime()) / 86400000);
  var week = Math.floor(diffDays / 7) + 1;
  return Math.max(1, Math.min(scheduleSettings.totalWeeks, week));
}

function scheduleWeek() {
  return scheduleViewWeek || scheduleComputedWeek();
}

function courseById(id) {
  for (var i = 0; i < scheduleCourses.length; i++) {
    if (scheduleCourses[i].id === id) return scheduleCourses[i];
  }
  return null;
}

function courseDisplayTime(c) {
  return SCHEDULE_DAYS[(c.dayOfWeek || 1) - 1] + ' 第' + c.startSection + '-' + c.endSection + '节';
}

function courseWeeksLabel(c) {
  var label = '第' + c.startWeek + '-' + c.endWeek + '周';
  if (c.weekParity === 'odd') label += '（单周）';
  else if (c.weekParity === 'even') label += '（双周）';
  return label;
}

function courseActiveInWeek(c, week) {
  if (week < (c.startWeek || 1) || week > (c.endWeek || 99)) return false;
  if (c.weekParity === 'odd' && week % 2 === 0) return false;
  if (c.weekParity === 'even' && week % 2 === 1) return false;
  return true;
}

function initSchedule() {
  loadScheduleSettings();
  if (!scheduleInited) {
    scheduleInited = true;
    window.addEventListener('resize', function() {
      if (currentWidget === 'schedule') renderTimetable();
    });
  }
  refreshSchedule();
}

async function refreshSchedule() {
  try { scheduleCourses = await getCourses(); } catch (e) { scheduleCourses = []; }
  scheduleLoaded = true;
  scheduleCourses.sort(function(a, b) {
    return (a.dayOfWeek - b.dayOfWeek) || (a.startSection - b.startSection) || String(a.name).localeCompare(String(b.name));
  });
  renderTimetable();
  if (scheduleDetailCourseId) renderCourseDetail();
}

// ── 课表视图 ─────────────────────────────────
function renderTimetable() {
  var grid = document.getElementById('timetable-grid');
  if (!grid) return;
  var week = scheduleWeek();
  if (scheduleViewWeek !== null) {
    scheduleViewWeek = Math.max(1, Math.min(scheduleSettings.totalWeeks, scheduleViewWeek));
    week = scheduleViewWeek;
  }
  var label = document.getElementById('schedule-week-label');
  if (label) label.textContent = '第 ' + week + ' 周';
  if (!scheduleLoaded) return; // 等 IndexedDB 读完再画，避免先闪一下“还没有课程”
  var sub = document.getElementById('schedule-week-sub');
  if (sub) {
    sub.textContent = scheduleSettings.semesterStart
      ? '开学 ' + scheduleSettings.semesterStart + ' · 共 ' + scheduleSettings.totalWeeks + ' 周'
      : '未设置开学日期，可手动切换周次';
  }

  var sections = scheduleSettings.sections;
  var todayIdx = (new Date().getDay() + 6) % 7; // 周一=0
  var html = '<div class="tt-corner"></div>';
  for (var d = 0; d < 7; d++) {
    html += '<div class="tt-day-head' + (d === todayIdx ? ' today' : '') + '">' + SCHEDULE_DAYS[d] + '</div>';
  }
  for (var s = 1; s <= sections; s++) {
    html += '<div class="tt-section-label">' + s + '</div>';
    for (var dd = 0; dd < 7; dd++) {
      html += '<div class="tt-cell"></div>';
    }
  }

  var visible = scheduleCourses.filter(function(c) { return courseActiveInWeek(c, week); });
  visible.forEach(function(c) {
    var col = (c.dayOfWeek || 1);
    var rowStart = Math.max(1, c.startSection) + 1; // 第 1 行是星期表头
    var rowEnd = Math.max(c.startSection, c.endSection) + 2;
    var color = c.color || SCHEDULE_COLORS[0];
    html += '<div class="tt-course" onclick="openCourseDetail(' + c.id + ')" style="grid-column:' + col + ';grid-row:' + rowStart + ' / ' + rowEnd + ';--c:' + color + ';background:' + color + '26;border-left-color:' + color + ';">'
      + '<div class="tt-course-name">' + esc(c.name) + '</div>'
      + (c.room ? '<div class="tt-course-meta">' + esc(c.room) + '</div>' : '')
      + '</div>';
  });
  grid.innerHTML = html;

  var empty = document.getElementById('timetable-empty');
  if (empty) empty.classList.toggle('hidden', scheduleCourses.length > 0);
  grid.classList.toggle('hidden', scheduleCourses.length === 0);
  var weekEmpty = document.getElementById('timetable-week-empty');
  if (weekEmpty) weekEmpty.classList.toggle('hidden', scheduleCourses.length === 0 || visible.length > 0);
}

function scheduleShiftWeek(delta) {
  var base = scheduleWeek();
  scheduleViewWeek = Math.max(1, Math.min(scheduleSettings.totalWeeks, base + delta));
  renderTimetable();
}

function scheduleGoCurrentWeek() {
  scheduleViewWeek = null;
  renderTimetable();
}

// ── 课程表单 ─────────────────────────────────
function fillSectionSelects() {
  var startSel = document.getElementById('course-start-section');
  var endSel = document.getElementById('course-end-section');
  if (!startSel || !endSel) return;
  var opts = '';
  for (var i = 1; i <= scheduleSettings.sections; i++) opts += '<option value="' + i + '">第 ' + i + ' 节</option>';
  startSel.innerHTML = opts;
  endSel.innerHTML = opts;
}

function openCourseModal(id) {
  scheduleEditingCourseId = id || null;
  fillSectionSelects();
  var c = id ? courseById(id) : null;

  document.getElementById('course-modal-title').textContent = c ? '编辑课程' : '新增课程';
  document.getElementById('course-name-input').value = c ? c.name : '';
  document.getElementById('course-teacher-input').value = c ? (c.teacher || '') : '';
  document.getElementById('course-room-input').value = c ? (c.room || '') : '';
  document.getElementById('course-day-select').value = String(c ? c.dayOfWeek : 1);
  document.getElementById('course-start-section').value = String(c ? c.startSection : 1);
  document.getElementById('course-end-section').value = String(c ? c.endSection : 2);
  document.getElementById('course-start-week').value = c ? c.startWeek : 1;
  document.getElementById('course-end-week').value = c ? c.endWeek : scheduleSettings.totalWeeks;
  document.getElementById('course-parity-select').value = c ? (c.weekParity || 'all') : 'all';
  scheduleFormColor = c && c.color ? c.color : SCHEDULE_COLORS[0];
  renderScheduleColorPicker();
  document.getElementById('course-modal').classList.remove('hidden');
  document.getElementById('course-name-input').focus();
}

function hideCourseModal() {
  document.getElementById('course-modal').classList.add('hidden');
  scheduleEditingCourseId = null;
}

function renderScheduleColorPicker() {
  var box = document.getElementById('course-color-picker');
  if (!box) return;
  box.innerHTML = SCHEDULE_COLORS.map(function(color) {
    return '<button type="button" onclick="selectScheduleColor(\'' + color + '\')" class="w-8 h-8 rounded-full btn-jelly" style="background:' + color + ';box-shadow:0 0 0 ' + (scheduleFormColor === color ? '2px var(--text-primary)' : '0 transparent') + ';"></button>';
  }).join('');
}

function selectScheduleColor(color) {
  scheduleFormColor = color;
  renderScheduleColorPicker();
}

async function confirmCourse() {
  var name = document.getElementById('course-name-input').value.trim();
  if (!name) { toast('请输入课程名称'); return; }
  var day = parseInt(document.getElementById('course-day-select').value, 10) || 1;
  var startSection = parseInt(document.getElementById('course-start-section').value, 10) || 1;
  var endSection = parseInt(document.getElementById('course-end-section').value, 10) || startSection;
  if (endSection < startSection) { var t = startSection; startSection = endSection; endSection = t; }
  var startWeek = Math.max(1, parseInt(document.getElementById('course-start-week').value, 10) || 1);
  var endWeek = Math.max(startWeek, parseInt(document.getElementById('course-end-week').value, 10) || scheduleSettings.totalWeeks);
  var payload = {
    name: name,
    teacher: document.getElementById('course-teacher-input').value.trim(),
    room: document.getElementById('course-room-input').value.trim(),
    dayOfWeek: day,
    startSection: startSection,
    endSection: endSection,
    startWeek: startWeek,
    endWeek: endWeek,
    weekParity: document.getElementById('course-parity-select').value || 'all',
    color: scheduleFormColor
  };

  if (scheduleEditingCourseId) {
    await updateCourse(scheduleEditingCourseId, payload);
    toast('课程已更新');
  } else {
    await addCourse(payload);
    toast('课程已添加');
  }
  hideCourseModal();
  await refreshSchedule();
  if (scheduleDetailCourseId) renderCourseDetail();
}

async function deleteCourseById(id) {
  var c = courseById(id);
  if (!c) return;
  var memos = [];
  try { memos = await getMemosByCourse(id); } catch (e) { /* ignore */ }
  var tip = '确定删除课程「' + c.name + '」？';
  if (memos.length) tip += '\n它关联的 ' + memos.length + ' 条备忘录会保留，但会取消课程关联。';
  if (!await confirmDialog(tip)) return;
  // 先解除备忘录关联，避免留下指向已删除课程的 courseId
  for (var i = 0; i < memos.length; i++) {
    try { await updateMemo(memos[i].id, { courseId: null }); } catch (e) { /* ignore */ }
  }
  await deleteCourse(id);
  if (scheduleDetailCourseId === id) hideCourseDetail();
  toast('课程已删除');
  await refreshSchedule();
}

// ── 课程详情 / 关联备忘录 ─────────────────────
function openCourseDetail(id) {
  var c = courseById(id);
  if (!c) return;
  scheduleDetailCourseId = id;
  renderCourseDetail();
  document.getElementById('course-detail-modal').classList.remove('hidden');
}

function hideCourseDetail() {
  document.getElementById('course-detail-modal').classList.add('hidden');
  scheduleDetailCourseId = null;
}

async function renderCourseDetail() {
  var c = courseById(scheduleDetailCourseId);
  if (!c) { hideCourseDetail(); return; }
  var title = document.getElementById('course-detail-title');
  var info = document.getElementById('course-detail-info');
  var list = document.getElementById('course-memo-list');
  if (title) title.textContent = c.name;
  if (info) {
    var parts = [];
    if (c.teacher) parts.push('教师：' + c.teacher);
    if (c.room) parts.push('教室：' + c.room);
    parts.push(courseDisplayTime(c));
    parts.push(courseWeeksLabel(c));
    info.innerHTML = parts.map(function(p) { return '<span>' + esc(p) + '</span>'; }).join('');
  }
  if (!list) return;
  var memos = [];
  try { memos = await getMemosByCourse(c.id); } catch (e) { /* ignore */ }
  memos.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  if (!memos.length) {
    list.innerHTML = '<div class="text-center text-xs py-6" style="color: var(--text-tertiary);">还没有关联的备忘录，点击上方按钮添加一条笔记</div>';
    return;
  }
  list.innerHTML = memos.map(function(m) {
    return '<div class="course-memo-item" onclick="showEditMemo(' + m.id + ')">'
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-medium truncate" style="color: var(--text-primary);">' + esc(m.title) + '</p>'
        + (m.content ? '<p class="text-xs mt-0.5 truncate" style="color: var(--text-tertiary);">' + esc(m.content.substring(0, 60)) + '</p>' : '')
      + '</div>'
      + '<span class="text-xs shrink-0" style="color: var(--text-tertiary);">' + new Date(m.createdAt).toLocaleDateString('zh-CN') + '</span>'
    + '</div>';
  }).join('');
}

function addMemoForCourse() {
  if (!scheduleDetailCourseId) return;
  showAddMemo(scheduleDetailCourseId);
}

// 从备忘录跳转到课表课程
function jumpToCourse(courseId) {
  if (!courseById(courseId)) { toast('关联课程已不存在'); return; }
  hideMemoModal();
  if (typeof currentWidget !== 'undefined' && currentWidget === 'schedule') {
    openCourseDetail(courseId);
    return;
  }
  if (typeof enterWidget === 'function') enterWidget('schedule');
  setTimeout(function() { openCourseDetail(courseId); }, 160);
}

// ── 学期设置 ─────────────────────────────────
function showScheduleSettings() {
  document.getElementById('schedule-start-date').value = scheduleSettings.semesterStart || '';
  document.getElementById('schedule-total-weeks').value = scheduleSettings.totalWeeks;
  document.getElementById('schedule-sections').value = scheduleSettings.sections;
  document.getElementById('schedule-settings-modal').classList.remove('hidden');
}

function hideScheduleSettings() {
  document.getElementById('schedule-settings-modal').classList.add('hidden');
}

function confirmScheduleSettings() {
  var start = document.getElementById('schedule-start-date').value;
  var weeks = Math.max(1, Math.min(30, parseInt(document.getElementById('schedule-total-weeks').value, 10) || 20));
  var sections = Math.max(6, Math.min(16, parseInt(document.getElementById('schedule-sections').value, 10) || 12));
  scheduleSettings.semesterStart = start || '';
  scheduleSettings.totalWeeks = weeks;
  scheduleSettings.sections = sections;
  saveScheduleSettings();
  hideScheduleSettings();
  renderTimetable();
  toast('课表设置已保存');
}

// ── Excel / CSV 导入 ──────────────────────────
var SCHEDULE_IMPORT_ALIASES = {
  name: ['课程名称', '课程', '科目', '课程名', '名称', 'coursename', 'name'],
  teacher: ['教师', '老师', '任课教师', '授课教师', 'teacher'],
  room: ['教室', '地点', '上课地点', '上课教室', 'room', 'location'],
  day: ['星期', '星期几', '周几', '上课星期', '上课星期几', 'day'],
  sections: ['节次', '上课节次', '节', 'section', 'sections'],
  weeks: ['周次', '周数', '上课周次', '上课周数', 'week', 'weeks']
};

function scheduleNormalizeHeader(v) {
  return String(v == null ? '' : v).split(String.fromCharCode(0xFEFF)).join('').replace(/[\s　]/g, '').toLowerCase();
}

function scheduleFindHeader(rows) {
  for (var r = 0; r < Math.min(rows.length, 10); r++) {
    var row = rows[r] || [];
    var map = {};
    for (var c = 0; c < row.length; c++) {
      var h = scheduleNormalizeHeader(row[c]);
      if (!h) continue;
      Object.keys(SCHEDULE_IMPORT_ALIASES).forEach(function(field) {
        if (map[field] != null) return;
        if (SCHEDULE_IMPORT_ALIASES[field].some(function(alias) { return h === alias; })) map[field] = c;
      });
    }
    if (map.name != null && (map.day != null || map.sections != null)) return { row: r, map: map };
  }
  return null;
}

function scheduleParseDay(v) {
  if (v == null || v === '') return 0;
  var s = String(v).trim();
  var n = parseInt(s, 10);
  if (n >= 1 && n <= 7) return n;
  var cn = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  var m = s.match(/^(?:周|星期|礼拜)([一二三四五六日天])$/);
  if (m) return cn[m[1]];
  if (cn[s]) return cn[s];
  var en = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  var k = s.toLowerCase().slice(0, 3);
  return en[k] || 0;
}

function scheduleNumbersIn(v) {
  var out = [];
  var re = /\d+/g;
  var m;
  while ((m = re.exec(String(v || '')))) out.push(parseInt(m[0], 10));
  return out;
}

function scheduleParseSections(v) {
  var nums = scheduleNumbersIn(v);
  if (!nums.length) return null;
  var a = nums[0];
  var b = nums.length > 1 ? nums[1] : a;
  if (a > b) { var t = a; a = b; b = t; }
  a = Math.max(1, Math.min(scheduleSettings.sections, a));
  b = Math.max(1, Math.min(scheduleSettings.sections, b));
  return { start: a, end: b };
}

function scheduleParseWeeks(v) {
  var s = String(v || '');
  var nums = scheduleNumbersIn(s);
  if (!nums.length) return null;
  var start = Math.min.apply(null, nums);
  var end = Math.max.apply(null, nums);
  var parity = 'all';
  if (/单/.test(s)) parity = 'odd';
  else if (/双/.test(s)) parity = 'even';
  else if (nums.length > 2) {
    var allOdd = nums.every(function(n) { return n % 2 === 1; });
    var allEven = nums.every(function(n) { return n % 2 === 0; });
    if (allOdd) parity = 'odd';
    else if (allEven) parity = 'even';
  }
  return {
    start: Math.max(1, start),
    end: Math.max(start, end),
    parity: parity
  };
}

// 把一组行数据转成课程对象，返回 { courses, errors }
function scheduleParseRows(rows) {
  var header = scheduleFindHeader(rows || []);
  if (!header) {
    return { courses: [], errors: ['未识别到表头，请确认包含「课程名称」「星期」「节次」等列'] };
  }
  var courses = [];
  var errors = [];
  for (var r = header.row + 1; r < rows.length; r++) {
    var row = rows[r] || [];
    var name = String(row[header.map.name] == null ? '' : row[header.map.name]).trim();
    if (!name) continue;
    var day = header.map.day != null ? scheduleParseDay(row[header.map.day]) : 0;
    var sec = header.map.sections != null ? scheduleParseSections(row[header.map.sections]) : null;
    var wk = header.map.weeks != null ? scheduleParseWeeks(row[header.map.weeks]) : null;
    if (!day) { errors.push('第 ' + (r + 1) + ' 行：无法识别星期'); continue; }
    if (!sec) { errors.push('第 ' + (r + 1) + ' 行：无法识别节次'); continue; }
    if (!wk) wk = { start: 1, end: scheduleSettings.totalWeeks, parity: 'all' };
    courses.push({
      name: name,
      teacher: header.map.teacher != null ? String(row[header.map.teacher] == null ? '' : row[header.map.teacher]).trim() : '',
      room: header.map.room != null ? String(row[header.map.room] == null ? '' : row[header.map.room]).trim() : '',
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      startWeek: wk.start,
      endWeek: wk.end,
      weekParity: wk.parity,
      color: SCHEDULE_COLORS[courses.length % SCHEDULE_COLORS.length]
    });
  }
  if (!courses.length && !errors.length) errors.push('文件里没有可导入的课程');
  return { courses: courses, errors: errors };
}

function scheduleCourseKey(c) {
  // 同一门课在同一天的同一节次算重复：覆盖时会把周次等字段更新为新值
  return [String(c.name || '').trim().toLowerCase(), c.dayOfWeek, c.startSection, c.endSection].join('|');
}

async function applyImportedCourses(courses, mode) {
  var result = { added: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  var existing = {};
  scheduleCourses.forEach(function(c) { existing[scheduleCourseKey(c)] = c; });
  for (var i = 0; i < courses.length; i++) {
    var c = courses[i];
    var key = scheduleCourseKey(c);
    try {
      if (existing[key]) {
        if (mode === 'overwrite') {
          await updateCourse(existing[key].id, c);
          result.updated++;
        } else {
          result.skipped++;
        }
      } else {
        await addCourse(c);
        result.added++;
        existing[key] = c;
      }
    } catch (e) {
      result.failed++;
      result.errors.push((c.name || '未命名') + '：' + (e && e.message ? e.message : '写入失败'));
    }
  }
  await refreshSchedule();
  return result;
}

function setScheduleImportConflict(mode) {
  scheduleImportConflict = mode;
  var skip = document.getElementById('import-conflict-skip');
  var over = document.getElementById('import-conflict-overwrite');
  if (skip) skip.checked = mode === 'skip';
  if (over) over.checked = mode === 'overwrite';
}

function pickScheduleFile() {
  var input = document.getElementById('schedule-file-input');
  if (input) { input.value = ''; input.click(); }
}

async function onScheduleFileSelected(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined' && typeof loadScript === 'function') {
    try { await loadScript('js/xlsx.full.min.js'); } catch (e) { /* 下面统一提示 */ }
  }
  if (typeof XLSX === 'undefined') { toast('表格解析组件未加载'); return; }
  var box = document.getElementById('schedule-import-result');
  if (box) { box.classList.remove('hidden'); box.innerHTML = '正在解析 ' + esc(file.name) + '…'; }
  try {
    var wb;
    if (/\.csv$/i.test(file.name)) {
      // CSV 按原始文本读取，避免把「1-2」当成日期解析
      var text = await file.text();
      wb = XLSX.read(text, { type: 'string', raw: true });
    } else {
      var buf = await file.arrayBuffer();
      wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    }
    var sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('文件里没有工作表');
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    var parsed = scheduleParseRows(rows);
    if (!parsed.courses.length) {
      renderImportResult({ added: 0, updated: 0, skipped: 0, failed: 0, errors: parsed.errors }, file.name);
      toast('没有可导入的课程');
      return;
    }
    var res = await applyImportedCourses(parsed.courses, scheduleImportConflict);
    res.errors = parsed.errors.concat(res.errors);
    renderImportResult(res, file.name);
    toast('导入完成：新增 ' + res.added + ' 门课程');
  } catch (e) {
    renderImportResult({ added: 0, updated: 0, skipped: 0, failed: 1, errors: [e && e.message ? e.message : '解析失败'] }, file.name);
    toast('导入失败，请检查文件格式');
  }
}

function renderImportResult(res, fileName) {
  var box = document.getElementById('schedule-import-result');
  if (!box) return;
  box.classList.remove('hidden');
  var color = res.failed ? '#ef4444' : '#10b981';
  var html = '<p class="text-sm font-semibold mb-1" style="color:' + color + ';">'
    + (fileName ? esc(fileName) + '：' : '')
    + '新增 ' + res.added + '，覆盖 ' + res.updated + '，跳过 ' + res.skipped + (res.failed ? '，失败 ' + res.failed : '')
    + '</p>';
  if (res.errors && res.errors.length) {
    html += '<ul class="text-xs leading-relaxed mt-1 space-y-1" style="color: var(--text-tertiary);">'
      + res.errors.slice(0, 8).map(function(e) { return '<li>· ' + esc(e) + '</li>'; }).join('')
      + (res.errors.length > 8 ? '<li>· 还有 ' + (res.errors.length - 8) + ' 条…</li>' : '')
      + '</ul>';
  }
  box.innerHTML = html;
}

function downloadScheduleTemplate() {
  if (typeof XLSX !== 'undefined') {
    var data = [
      ['课程名称', '教师', '教室', '星期', '节次', '周次'],
      ['高等数学', '张老师', '教学楼 A101', '周一', '1-2', '1-16'],
      ['大学英语', '李老师', '教学楼 B203', '周三', '3-4', '1-16单周']
    ];
    var ws = XLSX.utils.aoa_to_sheet(data);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '课表');
    XLSX.writeFile(wb, '课表导入模板.xlsx');
    return;
  }
  var csv = '﻿课程名称,教师,教室,星期,节次,周次\n高等数学,张老师,教学楼 A101,周一,1-2,1-16\n';
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '课表导入模板.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ── 内嵌 WebView 导入（框架） ─────────────────
function openCourseWebImport() {
  if (window.AndroidCourseImport && window.AndroidCourseImport.open) {
    try { window.AndroidCourseImport.open(''); return; } catch (e) { /* 落到提示 */ }
  }
  toast('内嵌浏览器仅在 Android App 内可用');
}

// 原生 WebView 解析完成后回传课程数组
window.onCourseImportResult = async function(json) {
  var list;
  try { list = JSON.parse(json); } catch (e) { toast('解析结果格式错误'); return; }
  if (!Array.isArray(list) || !list.length) { toast('未解析到课程'); return; }
  var courses = [];
  var errors = [];
  list.forEach(function(o, i) {
    var name = String(o.name || o.courseName || o['课程名称'] || '').trim();
    var day = scheduleParseDay(o.dayOfWeek || o.day || o['星期']);
    var sec = scheduleParseSections(o.sections || o.section || o['节次']);
    var wk = scheduleParseWeeks(o.weeks || o.week || o['周次']);
    if (!name || !day || !sec) { errors.push('第 ' + (i + 1) + ' 条解析结果缺少课程名称/星期/节次'); return; }
    courses.push({
      name: name,
      teacher: String(o.teacher || o['教师'] || ''),
      room: String(o.room || o['教室'] || ''),
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      startWeek: wk ? wk.start : 1,
      endWeek: wk ? wk.end : scheduleSettings.totalWeeks,
      weekParity: wk ? wk.parity : 'all',
      color: SCHEDULE_COLORS[courses.length % SCHEDULE_COLORS.length]
    });
  });
  if (!courses.length) {
    renderImportResult({ added: 0, updated: 0, skipped: 0, failed: errors.length, errors: errors }, '网页导入');
    toast('没有可导入的课程');
    return;
  }
  var res = await applyImportedCourses(courses, scheduleImportConflict);
  res.errors = errors.concat(res.errors);
  renderImportResult(res, '网页导入');
  toast('网页导入完成：新增 ' + res.added + ' 门课程');
};

// 首次进入课表时按需初始化
document.addEventListener('DOMContentLoaded', function() {
  loadScheduleSettings();
});
