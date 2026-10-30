(function () {
  'use strict';

  var root = document.documentElement;

  // Capacitor 8 的 SystemBars 会把系统栏真实高度注入成 CSS 变量（单位 CSS px）。
  // App 内直接用它：既不会重复留白，也不会在鸿蒙等机型上因为估算偏差而遮挡内容。
  function readNativeInset(name) {
    var v = root.style.getPropertyValue(name);
    if (!v) v = getComputedStyle(root).getPropertyValue(name);
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function hasNativeInsets() {
    return root.style.getPropertyValue('--safe-area-inset-top') !== '';
  }

  function measureEnvInset(direction) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;' + direction + ':0;left:0;width:1px;height:env(safe-area-inset-' + direction + ',0px);pointer-events:none;opacity:0;z-index:-1';
    document.body.appendChild(el);
    var h = el.offsetHeight;
    document.body.removeChild(el);
    return h;
  }

  function isAndroid() {
    return /android/i.test(navigator.userAgent);
  }

  function getAndroidApiLevel() {
    var m = navigator.userAgent.match(/Android\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function update() {
    var sat;
    var sab;

    if (hasNativeInsets()) {
      sat = readNativeInset('--safe-area-inset-top');
      sab = readNativeInset('--safe-area-inset-bottom');
    } else {
      sat = measureEnvInset('top');
      sab = measureEnvInset('bottom');
      if (isAndroid()) {
        var apiLevel = getAndroidApiLevel();
        var minSat = apiLevel >= 35 ? 32 : 28;
        if (sat < minSat) sat = minSat;
        if (sab < 16 && apiLevel >= 35) sab = 16;
      }
    }

    root.style.setProperty('--sat', sat + 'px');
    root.style.setProperty('--sab', sab + 'px');
  }

  // color 可能是 #rrggbb，也可能是浏览器解析后的 rgb(r, g, b)，
  // 原生端只接受 # 开头的十六进制，这里统一转换。
  function toHexColor(color) {
    color = (color || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(color) || /^#[0-9a-f]{8}$/i.test(color)) return color;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return '#' + color.charAt(1) + color.charAt(1) + color.charAt(2) + color.charAt(2) + color.charAt(3) + color.charAt(3);
    }
    var m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (m) {
      var hex = '';
      for (var i = 1; i <= 3; i++) {
        var part = parseInt(m[i], 10).toString(16);
        hex += part.length === 1 ? '0' + part : part;
      }
      return '#' + hex;
    }
    return '';
  }

  // 按背景亮度判断深浅，新增自定义主题时也能自动适配图标黑白
  function isDarkColor(hex) {
    if (!hex || hex.length < 7) return false;
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
  }

  // 系统栏图标黑白 + 系统栏区域底色跟随当前主题（仅 App 内生效）
  function syncSystemBars(theme) {
    theme = theme || root.getAttribute('data-theme') || 'glass';
    var bg = '';
    try {
      bg = toHexColor(getComputedStyle(root).getPropertyValue('--bg-body'));
    } catch (e) { /* 忽略，走默认色 */ }
    var isDark = bg ? isDarkColor(bg) : theme === 'dark';
    if (!bg) bg = isDark ? '#1c1c1e' : '#e5e5ea';

    try {
      if (window.AndroidSystemBars && window.AndroidSystemBars.setBarTheme) {
        window.AndroidSystemBars.setBarTheme(!isDark, bg);
      }
    } catch (e) { /* 非 App 环境静默降级 */ }
  }

  window.syncSystemBars = syncSystemBars;

  function boot() {
    update();
    syncSystemBars();

    // Capacitor 的安全区注入晚于首屏渲染，前 2 秒内持续校准；
    // 同时等 AndroidSystemBars 桥接对象挂载后补一次主题同步。
    var tries = 0;
    var synced = !!window.AndroidSystemBars;
    var timer = setInterval(function () {
      update();
      if (!synced && window.AndroidSystemBars) {
        syncSystemBars();
        synced = true;
      }
      if (++tries >= 20) clearInterval(timer);
    }, 100);
  }

  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', function () {
    setTimeout(function () {
      update();
      syncSystemBars();
    }, 200);
  });
})();
