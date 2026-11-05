// ─────────────────────────────────────────────
// 课表模块：课程增删改、周次视图、备忘录关联、Excel/CSV 导入
// 数据表 courses 在 db.js 中定义，备忘录通过 courseId 关联课程
// ─────────────────────────────────────────────

var SCHEDULE_SETTINGS_KEY = 'schedule-settings';
var SCHEDULE_DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
var SCHEDULE_COLORS = [
  '#0ea5e9', '#22d3ee', '#06b6d4', '#14b8a6', '#10b981',
  '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#f43f5e', '#ec4899', '#d946ef', '#a855f7',
  '#8b5cf6', '#6366f1', '#3b82f6', '#0f766e', '#475569'
];

var scheduleCourses = [];
var scheduleSettings = { semesterStart: '', totalWeeks: 20, sections: 12, periods: [] };
var scheduleEditingPeriods = null;
var scheduleViewWeek = null;        // null = 跟随当前周
var scheduleEditingCourseId = null;
var scheduleDetailCourseId = null;
var scheduleFormColor = SCHEDULE_COLORS[0];
var scheduleInited = false;
var scheduleLoaded = false; // 数据未读完前不渲染空状态，避免“还没有课程”一闪而过
var scheduleImportConflict = 'skip';
var scheduleRenderedDayKey = '';

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
      if (Array.isArray(raw.periods) && raw.periods.length) {
        scheduleSettings.periods = raw.periods;
      } else {
        // 兼容 1.2.3 及以前的作息设置
        var start = scheduleParseTime(raw.dayStart || '08:00');
        var dur = parseInt(raw.periodMinutes, 10) || 45;
        var brk = raw.breakMinutes == null ? 10 : (parseInt(raw.breakMinutes, 10) || 0);
        scheduleSettings.periods = scheduleBuildPeriods(scheduleSettings.sections, start == null ? 480 : start, dur, brk);
      }
    }
  } catch (e) { /* 使用默认值 */ }
  scheduleSettings.totalWeeks = Math.max(1, Math.min(30, scheduleSettings.totalWeeks));
  scheduleSettings.sections = Math.max(6, Math.min(16, scheduleSettings.sections));
  scheduleSettings.periods = scheduleNormalizePeriods(scheduleSettings.periods, scheduleSettings.sections);
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

// 课程块用实色填充，颜色按课程名固定，保证同一门课在整张表里颜色一致
function scheduleColorForName(name) {
  var s = String(name || '');
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return SCHEDULE_COLORS[Math.abs(h) % SCHEDULE_COLORS.length];
}

function scheduleTextColor(hex) {
  var h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var r = parseInt(h.slice(0, 2), 16) || 0;
  var g = parseInt(h.slice(2, 4), 16) || 0;
  var b = parseInt(h.slice(4, 6), 16) || 0;
  // 相对亮度，浅色底用深字，深色底用白字
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.68 ? '#1f2937' : '#ffffff';
}

function scheduleUniq(list) {
  var out = [];
  for (var i = 0; i < list.length; i++) if (out.indexOf(list[i]) < 0) out.push(list[i]);
  return out;
}

// 解析「1-3,5-9周」「1-4周,6-8周(双)」「第4周」这类周次，返回具体周号数组
function scheduleWeekListParse(v) {
  var s = String(v == null ? '' : v).replace(/[，、；;]/g, ',');
  var weeks = [];
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
      if (w >= 1 && w <= 60 && weeks.indexOf(w) < 0) weeks.push(w);
    }
  }
  weeks.sort(function(x, y) { return x - y; });
  return weeks.length ? weeks : null;
}

// 把周号数组压缩成「1-3,5-9」
function scheduleWeeksText(list) {
  var arr = (list || []).slice().sort(function(a, b) { return a - b; });
  var out = [];
  var i = 0;
  while (i < arr.length) {
    var j = i;
    while (j + 1 < arr.length && arr[j + 1] === arr[j] + 1) j++;
    out.push(i === j ? String(arr[i]) : arr[i] + '-' + arr[j]);
    i = j + 1;
  }
  return out.join(',');
}

