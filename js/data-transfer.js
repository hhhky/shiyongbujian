// ─────────────────────────────────────────────
// 离线数据导入导出（备忘录 / 专注记录）
//   纯文本字符串传输，全程不联网、不请求任何接口。
//   字符串结构：SJB-DATA|v2|memo|<JSON>
//   头部依次为：格式名 | 版本标记 | 模块标识
//   v2 用紧凑数组承载记录，字符串更短；仍兼容导入 v1 数据。
//   导入只追加新记录，冲突时保留本机原有数据。
// ─────────────────────────────────────────────

var DATA_FORMAT_NAME = 'SJB-DATA';
var DATA_FORMAT_VERSION = 2;
var DATA_SUPPORTED_VERSIONS = [1, 2];
var DATA_MODULE_LABELS = { memo: '备忘录', focus: '专注记录' };
var DATA_IMPORTING = {};

function dataModuleLabel(module) {
  return DATA_MODULE_LABELS[module] || module || '未知';
}

// ── 序列化 ───────────────────────────────────
function buildDataString(module, payload) {
  payload.app = 'shiyongbujian';
  payload.module = module;
  payload.version = DATA_FORMAT_VERSION;
  payload.exportedAt = Date.now();
  return DATA_FORMAT_NAME + '|v' + DATA_FORMAT_VERSION + '|' + module + '|' + JSON.stringify(payload);
}

// 只解析头部，取出模块与版本，正文留给对应模块校验
function parseDataHeader(raw) {
  var text = String(raw == null ? '' : raw).replace(/^﻿/, '').trim();
  if (!text) throw new Error('请先粘贴要导入的数据字符串');

  var p1 = text.indexOf('|');
  var p2 = p1 < 0 ? -1 : text.indexOf('|', p1 + 1);
  var p3 = p2 < 0 ? -1 : text.indexOf('|', p2 + 1);
  if (p1 < 0 || p2 < 0 || p3 < 0) throw new Error('数据格式无法识别，请确认粘贴的是本 App 导出的完整字符串');

  var name = text.slice(0, p1).trim();
  if (name !== DATA_FORMAT_NAME) throw new Error('数据格式无法识别，请确认粘贴的是本 App 导出的完整字符串');

  return {
    module: text.slice(p2 + 1, p3).trim(),
    versionToken: text.slice(p1 + 1, p2).trim(),
    jsonText: text.slice(p3 + 1)
  };
}

function checkDataHeader(header, expectedModule) {
  var module = header.module;
  if (!module) throw new Error('数据缺少模块标识，无法判断数据归属');
  if (module !== 'memo' && module !== 'focus') throw new Error('无法识别的模块标识「' + module + '」');
  // 先校验模块，再校验版本
  if (module !== expectedModule) {
    throw new Error('模块不匹配：这是「' + dataModuleLabel(module) + '」数据，当前页面只能导入「' + dataModuleLabel(expectedModule) + '」数据');
  }
  var m = /^v(\d+)$/.exec(header.versionToken);
  if (!m) throw new Error('数据版本标记无效，已终止导入');
  var ver = parseInt(m[1], 10);
  if (DATA_SUPPORTED_VERSIONS.indexOf(ver) < 0) {
    throw new Error('版本不匹配：数据格式为 v' + ver + '，当前 App 支持 ' + DATA_SUPPORTED_VERSIONS.map(function (v) { return 'v' + v; }).join(' / ') + '，请升级 App 后再导入');
  }
  return ver;
}

function parseDataString(raw, expectedModule) {
  var header = parseDataHeader(raw);
  var ver = checkDataHeader(header, expectedModule);

  var payload;
  try {
    payload = JSON.parse(header.jsonText);
  } catch (e) {
    throw new Error('数据正文已损坏，解析失败，未导入任何记录');
  }
  if (!payload || typeof payload !== 'object') throw new Error('数据正文不完整，未导入任何记录');
  if (payload.module !== expectedModule || payload.version !== ver) {
    throw new Error('数据正文与头部标识不一致，已终止导入');
  }
  return { payload: payload, version: ver };
}

