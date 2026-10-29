// ─────────────────────────────────────────────
// 专注计时 + 学习数据统计
//   focus_tasks    任务（用户自建，可多个）
//   focus_sessions 每次专注记录（开始/结束/时长）
// ─────────────────────────────────────────────

var FOCUS_ACCENT = '#f97316';
var FOCUS_TASK_COLORS = [
  '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1', '#3b82f6',
  '#06b6d4', '#10b981', '#84cc16', '#eab308', '#f59e0b', '#64748b'
];

var focusTasks = [];
var focusSessions = [];
var focusSelectedTaskId = null;
var focusDataReady = false;
var focusInited = false;
var focusEditingTaskId = null;
var focusTaskColor = FOCUS_TASK_COLORS[0];
var focusStatsRange = 7;
var focusStatsMonth = null; // 热力图 / 月度统计共同查看的月份，格式 YYYY-MM
var focusMonthlyScrolledMonth = null;
var focusCalYear = null;
var focusCalMonth = null;
var focusCalSelected = null; // YYYY-MM-DD

var focusSettings = { pomodoroMin: 25 };
var FOCUS_SETTINGS_KEY = 'focus-settings';
var FOCUS_TIMER_KEY = 'focus-timer-state';

var focusTimer = {
  mode: 'up',          // 'up' 正计时 | 'down' 番茄钟
  running: false,
  startAt: 0,          // 当前这一段开始的墙钟时间
  accumulated: 0,      // 之前累计的秒数（暂停/恢复用）
  targetSec: 0,        // 番茄钟总时长
  taskId: null,
  tickId: null,
  completing: false
};

// ── 初始化 ───────────────────────────────────
async function initFocus() {
  loadFocusSettings();
  await refreshFocus();
  if (!focusInited) {
    focusInited = true;
    restoreFocusTimer();
    window.addEventListener('resize', function() {
      if (currentWidget === 'focus') setTimeout(renderStats, 160);
    });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) { updateFocusTimerDisplay(); }
    });
  }
  updateFocusModeUI();
}

async function refreshFocus() {
  await loadFocusData();
  renderFocusTasks();
  updateFocusTimerDisplay();
  updateFocusModeUI();
  renderStats();
  renderFocusCalendar();
  var badges = document.querySelectorAll('#header-badge');
  if (badges.length && currentWidget === 'focus') {
    var s = focusSummary();
    badges[0].textContent = '今日 ' + Math.round(s.todaySec / 60) + ' 分钟';
  }
  var sc = document.getElementById('sidebar-footer-text');
  if (sc && currentWidget === 'focus') {
    sc.textContent = '累计 ' + formatFocusDuration(focusSummary().totalSec);
  }
}

async function loadFocusData() {
  try {
    var res = await Promise.all([getFocusTasks(), getFocusSessions()]);
    focusTasks = (res[0] || []).sort(function(a, b) { return a.createdAt - b.createdAt; });
    focusSessions = res[1] || [];
  } catch (e) {
    console.error('加载专注数据失败', e);
    focusTasks = focusTasks || [];
    focusSessions = focusSessions || [];
  }
  focusDataReady = true;
  if (focusSelectedTaskId !== null) {
    var exists = focusTasks.some(function(t) { return t.id === focusSelectedTaskId; });
    if (!exists) focusSelectedTaskId = null;
  }
  if (focusSelectedTaskId === null && focusTasks.length) {
    focusSelectedTaskId = focusTasks[0].id;
  }
}

// ── 设置 ─────────────────────────────────────
function loadFocusSettings() {
  try {
    var raw = localStorage.getItem(FOCUS_SETTINGS_KEY);
    if (raw) {
      var s = JSON.parse(raw);
      if (s && s.pomodoroMin) focusSettings.pomodoroMin = s.pomodoroMin;
    }
  } catch (e) { /* ignore */ }
  if (!focusTimer.targetSec && focusTimer.mode === 'down') {
    focusTimer.targetSec = focusSettings.pomodoroMin * 60;
  }
}

function saveFocusSettings() {
  try { localStorage.setItem(FOCUS_SETTINGS_KEY, JSON.stringify(focusSettings)); } catch (e) {}
}

function showFocusSettings() {
  var p = document.getElementById('focus-set-pomodoro');
  if (p) p.value = focusSettings.pomodoroMin;
  document.getElementById('focus-settings-modal').classList.remove('hidden');
}

function hideFocusSettings() {
  document.getElementById('focus-settings-modal').classList.add('hidden');
}

function confirmFocusSettings() {
  var p = parseInt(document.getElementById('focus-set-pomodoro').value, 10);
  if (!p || p < 1 || p > 180) { toast('番茄时长请填 1–180 分钟'); return; }
  focusSettings.pomodoroMin = p;
  saveFocusSettings();
  if (focusTimer.mode === 'down' && !focusTimer.running && focusTimer.accumulated === 0) {
    focusTimer.targetSec = p * 60;
  }
  hideFocusSettings();
  updateFocusTimerDisplay();
  renderStats();
  toast('设置已保存');
}

// ── 任务管理 ──────────────────────────────────
function focusTaskById(id) {
  for (var i = 0; i < focusTasks.length; i++) {
    if (focusTasks[i].id === id) return focusTasks[i];
  }
  return null;
}

function focusTaskSeconds(taskId) {
  var total = 0;
  focusSessions.forEach(function(s) {
    if (s.taskId === taskId) total += (s.durationSec || 0);
  });
  return total;
}

function renderFocusTasks() {
  var list = document.getElementById('focus-task-list');
  if (!list) return;
  var todayTaskIds = {};
  focusSessions.forEach(function(s) {
    if (dayKey(s.endAt || s.startAt) === dayKey(Date.now())) todayTaskIds[s.taskId] = true;
  });

  if (!focusTasks.length) {
    list.innerHTML = '<div class="text-center text-xs py-6" style="color: var(--text-tertiary);">还没有任务，点击右上角「新建任务」添加，例如：英语阅读、高数复习</div>';
    updateFocusTimerDisplay();
    return;
  }

  list.innerHTML = focusTasks.map(function(t) {
    var selected = t.id === focusSelectedTaskId;
    var total = focusTaskSeconds(t.id);
    var activeNow = focusTimer.running && focusTimer.taskId === t.id;
    return '<div onclick="selectFocusTask(' + t.id + ')" class="flex items-center gap-3 px-3 py-2.5 rounded-[16px] mb-1.5 cursor-pointer transition-all" style="background:' + (selected ? 'rgba(249,115,22,0.12)' : 'rgba(128,128,128,0.06)') + '; border:0.5px solid ' + (selected ? 'rgba(249,115,22,0.35)' : 'transparent') + ';">'
      + '<span class="shrink-0" style="width:10px;height:10px;border-radius:50%;background:' + t.color + ';box-shadow:0 0 6px ' + t.color + '66;"></span>'
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-sm font-medium truncate" style="color: var(--text-primary);">' + esc(t.name)
          + (activeNow ? ' <span class="text-xs" style="color:' + FOCUS_ACCENT + ';">● 计时中</span>' : '')
        + '</p>'
        + '<p class="text-xs mt-0.5" style="color: var(--text-tertiary);">累计 ' + formatFocusDuration(total) + '</p>'
      + '</div>'
      + (selected ? '<span class="text-xs shrink-0" style="color:' + FOCUS_ACCENT + ';">当前</span>' : '')
      + '<button onclick="event.stopPropagation();showFocusTaskModal(' + t.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
      + '<button onclick="event.stopPropagation();deleteFocusTaskById(' + t.id + ')" class="icon-btn-del" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
    + '</div>';
  }).join('');
}