function scheduleFullWeeks() {
  var list = [];
  for (var i = 1; i <= scheduleSettings.totalWeeks; i++) list.push(i);
  return list;
}

// ── 作息时间 ──────────────────────────────────
function scheduleParseTime(str) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function scheduleMinutesLabel(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  return schedPad2(Math.floor(mins / 60)) + ':' + schedPad2(mins % 60);
}

// 第 n 节课的上课 / 下课时间（来自逐节设置）
function schedulePeriodRange(n) {
  var item = (scheduleSettings.periods || [])[Math.max(1, n) - 1];
  if (!item) return null;
  var start = scheduleParseTime(item.start);
  var end = scheduleParseTime(item.end);
  if (start == null || end == null || end <= start) return null;
  return { start: start, end: end, startLabel: scheduleMinutesLabel(start), endLabel: scheduleMinutesLabel(end) };
}

function scheduleBuildPeriods(count, startMin, duration, gap) {
  var out = [];
  var cursor = startMin == null ? 480 : startMin;
  duration = duration || 45;
  gap = gap == null ? 10 : gap;
  for (var i = 0; i < count; i++) {
    out.push({ start: scheduleMinutesLabel(cursor), end: scheduleMinutesLabel(cursor + duration) });
    cursor += duration + gap;
  }
  return out;
}

function scheduleNormalizePeriods(list, count) {
  var out = [];
  var prevEnd = null;
  var source = Array.isArray(list) ? list : [];
  for (var i = 0; i < count; i++) {
    var item = source[i] || {};
    var start = scheduleParseTime(item.start);
    var end = scheduleParseTime(item.end);
    if (start == null) start = prevEnd == null ? 480 : prevEnd + 10;
    if (end == null || end <= start) end = start + 45;
    out.push({ start: scheduleMinutesLabel(start), end: scheduleMinutesLabel(end) });
    prevEnd = end;
  }
  return out;
}

// 当前查看的这一周的周一
function scheduleMondayForWeek(week) {
  var start = scheduleSettings.semesterStart ? new Date(scheduleSettings.semesterStart + 'T00:00:00') : null;
  if (start && !isNaN(start.getTime())) {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + (week - 1) * 7);
  }
  var now = new Date();
  var todayMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  var diff = week - scheduleComputedWeek();
  return new Date(todayMonday.getFullYear(), todayMonday.getMonth(), todayMonday.getDate() + diff * 7);
}

function scheduleYmd(d) {
  return d.getFullYear() + '-' + schedPad2(d.getMonth() + 1) + '-' + schedPad2(d.getDate());
}

function scheduleDateForDay(monday, dayIdx) {
  return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIdx);
}

// 当前时间落在第几节；不在任何一节或当前周不是本周时返回 0
function scheduleCurrentPeriodIndex() {
  var week = scheduleWeek();
  var monday = scheduleMondayForWeek(week);
  var now = new Date();
  var todayIdx = (now.getDay() + 6) % 7;
  if (scheduleYmd(scheduleDateForDay(monday, todayIdx)) !== scheduleYmd(now)) return 0;
  var minutes = now.getHours() * 60 + now.getMinutes();
  for (var i = 1; i <= scheduleSettings.sections; i++) {
    var range = schedulePeriodRange(i);
    if (range && minutes >= range.start && minutes < range.end) return i;
  }
  return 0;
}

function scheduleApplyNowHighlight() {
  var grid = document.getElementById('timetable-grid');
  if (!grid) return;
  var old = grid.querySelectorAll('.tt-now');
  for (var i = 0; i < old.length; i++) old[i].classList.remove('tt-now');
  var idx = scheduleCurrentPeriodIndex();
  if (!idx) return;
  var targets = grid.querySelectorAll('[data-section="' + idx + '"]');
  for (var j = 0; j < targets.length; j++) targets[j].classList.add('tt-now');
}

function courseWeeksLabel(c) {
  if (Array.isArray(c.weeks) && c.weeks.length) return '第' + scheduleWeeksText(c.weeks) + '周';
  var label = '第' + c.startWeek + '-' + c.endWeek + '周';
  if (c.weekParity === 'odd') label += '（单周）';
  else if (c.weekParity === 'even') label += '（双周）';
  return label;
}

