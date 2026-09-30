(function () {
  'use strict';

  const DRAG_THRESHOLD_PX = 5;
  const MIN_THUMB_PX = 24;
  let press = null;
  let suppressNextAuxClick = false;

  function isScrollable(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    if (element === document.scrollingElement) return true;
    return /^(auto|scroll|overlay)$/.test(getComputedStyle(element).overflowY);
  }

  function scrollTarget(event) {
    for (const node of event.composedPath()) {
      if (isScrollable(node)) return node;
    }
    return isScrollable(document.scrollingElement) ? document.scrollingElement : null;
  }

  function scrollPerPixel(element) {
    const viewport = element.clientHeight;
    const content = element.scrollHeight;
    const range = content - viewport;
    const thumb = Math.max(MIN_THUMB_PX, viewport * viewport / content);
    const travel = Math.max(1, viewport - Math.min(thumb, viewport - 1));
    return range / travel;
  }

  function onMouseDown(event) {
    if (event.button !== 1 || press) return;
    const target = scrollTarget(event);
    if (!target) return;

    press = {
      target,
      startY: event.clientY,
      startScrollTop: target.scrollTop,
      dragging: false,
    };

    // Chrome starts its built-in autoscroll on mouse down, before auxclick.
    event.preventDefault();
  }

  function onMouseMove(event) {
    if (!press) return;
    if (!(event.buttons & 4)) {
      press = null;
      return;
    }

    if (!press.dragging) {
      const dy = event.clientY - press.startY;
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    press.target.scrollTop = press.startScrollTop +
      (event.clientY - press.startY) * scrollPerPixel(press.target);
  }

  function onMouseUp(event) {
    if (event.button !== 1 || !press) return;
    if (press.dragging) {
      suppressNextAuxClick = true;
      event.preventDefault();
      event.stopImmediatePropagation();
      setTimeout(function () { suppressNextAuxClick = false; }, 0);
    }
    press = null;
  }

  function onAuxClick(event) {
    if (event.button !== 1 || !suppressNextAuxClick) return;
    suppressNextAuxClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  window.addEventListener('mousedown', onMouseDown, true);
  window.addEventListener('mousemove', onMouseMove, true);
  window.addEventListener('mouseup', onMouseUp, true);
  window.addEventListener('auxclick', onAuxClick, true);
  window.addEventListener('blur', function () { press = null; });
})();
