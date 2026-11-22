/* Toast — the .toast live region (ui-wiring-contract §4, DESIGN_SYSTEM §8.3). */
const HIDE_MS = 2200;
const REANNOUNCE_GAP_MS = 40;

export function createToast(root) {
  if (typeof document === 'undefined') {
    return { show() {} };
  }

  const scope = root && typeof root.querySelector === 'function' ? root : document;
  const el = scope.querySelector('.toast') || null;
  const textEl = el ? el.querySelector('[data-toast-text]') : null;

  let hideTimer = null;
  let clearTimer = null;
  let restoreTimer = null;

  function clear(timer) {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  function show(msg, tone) {
    if (!el) return;

    hideTimer = clear(hideTimer);
    clearTimer = clear(clearTimer);
    restoreTimer = clear(restoreTimer);

    const value = msg === null || msg === undefined ? '' : String(msg);
    const visible = !el.hidden;

    el.dataset.tone = tone || 'ok';

    if (textEl) {
      textEl.textContent = value;
      if (visible) {
        clearTimer = setTimeout(() => {
          clearTimer = null;
          textEl.textContent = '';
          restoreTimer = setTimeout(() => {
            restoreTimer = null;
            textEl.textContent = value;
          }, REANNOUNCE_GAP_MS);
        }, REANNOUNCE_GAP_MS);
      }
    }

    el.hidden = false;

    hideTimer = setTimeout(() => {
      hideTimer = null;
      el.hidden = true;
    }, HIDE_MS);
  }

  return { show };
}