function selectFocusTask(id) {
  if ((focusTimer.running || focusTimer.accumulated > 0) && focusTimer.taskId && focusTimer.taskId !== id) {
    toast('计时进行中，请先结束当前计时');
    return;
  }
  focusSelectedTaskId = id;
  renderFocusTasks();
  updateFocusTimerDisplay();
  saveFocusTimerState();
}

function showFocusTaskModal(id) {
  focusEditingTaskId = id || null;
  var t = id ? focusTaskById(id) : null;
  document.getElementById('focus-task-modal-title').textContent = t ? '编辑任务' : '新建任务';
  document.getElementById('focus-task-name-input').value = t ? t.name : '';
  focusTaskColor = t ? t.color : FOCUS_TASK_COLORS[focusTasks.length % FOCUS_TASK_COLORS.length];
  renderFocusColorPicker();
  document.getElementById('focus-task-modal').classList.remove('hidden');
  setTimeout(function() {
    var inp = document.getElementById('focus-task-name-input');
    if (inp) inp.focus();
  }, 120);
}

function hideFocusTaskModal() {
  document.getElementById('focus-task-modal').classList.add('hidden');
  focusEditingTaskId = null;
}

function renderFocusColorPicker() {
  var container = document.getElementById('focus-color-picker');
  if (!container) return;
  container.innerHTML = FOCUS_TASK_COLORS.map(function(c) {
    return '<button type="button" onclick="selectFocusColor(\'' + c + '\')" class="w-9 h-9 rounded-full transition-all btn-jelly flex items-center justify-center" style="background:' + c + '; box-shadow:0 2px 8px ' + c + '55;">'
      + (focusTaskColor === c ? '<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : '')
      + '</button>';
  }).join('');
}

function selectFocusColor(c) {
  focusTaskColor = c;
  renderFocusColorPicker();
}

async function confirmFocusTask() {
  var name = document.getElementById('focus-task-name-input').value.trim();
  if (!name) { toast('请输入任务名称'); return; }
  if (focusEditingTaskId) {
    await updateFocusTask(focusEditingTaskId, { name: name, color: focusTaskColor });
    toast('任务已更新');
  } else {
    var id = await addFocusTask(name, focusTaskColor);
    focusSelectedTaskId = id;
    toast('任务已创建');
  }
  hideFocusTaskModal();
  await loadFocusData();
  renderFocusTasks();
  renderStats();
}

async function deleteFocusTaskById(id) {
  var t = focusTaskById(id);
  if (!t) return;
  if (!await confirmDialog('删除任务「' + t.name + '」？\n已有的专注记录会保留在统计中。')) return;
  await deleteFocusTask(id);
  if (focusSelectedTaskId === id) focusSelectedTaskId = null;
  if (focusTimer.taskId === id && !focusTimer.running) focusTimer.taskId = null;
  await loadFocusData();
  renderFocusTasks();
  renderStats();
  toast('任务已删除');
}

// ── 计时器 ────────────────────────────────────
function focusElapsed() {
  var extra = (focusTimer.running && focusTimer.startAt) ? (Date.now() - focusTimer.startAt) / 1000 : 0;
  return focusTimer.accumulated + extra;
}

function setFocusMode(mode) {
  if (focusTimer.running || focusTimer.accumulated > 0) {
    toast('请先结束当前计时');
    return;
  }
  focusTimer.mode = mode;
  focusTimer.targetSec = mode === 'down' ? focusSettings.pomodoroMin * 60 : 0;
  updateFocusModeUI();
  updateFocusTimerDisplay();
  saveFocusTimerState();
}

function updateFocusModeUI() {
  var up = document.getElementById('focus-mode-up');
  var down = document.getElementById('focus-mode-down');
  if (!up || !down) return;
  var isUp = focusTimer.mode === 'up';
  up.style.background = isUp ? 'rgba(249,115,22,0.16)' : 'transparent';
  up.style.color = isUp ? FOCUS_ACCENT : 'var(--text-secondary)';
  up.style.borderColor = isUp ? 'rgba(249,115,22,0.45)' : 'transparent';
  down.style.background = !isUp ? 'rgba(249,115,22,0.16)' : 'transparent';
  down.style.color = !isUp ? FOCUS_ACCENT : 'var(--text-secondary)';
  down.style.borderColor = !isUp ? 'rgba(249,115,22,0.45)' : 'transparent';
  var lbl = document.getElementById('focus-mode-hint');
  if (lbl) lbl.textContent = isUp ? '正计时：记录实际学习时长' : '番茄钟：' + focusSettings.pomodoroMin + ' 分钟后自动记录';
}

async function toggleFocusTimer() {
  if (focusTimer.running) { pauseFocusTimer(); return; }
  await startFocusTimer();
}

async function startFocusTimer() {
  if (!focusSelectedTaskId) { toast('请先选择或新建一个任务'); return; }
  var task = focusTaskById(focusSelectedTaskId);
  if (!task) { toast('任务不存在'); return; }
  if (focusTimer.mode === 'down' && focusTimer.targetSec <= 0) {
    focusTimer.targetSec = focusSettings.pomodoroMin * 60;
  }
  focusTimer.taskId = task.id;
  focusTimer.running = true;
  focusTimer.startAt = Date.now();
  startFocusTicker();
  saveFocusTimerState();
  updateFocusTimerDisplay();
  renderFocusTasks();
  var btn = document.getElementById('focus-start-btn');
  if (btn) btn.textContent = '暂停';
  unlockFocusAudio();
}

function pauseFocusTimer() {
  if (!focusTimer.running) return;
  focusTimer.accumulated += (Date.now() - focusTimer.startAt) / 1000;
  focusTimer.startAt = 0;
  focusTimer.running = false;
  stopFocusTicker();
  saveFocusTimerState();
  updateFocusTimerDisplay();
  renderFocusTasks();
  var btn = document.getElementById('focus-start-btn');
  if (btn) btn.textContent = '继续';
}

async function stopFocusTimer(save) {
  var elapsed = focusElapsed();
  var sec = Math.round(elapsed);
  var t = focusTimer;
  var task = focusTaskById(t.taskId);
  var shouldSave = save && sec >= 5 && task;

  if (shouldSave) {
    var endAt = Date.now();
    await addFocusSession({
      taskId: task.id,
      taskName: task.name,
      startAt: endAt - sec * 1000,
      endAt: endAt,
      durationSec: sec,
      mode: t.mode,
      completed: t.mode === 'down' && sec >= (t.targetSec || 0) - 2
    });
    toast('已记录 ' + formatFocusDuration(sec) + ' · ' + task.name);
  } else if (save && sec > 0 && sec < 5) {
    toast('时长太短，未记录');
  }

  resetFocusTimer();
  await loadFocusData();
  renderFocusTasks();
  renderStats();
  refreshFocusBadge();
}

function resetFocusTimer() {
  stopFocusTicker();
  focusTimer.running = false;
  focusTimer.startAt = 0;
  focusTimer.accumulated = 0;
  focusTimer.targetSec = focusTimer.mode === 'down' ? focusSettings.pomodoroMin * 60 : 0;
  clearFocusTimerState();
  updateFocusTimerDisplay();
  var btn = document.getElementById('focus-start-btn');
  if (btn) btn.textContent = '开始';
  renderFocusTasks();
}

function startFocusTicker() {
  stopFocusTicker();
  focusTimer.tickId = setInterval(function() {
    updateFocusTimerDisplay();
    if (focusTimer.mode === 'down' && focusTimer.targetSec > 0 && focusTimer.running) {
      if (focusElapsed() >= focusTimer.targetSec) completeFocusTimer();
    }
  }, 250);
}

function stopFocusTicker() {
  if (focusTimer.tickId) {
    clearInterval(focusTimer.tickId);
    focusTimer.tickId = null;
  }
}

async function completeFocusTimer() {
  if (focusTimer.completing) return;
  focusTimer.completing = true;
  var task = focusTaskById(focusTimer.taskId);
  var sec = Math.round(focusTimer.targetSec);
  var endAt = Date.now();
  if (task) {
    await addFocusSession({
      taskId: task.id,
      taskName: task.name,
      startAt: endAt - sec * 1000,
      endAt: endAt,
      durationSec: sec,
      mode: 'down',
      completed: true
    });
  }
  notifyFocusDone(task);
  resetFocusTimer();
  focusTimer.completing = false;
  await loadFocusData();
  renderFocusTasks();
  renderStats();
  refreshFocusBadge();
  toast('番茄完成 · ' + (task ? task.name : '') + '（' + sec / 60 + ' 分钟）');
}

function updateFocusTimerDisplay() {
  var timeEl = document.getElementById('focus-time');
  if (!timeEl) return;
  var elapsed = Math.max(0, Math.floor(focusElapsed()));
  var shown = focusTimer.mode === 'down'
    ? Math.max(0, Math.floor((focusTimer.targetSec || 0) - elapsed))
    : elapsed;
  timeEl.textContent = formatClock(shown);

  var ring = document.getElementById('focus-ring');
  if (ring) {
    var C = 2 * Math.PI * 104;
    var progress;
    if (focusTimer.mode === 'down' && focusTimer.targetSec > 0) {
      progress = Math.min(1, elapsed / focusTimer.targetSec);
    } else {
      progress = (elapsed % 3600) / 3600;
    }
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - progress);
  }

  var stateEl = document.getElementById('focus-state-label');
  if (stateEl) {
    var label;
    if (focusTimer.running) label = focusTimer.mode === 'down' ? '专注中 · 倒计时' : '专注中 · 正计时';
    else if (focusTimer.accumulated > 0) label = '已暂停';
    else label = '未开始';
    stateEl.textContent = label;
  }

  var taskEl = document.getElementById('focus-task-label');
  if (taskEl) {
    var t = focusTaskById(focusTimer.taskId || focusSelectedTaskId);
    taskEl.textContent = t ? t.name : '未选择任务';
    taskEl.style.color = t ? (t.color || 'var(--text-secondary)') : 'var(--text-tertiary)';
  }

  var btn = document.getElementById('focus-start-btn');
  if (btn) btn.textContent = focusTimer.running ? '暂停' : (focusTimer.accumulated > 0 ? '继续' : '开始');
  var stopBtn = document.getElementById('focus-stop-btn');
  if (stopBtn) {
    var active = focusTimer.running || focusTimer.accumulated > 0;
    stopBtn.disabled = !active;
    stopBtn.style.opacity = active ? '1' : '0.4';
  }
  var ringColor = focusTaskById(focusTimer.taskId || focusSelectedTaskId);
  if (ring) ring.style.stroke = ringColor ? ringColor.color : FOCUS_ACCENT;
}

