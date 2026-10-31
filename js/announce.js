// ─────────────────────────────────────────────
// 远程公告
//   内容来自仓库根目录的 announce.json，电脑上改完提交即可推送
//   客户端启动后拉取一次，遇到没读过的 id 就弹窗
// ─────────────────────────────────────────────

var ANNOUNCE_URL = 'https://hhhky.github.io/shiyongbujian/announce.json';
var ANNOUNCE_SEEN_KEY = 'sjb-announce-seen';
var ANNOUNCE_MAX_SEEN = 50;

// App 内更新用：本次弹窗对象、关闭函数、是否正在下载
var announceCurrent = null;
var announceCloseFn = null;
var announceUpdating = false;
// 当前公告的下载地址列表与重试下标（主源失败自动换备用线路）
var announceUpdateSources = [];
var announceUpdateIndex = 0;
var announceFileName = '';

function announceCurrentVersion() {
  return (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '0';
}

// 公告带的 version 是否比当前 App 版本新（与运行环境无关）
function announceHasNewVersion(a) {
  return !!(a && a.version) && announceVersionLess(announceCurrentVersion(), a.version);
}

// 下载地址：优先用 urls 数组（多线路），兼容单个 url
function announceDownloadUrls(a) {
  if (a && Array.isArray(a.urls)) {
    return a.urls.filter(function(u) { return typeof u === 'string' && u; });
  }
  return (a && a.url) ? [a.url] : [];
}

// 能否在 App 内直接下载安装：有新版本 + 有下载地址 + 原生桥可用
function announceIsUpdate(a) {
  return announceHasNewVersion(a) && announceDownloadUrls(a).length > 0
    && typeof window !== 'undefined' && !!window.AndroidUpdate;
}

// 版本号比较：current 低于 target 时返回 true
function announceVersionLess(current, target) {
  var a = String(current || '').split('.');
  var b = String(target || '').split('.');
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) {
    var x = parseInt(a[i], 10) || 0;
    var y = parseInt(b[i], 10) || 0;
    if (x !== y) return x < y;
  }
  return false;
}

