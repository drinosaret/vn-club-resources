// Applies the stored theme before the first paint, so a reader in dark mode never sees the
// light page flash. Served as a file and loaded without defer so it runs where it is met,
// during parsing, ahead of the body; a script rendered by the page's own components would
// only run once those components had hydrated, which is after the flash.
/* global localStorage, document */
(function () {
  try {
    const theme = localStorage.getItem('theme') || 'light';
    const el = document.documentElement;
    el.classList.remove('light', 'dark');
    el.classList.add(theme, 'no-transitions');
  } catch {
    // Storage can be unavailable or refused; the light default then stands.
  }
})();