// ── 导出 ─────────────────────────────────────
// v2 紧凑结构：备忘录 r: [标题, 内容, 截止, 自动删除, 创建时间]
// 专注 t: 任务 [名称, 颜色, 创建时间]；s: 记录 [任务下标, 开始, 结束, 秒数, 模式, 完成]
async function buildModuleExport(module) {
  if (module === 'memo') {
    var memos = await getMemos();
    return {
      payload: {
        r: memos.map(function (m) {
          return [m.title || '', m.content || '', m.deadline || '', m.autoDelete ? 1 : 0, m.createdAt || 0];
        })
      },
      countText: memos.length + ' 条备忘录'
    };
  }

  var res = await Promise.all([getFocusTasks(), getFocusSessions()]);
  var tasks = res[0].map(function (t) {
    return { name: t.name || '', color: t.color || '', createdAt: t.createdAt || 0 };
  });
  var indexByName = {};
  tasks.forEach(function (t, i) {
    if (indexByName[t.name] === undefined) indexByName[t.name] = i;
  });
  res[1].forEach(function (s) {
    var name = s.taskName || '';
    if (indexByName[name] === undefined) {
      indexByName[name] = tasks.length;
      tasks.push({ name: name, color: '', createdAt: s.startAt || 0 });
    }
  });

  return {
    payload: {
      t: tasks.map(function (t) { return [t.name, t.color, t.createdAt]; }),
      s: res[1].map(function (s) {
        var idx = indexByName[s.taskName || ''];
        return [idx === undefined ? 0 : idx, s.startAt || 0, s.endAt || 0, s.durationSec || 0, s.mode || 'up', s.completed === false ? 0 : 1];
      })
    },
    countText: res[0].length + ' 个任务、' + res[1].length + ' 条专注记录'
  };
}

async function exportModuleData(module) {
  var ta = document.getElementById(module + '-data-export');
  try {
    var built = await buildModuleExport(module);
    var text = buildDataString(module, built.payload);
    if (ta) ta.value = text;
    setDataResult(module, 'ok', '已生成字符串（' + built.countText + '，共 ' + text.length + ' 个字符）');
    toast('已生成导出字符串');
  } catch (e) {
    setDataResult(module, 'error', '导出失败：' + (e && e.message ? e.message : '未知错误'));
    toast('导出失败');
  }
}

function dataPad2(n) { return n < 10 ? '0' + n : '' + n; }

// 导出为 txt 文件（应用内无文件系统权限时，复制粘贴仍是主通道）
async function exportModuleFile(module) {
  try {
    var ta = document.getElementById(module + '-data-export');
    var text = ta ? ta.value : '';
    if (!text || text.indexOf(DATA_FORMAT_NAME + '|') !== 0) {
      var built = await buildModuleExport(module);
      text = buildDataString(module, built.payload);
      if (ta) ta.value = text;
    }

    var d = new Date();
    var stamp = d.getFullYear() + dataPad2(d.getMonth() + 1) + dataPad2(d.getDate());
    var fileName = 'shiyongbujian-' + module + '-' + stamp + '.txt';
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);

    setDataResult(module, 'ok', '已生成文件「' + fileName + '」（' + text.length + ' 个字符）');
    toast('已导出为文件');
  } catch (e) {
    setDataResult(module, 'warn', '保存文件失败，请改用“复制”按钮');
    toast('保存文件失败');
  }
}

// 从 txt 文件读取导入字符串
function loadModuleFile(module, input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var ta = document.getElementById(module + '-data-import');
    if (ta) ta.value = String(reader.result || '');
    setDataResult(module, 'warn', '已载入「' + file.name + '」，点击“导入”开始合并');
    toast('文件已载入');
  };
  reader.onerror = function () {
    setDataResult(module, 'error', '读取文件失败，请重试或改用复制粘贴');
  };
  reader.readAsText(file, 'utf-8');
  input.value = '';
}

function pickModuleFile(module) {
  var input = document.getElementById(module + '-data-file');
  if (input) input.click();
}

async function copyModuleExport(module) {
  var ta = document.getElementById(module + '-data-export');
  var text = ta ? ta.value : '';
  if (!text) {
    setDataResult(module, 'warn', '请先点击“生成”得到导出字符串');
    toast('请先生成导出字符串');
    return;
  }

  var copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (e) { copied = false; }

  if (!copied) {
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      copied = document.execCommand('copy');
    } catch (e) { copied = false; }
  }

  if (copied) {
    setDataResult(module, 'ok', '已复制到剪贴板，可直接粘贴到另一台设备');
    toast('已复制到剪贴板');
  } else {
    setDataResult(module, 'warn', '自动复制失败，请长按文本框手动全选复制');
    toast('复制失败，请手动复制');
  }
}

