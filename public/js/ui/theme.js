// Theme toggle: [data-theme-toggle] flips documentElement.dataset.theme, persisted in localStorage['sc.theme'].

const KEY = 'sc.theme';
const TOGGLE = '[data-theme-toggle]';

let mounted = false;

function storage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readTheme() {
  try {
    const store = storage();
    if (!store) return null;
    const value = store.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function writeTheme(theme) {
  try {
    const store = storage();
    if (!store) return;
    store.setItem(KEY, theme);
  } catch {
    /* storage unavailable or full — theme still applies for this session */
  }
}

function prefersDark() {
  try {
    if (typeof matchMedia !== 'function') return false;
    const query = matchMedia('(prefers-color-scheme: dark)');
    return !!(query && query.matches === true);
  } catch {
    return false;
  }
}

function initialTheme() {
  return readTheme() || (prefersDark() ? 'dark' : 'light');
}

export function createTheme(ctx) {
  function apply(theme) {
    if (typeof document === 'undefined' || !document || !document.documentElement) return;
    document.documentElement.dataset.theme = theme;
    const toggle = document.querySelector(TOGGLE);
    if (toggle) toggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    if (ctx && typeof ctx.emit === 'function') ctx.emit('theme', { theme });
  }

  return {
    mount() {
      if (mounted) return;
      if (typeof document === 'undefined' || !document) return;
      mounted = true;

      apply(initialTheme());

      const toggle = document.querySelector(TOGGLE);
      if (!toggle || typeof toggle.addEventListener !== 'function') return;

      toggle.addEventListener('click', () => {
        const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        apply(next);
        writeTheme(next);
      });
    },
  };
}
