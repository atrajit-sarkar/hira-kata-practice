/*
 * Runs synchronously in <head> before first paint (classic script, CSP-safe) to apply the saved
 * theme and kana font so the page never flashes the wrong colours.
 */
(function applyStoredAppearance() {
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('hk-theme');
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    var font = localStorage.getItem('hk-kana-font');
    if (font === 'gothic') root.setAttribute('data-kana-font', 'gothic');
  } catch (e) {
    /* Storage may be unavailable (private mode); defaults apply. */
  }
})();
