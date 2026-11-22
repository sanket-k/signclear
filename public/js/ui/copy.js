/* copy.js — shared clipboard helper: copyText(text) + createCopyButton(ctx) for
   [data-draft-copy]. navigator.clipboard first (insecure contexts throw → caught),
   then a temporary offscreen <textarea> + execCommand('copy'). Never throws;
   resolves false in Node where there is no document/navigator.clipboard. */

const TOAST_OK = 'Draft copied';
const TOAST_WARN = 'Select the text and copy';
const BUTTON_SELECTOR = '[data-draft-copy]';
const WIRED_ATTR = 'data-copy-wired';

function getDoc(ctx) {
  if (ctx && ctx.doc) return ctx.doc;
  return typeof document !== 'undefined' && document ? document : null;
}

function toText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

function clipboardAvailable() {
  try {
    if (typeof navigator === 'undefined' || !navigator) return false;
    if (typeof window !== 'undefined' && window && window.isSecureContext === false) return false;
    return !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function';
  } catch {
    return false;
  }
}

function textareaCopy(doc, text) {
  let area = null;
  try {
    area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.left = '-9999px';
    area.style.opacity = '0';
    (doc.body || doc.documentElement).appendChild(area);
    area.focus();
    area.select();
    try {
      area.setSelectionRange(0, text.length);
    } catch {
      /* selection already covers the value */
    }
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    return ok === true;
  } catch {
    return false;
  } finally {
    try {
      if (area && area.parentNode) area.parentNode.removeChild(area);
    } catch {
      /* orphaned node is harmless */
    }
  }
}

/**
 * @param {string} text
 * @returns {Promise<boolean>} true when the text reached the clipboard
 */
export async function copyText(text) {
  const value = toText(text);

  if (clipboardAvailable()) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* insecure origin or denied permission — fall through */
    }
  }

  if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function') {
    return false;
  }

  return textareaCopy(document, value);
}

/**
 * @param {{ toast?: (msg: string, tone?: 'ok'|'warn') => void, doc?: Document }} [ctx]
 * @returns {{ mount: () => void }}
 */
export function createCopyButton(ctx) {
  const doc = getDoc(ctx);
  const state = { mounted: false };

  function draftText() {
    if (!doc || typeof doc.querySelector !== 'function') return '';
    try {
      const preview = doc.querySelector('.draft-preview');
      const previewText = preview ? toText(preview.textContent) : '';
      if (previewText.trim()) return previewText;
      const fallback = doc.querySelector('[data-draft-fallback]');
      const fallbackValue = fallback ? toText(fallback.value) : '';
      return fallbackValue.trim() ? fallbackValue : previewText;
    } catch {
      return '';
    }
  }

  async function onCopyClick() {
    let ok = false;
    try {
      ok = await copyText(draftText());
    } catch {
      ok = false;
    }
    try {
      if (ok) ctx?.toast?.(TOAST_OK);
      else ctx?.toast?.(TOAST_WARN, 'warn');
    } catch {
      /* toast is best-effort */
    }
  }

  function mount() {
    if (state.mounted) return;
    if (!doc || typeof doc.addEventListener !== 'function') return;
    state.mounted = true;

    try {
      const button = doc.querySelector(BUTTON_SELECTOR);
      if (button && typeof button.setAttribute === 'function') button.setAttribute(WIRED_ATTR, 'true');
    } catch {
      /* the button may not be rendered yet — the delegated click still works */
    }

    try {
      doc.addEventListener('click', (event) => {
        const target = event ? event.target : null;
        if (!target || typeof target.closest !== 'function') return;
        if (!target.closest(BUTTON_SELECTOR)) return;
        onCopyClick();
      });
    } catch {
      /* no listener — nothing to wire */
    }
  }

  return { mount };
}