// ── 计时状态持久化 ────────────────────────────
function saveFocusTimerState() {
  try {
    if (!focusTimer.running && focusTimer.accumulated <= 0) {
      localStorage.removeItem(FOCUS_TIMER_KEY);
      return;
    }
    localStorage.setItem(FOCUS_TIMER_KEY, JSON.stringify({
      mode: focusTimer.mode,
      running: focusTimer.running,
      startAt: focusTimer.startAt,
      accumulated: focusTimer.accumulated,
      targetSec: focusTimer.targetSec,
      taskId: focusTimer.taskId || focusSelectedTaskId
    }));
  } catch (e) { /* ignore */ }
}

function clearFocusTimerState() {
  try { localStorage.removeItem(FOCUS_TIMER_KEY); } catch (e) {}
}

function restoreFocusTimer() {
  var raw = null;
  try { raw = localStorage.getItem(FOCUS_TIMER_KEY); } catch (e) {}
  if (!raw) {
    if (focusTimer.mode === 'down' && !focusTimer.targetSec) focusTimer.targetSec = focusSettings.pomodoroMin * 60;
    return;
  }
  try {
    var s = JSON.parse(raw);
    if (!s) return;
    focusTimer.mode = s.mode === 'down' ? 'down' : 'up';
    focusTimer.accumulated = Math.max(0, s.accumulated || 0);
    focusTimer.targetSec = s.targetSec || (s.mode === 'down' ? focusSettings.pomodoroMin * 60 : 0);
    if (s.taskId) {
      focusTimer.taskId = s.taskId;
      if (focusTaskById(s.taskId)) focusSelectedTaskId = s.taskId;
    }
    if (s.running && s.startAt) {
      focusTimer.running = true;
      focusTimer.startAt = s.startAt;
      startFocusTicker();
      var elapsed = focusElapsed();
      if (focusTimer.mode === 'down' && focusTimer.targetSec > 0 && elapsed >= focusTimer.targetSec) {
        completeFocusTimer();
      } else {
        setTimeout(function() { toast('已恢复上次计时 · 已专注 ' + formatFocusDuration(Math.round(focusElapsed()))); }, 600);
      }
    }
  } catch (e) { /* ignore */ }
}

function refreshFocusBadge() {
  if (currentWidget !== 'focus') return;
  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = '今日 ' + Math.round(focusSummary().todaySec / 60) + ' 分钟';
  var sc = document.getElementById('sidebar-footer-text');
  if (sc) sc.textContent = '累计 ' + formatFocusDuration(focusSummary().totalSec);
}

