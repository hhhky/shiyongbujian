(function() {
  'use strict';

  var root = document.documentElement;

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
    var sat = measureEnvInset('top');
    var sab = measureEnvInset('bottom');

    if (isAndroid()) {
      var apiLevel = getAndroidApiLevel();
      var minSat = apiLevel >= 35 ? 32 : 28;
      if (sat < minSat) sat = minSat;

      if (sab < 16 && apiLevel >= 35) sab = 16;
    }

    root.style.setProperty('--sat', sat + 'px');
    root.style.setProperty('--sab', sab + 'px');
  }

  if (document.body) {
    update();
  } else {
    document.addEventListener('DOMContentLoaded', update);
  }

  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', function() {
    setTimeout(update, 200);
  });
})();
