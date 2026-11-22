// Tabs (max 3, ARIA tablist) + desktop view switch — DESIGN_SYSTEM §2/§3, contract §4.

const TABS = ['understand', 'negotiate', 'document'];
const VIEWS = ['report', 'split', 'contract'];
const DESKTOP = '(min-width: 900px)';

export function createTabs(ctx) {
  const c = ctx || {};
  let mounted = false;
  let active = 'understand';
  let view = 'split';

  function doc() {
    return c.doc || (typeof document !== 'undefined' ? document : null);
  }

  function shell() {
    const d = doc();
    const el = c.shell || (d && d.querySelector ? d.querySelector('.app-shell') : null);
    return el && el.dataset ? el : null;
  }

  function tabEls() {
    const d = doc();
    return d && d.querySelectorAll ? Array.from(d.querySelectorAll('.tab[data-tab]')) : [];
  }

  function setView(next) {
    if (VIEWS.indexOf(next) === -1) return;
    view = next;
    const d = doc();
    if (d && d.querySelectorAll) {
      Array.from(d.querySelectorAll('[data-view-opt]')).forEach((btn) => {
        btn.setAttribute('aria-pressed', btn.dataset.viewOpt === next ? 'true' : 'false');
      });
    }
    const s = shell();
    if (s) s.dataset.view = next;
  }

  function activate(id, focus) {
    if (TABS.indexOf(id) === -1) return;
    active = id;
    tabEls().forEach((tab) => {
      const on = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
      if (on && focus && typeof tab.focus === 'function') tab.focus();
    });
    const s = shell();
    if (s) s.dataset.activeTab = id;
    routePanels();
  }

  // Desktop routes panels by the view switch + data-active-tab (app.css §2), so the
  // contract column must stay visible in Split. Only the mobile feed uses [hidden].
  function routePanels() {
    const d = doc();
    if (!d || !d.querySelectorAll) return;
    const desktop = isDesktop();
    Array.from(d.querySelectorAll('[data-tab-panel]')).forEach((panel) => {
      if (desktop) panel.removeAttribute('hidden');
      else panel.hidden = panel.dataset.tabPanel !== active;
    });
  }

  function isDesktop() {
    const d = doc();
    const win = d && d.defaultView;
    if (!win || typeof win.matchMedia !== 'function') return true;
    return !!win.matchMedia(DESKTOP).matches;
  }

  function onKeydown(e) {
    const tabs = tabEls();
    if (!tabs.length || !e) return;
    const key = e.key;
    const idx = Math.max(0, tabs.findIndex((t) => t.dataset.tab === active));
    let target = null;
    if (key === 'ArrowRight') target = tabs[(idx + 1) % tabs.length];
    else if (key === 'ArrowLeft') target = tabs[(idx - 1 + tabs.length) % tabs.length];
    else if (key === 'Home') target = tabs[0];
    else if (key === 'End') target = tabs[tabs.length - 1];
    else if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      const from = e.target && typeof e.target.closest === 'function' ? e.target.closest('.tab[data-tab]') : null;
      const focused = (doc() && doc().activeElement && doc().activeElement.closest)
        ? doc().activeElement.closest('.tab[data-tab]')
        : null;
      target = from || focused || tabs[idx];
    } else return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (target) activate(target.dataset.tab, true);
  }

  function mount() {
    if (mounted) return { activate, setView };
    mounted = true;
    const d = doc();
    if (!d || !d.querySelectorAll) return { activate, setView };

    const selected = d.querySelector('.tab[data-tab][aria-selected="true"]');
    const first = d.querySelector('.tab[data-tab]');
    active = (selected && TABS.indexOf(selected.dataset.tab) !== -1)
      ? selected.dataset.tab
      : (first && TABS.indexOf(first.dataset.tab) !== -1 ? first.dataset.tab : 'understand');

    const pressed = d.querySelector('[data-view-opt][aria-pressed="true"]');
    view = (pressed && VIEWS.indexOf(pressed.dataset.viewOpt) !== -1) ? pressed.dataset.viewOpt : 'split';
    const s = shell();
    if (s && VIEWS.indexOf(s.dataset.view) !== -1) view = s.dataset.view;

    Array.from(d.querySelectorAll('[role="tablist"]')).forEach((list) => {
      list.addEventListener('keydown', onKeydown);
    });

    tabEls().forEach((tab) => {
      tab.addEventListener('click', () => activate(tab.dataset.tab, false));
    });

    Array.from(d.querySelectorAll('[data-view-opt]')).forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.viewOpt));
    });

    activate(active, false);

    if (!isDesktop()) {
      if (s) s.dataset.view = 'feed';
    } else {
      setView(view);
    }
    routePanels();

    const win = d.defaultView;
    if (win && typeof win.matchMedia === 'function') {
      const mq = win.matchMedia(DESKTOP);
      const onChange = () => {
        if (!isDesktop() && shell()) shell().dataset.view = 'feed';
        routePanels();
      };
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    }

    return { activate, setView };
  }

  return { mount, activate, setView };
}