// ── 提醒 ──────────────────────────────────────
var _focusAudioCtx = null;
function unlockFocusAudio() {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_focusAudioCtx) _focusAudioCtx = new AC();
    if (_focusAudioCtx.state === 'suspended') _focusAudioCtx.resume();
  } catch (e) { /* ignore */ }
}

function notifyFocusDone(task) {
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_focusAudioCtx) _focusAudioCtx = new AC();
    var ctx = _focusAudioCtx;
    var now = ctx.currentTime;
    [880, 1174].forEach(function(freq, i) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, now + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.22, now + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.28);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(now + i * 0.18);
      o.stop(now + i * 0.18 + 0.3);
    });
  } catch (e) { /* ignore */ }
}

// ── 统计数据工具 ──────────────────────────────
function dayKey(ts) {
  var d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function startOfDay(ts) {
  var d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function focusSummary() {
  var now = new Date();
  var todayStart = startOfDay(now.getTime());
  var mondayOffset = (now.getDay() + 6) % 7;
  var weekStart = todayStart - mondayOffset * 86400000;
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  var res = { todaySec: 0, weekSec: 0, monthSec: 0, totalSec: 0, todayCount: 0, totalCount: 0 };
  focusSessions.forEach(function(s) {
    var sec = s.durationSec || 0;
    var ts = focusSessionTs(s);
    res.totalSec += sec;
    res.totalCount++;
    if (ts >= todayStart) { res.todaySec += sec; res.todayCount++; }
    if (ts >= weekStart) res.weekSec += sec;
    if (ts >= monthStart) res.monthSec += sec;
  });
  return res;
}

function focusDayMap() {
  var map = {};
  focusSessions.forEach(function(s) {
    var ts = focusSessionTs(s);
    var k = dayKey(ts);
    map[k] = (map[k] || 0) + (s.durationSec || 0);
  });
  return map;
}

function focusStreak() {
  var map = focusDayMap();
  var d = new Date();
  d.setHours(0, 0, 0, 0);
  if (!map[dayKey(d.getTime())]) d.setDate(d.getDate() - 1);
  var streak = 0;
  while (map[dayKey(d.getTime())]) {
    streak++;
    d.setDate(d.getDate() - 1);
    if (streak > 3650) break;
  }
  return streak;
}

function focusRangeDays(range) {
  var today = startOfDay(Date.now());
  var days = [];
  var i;
  if (range === 'all') {
    var earliest = null;
    focusSessions.forEach(function(s) {
      var ts = focusSessionTs(s);
      if (ts && (earliest === null || ts < earliest)) earliest = ts;
    });
    var start = earliest ? startOfDay(earliest) : today - 29 * 86400000;
    var n = Math.round((today - start) / 86400000) + 1;
    n = Math.min(n, 400);
    for (i = n - 1; i >= 0; i--) days.push(today - i * 86400000);
  } else if (range === 'month') {
    var first = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1).getTime();
    var cnt = Math.round((today - first) / 86400000) + 1;
    for (i = 0; i < cnt; i++) days.push(first + i * 86400000);
  } else {
    var n2 = parseInt(range, 10) || 7;
    for (i = n2 - 1; i >= 0; i--) days.push(today - i * 86400000);
  }
  return days;
}

function formatClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  if (h > 0) return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  return pad2(m) + ':' + pad2(s);
}

function formatFocusDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + ' 秒';
  var m = Math.floor(sec / 60);
  if (m < 60) return m + ' 分钟';
  var h = Math.floor(m / 60);
  var rm = m % 60;
  return h + ' 小时' + (rm ? ' ' + rm + ' 分' : '');
}

// ── 统计页渲染 ────────────────────────────────
function setFocusStatsRange(range) {
  focusStatsRange = range;
  renderStats();
}

function renderStats() {
  if (!focusDataReady) return;
  if (!document.getElementById('page-stats')) return;
  updateStatsRangeUI();
  renderStatsOverview();
  drawTrendChart();
  drawHourChart();
  drawHeatmap();
  drawMonthlyChart();
  drawDonutAndRank();
}

function updateStatsRangeUI() {
  var btns = document.querySelectorAll('.focus-range-btn');
  for (var i = 0; i < btns.length; i++) {
    var active = btns[i].getAttribute('data-range') === String(focusStatsRange);
    btns[i].style.background = active ? 'rgba(249,115,22,0.16)' : 'transparent';
    btns[i].style.color = active ? FOCUS_ACCENT : 'var(--text-secondary)';
    btns[i].style.borderColor = active ? 'rgba(249,115,22,0.45)' : 'transparent';
  }
}

function renderStatsOverview() {
  var el = document.getElementById('stats-overview');
  if (!el) return;
  var s = focusSummary();
  var cards = [
    { label: '今日', sec: s.todaySec, sub: s.todayCount + ' 次专注' },
    { label: '本周', sec: s.weekSec, sub: '周一起算' },
    { label: '本月', sec: s.monthSec, sub: new Date().getMonth() + 1 + ' 月' },
    { label: '累计', sec: s.totalSec, sub: s.totalCount + ' 次记录' }
  ];
  el.innerHTML = cards.map(function(c) {
    return '<div class="rounded-[20px] p-3.5" style="background: var(--card-bg); border: var(--card-border); backdrop-filter: var(--card-backdrop); -webkit-backdrop-filter: var(--card-backdrop);">'
      + '<p class="text-xs mb-1" style="color: var(--text-tertiary);">' + c.label + '</p>'
      + '<p class="text-lg font-bold leading-tight" style="color: var(--text-primary);">' + formatFocusDuration(c.sec) + '</p>'
      + '<p class="text-xs mt-0.5" style="color: var(--text-tertiary);">' + c.sub + '</p>'
    + '</div>';
  }).join('');
}

// ── Canvas 工具 ───────────────────────────────
function focusCssVar(name, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  } catch (e) { return fallback; }
}

function focusCanvas(id, height) {
  var c = document.getElementById(id);
  if (!c) return null;
  var parent = c.parentElement;
  c.style.width = '100%';
  c.style.height = height + 'px';
  var w = Math.floor(c.getBoundingClientRect().width || (parent ? parent.clientWidth : 320) || 320);
  if (w < 120) w = 320;
  var dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(height * dpr);
  var ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, height);
  return { ctx: ctx, w: w, h: height, canvas: c };
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (w < 0) w = 0;
  if (h < 0) h = 0;
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

