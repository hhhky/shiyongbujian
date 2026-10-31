// ─────────────────────────────────────────────
// 网页热更新
//   只改 HTML/CSS/JS（不动原生）时，把新资源打成 zip 传到 web-hot Release，
//   再把 hot/version.json 的 version +1 并填上新地址，旧版 App 会自动下载，
//   下次打开就是新页面 —— 不需要发新安装包，也不升版本号。
//
//   原生桥 AndroidHotUpdate 由 MainActivity 提供：
//     getState() / markHealthy() / downloadAndApply() / rollback()
//   取不到桥（浏览器 / 旧版 APK）时整个流程静默跳过。
// ─────────────────────────────────────────────

var HOT_VERSION_URL = 'https://hhhky.github.io/shiyongbujian/hot/version.json';

// 本安装包里自带网页资源的版本基线。
// 发 APK 时如果已经包含最新的网页改动，把这里改成对应的热更版本号。
var HOT_BASE_VERSION = '1';

// 「恢复内置网页」时记下放弃的版本，避免下次启动又自动装回来
var HOT_SKIP_KEY = 'sjb-hot-skip';

var hotApplying = false;
var hotSources = [];
var hotIndex = 0;
var hotTargetVersion = '';

function hotVersionLess(current, target) {
  var a = String(current || '0').split('.');
  var b = String(target || '0').split('.');
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    var x = parseInt(a[i], 10) || 0;
    var y = parseInt(b[i], 10) || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function hotState() {
  if (!window.AndroidHotUpdate) return {};
  try {
    return JSON.parse(window.AndroidHotUpdate.getState() || '{}') || {};
  } catch (e) {
    return {};
  }
}

// 本次会话实际加载的版本（之后下载的新包要下次打开才生效）
var hotServingVersion = null;

/** 当前生效的网页资源版本：优先热更版本，没有就是安装包自带的基线 */
function hotCurrentVersion() {
  var state = hotState();
  return state.version || HOT_BASE_VERSION;
}

function checkHotUpdate() {
  if (!window.AndroidHotUpdate || hotApplying) return;

  fetch(HOT_VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' })
    .then(function(res) {
      if (!res || !res.ok) return null;
      return res.json();
    })
    .then(function(data) {
      if (!data || !data.version) return;
      var urls = Array.isArray(data.urls) ? data.urls.filter(function(u) {
        return typeof u === 'string' && u;
      }) : [];
      if (!urls.length) return;
      if (!hotVersionLess(hotCurrentVersion(), data.version)) return;

      // 用户手动恢复过内置网页的版本不再自动装回；更新的版本照常更新
      var skip = '';
      try { skip = localStorage.getItem(HOT_SKIP_KEY) || ''; } catch (e) { /* ignore */ }
      if (skip && !hotVersionLess(skip, data.version)) return;

      hotApplying = true;
      hotSources = urls;
      hotIndex = 0;
      hotTargetVersion = String(data.version);
      try {
        window.AndroidHotUpdate.downloadAndApply(
          urls[0], hotTargetVersion, 'web-' + hotTargetVersion + '.zip', urls.length > 1
        );
      } catch (e) {
        hotApplying = false;
      }
    })
    .catch(function() { /* 离线或网络异常时静默跳过 */ });
}

/** 下载进度：不打扰用户，只在 About 页有入口时更新一行状态 */
window.onHotUpdateProgress = function(pct) {
  var el = document.getElementById('about-hot-status');
  if (el && el.classList.contains('show')) {
    el.textContent = '网页资源更新中 ' + pct + '%';
  }
};

window.onHotUpdateError = function(msg) {
  // 还有备用线路就换下一条（与 APK 更新共用同一套多线路策略）
  if (hotIndex + 1 < hotSources.length) {
    hotIndex++;
    var stillStrict = hotIndex + 1 < hotSources.length;
    setTimeout(function() {
      window.AndroidHotUpdate.downloadAndApply(
        hotSources[hotIndex], hotTargetVersion, 'web-' + hotTargetVersion + '.zip', stillStrict
      );
    }, 300);
    return;
  }
  hotApplying = false;
};

window.onHotUpdateDone = function(version) {
  hotApplying = false;
  if (typeof toast === 'function') toast('网页资源已更新到 v' + version + '，下次打开生效');
  updateHotStatus();
};

/** 「关于」页：显示当前网页资源版本，有热更包时提供「恢复内置网页」 */
function updateHotStatus() {
  var status = document.getElementById('about-hot-status');
  var reset = document.getElementById('about-hot-reset');
  if (!status) return;

  var version = '';
  if (window.AndroidHotUpdate) {
    version = hotState().version || '';
  }

  if (version && version !== HOT_BASE_VERSION) {
    var pending = hotServingVersion !== null && version !== hotServingVersion;
    status.textContent = '网页资源：热更新 v' + version + (pending ? '（下次打开生效）' : '');
    status.classList.remove('hidden');
    status.classList.add('show');
    if (reset) reset.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
    status.classList.remove('show');
    if (reset) reset.classList.add('hidden');
  }
}

function rollbackHotUpdate() {
  if (!window.AndroidHotUpdate) return;
  if (!confirm('恢复为安装包里内置的网页资源？恢复后页面会重新加载。')) return;
  // 记住放弃的这个版本，否则下次打开又会被自动下载
  var version = hotState().version || '';
  if (version) {
    try { localStorage.setItem(HOT_SKIP_KEY, version); } catch (e) { /* ignore */ }
  }
  window.AndroidHotUpdate.rollback();
}

document.addEventListener('DOMContentLoaded', function() {
  hotServingVersion = hotCurrentVersion();
  // 页面正常跑起来了，告诉原生这份资源可用，避免下次启动被当成坏包回滚
  if (window.AndroidHotUpdate) {
    try { window.AndroidHotUpdate.markHealthy(); } catch (e) { /* ignore */ }
  }
  // 等首屏和公告都处理完再检查，避免抢启动带宽
  setTimeout(checkHotUpdate, 4000);
});