// ── 导入入口 ─────────────────────────────────
async function importModuleData(module) {
  if (DATA_IMPORTING[module]) return;
  DATA_IMPORTING[module] = true;

  var ta = document.getElementById(module + '-data-import');
  var btn = document.getElementById(module + '-data-import-btn');
  var oldBtnText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '导入中…'; btn.disabled = true; }

  try {
    var parsed = parseDataString(ta ? ta.value : '', module);
    var stats;
    if (module === 'memo') {
      stats = await mergeMemoRecords(normalizeMemoRecords(parsed.payload, parsed.version));
    } else {
      stats = await mergeFocusPayload(normalizeFocusPayload(parsed.payload, parsed.version));
    }

    if (module === 'memo') {
      var msg = '导入完成：新增 ' + stats.added + ' 条';
      if (stats.skipped) msg += '，跳过 ' + stats.skipped + ' 条（本机已存在）';
      if (stats.invalid) msg += '，忽略 ' + stats.invalid + ' 条无效数据';
      setDataResult(module, 'ok', msg);
      toast('导入完成，新增 ' + stats.added + ' 条');
    } else {
      var msg2 = '导入完成：新增任务 ' + stats.taskAdded + ' 个、专注记录 ' + stats.sessionAdded + ' 条';
      var skipped = stats.taskSkipped + stats.sessionSkipped;
      if (skipped) msg2 += '，跳过 ' + skipped + ' 条（本机已存在）';
      if (stats.invalid) msg2 += '，忽略 ' + stats.invalid + ' 条无效数据';
      setDataResult(module, 'ok', msg2);
      toast('导入完成，新增 ' + stats.sessionAdded + ' 条专注记录');
    }

    await refreshAfterImport(module);
    await initDataPage(module);
  } catch (e) {
    var msg3 = e && e.message ? e.message : '未知错误';
    setDataResult(module, 'error', '导入失败：' + msg3 + '。本机原有数据未做任何改动。');
    toast('导入失败：' + msg3);
  } finally {
    DATA_IMPORTING[module] = false;
    if (btn) { btn.textContent = oldBtnText || '导入'; btn.disabled = false; }
  }
}

async function refreshAfterImport(module) {
  try {
    if (module === 'memo') {
      if (currentWidget === 'memo') await refreshAll();
    } else {
      if (typeof refreshFocus === 'function') await refreshFocus();
    }
  } catch (e) {
    console.error('导入后刷新失败:', e);
  }
}

function initDataPage(module) {
  var el = document.getElementById(module + '-data-local-count');
  if (!el) return;
  if (module === 'memo') {
    getMemos().then(function (list) {
      el.textContent = '本机已有 ' + list.length + ' 条备忘录';
    }).catch(function () {});
  } else {
    Promise.all([getFocusTasks(), getFocusSessions()]).then(function (res) {
      el.textContent = '本机已有 ' + res[0].length + ' 个任务、' + res[1].length + ' 条专注记录';
    }).catch(function () {});
  }
}

function setDataResult(module, type, msg) {
  var el = document.getElementById(module + '-data-result');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.color = type === 'error' ? '#ef4444' : (type === 'warn' ? '#f59e0b' : '#10b981');
}

// ── 版本归一化：v1 对象结构 / v2 紧凑数组 → 统一对象 ──
function normalizeMemoRecords(payload, version) {
  if (version === 1) {
    if (!Array.isArray(payload.records)) throw new Error('数据缺少 records 字段，未导入任何记录');
    return payload.records;
  }
  if (!Array.isArray(payload.r)) throw new Error('数据缺少记录字段，未导入任何记录');
  return payload.r.map(function (a) {
    if (!Array.isArray(a)) return null;
    return { title: a[0], content: a[1], deadline: a[2] || null, autoDelete: !!a[3], createdAt: a[4] };
  });
}

