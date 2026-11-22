/**
 * install.js — service worker registration for the offline app shell.
 *
 * Registers ./sw.js once, after the first render, so the network never blocks
 * the 60-second flow. Offline caching is an enhancement: any failure becomes a
 * single warn toast and never propagates to the orchestrator
 * (docs/ui-wiring-contract.md §3 factory shape, §5 boot must not error).
 */

const SW_URL = './sw.js';
const FAIL_MESSAGE = 'Offline caching unavailable';

// Module-level flag — mount() is idempotent across repeated calls (§3).
let mounted = false;

function getNavigator() {
  try {
    return typeof navigator === 'undefined' ? null : navigator;
  } catch {
    return null;
  }
}

function getDocument() {
  try {
    return typeof document === 'undefined' ? null : document;
  } catch {
    return null;
  }
}

function currentProtocol() {
  try {
    if (typeof location !== 'undefined' && location && location.protocol) {
      return location.protocol;
    }
    const doc = getDocument();
    if (doc && doc.location && doc.location.protocol) return doc.location.protocol;
  } catch {
    /* no location (Node, worker scope) — treated as unsupported below */
  }
  return '';
}

function isHttp(protocol) {
  return protocol === 'http:' || protocol === 'https:';
}

export function createInstall(ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  let warned = false;

  function warn() {
    if (warned) return;
    warned = true;
    try {
      if (typeof context.toast === 'function') context.toast(FAIL_MESSAGE, 'warn');
    } catch {
      /* toast is best-effort — a broken toast must not break boot */
    }
  }

  function register(container) {
    try {
      const pending = container.serviceWorker.register(SW_URL);
      if (pending && typeof pending.then === 'function') {
        pending.then(
          function () {
            try {
              console.info('[sw] offline shell registered');
            } catch {
              /* no console — ignore */
            }
          },
          function () {
            warn();
          }
        );
      }
    } catch {
      warn();
    }
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;

      const nav = getNavigator();
      if (!nav) return;
      if (!nav.serviceWorker || typeof nav.serviceWorker.register !== 'function') return;
      if (!getDocument()) return;
      if (!isHttp(currentProtocol())) return;

      register(nav);
    },
  };
}