function announceSeenIds() {
  try {
    var raw = JSON.parse(localStorage.getItem(ANNOUNCE_SEEN_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function announceMarkSeen(id) {
  try {
    var ids = announceSeenIds();
    if (ids.indexOf(id) === -1) ids.push(id);
    if (ids.length > ANNOUNCE_MAX_SEEN) ids = ids.slice(ids.length - ANNOUNCE_MAX_SEEN);
    localStorage.setItem(ANNOUNCE_SEEN_KEY, JSON.stringify(ids));
  } catch (e) { /* ignore */ }
}

function announcePick(items) {
  var current = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '0';
  var seen = announceSeenIds();
  for (var i = 0; i < items.length; i++) {
    var a = items[i];
    if (!a || a.id == null || !a.title) continue;
    if (seen.indexOf(a.id) !== -1) continue;
    // minVersion 用于"低于某版本才提示"，例如催更
    if (a.minVersion && !announceVersionLess(current, a.minVersion)) continue;
    return a;
  }
  return null;
}

async function checkAnnouncement() {
  var res;
  try {
    res = await fetch(ANNOUNCE_URL + '?t=' + Date.now(), { cache: 'no-store' });
  } catch (e) {
    return; // 离线或跨域失败时静默跳过，不影响启动
  }
  if (!res || !res.ok) return;
  var data;
  try { data = await res.json(); } catch (e) { return; }
  var items = Array.isArray(data) ? data : [data];
  var picked = announcePick(items);
  if (picked) showAnnouncement(picked);
}

/**
 * 「关于」页手动检查更新：不看已读记录，直接找比当前版本新的公告。
 * 有新版本就弹出更新弹窗（可下载安装），没有就提示已是最新。
 */
async function checkUpdateManually() {
  var btn = document.getElementById('about-check-update');
  var label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '检查中…'; }

  var res = null;
  try {
    res = await fetch(ANNOUNCE_URL + '?t=' + Date.now(), { cache: 'no-store' });
  } catch (e) { /* 下面统一提示 */ }

  if (btn) { btn.disabled = false; btn.textContent = label; }

  if (!res || !res.ok) { toast('检查失败，请检查网络后重试'); return; }

  var data;
  try { data = await res.json(); } catch (e) { toast('检查失败，请稍后再试'); return; }

  var items = Array.isArray(data) ? data : [data];
  var best = null;
  for (var i = 0; i < items.length; i++) {
    var a = items[i];
    if (!a || !announceHasNewVersion(a) || !announceDownloadUrls(a).length) continue;
    if (!best || announceVersionLess(best.version, a.version)) best = a;
  }

  if (!best) {
    toast('已是最新版本 v' + announceCurrentVersion());
    return;
  }

  // 已有弹窗先收掉，避免重复
  var old = document.getElementById('announce-mask');
  if (old) old.remove();
  showAnnouncement(best);
}

function showAnnouncement(a) {
  if (document.getElementById('announce-mask')) return;

  var mask = document.createElement('div');
  mask.id = 'announce-mask';
  mask.className = 'announce-mask';

  var card = document.createElement('div');
  card.className = 'announce-card';

  var title = document.createElement('h3');
  title.className = 'announce-title';
  title.textContent = a.title;
  card.appendChild(title);

  if (a.body) {
    var body = document.createElement('p');
    body.className = 'announce-body';
    body.textContent = a.body;
    card.appendChild(body);
  }

  // 「不再显示」需要用户主动勾选，只关掉弹窗不算已读，下次进入仍会提示
  // force 公告不允许静默，因此不提供该选项
  var muteBox = null;
  if (!a.force) {
    var mute = document.createElement('label');
    mute.className = 'announce-mute';
    muteBox = document.createElement('input');
    muteBox.type = 'checkbox';
    var muteText = document.createElement('span');
    muteText.textContent = '不再显示';
    mute.appendChild(muteBox);
    mute.appendChild(muteText);
    card.appendChild(mute);
  }

  var actions = document.createElement('div');
  actions.className = 'announce-actions';

  var closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    // 普通公告只有勾选「不再显示」才记住；force 公告不能勾选，点按钮即视为已读
    if (a.force || (muteBox && muteBox.checked)) announceMarkSeen(a.id);
    mask.classList.remove('show');
    setTimeout(function() { mask.remove(); }, 220);
  }

  // 安装成功后由原生回调触发关闭，需要能拿到本次的 finish
  announceCurrent = a;
  announceCloseFn = finish;

  // 这条公告带 version 且高于当前 App 版本 → 当作更新提示
  var canUpdate = announceIsUpdate(a);
  var urls = announceDownloadUrls(a);
  // 带 version 的公告只在确实有新版本时才给下载入口，已是最新版的用户就只看说明
  var showLink = urls.length > 0 && (!a.version || announceHasNewVersion(a));

  var updateBtn = null;
  if (showLink) {
    if (canUpdate) {
      // 原生可用：点一下由 App 自己下载并拉起系统安装界面
      updateBtn = document.createElement('button');
      updateBtn.type = 'button';
      updateBtn.className = 'announce-primary';
      updateBtn.textContent = a.button || '立即更新';
      updateBtn.addEventListener('click', function() {
        if (announceUpdating) return;
        announceUpdating = true;
        updateBtn.disabled = true;
        updateBtn.textContent = '准备下载…';
        announceUpdateSources = urls;
        announceUpdateIndex = 0;
        announceFileName = 'shiyongbujian-' + a.version + '.apk';
        try {
          window.AndroidUpdate.downloadAndInstall(urls[0], announceFileName, urls.length > 1);
        } catch (e) {
          announceUpdating = false;
          updateBtn.disabled = false;
          updateBtn.textContent = '下载失败，点此重试';
        }
      });
      actions.appendChild(updateBtn);
    } else {
      // 浏览器 / PWA：退化成普通链接，由用户自行下载
      var link = document.createElement('a');
      link.className = 'announce-primary';
      link.href = urls[0];
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = a.button || '查看';
      link.addEventListener('click', finish);
      actions.appendChild(link);
    }
  }

  var close = document.createElement('button');
  close.type = 'button';
  close.className = showLink ? 'announce-secondary' : 'announce-primary';
  close.textContent = canUpdate ? '稍后' : (a.button || '知道了');
  close.addEventListener('click', finish);
  actions.appendChild(close);

  card.appendChild(actions);
  mask.appendChild(card);
  document.body.appendChild(mask);

  requestAnimationFrame(function() { mask.classList.add('show'); });

  if (!a.force) {
    mask.addEventListener('click', function(e) {
      if (e.target === mask) finish();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        if (!closed) finish();
      }
    });
  }
}

// ── 原生下载回调（由 MainActivity 的 AndroidUpdate 桥调用）─────────────

function announceUpdateButton() {
  var btn = document.querySelector('#announce-mask .announce-primary');
  return (btn && btn.tagName === 'BUTTON') ? btn : null;
}

window.onUpdateProgress = function(pct) {
  var btn = announceUpdateButton();
  if (!btn) return;
  btn.textContent = pct >= 100 ? '正在打开安装程序…' : ('下载中 ' + pct + '%');
};

window.onUpdateError = function(msg) {
  var btn = announceUpdateButton();
  announceUpdating = false;
  if (!btn) return;

  // 还有备用线路就自动换源重试（比如 GitHub Release 太慢或被限速时换 Pages）
  if (msg !== 'needPermission' && announceUpdateIndex + 1 < announceUpdateSources.length) {
    announceUpdateIndex++;
    announceUpdating = true;
    btn.disabled = true;
    btn.textContent = '换线路重试…';
    var next = announceUpdateSources[announceUpdateIndex];
    var stillStrict = announceUpdateIndex + 1 < announceUpdateSources.length;
    setTimeout(function() { window.AndroidUpdate.downloadAndInstall(next, announceFileName, stillStrict); }, 300);
    return;
  }

  btn.disabled = false;
  if (msg === 'needPermission') {
    // 原生已把用户送到「安装未知应用」授权页
    btn.textContent = '请允许安装应用后重试';
    setTimeout(function() {
      if (document.body.contains(btn) && !announceUpdating) btn.textContent = '立即更新';
    }, 3000);
  } else {
    btn.textContent = '下载失败，点此重试';
  }
};

window.onUpdateInstalling = function() {
  // 系统安装界面已拉起，这条公告不用再提醒
  if (announceCurrent && announceCurrent.id != null) announceMarkSeen(announceCurrent.id);
  announceUpdating = false;
  if (announceCloseFn) announceCloseFn();
};

document.addEventListener('DOMContentLoaded', function() {
  // 等首屏渲染完再拉，避免和启动抢带宽
  setTimeout(checkAnnouncement, 1500);
});