function courseActiveInWeek(c, week) {
  if (Array.isArray(c.weeks) && c.weeks.length) return c.weeks.indexOf(week) >= 0;
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
    // 当前节高亮每半分钟刷新一次；跨天后重画日期与“今天”标记
    setInterval(function() {
      if (typeof currentWidget === 'undefined' || currentWidget !== 'schedule') return;
      if (scheduleRenderedDayKey && scheduleRenderedDayKey !== scheduleYmd(new Date())) {
        renderTimetable();
      } else {
        scheduleApplyNowHighlight();
      }
    }, 30000);
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
  scheduleCourses.forEach(function(c) {
    if ((c.endSection || 0) > sections) sections = Math.min(16, c.endSection);
  });
  var monday = scheduleMondayForWeek(week);
  var todayKey = scheduleYmd(new Date());
  scheduleRenderedDayKey = todayKey;
  var html = '<div class="tt-corner" style="grid-column:1;grid-row:1;"></div>';
  for (var d = 0; d < 7; d++) {
    var dayDate = scheduleDateForDay(monday, d);
    var isToday = scheduleYmd(dayDate) === todayKey;
    var dateLabel = (dayDate.getMonth() + 1) + '/' + dayDate.getDate();
    html += '<div class="tt-day-head' + (isToday ? ' today' : '') + '" style="grid-column:' + (d + 2) + ';grid-row:1;" title="' + SCHEDULE_DAYS[d] + ' ' + scheduleYmd(dayDate) + '">'
      + '<span class="tt-day-name">' + SCHEDULE_DAYS[d] + '</span>'
      + '<span class="tt-day-date">' + dateLabel + '</span>'
      + '</div>';
  }
  for (var s = 1; s <= sections; s++) {
    var pr = schedulePeriodRange(s);
    html += '<div class="tt-section-label" data-section="' + s + '" style="grid-column:1;grid-row:' + (s + 1) + ';"'
      + (pr ? ' title="第 ' + s + ' 节 ' + pr.startLabel + '–' + pr.endLabel + '"' : '')
      + '>' + s + (pr ? '<span class="tt-section-time">' + pr.startLabel + '</span>' : '') + '</div>';
    for (var dd = 0; dd < 7; dd++) {
      html += '<div class="tt-cell" data-section="' + s + '" style="grid-column:' + (dd + 2) + ';grid-row:' + (s + 1) + ';"></div>';
    }
  }

  var visible = scheduleCourses.filter(function(c) { return courseActiveInWeek(c, week); });
  // 同一格可能有多门课（不同周次重叠），按格子分组，竖向平分，避免互相盖住
  var groups = {};
  var groupOrder = [];
  visible.forEach(function(c) {
    var start = Math.max(1, c.startSection || 1);
    var end = Math.max(start, c.endSection || start);
    var key = (c.dayOfWeek || 1) + '|' + start + '|' + end;
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(c);
  });
  groupOrder.forEach(function(key) {
    var arr = groups[key].slice().sort(function(a, b) {
      var aw = Array.isArray(a.weeks) && a.weeks.length ? a.weeks[0] : a.startWeek;
      var bw = Array.isArray(b.weeks) && b.weeks.length ? b.weeks[0] : b.startWeek;
      return (aw || 0) - (bw || 0) || String(a.name).localeCompare(String(b.name));
    });
    var first = arr[0];
    var col = first.dayOfWeek || 1;
    var start = Math.max(1, first.startSection || 1);
    var end = Math.max(start, first.endSection || start);
    var rowStart = start + 1; // 第 1 行是星期表头
    var rowEnd = end + 2;
    var inner = arr.map(function(c) {
      var color = c.color || scheduleColorForName(c.name);
      var textColor = scheduleTextColor(color);
      return '<div class="tt-course" onclick="openCourseDetail(' + c.id + ')" style="--c:' + color + ';color:' + textColor + ';">'
        + '<div class="tt-course-name">' + esc(c.name) + '</div>'
        + (c.room ? '<div class="tt-course-meta">' + esc(c.room) + '</div>' : '')
        + '</div>';
    }).join('');
    html += '<div class="tt-stack" style="grid-column:' + (col + 1) + ';grid-row:' + rowStart + ' / ' + rowEnd + ';">' + inner + '</div>';
  });
  grid.innerHTML = html;
  scheduleApplyNowHighlight();

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
  var weeksInput = document.getElementById('course-weeks-input');
  if (weeksInput) weeksInput.value = c && Array.isArray(c.weeks) && c.weeks.length ? scheduleWeeksText(c.weeks) : '';
  scheduleFormColor = c && c.color ? c.color : SCHEDULE_COLORS[0];
  renderScheduleColorPicker();
  document.getElementById('course-modal').classList.remove('hidden');
  setTimeout(function() {
    var inp = document.getElementById('course-name-input');
    if (inp) inp.focus();
  }, 120);
}