function normalizeFocusPayload(payload, version) {
  if (version === 1) {
    if (!Array.isArray(payload.tasks) && !Array.isArray(payload.sessions)) {
      throw new Error('数据缺少 tasks / sessions 字段，未导入任何记录');
    }
    return {
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      sessions: Array.isArray(payload.sessions) ? payload.sessions : []
    };
  }

  if (!Array.isArray(payload.t) && !Array.isArray(payload.s)) {
    throw new Error('数据缺少任务或记录字段，未导入任何记录');
  }
  var taskArrays = Array.isArray(payload.t) ? payload.t : [];
  var tasks = taskArrays.map(function (a) {
    if (!Array.isArray(a)) return null;
    return { name: a[0], color: a[1], createdAt: a[2] };
  });
  var sessions = (Array.isArray(payload.s) ? payload.s : []).map(function (a) {
    if (!Array.isArray(a)) return null;
    var idx = Number(a[0]);
    var t = tasks[idx];
    return {
      taskName: t && typeof t.name === 'string' ? t.name : '',
      startAt: a[1],
      endAt: a[2],
      durationSec: a[3],
      mode: a[4],
      completed: a[5] !== 0
    };
  });
  return { tasks: tasks, sessions: sessions };
}

// ── 备忘录合并 ────────────────────────────────
function memoRecordKey(m) {
  return String(m.createdAt || 0) + '\u0001' + String(m.title || '').trim();
}

function sanitizeMemoRecord(r) {
  if (!r || typeof r !== 'object') return null;
  var title = typeof r.title === 'string' ? r.title.trim() : '';
  var content = typeof r.content === 'string' ? r.content : '';
  if (!title && !content) return null;
  var createdAt = Number(r.createdAt);
  if (!isFinite(createdAt) || createdAt <= 0) createdAt = Date.now();
  return {
    title: title,
    content: content,
    deadline: typeof r.deadline === 'string' && r.deadline ? r.deadline : null,
    autoDelete: !!r.autoDelete,
    createdAt: createdAt
  };
}

// 单个事务完成“读取已有 + 追加新记录”，失败则整体回滚，不动本机数据
function mergeMemoRecords(records) {
  if (!Array.isArray(records)) return Promise.reject(new Error('数据缺少 records 字段，未导入任何记录'));
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('memos', 'readwrite');
      var store = tx.objectStore('memos');
      var stats = { added: 0, skipped: 0, invalid: 0 };
      var getReq = store.getAll();

      getReq.onsuccess = function () {
        try {
          var existing = getReq.result || [];
          var keys = Object.create(null);
          existing.forEach(function (m) { keys[memoRecordKey(m)] = true; });

          records.forEach(function (r) {
            var rec = sanitizeMemoRecord(r);
            if (!rec) { stats.invalid++; return; }
            var key = memoRecordKey(rec);
            if (keys[key]) { stats.skipped++; return; } // 冲突：保留本机已有记录
            keys[key] = true;
            store.add(rec);
            stats.added++;
          });
        } catch (err) {
          try { tx.abort(); } catch (e) {}
        }
      };

      tx.oncomplete = function () { db.close(); resolve(stats); };
      tx.onerror = function () { db.close(); reject(tx.error || new Error('写入失败')); };
      tx.onabort = function () { db.close(); reject(tx.error || new Error('导入被中止，本机数据未改动')); };
    });
  });
}

// ── 专注记录合并 ──────────────────────────────
function focusTaskKey(t) {
  return String(t.name || '').trim();
}

function focusSessionKey(s) {
  return focusTaskKey({ name: s.taskName }) + '\u0001' + String(s.startAt || 0) + '\u0001' + String(s.durationSec || 0);
}

function sanitizeFocusTask(r) {
  if (!r || typeof r !== 'object') return null;
  var name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name) return null;
  var createdAt = Number(r.createdAt);
  if (!isFinite(createdAt) || createdAt <= 0) createdAt = Date.now();
  return {
    name: name,
    color: typeof r.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : '',
    createdAt: createdAt
  };
}

function sanitizeFocusSession(r) {
  if (!r || typeof r !== 'object') return null;
  var taskName = typeof r.taskName === 'string' ? r.taskName.trim() : '';
  if (!taskName) return null;

  var durationSec = Number(r.durationSec);
  if (!isFinite(durationSec) || durationSec <= 0 || durationSec > 7 * 86400) return null;

  var startAt = Number(r.startAt);
  var endAt = Number(r.endAt);
  if (!isFinite(startAt) || startAt <= 0) {
    if (isFinite(endAt) && endAt > 0) startAt = endAt - durationSec * 1000;
    else return null;
  }
  if (!isFinite(endAt) || endAt <= 0) endAt = startAt + durationSec * 1000;

  return {
    taskName: taskName,
    startAt: startAt,
    endAt: endAt,
    durationSec: durationSec,
    mode: r.mode === 'down' || r.mode === 'manual' ? r.mode : 'up',
    completed: r.completed !== false
  };
}

