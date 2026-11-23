/**
 * 匿名使用统计上报
 *
 * 只上报：随机设备编号、随机会话编号、App 版本号、各部件打开次数。
 * 不上报任何内容、账号、位置，也不上传用户数据。
 * 未配置上报地址（CONST_USAGE_ENDPOINT 为空）或用户关闭时完全静默。
 *
 * 每次会话在退到后台时合并成一个请求发出，失败不影响使用。
 */
(function () {
  'use strict';

  var LS_DEVICE = 'usage-device';
  var LS_OPT = 'usage-opt-out';
  var LS_REQ = 'usage-req';

  var sessionId = randomId();
  var counts = {};
  var dirty = false;
  var lastFlushAt = 0;

  function randomId() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 32);
      if (window.crypto && crypto.getRandomValues) {
        var arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Array.prototype.map.call(arr, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* ignore */ }
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function readLS(key, def) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch (e) {
      return def;
    }
  }

  function writeLS(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  function deviceId() {
    var id = readLS(LS_DEVICE, '');
    if (!id || !/^[A-Za-z0-9]{8,64}$/.test(id)) {
      id = randomId();
      writeLS(LS_DEVICE, id);
    }
    return id;
  }

  function endpoint() {
    // 远程公告下发的地址优先，可在不发版的情况下开启或更换统计服务
    var remote = typeof window.ANNOUNCE_USAGE_ENDPOINT === 'string' ? window.ANNOUNCE_USAGE_ENDPOINT.trim() : '';
    if (remote) return remote;
    return typeof CONST_USAGE_ENDPOINT === 'string' ? CONST_USAGE_ENDPOINT.trim() : '';
  }

  function isEnabled() {
    return readLS(LS_OPT, 'on') !== 'off';
  }

  function dayKey() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  // 每天最多上报 20 次，避免异常情况下反复请求
  function requestBudget() {
    var raw = readLS(LS_REQ, '');
    var today = dayKey();
    if (raw.indexOf(today + ':') !== 0) return { key: today + ':0', used: 0 };
    var used = Number(raw.split(':')[1]) || 0;
    return { key: raw, used: used };
  }

  function flush() {
    if (!endpoint() || !isEnabled() || !dirty) return;
    if (Date.now() - lastFlushAt < 5000) return;

    var budget = requestBudget();
    if (budget.used >= 20) return;

    var payload = {
      device: deviceId(),
      session: sessionId,
      version: (typeof APP_VERSION === 'string' ? APP_VERSION : ''),
      widgets: counts
    };
    var sent = counts;
    counts = {};
    dirty = false;
    lastFlushAt = Date.now();
    writeLS(LS_REQ, dayKey() + ':' + (budget.used + 1));

    try {
      fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        mode: 'cors'
      }).catch(function () {
        // 失败就把计数还回去，下次会话还能补报
        Object.keys(sent).forEach(function (k) { counts[k] = (counts[k] || 0) + sent[k]; });
        dirty = true;
      });
    } catch (e) {
      Object.keys(sent).forEach(function (k) { counts[k] = (counts[k] || 0) + sent[k]; });
      dirty = true;
    }
  }

  window.usageTrackWidget = function (id) {
    if (!id || !endpoint() || !isEnabled()) return;
    counts[id] = (counts[id] || 0) + 1;
    dirty = true;
  };

  window.usageStatsEnabled = function () {
    return endpoint() ? isEnabled() : false;
  };

  window.usageStatsAvailable = function () {
    return !!endpoint();
  };

  window.setUsageStatsEnabled = function (on) {
    writeLS(LS_OPT, on ? 'on' : 'off');
    if (!on) { counts = {}; dirty = false; }
    updateUsageToggleUI();
  };

  window.toggleUsageStats = function () {
    setUsageStatsEnabled(!isEnabled());
    if (typeof toast === 'function') toast(isEnabled() ? '已开启匿名使用统计' : '已关闭匿名使用统计');
  };

  window.updateUsageToggleUI = function () {
    var btn = document.getElementById('usage-toggle');
    if (!btn) return;
    var available = !!endpoint();
    var on = available && isEnabled();
    btn.textContent = available ? (on ? '已开启' : '已关闭') : '未配置';
    btn.style.background = !available ? 'rgba(128,128,128,0.16)'
      : (on ? 'var(--memo-accent-soft)' : 'rgba(128,128,128,0.16)');
    btn.style.color = !available ? 'var(--text-tertiary)'
      : (on ? 'var(--memo-accent)' : 'var(--text-secondary)');
    btn.classList.toggle('is-disabled', !available);
  };

  // 退到后台、离开页面时把本次会话的计数合并上报
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  // 长时间停留时定期上报，避免被系统直接杀掉导致数据丢失
  setInterval(flush, 180000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateUsageToggleUI);
  } else {
    updateUsageToggleUI();
  }
})();
