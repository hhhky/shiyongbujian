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

var focusSettings = { pomodoroMin: 25, goalMin: 120 };
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
      if (s && s.goalMin) focusSettings.goalMin = s.goalMin;
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
  var g = document.getElementById('focus-set-goal');
  if (p) p.value = focusSettings.pomodoroMin;
  if (g) g.value = focusSettings.goalMin;
  document.getElementById('focus-settings-modal').classList.remove('hidden');
}

function hideFocusSettings() {
  document.getElementById('focus-settings-modal').classList.add('hidden');
}

function confirmFocusSettings() {
  var p = parseInt(document.getElementById('focus-set-pomodoro').value, 10);
  var g = parseInt(document.getElementById('focus-set-goal').value, 10);
  if (!p || p < 1 || p > 180) { toast('番茄时长请填 1–180 分钟'); return; }
  if (!g || g < 1 || g > 1440) { toast('每日目标请填 1–1440 分钟'); return; }
  focusSettings.pomodoroMin = p;
  focusSettings.goalMin = g;
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
    var ts = s.endAt || s.startAt || 0;
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
    var ts = s.endAt || s.startAt || 0;
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
      var ts = s.endAt || s.startAt;
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
  renderStatsGoal();
  drawTrendChart();
  drawHourChart();
  drawHeatmap();
  drawDonutAndRank();
  renderRecentSessions();
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

function renderStatsGoal() {
  var el = document.getElementById('stats-goal-card');
  if (!el) return;
  var s = focusSummary();
  var goalSec = focusSettings.goalMin * 60;
  var pct = goalSec > 0 ? Math.min(100, Math.round(s.todaySec / goalSec * 100)) : 0;
  var streak = focusStreak();
  el.innerHTML = '<div class="rounded-[24px] p-4 flex items-center gap-4" style="background: var(--card-bg); border: var(--card-border); backdrop-filter: var(--card-backdrop); -webkit-backdrop-filter: var(--card-backdrop);">'
    + '<div class="shrink-0 relative" style="width:64px;height:64px;">'
      + '<svg viewBox="0 0 64 64" class="w-full h-full" style="transform:rotate(-90deg);">'
        + '<circle cx="32" cy="32" r="27" fill="none" stroke="rgba(128,128,128,0.16)" stroke-width="6"/>'
        + '<circle cx="32" cy="32" r="27" fill="none" stroke="' + FOCUS_ACCENT + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (2 * Math.PI * 27).toFixed(1) + '" stroke-dashoffset="' + (2 * Math.PI * 27 * (1 - pct / 100)).toFixed(1) + '"/>'
      + '</svg>'
      + '<div class="absolute inset-0 flex items-center justify-center text-sm font-bold" style="color: var(--text-primary);">' + pct + '%</div>'
    + '</div>'
    + '<div class="flex-1 min-w-0">'
      + '<div class="flex items-center justify-between text-xs mb-1.5"><span style="color: var(--text-secondary);">今日目标</span><span style="color: var(--text-primary);font-weight:600;">' + Math.round(s.todaySec / 60) + ' / ' + focusSettings.goalMin + ' 分钟</span></div>'
      + '<div class="rounded-full overflow-hidden" style="height:7px;background:rgba(128,128,128,0.16);"><div style="height:100%;width:' + pct + '%;background:' + FOCUS_ACCENT + ';border-radius:999px;transition:width .3s;"></div></div>'
      + '<div class="flex items-center gap-3 mt-2 text-xs" style="color: var(--text-tertiary);">'
        + '<span>🔥 连续专注 <b style="color:' + FOCUS_ACCENT + ';">' + streak + '</b> 天</span>'
        + '<span>今日 ' + s.todayCount + ' 次</span>'
      + '</div>'
    + '</div>'
    + '<button onclick="showFocusSettings()" class="shrink-0 text-xs px-3 py-1.5 rounded-full" style="background:rgba(128,128,128,0.12);color:var(--text-secondary);">设置</button>'
  + '</div>';
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
  var days = focusRangeDays(focusStatsRange);
  var start = days[0] || 0;
  var end = (days[days.length - 1] || Date.now()) + 86400000;
  focusSessions.forEach(function(s) {
    var ts = s.endAt || s.startAt || 0;
    if (ts < start || ts >= end) return;
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

// ── 打卡热力图 ────────────────────────────────
function drawHeatmap() {
  var cv = focusCanvas('chart-heatmap', 148);
  if (!cv) return;
  var ctx = cv.ctx, W = cv.w, H = cv.h;
  var weeks = 18;
  var today = startOfDay(Date.now());
  var dow = (new Date(today).getDay() + 6) % 7;
  var endMonday = today - dow * 86400000;
  var start = endMonday - (weeks - 1) * 7 * 86400000;
  var map = focusDayMap();
  var text = focusCssVar('--text-tertiary', '#8e8e93');

  var gap = 3;
  var cell = Math.floor((W - gap * (weeks - 1)) / weeks);
  cell = Math.max(6, Math.min(15, cell));
  var gridW = weeks * cell + (weeks - 1) * gap;
  var ox = Math.max(0, (W - gridW) / 2);
  var oy = 16;

  ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  var lastMonth = -1;
  for (var w = 0; w < weeks; w++) {
    var colTs = start + w * 7 * 86400000;
    var md = new Date(colTs);
    if (md.getMonth() !== lastMonth) {
      lastMonth = md.getMonth();
      if (w > 0) ctx.fillText((md.getMonth() + 1) + '月', ox + w * (cell + gap), 0);
    }
  }

  for (var c = 0; c < weeks; c++) {
    for (var r = 0; r < 7; r++) {
      var ts = start + (c * 7 + r) * 86400000;
      if (ts > today) continue;
      var mins = Math.round((map[dayKey(ts)] || 0) / 60);
      var color;
      if (!mins) color = 'rgba(128,128,128,0.14)';
      else if (mins < 30) color = 'rgba(249,115,22,0.25)';
      else if (mins < 60) color = 'rgba(249,115,22,0.45)';
      else if (mins < 120) color = 'rgba(249,115,22,0.68)';
      else color = 'rgba(249,115,22,0.95)';
      ctx.fillStyle = color;
      roundRectPath(ctx, ox + c * (cell + gap), oy + r * (cell + gap), cell, cell, 2);
      ctx.fill();
    }
  }

  // 今天描边
  var todayCol = Math.floor((today - start) / 86400000 / 7);
  var todayRow = (new Date(today).getDay() + 6) % 7;
  ctx.strokeStyle = 'rgba(249,115,22,0.9)';
  ctx.lineWidth = 1.2;
  roundRectPath(ctx, ox + todayCol * (cell + gap) - 1, oy + todayRow * (cell + gap) - 1, cell + 2, cell + 2, 3);
  ctx.stroke();
}

// ── 任务占比 + 排行 ───────────────────────────
function focusTaskGroups() {
  var groups = {};
  var days = focusRangeDays(focusStatsRange);
  var start = days[0] || 0;
  var end = (days[days.length - 1] || Date.now()) + 86400000;
  focusSessions.forEach(function(s) {
    var ts = s.endAt || s.startAt || 0;
    if (ts < start || ts >= end) return;
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

// ── 最近记录 ──────────────────────────────────
function renderRecentSessions() {
  var el = document.getElementById('stats-recent');
  if (!el) return;
  if (!focusSessions.length) {
    el.innerHTML = '<p class="text-xs text-center py-6" style="color: var(--text-tertiary);">还没有专注记录</p>';
    return;
  }
  var list = focusSessions.slice().sort(function(a, b) {
    return (b.endAt || b.startAt) - (a.endAt || a.startAt);
  }).slice(0, 20);

  el.innerHTML = list.map(function(s) {
    var t = focusTaskById(s.taskId);
    var color = t ? t.color : '#9ca3af';
    var d = new Date(s.endAt || s.startAt);
    var when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return '<div class="flex items-center gap-3 py-2" style="border-bottom:0.5px solid rgba(128,128,128,0.12);">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>'
      + '<div class="flex-1 min-w-0">'
        + '<p class="text-xs truncate" style="color: var(--text-primary);">' + esc(s.taskName || '未命名') + '</p>'
        + '<p class="text-xs" style="color: var(--text-tertiary);">' + when + ' · ' + (s.mode === 'down' ? '番茄钟' : '正计时') + '</p>'
      + '</div>'
      + '<span class="text-xs font-medium" style="color: var(--text-secondary);">' + formatFocusDuration(s.durationSec || 0) + '</span>'
      + '<button onclick="deleteFocusSessionById(' + s.id + ')" class="icon-btn-del" title="删除记录"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
    + '</div>';
  }).join('');
}

async function deleteFocusSessionById(id) {
  if (!await confirmDialog('删除这条专注记录？统计会同步更新。')) return;
  await deleteFocusSession(id);
  await loadFocusData();
  renderStats();
  renderFocusTasks();
  refreshFocusBadge();
  toast('记录已删除');
}