function mergeFocusPayload(payload) {
  var hasTasks = Array.isArray(payload.tasks);
  var hasSessions = Array.isArray(payload.sessions);
  if (!hasTasks && !hasSessions) return Promise.reject(new Error('数据缺少 tasks / sessions 字段，未导入任何记录'));
  var rawTasks = hasTasks ? payload.tasks : [];
  var rawSessions = hasSessions ? payload.sessions : [];

  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(['focus_tasks', 'focus_sessions'], 'readwrite');
      var taskStore = tx.objectStore('focus_tasks');
      var sessionStore = tx.objectStore('focus_sessions');
      var stats = { taskAdded: 0, taskSkipped: 0, sessionAdded: 0, sessionSkipped: 0, invalid: 0 };
      var pending = 2;
      var tasksReq = taskStore.getAll();
      var sessionsReq = sessionStore.getAll();

      function doneReading() {
        if (--pending > 0) return;
        try {
          var existingTasks = tasksReq.result || [];
          var existingSessions = sessionsReq.result || [];

          var taskKeys = Object.create(null);
          var nameToId = Object.create(null);
          var nextTaskId = 1;
          existingTasks.forEach(function (t) {
            taskKeys[focusTaskKey(t)] = true;
            nameToId[focusTaskKey(t)] = t.id;
            if (t.id >= nextTaskId) nextTaskId = t.id + 1;
          });

          // 1) 合并任务（同名任务视为同一条，保留本机版本）
          rawTasks.forEach(function (r) {
            var t = sanitizeFocusTask(r);
            if (!t) { stats.invalid++; return; }
            var key = focusTaskKey(t);
            if (taskKeys[key]) { stats.taskSkipped++; return; }
            taskKeys[key] = true;
            t.id = nextTaskId++;
            if (!t.color) t.color = FOCUS_TASK_COLORS[(t.id - 1) % FOCUS_TASK_COLORS.length];
            taskStore.put(t);
            nameToId[key] = t.id;
            stats.taskAdded++;
          });

          // 2) 合并专注记录（任务名 + 开始时间 + 时长 视为同一条）
          var sessionKeys = Object.create(null);
          var nextSessionId = 1;
          existingSessions.forEach(function (s) {
            sessionKeys[focusSessionKey(s)] = true;
            if (s.id >= nextSessionId) nextSessionId = s.id + 1;
          });

          rawSessions.forEach(function (r) {
            var s = sanitizeFocusSession(r);
            if (!s) { stats.invalid++; return; }
            var key = focusSessionKey(s);
            if (sessionKeys[key]) { stats.sessionSkipped++; return; } // 冲突：保留本机已有记录
            sessionKeys[key] = true;

            var taskKey = focusTaskKey({ name: s.taskName });
            var taskId = nameToId[taskKey];
            if (taskId == null) {
              // 记录引用的任务本机不存在时，自动补建，保证统计分组完整
              taskId = nextTaskId++;
              taskStore.put({
                id: taskId,
                name: s.taskName,
                color: FOCUS_TASK_COLORS[(taskId - 1) % FOCUS_TASK_COLORS.length],
                createdAt: s.startAt || Date.now()
              });
              nameToId[taskKey] = taskId;
              stats.taskAdded++;
            }

            s.id = nextSessionId++;
            s.taskId = taskId;
            sessionStore.put(s);
            stats.sessionAdded++;
          });
        } catch (err) {
          try { tx.abort(); } catch (e) {}
        }
      }

      tasksReq.onsuccess = doneReading;
      sessionsReq.onsuccess = doneReading;

      tx.oncomplete = function () { db.close(); resolve(stats); };
      tx.onerror = function () { db.close(); reject(tx.error || new Error('写入失败')); };
      tx.onabort = function () { db.close(); reject(tx.error || new Error('导入被中止，本机数据未改动')); };
    });
  });
}
