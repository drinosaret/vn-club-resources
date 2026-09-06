import { safeJsonLdStringify } from './metadata-utils';

/** The analytics loader as inline script text; the address and id are written in as constants. */
export function analyticsGateScript(trackerSrc: string, websiteId: string): string {
  const src = safeJsonLdStringify(trackerSrc);
  const id = safeJsonLdStringify(websiteId);
  return `(function () {
  if (navigator.webdriver) return;
  var DWELL_MS = 20000;
  var signals = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
  var timer = null;
  var pending = true;
  function load() {
    if (!pending) return;
    pending = false;
    for (var i = 0; i < signals.length; i++) window.removeEventListener(signals[i], load, true);
    if (timer !== null) window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    var el = document.createElement('script');
    el.defer = true;
    el.src = ${src};
    el.setAttribute('data-website-id', ${id});
    document.head.appendChild(el);
  }
  function onVisibility() {
    if (document.visibilityState === 'visible') {
      if (timer === null) timer = window.setTimeout(load, DWELL_MS);
    } else if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }
  for (var i = 0; i < signals.length; i++) {
    window.addEventListener(signals[i], load, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();
})();`;
}
