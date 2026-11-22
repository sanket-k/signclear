/* ui/a11y.js — skip link, Escape escape-hatch and a polite live region for route/view
   changes (DESIGN_SYSTEM §8.3, docs/ui-wiring-contract.md §3 factory + §7 DoD). */

const SKIP_TEXT = 'Skip to main content';
const SKIP_TARGET = '#app-main';
const LANGS = ['kn', 'hi', 'ta', 'en'];
const AUDIT_MSG = 'Report loaded';

export function createA11y(ctx) {
  const state = { mounted: false };

  function getDoc() {
    if (ctx && ctx.doc) return ctx.doc;
    if (typeof document !== 'undefined' && document) return document;
    return null;
  }

  function getEventTarget(doc) {
    if (ctx && ctx.shell && typeof ctx.shell.addEventListener === 'function') return ctx.shell;
    if (doc && typeof doc.addEventListener === 'function') return doc;
    return null;
  }

  function ensureSkipLink(doc) {
    if (!doc || !doc.body) return null;

    let existing = null;
    try {
      existing = doc.querySelector('.skip-link');
    } catch {
      existing = null;
    }
    if (existing) return existing;

    let link = null;
    try {
      link = doc.createElement('a');
      link.className = 'skip-link';
      link.setAttribute('href', SKIP_TARGET);
      link.textContent = SKIP_TEXT;
    } catch {
      return null;
    }

    try {
      const header = doc.querySelector('.app-header');
      if (header && header.parentNode === doc.body) {
        doc.body.insertBefore(link, header);
      } else {
        doc.body.insertBefore(link, doc.body.firstChild || null);
      }
    } catch {
      return null;
    }

    return link;
  }

  function ensureMainId(doc) {
    try {
      const main = doc.querySelector('main');
      if (main && !main.id) main.id = 'app-main';
    } catch {
      /* no <main> — nothing to landmark */
    }
  }

  function markRoot(doc) {
    try {
      const anchors = doc.querySelectorAll('a[href]');
      if (!anchors || anchors.length === 0) return;
      const root = doc.documentElement;
      if (root && typeof root.setAttribute === 'function') root.setAttribute('data-a11y', 'on');
    } catch {
      /* no documentElement — leave the attribute off */
    }
  }

  function ensureLiveRegion(doc) {
    if (!doc || !doc.body) return null;

    let el = null;
    try {
      el = doc.querySelector('[data-live-status]');
    } catch {
      el = null;
    }
    if (el) return el;

    try {
      el = doc.createElement('div');
      el.className = 'visually-hidden';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('data-live-status', '');
      doc.body.appendChild(el);
    } catch {
      return null;
    }
    return el;
  }

  function announce(doc, message) {
    const el = ensureLiveRegion(doc);
    if (!el) return;
    try {
      el.textContent = message;
    } catch {
      /* frozen node */
    }
  }

  function langMessage(detail) {
    const code = typeof detail === 'string' ? detail : detail && detail.lang;
    if (typeof code !== 'string' || !LANGS.includes(code)) return null;
    return `Language changed to ${code}`;
  }

  function closeTransients(doc) {
    if (!doc) return;

    try {
      for (const popover of doc.querySelectorAll('.pii-popover')) popover.hidden = true;
    } catch {
      /* ignore */
    }

    try {
      const dialog = doc.querySelector('#qr-dialog');
      if (dialog) {
        const isOpen = dialog.open === true || dialog.hasAttribute('open');
        if (isOpen) {
          if (typeof dialog.close === 'function') dialog.close();
          else dialog.removeAttribute('open');
        }
      }
    } catch {
      /* ignore */
    }

    try {
      if (doc.querySelector('.ask-drawer[data-open="true"]')) {
        const close = doc.querySelector('[data-ask-close]');
        if (close && typeof close.click === 'function') close.click();
      }
    } catch {
      /* ignore */
    }

    try {
      if (doc.querySelector('#vault-drawer[data-open="true"]')) {
        const close = doc.querySelector('[data-vault-close]');
        if (close && typeof close.click === 'function') close.click();
      }
    } catch {
      /* ignore */
    }
  }

  function bindKeydown(doc) {
    if (!doc || typeof doc.addEventListener !== 'function') return;
    doc.addEventListener('keydown', (event) => {
      try {
        const key = event && event.key;
        if (key !== 'Escape') return;
        closeTransients(doc);
      } catch {
        /* never throw out of a global listener */
      }
    });
  }

  function bindAnnouncements(doc) {
    const target = getEventTarget(doc);
    if (!target) return;

    const listen = (name, handler) => {
      try {
        target.addEventListener(name, (event) => {
          try {
            handler(event);
          } catch {
            /* never throw out of a global listener */
          }
        });
      } catch {
        /* ignore */
      }
    };

    listen('sc:audit', () => announce(doc, AUDIT_MSG));
    listen('sc:lang', (event) => {
      const message = langMessage(event && event.detail);
      if (message) announce(doc, message);
    });
  }

  function mount() {
    if (state.mounted) return;
    const doc = getDoc();
    if (!doc || typeof doc.querySelector !== 'function') return;
    state.mounted = true;

    try {
      ensureSkipLink(doc);
      ensureMainId(doc);
      ensureLiveRegion(doc);
      markRoot(doc);
      bindKeydown(doc);
      bindAnnouncements(doc);
    } catch {
      /* mount is best-effort — an a11y helper must never blank the page */
    }
  }

  return { mount };
}