var FOCUS_WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ── 每日趋势图 ────────────────────────────────
function drawTrendChart() {
  var cv = focusCanvas('chart-trend', 190);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w, H = cv.h;
  var days = focusRangeDays(focusStatsRange);
  var map = focusDayMap();
  var vals = days.map(function(ts) { return Math.round((map[dayKey(ts)] || 0) / 60); });
  var maxV = Math.max.apply(null, vals.concat([1]));
  var top = Math.max(30, Math.ceil(maxV / 15) * 15);
  var pad = { l: 34, r: 8, t: 10, b: 24 };
  var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  var text = focusCssVar('--text-tertiary', '#8e8e93');
  var grid = 'rgba(128,128,128,0.16)';
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';

  for (var g = 0; g <= 3; g++) {
    var gy = pad.t + ph - ph * g / 3;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy + 0.5);
    ctx.lineTo(W - pad.r, gy + 0.5);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(top * g / 3)), pad.l - 6, gy);
  }

  var hasData = vals.some(function(v) { return v > 0; });
  if (!hasData) {
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无专注记录，去计时页开始第一次专注吧', pad.l + pw / 2, pad.t + ph / 2);
    return;
  }

  var n = vals.length;
  var slot = pw / n;
  var bw = Math.max(2, Math.min(26, slot * 0.64));
  var todayKey = dayKey(Date.now());

  for (var i = 0; i < n; i++) {
    var v = vals[i];
    var x = pad.l + slot * i + (slot - bw) / 2;
    if (v > 0) {
      var bh = Math.max(2, ph * v / top);
      var y2 = pad.t + ph - bh;
      var isToday = dayKey(days[i]) === todayKey;
      var grad = ctx.createLinearGradient(0, y2, 0, pad.t + ph);
      grad.addColorStop(0, isToday ? '#fdba74' : 'rgba(249,115,22,0.85)');
      grad.addColorStop(1, isToday ? '#f97316' : 'rgba(249,115,22,0.3)');
      ctx.fillStyle = grad;
      roundRectPath(ctx, x, y2, bw, bh, Math.min(4, bw / 2));
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(128,128,128,0.14)';
      roundRectPath(ctx, x, pad.t + ph - 2, bw, 2, 1);
      ctx.fill();
    }
  }

  ctx.fillStyle = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  var every = n <= 7 ? 1 : Math.ceil(n / 6);
  for (var k = 0; k < n; k += every) {
    var d = new Date(days[k]);
    var label;
    if (n <= 7) label = FOCUS_WEEKDAYS[(d.getDay() + 6) % 7];
    else label = (d.getMonth() + 1) + '/' + d.getDate();
    ctx.fillText(label, pad.l + slot * k + slot / 2, pad.t + ph + 6);
  }
}

// ── 时段分布图 ────────────────────────────────
function drawHourChart() {
  var cv = focusCanvas('chart-hours', 170);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w, H = cv.h;
  var hours = new Array(24).fill(0);
  var bounds = focusMonthBounds();
  focusSessions.forEach(function(s) {
    var ts = focusSessionTs(s);
    if (ts < bounds.start || ts >= bounds.end) return;
    var hour = new Date(s.startAt || ts).getHours();
    hours[hour] += Math.round((s.durationSec || 0) / 60);
  });

  var maxV = Math.max.apply(null, hours.concat([1]));
  var top = Math.max(30, Math.ceil(maxV / 15) * 15);
  var pad = { l: 30, r: 8, t: 10, b: 22 };
  var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  var text = focusCssVar('--text-tertiary', '#8e8e93');

  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  for (var g = 0; g <= 2; g++) {
    var gy = pad.t + ph - ph * g / 2;
    ctx.strokeStyle = 'rgba(128,128,128,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy + 0.5);
    ctx.lineTo(W - pad.r, gy + 0.5);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(top * g / 2)), pad.l - 5, gy);
  }

  if (!hours.some(function(v) { return v > 0; })) {
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据', pad.l + pw / 2, pad.t + ph / 2);
    return;
  }

  var slot = pw / 24;
  var bw = Math.max(2, slot * 0.62);
  var peak = Math.max.apply(null, hours);
  for (var i = 0; i < 24; i++) {
    var v = hours[i];
    var x = pad.l + slot * i + (slot - bw) / 2;
    if (v > 0) {
      var bh = Math.max(2, ph * v / top);
      var y2 = pad.t + ph - bh;
      var isPeak = v === peak;
      ctx.fillStyle = isPeak ? '#f97316' : 'rgba(249,115,22,0.55)';
      roundRectPath(ctx, x, y2, bw, bh, Math.min(3, bw / 2));
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(128,128,128,0.12)';
      roundRectPath(ctx, x, pad.t + ph - 2, bw, 2, 1);
      ctx.fill();
    }
  }

  ctx.fillStyle = text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (var hh = 0; hh < 24; hh += 4) {
    ctx.fillText(hh + '时', pad.l + slot * hh + slot / 2, pad.t + ph + 6);
  }
}

// ── 月份选择 ──────────────────────────────────
function focusMonthParts() {
  if (!focusStatsMonth) {
    var now = new Date();
    focusStatsMonth = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  }
  var p = focusStatsMonth.split('-');
  return { year: parseInt(p[0], 10), month: parseInt(p[1], 10) - 1 };
}

// 当前查看月份的时间范围 [start, end)
function focusMonthBounds() {
  var mp = focusMonthParts();
  return {
    start: new Date(mp.year, mp.month, 1).getTime(),
    end: new Date(mp.year, mp.month + 1, 1).getTime()
  };
}

function syncFocusMonthInputs() {
  var ids = ['focus-hours-month', 'focus-heatmap-month', 'focus-monthly-month', 'focus-donut-month'];
  for (var i = 0; i < ids.length; i++) {
    var input = document.getElementById(ids[i]);
    if (input && input.value !== focusStatsMonth) input.value = focusStatsMonth;
  }
}

function setFocusStatsMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value || '')) return;
  focusStatsMonth = value;
  syncFocusMonthInputs();
  drawHourChart();
  drawHeatmap();
  drawMonthlyChart();
  drawDonutAndRank();
}

function changeFocusStatsMonth(delta) {
  var mp = focusMonthParts();
  var d = new Date(mp.year, mp.month + delta, 1);
  setFocusStatsMonth(d.getFullYear() + '-' + pad2(d.getMonth() + 1));
}

// ── 打卡热力图（按月份显示，时长越长颜色越深） ──
function focusHeatLevel(mins) {
  if (mins <= 0) return { bg: 'rgba(128,128,128,0.08)', strong: false };
  if (mins < 30) return { bg: 'rgba(249,115,22,0.18)', strong: false };
  if (mins < 60) return { bg: 'rgba(249,115,22,0.34)', strong: false };
  if (mins < 90) return { bg: 'rgba(249,115,22,0.50)', strong: false };
  if (mins < 120) return { bg: 'rgba(249,115,22,0.66)', strong: true };
  if (mins < 180) return { bg: 'rgba(249,115,22,0.82)', strong: true };
  return { bg: 'rgba(249,115,22,0.96)', strong: true };
}

