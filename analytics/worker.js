/**
 * 使用统计 Worker（Cloudflare Workers + D1）
 *
 * POST /api/usage   接收 App 的匿名会话上报
 * GET  /api/stats   返回统计数据（需要 token）
 * GET  /admin       看板页面（需要 token）
 *
 * 环境变量：ADMIN_TOKEN（必填）
 * D1 绑定：DB
 *
 * 只记录：匿名设备 ID、会话 ID、版本号、各部件使用次数。
 * 不记录任何内容、账号、位置信息。
 */

const WIDGET_ALLOW = ['focus', 'schedule', 'shua', 'review', 'memo', 'mindmap'];
const MAX_WIDGET_COUNT = 500;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, corsHeaders())
  });
}

// 统计按东八区切日
function cstDate(offsetDays = 0) {
  const ms = Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function cleanId(v, max) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v.slice(0, max) : '';
}

async function handleUsage(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'bad_json' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad_payload' }, 400);

  const device = cleanId(body.device, 64);
  if (!device) return json({ ok: false, error: 'bad_device' }, 400);

  const session = cleanId(body.session, 64) || device;
  const version = typeof body.version === 'string' ? body.version.slice(0, 16) : '';
  const date = cstDate();
  const now = Date.now();

  const widgets = {};
  if (body.widgets && typeof body.widgets === 'object') {
    Object.keys(body.widgets).forEach((key) => {
      if (WIDGET_ALLOW.indexOf(key) < 0) return;
      const n = Number(body.widgets[key]);
      if (!isFinite(n) || n <= 0) return;
      widgets[key] = Math.min(MAX_WIDGET_COUNT, Math.round(n));
    });
  }

  const stmts = [];
  // 同一设备同一天只算一次活跃
  stmts.push(env.DB.prepare(
    'INSERT OR IGNORE INTO dau (date, device, first_seen, version) VALUES (?, ?, ?, ?)'
  ).bind(date, device, now, version));

  stmts.push(env.DB.prepare(
    'INSERT INTO app_daily (date, sessions) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET sessions = sessions + 1'
  ).bind(date));

  Object.keys(widgets).forEach((key) => {
    stmts.push(env.DB.prepare(
      'INSERT INTO widget_daily (date, widget, count) VALUES (?, ?, ?) ' +
      'ON CONFLICT(date, widget) DO UPDATE SET count = count + excluded.count'
    ).bind(date, key, widgets[key]));
  });

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
  return json({ ok: true });
}

async function handleStats(env, url) {
  const token = url.searchParams.get('token') || '';
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const today = cstDate();
  const yesterday = cstDate(1);
  const start7 = cstDate(6);
  const start30 = cstDate(29);

  const [todayRow, yesterdayRow, weekRow, totalRow, days, widgetsToday, widgets7d, widgetsAll, sessionsToday] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM dau WHERE date = ?').bind(today),
    env.DB.prepare('SELECT COUNT(*) AS n FROM dau WHERE date = ?').bind(yesterday),
    env.DB.prepare('SELECT date, COUNT(*) AS n FROM dau WHERE date >= ? GROUP BY date').bind(start7),
    env.DB.prepare('SELECT COUNT(*) AS n FROM dau').bind(),
    env.DB.prepare('SELECT date, COUNT(*) AS n FROM dau WHERE date >= ? GROUP BY date ORDER BY date').bind(start30),
    env.DB.prepare('SELECT widget, SUM(count) AS n FROM widget_daily WHERE date = ? GROUP BY widget ORDER BY n DESC').bind(today),
    env.DB.prepare('SELECT widget, SUM(count) AS n FROM widget_daily WHERE date >= ? GROUP BY widget ORDER BY n DESC').bind(start7),
    env.DB.prepare('SELECT widget, SUM(count) AS n FROM widget_daily GROUP BY widget ORDER BY n DESC').bind(),
    env.DB.prepare('SELECT sessions FROM app_daily WHERE date = ?').bind(today)
  ]);

  const weekDays = (weekRow.results || []).reduce((n, r) => n + r.n, 0);

  return json({
    ok: true,
    date: today,
    today: todayRow.results[0] ? todayRow.results[0].n : 0,
    yesterday: yesterdayRow.results[0] ? yesterdayRow.results[0].n : 0,
    avg7: Math.round((weekDays / 7) * 10) / 10,
    total: totalRow.results[0] ? totalRow.results[0].n : 0,
    sessionsToday: sessionsToday.results[0] ? sessionsToday.results[0].sessions : 0,
    days: days.results || [],
    widgetsToday: widgetsToday.results || [],
    widgets7d: widgets7d.results || [],
    widgetsAll: widgetsAll.results || []
  });
}

const WIDGET_NAMES = {
  focus: '专注',
  schedule: '课表',
  shua: '刷题',
  review: '资料',
  memo: '备忘',
  mindmap: '导图'
};

function adminPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>使用统计</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif; background: #eef1f6; color: #1d1d1f; padding: 20px 16px 40px; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #8a8a95; margin-bottom: 18px; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(24,26,60,.04), 0 10px 24px -16px rgba(46,50,94,.24); }
  .label { font-size: 12px; color: #8a8a95; }
  .value { font-size: 24px; font-weight: 700; margin-top: 2px; }
  .panel { background: #fff; border-radius: 16px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(24,26,60,.04), 0 10px 24px -16px rgba(46,50,94,.24); }
  .panel h2 { font-size: 14px; margin: 0 0 12px; }
  .chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
  .bar { flex: 1; background: #c7d2fe; border-radius: 4px 4px 2px 2px; min-height: 2px; position: relative; }
  .bar span { position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%); font-size: 9px; color: #a0a0a8; white-space: nowrap; }
  .bar:hover { background: #818cf8; }
  .axis { display: flex; justify-content: space-between; font-size: 10px; color: #a0a0a8; margin-top: 20px; }
  .row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 13px; }
  .row .name { width: 44px; flex-shrink: 0; color: #5f5f6b; }
  .track { flex: 1; height: 8px; background: #eef1f6; border-radius: 999px; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(135deg,#a78bfa,#7c3aed); border-radius: 999px; }
  .num { width: 48px; text-align: right; color: #5f5f6b; font-variant-numeric: tabular-nums; }
  .empty { color: #a0a0a8; font-size: 13px; padding: 12px 0; text-align: center; }
  .foot { font-size: 11px; color: #a0a0a8; text-align: center; margin-top: 8px; }
  @media (min-width: 640px) { .cards { grid-template-columns: repeat(4, 1fr); } }
</style>
</head>
<body>
<div class="wrap">
  <h1>使用统计</h1>
  <p class="sub" id="sub">加载中…</p>

  <div class="cards">
    <div class="card"><div class="label">今日活跃</div><div class="value" id="today">-</div></div>
    <div class="card"><div class="label">昨日活跃</div><div class="value" id="yesterday">-</div></div>
    <div class="card"><div class="label">近 7 天日均</div><div class="value" id="avg7">-</div></div>
    <div class="card"><div class="label">累计设备</div><div class="value" id="total">-</div></div>
  </div>

  <div class="panel">
    <h2>近 30 天活跃设备</h2>
    <div class="chart" id="chart"></div>
    <div class="axis"><span id="axisStart"></span><span id="axisEnd"></span></div>
  </div>

  <div class="panel">
    <h2>部件使用 · 今日</h2>
    <div id="wToday"><div class="empty">暂无数据</div></div>
  </div>

  <div class="panel">
    <h2>部件使用 · 近 7 天</h2>
    <div id="w7d"><div class="empty">暂无数据</div></div>
  </div>

  <p class="foot">仅统计匿名设备数与部件点击次数，不收集内容与账号</p>
</div>
<script>
  var TOKEN = new URLSearchParams(location.search).get('token') || '';
  var NAMES = ${JSON.stringify(WIDGET_NAMES)};

  function renderRank(box, rows) {
    if (!rows || !rows.length) { box.innerHTML = '<div class="empty">暂无数据</div>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; })) || 1;
    box.innerHTML = rows.map(function (r) {
      var pct = Math.max(2, Math.round(r.n / max * 100));
      return '<div class="row"><span class="name">' + (NAMES[r.widget] || r.widget) + '</span>'
        + '<span class="track"><span class="fill" style="width:' + pct + '%"></span></span>'
        + '<span class="num">' + r.n + '</span></div>';
    }).join('');
  }

  fetch('/api/stats?token=' + encodeURIComponent(TOKEN))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) throw new Error(d.error || '加载失败');
      document.getElementById('sub').textContent = '统计日期 ' + d.date + '（东八区） · 今日会话 ' + d.sessionsToday;
      document.getElementById('today').textContent = d.today;
      document.getElementById('yesterday').textContent = d.yesterday;
      document.getElementById('avg7').textContent = d.avg7;
      document.getElementById('total').textContent = d.total;

      var days = d.days || [];
      var max = Math.max.apply(null, days.map(function (x) { return x.n; }).concat([1]));
      var chart = document.getElementById('chart');
      chart.innerHTML = days.map(function (x) {
        var h = Math.max(2, Math.round(x.n / max * 100));
        return '<div class="bar" style="height:' + h + '%" title="' + x.date + '：' + x.n + '"><span>' + x.date.slice(5) + '</span></div>';
      }).join('') || '<div class="empty">暂无数据</div>';
      if (days.length) {
        document.getElementById('axisStart').textContent = days[0].date;
        document.getElementById('axisEnd').textContent = days[days.length - 1].date;
      }

      renderRank(document.getElementById('wToday'), d.widgetsToday);
      renderRank(document.getElementById('w7d'), d.widgets7d);
    })
    .catch(function (e) {
      document.getElementById('sub').textContent = '加载失败：' + e.message + '（检查 token）';
    });
</script>
</body>
</html>`;
}

async function handleAdmin(env, url) {
  const token = url.searchParams.get('token') || '';
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(adminPage(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === '/api/usage' && request.method === 'POST') return handleUsage(request, env);
    if (url.pathname === '/api/stats' && request.method === 'GET') return handleStats(env, url);
    if (url.pathname === '/admin' && request.method === 'GET') return handleAdmin(env, url);
    if (url.pathname === '/' ) {
      return new Response('usage endpoint ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    return new Response('Not found', { status: 404 });
  }
};
