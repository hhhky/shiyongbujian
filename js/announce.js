// ─────────────────────────────────────────────
// 远程公告
//   内容来自仓库根目录的 announce.json，电脑上改完提交即可推送
//   客户端启动后拉取一次，遇到没读过的 id 就弹窗
// ─────────────────────────────────────────────

var ANNOUNCE_URL = 'https://hhhky.github.io/shiyongbujian/announce.json';
var ANNOUNCE_SEEN_KEY = 'sjb-announce-seen';
var ANNOUNCE_MAX_SEEN = 50;

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

  var actions = document.createElement('div');
  actions.className = 'announce-actions';

  var closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    announceMarkSeen(a.id);
    mask.classList.remove('show');
    setTimeout(function() { mask.remove(); }, 220);
  }

  if (a.url) {
    var link = document.createElement('a');
    link.className = 'announce-primary';
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = a.button || '查看';
    link.addEventListener('click', finish);
    actions.appendChild(link);
  }

  var close = document.createElement('button');
  close.type = 'button';
  close.className = a.url ? 'announce-secondary' : 'announce-primary';
  close.textContent = a.url ? '知道了' : (a.button || '知道了');
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

document.addEventListener('DOMContentLoaded', function() {
  // 等首屏渲染完再拉，避免和启动抢带宽
  setTimeout(checkAnnouncement, 1500);
});