function drawHeatmap() {
  var probe = focusCanvas('chart-heatmap', 250);
  if (!probe) return;
  syncFocusMonthInputs();

  var mp = focusMonthParts();
  var dayCount = new Date(mp.year, mp.month + 1, 0).getDate();
  var firstDow = (new Date(mp.year, mp.month, 1).getDay() + 6) % 7;
  var rows = Math.ceil((firstDow + dayCount) / 7);
  var gap = 4, top = 20, bottom = 4;
  var cell = Math.floor((probe.w - gap * 6) / 7);
  cell = Math.max(18, Math.min(38, cell));
  var height = top + rows * (cell + gap) + bottom;

  var cv = height === 250 ? probe : focusCanvas('chart-heatmap', height);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w;
  var gridW = 7 * cell + 6 * gap;
  var ox = Math.max(0, (W - gridW) / 2);
  var oy = 18;
  var text = focusCssVar('--text-tertiary', '#8e8e93');
  var primary = focusCssVar('--text-primary', '#1d1d1f');
  var map = focusDayMap();
  var now = new Date();
  var todayKeyStr = dayKey(now.getTime());

  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = text;
  var wd = ['一', '二', '三', '四', '五', '六', '日'];
  for (var w = 0; w < 7; w++) {
    ctx.fillText(wd[w], ox + w * (cell + gap) + cell / 2, 8);
  }

  for (var d = 1; d <= dayCount; d++) {
    var k = mp.year + '-' + pad2(mp.month + 1) + '-' + pad2(d);
    var mins = Math.round((map[k] || 0) / 60);
    var idx = firstDow + d - 1;
    var x = ox + (idx % 7) * (cell + gap);
    var y = oy + Math.floor(idx / 7) * (cell + gap);
    var lvl = focusHeatLevel(mins);
    ctx.fillStyle = lvl.bg;
    roundRectPath(ctx, x, y, cell, cell, 4);
    ctx.fill();

    ctx.font = (cell >= 30 ? '11px' : '9px') + ' -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = lvl.strong ? '#ffffff' : (mins > 0 ? primary : text);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d), x + cell / 2, y + cell / 2 + 0.5);

    if (k === todayKeyStr) {
      ctx.strokeStyle = lvl.strong ? 'rgba(255,255,255,0.95)' : 'rgba(249,115,22,0.95)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, x - 1, y - 1, cell + 2, cell + 2, 5);
      ctx.stroke();
    }
  }
}

// ── 月度专注曲线（可左右滑动） ─────────────────
function focusCanvasSized(id, height, width) {
  var c = document.getElementById(id);
  if (!c) return null;
  c.style.width = width + 'px';
  c.style.height = height + 'px';
  var dpr = window.devicePixelRatio || 1;
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  var ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx: ctx, w: width, h: height, canvas: c };
}

function focusBuildCurve(ctx, pts, topY, bottomY) {
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[i - 1] || pts[i];
    var p1 = pts[i];
    var p2 = pts[i + 1];
    var p3 = pts[i + 2] || p2;
    var c1x = p1.x + (p2.x - p0.x) / 6;
    var c1y = p1.y + (p2.y - p0.y) / 6;
    var c2x = p2.x - (p3.x - p1.x) / 6;
    var c2y = p2.y - (p3.y - p1.y) / 6;
    c1y = Math.max(topY, Math.min(bottomY, c1y));
    c2y = Math.max(topY, Math.min(bottomY, c2y));
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
  }
}

