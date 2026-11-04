(function () {
  'use strict';

  // 可点击元素的统一选择器：按钮、部件卡片、主题选项、底部导航，以及所有带 onclick 的元素
  var SELECTOR = 'button, .widget-card-outer, .theme-option, .nav-item, [onclick], a[href]';
  var PRESS_CLASS = 'tap-press';
  var HOLD_DELAY = 45;    // 按下后稍等再触发，避免手指开始滚动时误震动
  var MOVE_TOLERANCE = 8; // 移动超过这个距离就当作滑动，取消按压

  var active = null; // { el, x, y, timer, pressing }

  function hapticTap() {
    try {
      if (window.AndroidHaptic && window.AndroidHaptic.tap) {
        window.AndroidHaptic.tap();
        return;
      }
    } catch (e) { /* 非 App 环境，走下面的降级 */ }
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* 不支持震动就只保留视觉反馈 */ }
  }

  function hapticConfirm() {
    try {
      if (window.AndroidHaptic && window.AndroidHaptic.confirm) {
        window.AndroidHaptic.confirm();
        return;
      }
    } catch (e) { /* 同上 */ }
    try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) { /* 忽略 */ }
  }

  window.hapticTap = hapticTap;
  window.hapticConfirm = hapticConfirm;

  function findTarget(node) {
    if (!node || !node.closest) return null;
    var el = node.closest(SELECTOR);
    if (!el) return null;
    // 输入类控件自带原生反馈，不叠加缩放
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return null;
    if (el.disabled) return null;
    return el;
  }

  function beginPress() {
    if (!active || active.pressing) return;
    active.pressing = true;
    active.el.classList.add(PRESS_CLASS);
    hapticTap();
  }

  function endPress(keepTapFeedback) {
    if (!active) return;
    clearTimeout(active.timer);
    var el = active.el;
    if (active.pressing) {
      el.classList.remove(PRESS_CLASS);
    } else if (keepTapFeedback) {
      // 极快的点击：按下动画来不及走完，补一帧收缩再弹回
      el.classList.add(PRESS_CLASS);
      setTimeout(function () { el.classList.remove(PRESS_CLASS); }, 80);
      hapticTap();
    }
    active = null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return; // 桌面端保留 hover，不模拟手机按压
    if (e.button !== undefined && e.button !== 0) return;
    var el = findTarget(e.target);
    if (!el) return;

    active = { el: el, x: e.clientX, y: e.clientY, pressing: false, timer: null };
    active.timer = setTimeout(beginPress, HOLD_DELAY);
  }, { passive: true });

  document.addEventListener('pointermove', function (e) {
    if (!active) return;
    if (Math.abs(e.clientX - active.x) > MOVE_TOLERANCE || Math.abs(e.clientY - active.y) > MOVE_TOLERANCE) {
      endPress(false);
    }
  }, { passive: true });

  document.addEventListener('pointerup', function () {
    endPress(true);
  }, { passive: true });

  document.addEventListener('pointercancel', function () {
    endPress(false);
  }, { passive: true });

  // 页面切走或滚动容器接管手势时，别把按下态留在元素上
  window.addEventListener('blur', function () { endPress(false); });
})();