function hideCourseModal() {
  document.getElementById('course-modal').classList.add('hidden');
  scheduleEditingCourseId = null;
}

function renderScheduleColorPicker() {
  var box = document.getElementById('course-color-picker');
  if (!box) return;
  box.innerHTML = SCHEDULE_COLORS.map(function(color) {
    var selected = scheduleFormColor === color;
    var tickColor = scheduleTextColor(color);
    return '<button type="button" aria-label="课程颜色" onclick="selectScheduleColor(\'' + color + '\')" class="w-9 h-9 rounded-full btn-jelly flex items-center justify-center" style="background:' + color + ';box-shadow:0 0 0 ' + (selected ? '2.5px var(--sched-accent), 0 0 0 5px var(--sched-accent-soft)' : '0 transparent') + ';">'
      + (selected ? '<svg class="w-4 h-4" style="color:' + tickColor + ';" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : '')
      + '</button>';
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
  var weeksInputVal = (document.getElementById('course-weeks-input') || {}).value || '';
  var customWeeks = weeksInputVal.trim() ? scheduleWeekListParse(weeksInputVal) : null;
  var payload = {
    name: name,
    teacher: document.getElementById('course-teacher-input').value.trim(),
    room: document.getElementById('course-room-input').value.trim(),
    dayOfWeek: day,
    startSection: startSection,
    endSection: endSection,
    startWeek: customWeeks ? customWeeks[0] : startWeek,
    endWeek: customWeeks ? customWeeks[customWeeks.length - 1] : endWeek,
    weekParity: customWeeks ? 'all' : (document.getElementById('course-parity-select').value || 'all'),
    weeks: customWeeks || null,
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
  switchTab('schedule-settings');
}

function scheduleReadSettingsForm() {
  var start = document.getElementById('schedule-start-date');
  var weeks = document.getElementById('schedule-total-weeks');
  var sections = document.getElementById('schedule-sections');
  return {
    semesterStart: start ? start.value : '',
    totalWeeks: Math.max(1, Math.min(30, parseInt(weeks && weeks.value, 10) || 20)),
    sections: Math.max(6, Math.min(16, parseInt(sections && sections.value, 10) || 12))
  };
}

function renderScheduleSettingsPage() {
  var start = document.getElementById('schedule-start-date');
  if (!start) return;
  start.value = scheduleSettings.semesterStart || '';
  document.getElementById('schedule-total-weeks').value = scheduleSettings.totalWeeks;
  document.getElementById('schedule-sections').value = scheduleSettings.sections;
  scheduleEditingPeriods = scheduleNormalizePeriods(scheduleSettings.periods, scheduleSettings.sections);
  var sectionsInput = document.getElementById('schedule-sections');
  if (sectionsInput) sectionsInput.oninput = scheduleOnSectionsInput;
  renderSchedulePeriodEditor();
}

function scheduleOnSectionsInput() {
  var form = scheduleReadSettingsForm();
  scheduleEditingPeriods = scheduleNormalizePeriods(scheduleEditingPeriods, form.sections);
  renderSchedulePeriodEditor();
}

function renderSchedulePeriodEditor() {
  var box = document.getElementById('schedule-period-editor');
  if (!box) return;
  var form = scheduleReadSettingsForm();
  if (!scheduleEditingPeriods) scheduleEditingPeriods = scheduleNormalizePeriods(scheduleSettings.periods, form.sections);
  scheduleEditingPeriods = scheduleNormalizePeriods(scheduleEditingPeriods, form.sections);
  box.innerHTML = scheduleEditingPeriods.map(function (item, i) {
    return '<div class="flex items-center gap-2">'
      + '<span class="text-xs shrink-0 w-12" style="color: var(--text-secondary);">第 ' + (i + 1) + ' 节</span>'
      + '<input type="time" value="' + esc(item.start) + '" oninput="scheduleUpdatePeriod(' + i + ',\'start\',this.value)" class="flex-1 min-w-0 text-xs px-2 py-2 rounded-[12px] border border-gray-200 bg-gray-50 focus:outline-none" style="color: var(--text-primary);">'
      + '<span class="text-xs shrink-0" style="color: var(--text-tertiary);">–</span>'
      + '<input type="time" value="' + esc(item.end) + '" oninput="scheduleUpdatePeriod(' + i + ',\'end\',this.value)" class="flex-1 min-w-0 text-xs px-2 py-2 rounded-[12px] border border-gray-200 bg-gray-50 focus:outline-none" style="color: var(--text-primary);">'
      + '</div>';
  }).join('');
}

function scheduleUpdatePeriod(index, field, value) {
  if (!scheduleEditingPeriods || !scheduleEditingPeriods[index]) return;
  scheduleEditingPeriods[index][field] = value;
}

function scheduleAutoFillPeriods() {
  var form = scheduleReadSettingsForm();
  var base = scheduleParseTime(((scheduleEditingPeriods || [])[0] || {}).start);
  scheduleEditingPeriods = scheduleBuildPeriods(form.sections, base == null ? 480 : base, 45, 10);
  renderSchedulePeriodEditor();
  toast('已按 45 分钟一节、课间 10 分钟排满，可继续手动调整');
}

function confirmScheduleSettings() {
  var form = scheduleReadSettingsForm();
  var periods = [];
  for (var i = 0; i < form.sections; i++) {
    var item = (scheduleEditingPeriods || [])[i] || {};
    var start = scheduleParseTime(item.start);
    var end = scheduleParseTime(item.end);
    if (start == null || end == null) { toast('第 ' + (i + 1) + ' 节的时间不完整'); return; }
    if (end <= start) { toast('第 ' + (i + 1) + ' 节的结束时间需要晚于开始时间'); return; }
    periods.push({ start: scheduleMinutesLabel(start), end: scheduleMinutesLabel(end) });
  }
  scheduleSettings.semesterStart = form.semesterStart;
  scheduleSettings.totalWeeks = form.totalWeeks;
  scheduleSettings.sections = form.sections;
  scheduleSettings.periods = periods;
  saveScheduleSettings();
  scheduleEditingPeriods = periods.slice();
  renderTimetable();
  toast('课表设置已保存');
}

// ── 清空课表（二次确认）───────────────────────
function showScheduleClearConfirm() {
  if (!scheduleCourses.length) { toast('课表已经是空的'); return; }
  var desc = document.getElementById('schedule-clear-desc');
  if (desc) {
    desc.textContent = '将删除全部 ' + scheduleCourses.length + ' 门课程。关联的备忘录会保留，但会解除课程关联。此操作不可恢复。';
  }
  var modal = document.getElementById('schedule-clear-modal');
  if (modal) modal.classList.remove('hidden');
}

function hideScheduleClearConfirm() {
  var modal = document.getElementById('schedule-clear-modal');
  if (modal) modal.classList.add('hidden');
}

async function scheduleClearSecondConfirm() {
  hideScheduleClearConfirm();
  if (!scheduleCourses.length) { toast('课表已经是空的'); return; }
  if (!await confirmDialog('再次确认：永久删除课表里的 ' + scheduleCourses.length + ' 门课程？')) return;
  var memos = [];
  try { memos = await getMemos(); } catch (e) { /* ignore */ }
  for (var i = 0; i < memos.length; i++) {
    if (memos[i].courseId) {
      try { await updateMemo(memos[i].id, { courseId: null }); } catch (e) { /* ignore */ }
    }
  }
  var list = scheduleCourses.slice();
  for (var j = 0; j < list.length; j++) {
    try { await deleteCourse(list[j].id); } catch (e) { /* ignore */ }
  }
  scheduleViewWeek = null;
  scheduleDetailCourseId = null;
  await refreshSchedule();
  toast('课表已清空');
  switchTab('timetable');
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
    var weekList = header.map.weeks != null ? scheduleWeekListParse(row[header.map.weeks]) : null;
    var contiguous = weekList && weekList.length === (wk.end - wk.start + 1)
      && weekList[0] === wk.start && weekList[weekList.length - 1] === wk.end;
    var item = {
      name: name,
      teacher: header.map.teacher != null ? String(row[header.map.teacher] == null ? '' : row[header.map.teacher]).trim() : '',
      room: header.map.room != null ? String(row[header.map.room] == null ? '' : row[header.map.room]).trim() : '',
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      startWeek: wk.start,
      endWeek: wk.end,
      weekParity: wk.parity,
      color: scheduleColorForName(name)
    };
    if (weekList && !contiguous) { item.weeks = weekList; item.weekParity = 'all'; }
    courses.push(item);
  }
  if (!courses.length && !errors.length) errors.push('文件里没有可导入的课程');
  return { courses: courses, errors: errors };
}

// ── 教务系统整表格式（星期为列、大节为行）──
var SCHEDULE_CN_NUM = '一二三四五六七八九十';

function scheduleGridFindHeader(rows) {
  for (var r = 0; r < Math.min(rows.length, 12); r++) {
    var row = rows[r] || [];
    var cols = {};
    var count = 0;
    for (var c = 0; c < row.length; c++) {
      var t = String(row[c] == null ? '' : row[c]).replace(/[\s　]/g, '');
      var m = t.match(/^(?:星期|周|礼拜)([一二三四五六日天])$/);
      if (m) { var d = scheduleParseDay(m[1]); if (d) { cols[c] = d; count++; } }
    }
    if (count >= 4) return { row: r, cols: cols };
  }
  return null;
}

// 行首「一/二/三…」对应第 1-2、3-4… 节
function scheduleGridSectionForRow(row, order) {
  row = row || [];
  for (var c = 0; c < Math.min(row.length, 3); c++) {
    var t = String(row[c] == null ? '' : row[c]).replace(/[\s　]/g, '');
    var m = t.match(/^(?:第)?([一二三四五六七八九十])(?:大节|节)?$/);
    if (m) {
      var idx = SCHEDULE_CN_NUM.indexOf(m[1]) + 1;
      if (idx > 0) return { start: idx * 2 - 1, end: idx * 2 };
    }
  }
  return { start: order * 2 + 1, end: order * 2 + 2 };
}

// 单行格式：课程名/(节次)周次/校区 教室/教师/职称//周学时/总学时/学分
function scheduleParseGridEntry(line, fallbackSec, day) {
  var raw = String(line == null ? '' : line).replace(/ /g, ' ').trim();
  if (!raw) return null;
  if (/^(注\s*[-—]|说明|备注|实践课程|理论课程)/.test(raw)) return null;
  var parts = raw.split('/');
  var name = String(parts[0] || '').trim();
  if (!name) return null;
  var secPart = String(parts.length > 1 ? parts[1] : '').trim();
  var room = String(parts.length > 2 ? parts[2] : '').trim();
  var teacher = String(parts.length > 3 ? parts[3] : '').trim();
  var sec = { start: fallbackSec.start, end: fallbackSec.end };
  var sm = secPart.match(/[（(]\s*(\d{1,2})\s*[-~－至到]\s*(\d{1,2})\s*节/);
  if (sm) sec = { start: parseInt(sm[1], 10), end: parseInt(sm[2], 10) };
  var weekRaw = secPart.replace(/[（(][^）)]*节[^）)]*[)）]/g, '');
  var weeks = scheduleWeekListParse(weekRaw);
  if (!weeks || !weeks.length) weeks = scheduleFullWeeks();
  room = room.replace(/^[^\s]*校区\s*/, '').trim();
  sec.start = Math.max(1, Math.min(16, sec.start));
  sec.end = Math.max(sec.start, Math.min(16, sec.end));
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

function scheduleMergeText(a, b) {
  a = String(a || '').trim();
  b = String(b || '').trim();
  if (!a) return b;
  if (!b || a === b) return a;
  var list = a.split(/[\/、,，]/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (list.indexOf(b) < 0) list.push(b);
  return list.join('/');
}

// 同名、同天、同节次的条目（如不同周次换老师）合并成一门课
function scheduleMergeGridEntries(entries) {
  var map = {};
  var order = [];
  entries.forEach(function(e) {
    var key = [e.name, e.dayOfWeek, e.startSection, e.endSection].join('|');
    if (!map[key]) { map[key] = e; order.push(key); return; }
    var cur = map[key];
    cur.weeks = scheduleUniq(cur.weeks.concat(e.weeks)).sort(function(a, b) { return a - b; });
    cur.teacher = scheduleMergeText(cur.teacher, e.teacher);
    cur.room = scheduleMergeText(cur.room, e.room);
  });
  return order.map(function(key) {
    var e = map[key];
    e.startWeek = e.weeks[0];
    e.endWeek = e.weeks[e.weeks.length - 1];
    e.weekParity = 'all';
    e.color = scheduleColorForName(e.name);
    return e;
  });
}

// 从导出表的脚注里读「2026-09-07 正式上课」「共 19 周」
function scheduleGridSemester(rows) {
  var text = (rows || []).map(function(r) { return (r || []).join(' '); }).join(' ');
  var out = {};
  var m = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})[日]?\s*(?:正式上课|开学|开始上课)/);
  if (m) out.start = m[1] + '-' + schedPad2(parseInt(m[2], 10)) + '-' + schedPad2(parseInt(m[3], 10));
  var w = text.match(/共\s*(\d{1,2})\s*周/g) || [];
  var maxWeeks = 0;
  w.forEach(function(item) {
    var n = parseInt((item.match(/\d+/) || [0])[0], 10);
    if (n > maxWeeks) maxWeeks = n;
  });
  if (maxWeeks) out.totalWeeks = Math.max(1, Math.min(30, maxWeeks));
  return out;
}

// 返回 null 表示不是整表格式，交给表头式解析
function scheduleParseGrid(rows) {
  var head = scheduleGridFindHeader(rows || []);
  if (!head) return null;
  var entries = [];
  var order = 0;
  var dayCols = Object.keys(head.cols).map(Number);
  for (var r = head.row + 1; r < rows.length; r++) {
    var row = rows[r] || [];
    var hasCourse = dayCols.some(function(c) { return String(row[c] == null ? '' : row[c]).trim(); });
    if (!hasCourse) continue;
    var sec = scheduleGridSectionForRow(row, order);
    order++;
    dayCols.forEach(function(c) {
      var text = String(row[c] == null ? '' : row[c]).trim();
      if (!text) return;
      text.split(/\r?\n/).forEach(function(line) {
        var e = scheduleParseGridEntry(line, sec, head.cols[c]);
        if (e) entries.push(e);
      });
    });
  }
  var merged = scheduleMergeGridEntries(entries);
  if (!merged.length) return { courses: [], errors: ['识别到课表网格，但没有读到课程内容'], layout: 'grid' };
  return { courses: merged, errors: [], layout: 'grid', semester: scheduleGridSemester(rows) };
}

function scheduleCourseKey(c) {
  // 同一门课在同一天的同一节次算重复：覆盖时会把周次等字段更新为新值
  return [String(c.name || '').trim().toLowerCase(), c.dayOfWeek, c.startSection, c.endSection].join('|');
}

async function applyImportedCourses(courses, mode) {
  var result = { added: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  // 同一门课用同一种颜色，不同课程尽量分到不同颜色
  var colorMap = {};
  scheduleCourses.forEach(function(c) {
    if (!colorMap[c.name]) colorMap[c.name] = c.color || scheduleColorForName(c.name);
  });
  function nextColor() {
    var used = Object.keys(colorMap).map(function(n) { return colorMap[n]; });
    for (var i = 0; i < SCHEDULE_COLORS.length; i++) {
      if (used.indexOf(SCHEDULE_COLORS[i]) < 0) return SCHEDULE_COLORS[i];
    }
    return SCHEDULE_COLORS[used.length % SCHEDULE_COLORS.length];
  }
  courses.forEach(function(c) {
    if (!colorMap[c.name]) colorMap[c.name] = nextColor();
    c.color = colorMap[c.name];
  });
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
    // 教务系统导出的整表（星期为列）优先，其次才是表头式表格
    var isGrid = !!scheduleGridFindHeader(rows);
    var sem = isGrid ? scheduleGridSemester(rows) : {};
    if (sem.start) scheduleSettings.semesterStart = sem.start;
    if (sem.totalWeeks) scheduleSettings.totalWeeks = sem.totalWeeks;
    if (sem.start || sem.totalWeeks) saveScheduleSettings();
    var parsed = isGrid ? scheduleParseGrid(rows) : scheduleParseRows(rows);
    var note = '';
    if (sem.start || sem.totalWeeks) {
      var bits = [];
      if (sem.start) bits.push('开学日期 ' + sem.start);
      if (sem.totalWeeks) bits.push('共 ' + sem.totalWeeks + ' 周');
      note = '已从文件读取学期信息：' + bits.join('，');
    }
    var maxSection = 1;
    parsed.courses.forEach(function(c) { maxSection = Math.max(maxSection, c.endSection || 1); });
    if (parsed.layout === 'grid') {
      // 整表导入按实际节次收起，避免多余的空白行把课表顶到屏幕外
      scheduleSettings.sections = Math.max(6, Math.min(16, maxSection));
      saveScheduleSettings();
    } else if (maxSection > scheduleSettings.sections) {
      scheduleSettings.sections = Math.min(16, maxSection);
      saveScheduleSettings();
    }
    if (!parsed.courses.length) {
      renderImportResult({ added: 0, updated: 0, skipped: 0, failed: 0, errors: parsed.errors, note: note }, file.name);
      toast('没有可导入的课程');
      return;
    }
    var res = await applyImportedCourses(parsed.courses, scheduleImportConflict);
    res.errors = parsed.errors.concat(res.errors);
    res.note = note;
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
  if (res.note) {
    html += '<p class="text-xs mt-1" style="color: var(--text-secondary);">' + esc(res.note) + '</p>';
  }
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
    var wkList = Array.isArray(o.weeks) ? o.weeks.filter(function(n) { return typeof n === 'number'; }) : null;
    if (!name || !day || !sec) { errors.push('第 ' + (i + 1) + ' 条解析结果缺少课程名称/星期/节次'); return; }
    var item = {
      name: name,
      teacher: String(o.teacher || o['教师'] || ''),
      room: String(o.room || o['教室'] || ''),
      dayOfWeek: day,
      startSection: sec.start,
      endSection: sec.end,
      startWeek: wkList && wkList.length ? Math.min.apply(null, wkList) : (wk ? wk.start : 1),
      endWeek: wkList && wkList.length ? Math.max.apply(null, wkList) : (wk ? wk.end : scheduleSettings.totalWeeks),
      weekParity: wkList && wkList.length ? 'all' : (wk ? wk.parity : 'all'),
      color: scheduleColorForName(name)
    };
    if (wkList && wkList.length) item.weeks = wkList;
    courses.push(item);
  });
  if (!courses.length) {
    renderImportResult({ added: 0, updated: 0, skipped: 0, failed: errors.length, errors: errors }, '网页导入');
    toast('没有可导入的课程');
    return;
  }
  // 通用识别可能有误差，导入前先让用户确认
  var preview = courses.slice(0, 7).map(function(c) {
    return c.name + '（' + SCHEDULE_DAYS[(c.dayOfWeek || 1) - 1] + ' 第' + c.startSection + '-' + c.endSection + '节）';
  }).join('\n');
  if (!await confirmDialog('识别到 ' + courses.length + ' 个课程安排：\n' + preview
      + (courses.length > 7 ? '\n…' : '') + '\n\n确认导入到本机课表？')) {
    toast('已取消导入');
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
