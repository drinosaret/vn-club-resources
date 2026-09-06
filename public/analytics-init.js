// Loads the analytics script once the visit shows a sign of a person: a pointer, key,
// touch, wheel or scroll, or a page kept on screen for a while. Automated browsers are
// not counted. The script host and website id come from the tag that loads this file.
/* global document, window, navigator */
(function () {
  var tag = document.currentScript;
  if (!tag) return;
  var src = tag.getAttribute('data-src');
  var websiteId = tag.getAttribute('data-website-id');
  if (!src || !websiteId) return;
  if (navigator.webdriver) return;

  var DWELL_MS = 20000;
  var signals = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
  var timer = null;

  function load() {
    if (!load.pending) return;
    load.pending = false;
    for (var i = 0; i < signals.length; i++) {
      window.removeEventListener(signals[i], load, true);
    }
    if (timer !== null) window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    var el = document.createElement('script');
    el.defer = true;
    el.src = src;
    el.setAttribute('data-website-id', websiteId);
    document.head.appendChild(el);
  }
  load.pending = true;

  // The dwell clock only runs while the page is on screen.
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
})();