function drawMonthlyChart() {
  var wrap = document.getElementById('chart-monthly-wrap');
  if (!wrap) return;
  syncFocusMonthInputs();

  var mp = focusMonthParts();
  var n = new Date(mp.year, mp.month + 1, 0).getDate();
  var pad = { l: 2, r: 12, t: 12, b: 24 };
  var slot = 42;
  var width = Math.max(wrap.clientWidth || 320, pad.l + n * slot + pad.r);
  var cv = focusCanvasSized('chart-monthly', 200, width);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w, H = cv.h;
  var map = focusDayMap();
  var vals = [];
  for (var i = 0; i < n; i++) {
    var k = mp.year + '-' + pad2(mp.month + 1) + '-' + pad2(i + 1);
    vals.push(Math.round((map[k] || 0) / 60));
  }
  var total = vals.reduce(function(a, v) { return a + v; }, 0);
  var activeDays = vals.filter(function(v) { return v > 0; }).length;
  var totalEl = document.getElementById('focus-monthly-total');
  if (totalEl) totalEl.textContent = '共 ' + total + ' 分钟 · ' + activeDays + ' 天';

  var maxV = Math.max.apply(null, vals.concat([1]));
  var top = Math.max(30, Math.ceil(maxV / 15) * 15);
  var pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  var bottom = pad.t + ph;
  var text = focusCssVar('--text-tertiary', '#8e8e93');

  // 固定在左侧的纵轴刻度（不随横向滚动移动）
  var ycv = focusCanvasSized('chart-monthly-y', 200, 34);
  if (ycv) {
    var yctx = ycv.ctx;
    yctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    yctx.fillStyle = text;
    yctx.textAlign = 'right';
    yctx.textBaseline = 'middle';
    for (var yg = 0; yg <= 3; yg++) {
      yctx.fillText(String(Math.round(top * yg / 3)), 30, pad.t + ph - ph * yg / 3);
    }
  }

  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  for (var g = 0; g <= 3; g++) {
    var gy = pad.t + ph - ph * g / 3;
    ctx.strokeStyle = 'rgba(128,128,128,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy + 0.5);
    ctx.lineTo(W - pad.r, gy + 0.5);
    ctx.stroke();
  }

  var xAt = function(i) { return pad.l + i * slot + slot / 2; };
  var yAt = function(v) { return pad.t + ph - ph * Math.min(1, v / top); };
  var pts = vals.map(function(v, i) { return { x: xAt(i), y: yAt(v) }; });

  if (total === 0) {
    ctx.fillStyle = text;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('这个月还没有专注记录', pad.l + pw / 2, pad.t + ph / 2);
  } else {
    var fill = ctx.createLinearGradient(0, pad.t, 0, bottom);
    fill.addColorStop(0, 'rgba(249,115,22,0.30)');
    fill.addColorStop(1, 'rgba(249,115,22,0.02)');
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, bottom);
    ctx.lineTo(pts[0].x, pts[0].y);
    focusBuildCurve(ctx, pts, pad.t, bottom);
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    focusBuildCurve(ctx, pts, pad.t, bottom);
    ctx.stroke();

    vals.forEach(function(v, i) {
      if (v <= 0) return;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  var now = new Date();
  var todayStr = dayKey(now.getTime());
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (var d = 0; d < n; d++) {
    var dayK = mp.year + '-' + pad2(mp.month + 1) + '-' + pad2(d + 1);
    var isToday = dayK === todayStr;
    ctx.fillStyle = isToday ? FOCUS_ACCENT : text;
    ctx.font = (isToday ? 'bold ' : '') + '9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(String(d + 1), xAt(d), bottom + 6);
    if (isToday) {
      ctx.strokeStyle = 'rgba(249,115,22,0.35)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xAt(d), pad.t);
      ctx.lineTo(xAt(d), bottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 当前月份自动滚动到今天附近
  var statsVisible = document.getElementById('page-stats') && document.getElementById('page-stats').classList.contains('active');
  if (statsVisible && focusMonthlyScrolledMonth !== focusStatsMonth) {
    focusMonthlyScrolledMonth = focusStatsMonth;
    if (mp.year === now.getFullYear() && mp.month === now.getMonth()) {
      wrap.scrollLeft = Math.max(0, xAt(now.getDate() - 1) - Math.min(wrap.clientWidth * 0.75, 240));
    } else {
      wrap.scrollLeft = 0;
    }
  }
}

// ── 时长分布 + 排行 ───────────────────────────
function focusTaskGroups() {
  var groups = {};
  var bounds = focusMonthBounds();
  focusSessions.forEach(function(s) {
    var ts = focusSessionTs(s);
    if (ts < bounds.start || ts >= bounds.end) return;
    var name = s.taskName || '未命名';
    if (!groups[name]) groups[name] = { name: name, sec: 0, taskId: s.taskId };
    groups[name].sec += (s.durationSec || 0);
  });
  var arr = Object.keys(groups).map(function(k) { return groups[k]; });
  arr.sort(function(a, b) { return b.sec - a.sec; });
  return arr;
}

function focusGroupColor(g, index) {
  var t = focusTaskById(g.taskId);
  if (t && t.color) return t.color;
  for (var i = 0; i < focusTasks.length; i++) {
    if (focusTasks[i].name === g.name) return focusTasks[i].color;
  }
  return FOCUS_TASK_COLORS[index % FOCUS_TASK_COLORS.length];
}

function drawDonutAndRank() {
  var rankEl = document.getElementById('stats-task-rank');
  var cv = focusCanvas('chart-donut', 190);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w, H = cv.h;
  var groups = focusTaskGroups();
  var totalSec = groups.reduce(function(a, g) { return a + g.sec; }, 0);
  var cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14, r = R * 0.62;
  var text = focusCssVar('--text-tertiary', '#8e8e93');

  if (!groups.length || totalSec <= 0) {
    ctx.strokeStyle = 'rgba(128,128,128,0.16)';
    ctx.lineWidth = R - r;
    ctx.beginPath();
    ctx.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无数据', cx, cy);
  } else {
    var top = groups.slice(0, 6);
    var otherSec = groups.slice(6).reduce(function(a, g) { return a + g.sec; }, 0);
    if (otherSec > 0) top.push({ name: '其他', sec: otherSec, taskId: null });
    var ang = -Math.PI / 2;
    top.forEach(function(g, i) {
      var frac = g.sec / totalSec;
      var a2 = ang + frac * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang, a2);
      ctx.arc(cx, cy, r, a2, ang, true);
      ctx.closePath();
      ctx.fillStyle = g.name === '其他' ? 'rgba(128,128,128,0.45)' : focusGroupColor(g, i);
      ctx.fill();
      ang = a2;
    });
    ctx.fillStyle = focusCssVar('--text-primary', '#1d1d1f');
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatFocusDuration(totalSec), cx, cy - 7);
    ctx.fillStyle = text;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('总时长', cx, cy + 12);
  }

  if (!rankEl) return;
  if (!groups.length) {
    rankEl.innerHTML = '<p class="text-xs text-center py-8" style="color: var(--text-tertiary);">当前范围内的专注记录会按任务汇总在这里</p>';
    return;
  }
  var maxSec = groups[0].sec || 1;
  rankEl.innerHTML = groups.slice(0, 8).map(function(g, i) {
    var pct = totalSec ? Math.round(g.sec / totalSec * 100) : 0;
    var color = focusGroupColor(g, i);
    return '<div class="mb-2.5">'
      + '<div class="flex items-center gap-2 text-xs mb-1">'
        + '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>'
        + '<span class="flex-1 truncate" style="color: var(--text-primary);">' + esc(g.name) + '</span>'
        + '<span style="color: var(--text-tertiary);">' + formatFocusDuration(g.sec) + ' · ' + pct + '%</span>'
      + '</div>'
      + '<div class="rounded-full overflow-hidden" style="height:5px;background:rgba(128,128,128,0.14);">'
        + '<div style="height:100%;width:' + Math.max(3, Math.round(g.sec / maxSec * 100)) + '%;background:' + color + ';border-radius:999px;"></div>'
      + '</div>'
    + '</div>';
  }).join('');
}

// ── 补录记录 ──────────────────────────────────
function focusSessionTs(s) {
  // 补录记录按用户选择的日期（开始时间）归日，其余按结束时间
  if (s.mode === 'manual') return s.startAt || s.endAt || 0;
  return s.endAt || s.startAt || 0;
}

function focusModeLabel(mode) {
  if (mode === 'manual') return '补录';
  return mode === 'down' ? '番茄钟' : '正计时';
}

function showFocusManualModal(dateStr) {
  if (!focusDataReady) return;
  var sel = document.getElementById('focus-manual-task');
  if (sel) {
    if (focusTasks.length) {
      sel.innerHTML = focusTasks.map(function(t) {
        return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
      }).join('');
      if (focusSelectedTaskId !== null) sel.value = String(focusSelectedTaskId);
    } else {
      sel.innerHTML = '<option value="">未命名专注</option>';
    }
  }

  var dateEl = document.getElementById('focus-manual-date');
  var timeEl = document.getElementById('focus-manual-time');
  var minEl = document.getElementById('focus-manual-minutes');
  var now = new Date();
  if (dateEl) dateEl.value = dateStr || dayKey(now.getTime());
  if (timeEl) timeEl.value = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  if (minEl) minEl.value = 30;

  var modal = document.getElementById('focus-manual-modal');
  if (modal) modal.classList.remove('hidden');
}

function hideFocusManualModal() {
  var modal = document.getElementById('focus-manual-modal');
  if (modal) modal.classList.add('hidden');
}

async function confirmFocusManual() {
  var taskSel = document.getElementById('focus-manual-task');
  var dateVal = (document.getElementById('focus-manual-date') || {}).value || '';
  var timeVal = (document.getElementById('focus-manual-time') || {}).value || '';
  var minutes = parseInt((document.getElementById('focus-manual-minutes') || {}).value, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) { toast('请选择日期'); return; }
  if (!minutes || minutes < 1 || minutes > 1440) { toast('请输入 1–1440 分钟'); return; }
  if (!/^\d{2}:\d{2}$/.test(timeVal)) timeVal = '00:00';

  var dp = dateVal.split('-');
  var tp = timeVal.split(':');
  var startAt = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1], 0, 0).getTime();
  if (isNaN(startAt)) { toast('时间格式有误'); return; }

  var taskId = taskSel && taskSel.value ? Number(taskSel.value) : null;
  var task = taskId ? focusTaskById(taskId) : null;
  var durationSec = minutes * 60;

  await addFocusSession({
    taskId: taskId,
    taskName: task ? task.name : '未命名专注',
    startAt: startAt,
    endAt: startAt + durationSec * 1000,
    durationSec: durationSec,
    mode: 'manual',
    completed: true
  });

  hideFocusManualModal();
  await loadFocusData();
  renderFocusTasks();
  renderStats();
  renderFocusCalendar();
  refreshFocusBadge();
  toast('已补录 ' + minutes + ' 分钟' + (task ? ' · ' + task.name : ''));
}

// ── 专注日历 ──────────────────────────────────
function ensureFocusCalendarState() {
  var now = new Date();
  if (focusCalYear === null || focusCalMonth === null) {
    focusCalYear = now.getFullYear();
    focusCalMonth = now.getMonth();
  }
  if (!focusCalSelected) focusCalSelected = dayKey(now.getTime());
}

function focusCalMonthKey() {
  return focusCalYear + '-' + pad2(focusCalMonth + 1);
}

// 日历格子右侧的时长文字，控制长度避免撑出格子
function focusCalTimeLabel(mins) {
  if (!mins) return '';
  if (mins < 300) return mins + '分';
  var h = mins / 60;
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + 'h';
}

function renderFocusCalendar() {
  var grid = document.getElementById('focus-cal-grid');
  if (!grid || !focusDataReady) return;
  ensureFocusCalendarState();

  var label = document.getElementById('focus-cal-label');
  if (label) label.textContent = focusCalYear + '年' + (focusCalMonth + 1) + '月';

  var dayCount = new Date(focusCalYear, focusCalMonth + 1, 0).getDate();
  var firstDow = (new Date(focusCalYear, focusCalMonth, 1).getDay() + 6) % 7;
  var map = focusDayMap();
  var todayStr = dayKey(Date.now());
  var prefix = focusCalMonthKey() + '-';
  var html = '';

  for (var b = 0; b < firstDow; b++) html += '<div></div>';

  for (var d = 1; d <= dayCount; d++) {
    var key = prefix + pad2(d);
    var mins = Math.round((map[key] || 0) / 60);
    var lvl = focusHeatLevel(mins);
    var selected = key === focusCalSelected;
    var isToday = key === todayStr;
    var style = 'min-height:46px;border-radius:10px;padding:4px 2px;line-height:1;background:' + lvl.bg + ';display:flex;align-items:center;justify-content:space-between;gap:1px;overflow:hidden;';
    if (selected) style += 'box-shadow:inset 0 0 0 2px ' + (lvl.strong ? 'rgba(255,255,255,0.95)' : FOCUS_ACCENT) + ';';
    else if (isToday) style += 'box-shadow:inset 0 0 0 1px rgba(249,115,22,0.55);';
    var numColor = lvl.strong ? '#ffffff' : (isToday ? FOCUS_ACCENT : 'var(--text-primary)');
    var subColor = lvl.strong ? 'rgba(255,255,255,0.85)' : 'var(--text-tertiary)';
    var timeLabel = focusCalTimeLabel(mins);
    html += '<div onclick="selectFocusCalendarDay(\'' + key + '\')" title="' + (mins > 0 ? d + ' 日 · ' + mins + ' 分钟' : d + ' 日') + '" style="cursor:pointer;' + style + '">'
      + '<span style="font-size:12px;font-weight:600;color:' + numColor + ';flex:0 0 auto;">' + d + '</span>'
      + '<span style="flex:1 1 0;min-width:0;overflow:hidden;white-space:nowrap;text-align:right;font-size:8.5px;font-weight:600;color:' + (mins > 0 ? subColor : 'transparent') + ';">' + (mins > 0 ? timeLabel : '·') + '</span>'
      + '</div>';
  }

  grid.innerHTML = html;
  renderFocusCalendarDay();
}

function renderFocusCalendarDay() {
  var listEl = document.getElementById('focus-cal-day-list');
  var titleEl = document.getElementById('focus-cal-day-title');
  var sumEl = document.getElementById('focus-cal-day-summary');
  if (!listEl || !focusCalSelected) return;

  var parts = focusCalSelected.split('-');
  var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  var isToday = focusCalSelected === dayKey(Date.now());
  if (titleEl) {
    titleEl.textContent = (+parts[1]) + '月' + (+parts[2]) + '日 · ' + weekday + (isToday ? '（今天）' : '');
  }

  var sessions = focusSessions.filter(function(s) {
    return dayKey(focusSessionTs(s)) === focusCalSelected;
  }).sort(function(a, b) { return (a.startAt || 0) - (b.startAt || 0); });

  var totalSec = sessions.reduce(function(a, s) { return a + (s.durationSec || 0); }, 0);
  if (sumEl) {
    sumEl.textContent = sessions.length
      ? formatFocusDuration(totalSec) + ' · ' + sessions.length + ' 次专注'
      : '这一天还没有专注记录';
  }

  if (!sessions.length) {
    listEl.innerHTML = '<p class="text-xs text-center py-6" style="color: var(--text-tertiary);">点右上角“＋ 补录”可以把漏记的专注补上</p>';
    return;
  }

  listEl.innerHTML = sessions.map(function(s) {
    var t = focusTaskById(s.taskId);
    var color = t ? t.color : '#9ca3af';
    var a = new Date(s.startAt || focusSessionTs(s));
    var b = new Date((s.startAt || focusSessionTs(s)) + (s.durationSec || 0) * 1000);
    var range = pad2(a.getHours()) + ':' + pad2(a.getMinutes()) + ' – ' + pad2(b.getHours()) + ':' + pad2(b.getMinutes());
    return '<div class="flex items-center gap-3 py-2.5" style="border-bottom:0.5px solid rgba(128,128,128,0.12);">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>'
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-xs truncate font-medium" style="color: var(--text-primary);">' + esc(s.taskName || '未命名') + '</p>'
        + '<p class="text-xs mt-0.5" style="color: var(--text-tertiary);">' + range + ' · ' + focusModeLabel(s.mode) + '</p>'
      + '</div>'
      + '<span class="text-xs font-medium shrink-0" style="color: var(--text-secondary);">' + formatFocusDuration(s.durationSec || 0) + '</span>'
      + '<button onclick="deleteFocusSessionById(' + s.id + ')" class="icon-btn-del" title="删除记录"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
    + '</div>';
  }).join('');
}

function changeFocusCalendarMonth(delta) {
  ensureFocusCalendarState();
  var d = new Date(focusCalYear, focusCalMonth + delta, 1);
  focusCalYear = d.getFullYear();
  focusCalMonth = d.getMonth();

  var now = new Date();
  var inThisMonth = focusCalYear === now.getFullYear() && focusCalMonth === now.getMonth();
  focusCalSelected = focusCalMonthKey() + '-' + pad2(inThisMonth ? now.getDate() : 1);
  renderFocusCalendar();
}

function selectFocusCalendarDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return;
  focusCalSelected = key;
  var parts = key.split('-');
  focusCalYear = +parts[0];
  focusCalMonth = +parts[1] - 1;
  renderFocusCalendar();
}

function focusCalendarToday() {
  var now = new Date();
  focusCalYear = now.getFullYear();
  focusCalMonth = now.getMonth();
  focusCalSelected = dayKey(now.getTime());
  renderFocusCalendar();
}

async function deleteFocusSessionById(id) {
  if (!await confirmDialog('删除这条专注记录？统计会同步更新。')) return;
  await deleteFocusSession(id);
  await loadFocusData();
  renderStats();
  renderFocusCalendar();
  renderFocusTasks();
  refreshFocusBadge();
  toast('记录已删除');
}
