/* Mila Café — tema claro (mila) y tema noche.
   Va en el <head>, antes de pintar, para que la página nunca parpadee con el tema equivocado.
   Siempre arranca en "mila" salvo que la persona haya elegido noche (clave mila-tema); no sigue el modo del sistema. */
(function () {
  var STORAGE_KEY = "mila-tema";
  var DEFAULT_THEME = "mila";
  var THEMES = { mila: "#274034", noche: "#0D1410" };
  var LABELS = {
    mila: "Cambiar a modo noche",
    noche: "Cambiar a modo claro",
  };
  var root = document.documentElement;
  var switchTimer = 0;

  function stored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return Object.prototype.hasOwnProperty.call(THEMES, value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function syncMeta(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", THEMES[theme]);
  }

  function syncButtons(theme) {
    var buttons = document.querySelectorAll("[data-theme-toggle]");
    for (var index = 0; index < buttons.length; index += 1) {
      buttons[index].setAttribute("aria-label", LABELS[theme]);
      buttons[index].setAttribute("title", LABELS[theme]);
    }
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    syncMeta(theme);
    syncButtons(theme);
  }

  function current() {
    var theme = root.getAttribute("data-theme");
    return Object.prototype.hasOwnProperty.call(THEMES, theme) ? theme : DEFAULT_THEME;
  }

  function set(theme, options) {
    if (!Object.prototype.hasOwnProperty.call(THEMES, theme)) return current();
    var animate = !options || options.animate !== false;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && !reduced) {
      root.classList.add("theme-switching");
      window.clearTimeout(switchTimer);
      switchTimer = window.setTimeout(function () { root.classList.remove("theme-switching"); }, 220);
    }
    apply(theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch (error) { /* sin almacenamiento: el cambio dura la sesión */ }
    root.dispatchEvent(new CustomEvent("mila-theme-change", { detail: { theme: theme } }));
    return theme;
  }

  apply(stored() || DEFAULT_THEME);

  document.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
    if (!button) return;
    set(current() === "noche" ? "mila" : "noche");
  });

  // Los botones aparecen después de este script: ponerles su etiqueta en cuanto existan.
  document.addEventListener("DOMContentLoaded", function () { syncButtons(current()); });

  window.MilaTheme = { get: current, set: set, themes: Object.keys(THEMES) };
})();
