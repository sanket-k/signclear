/**
 * main.js — app orchestrator (lane w9). Builds the single `Ctx` from
 * docs/ui-wiring-contract.md §2, boots the first audit from ./api.js and mounts
 * every UI factory per §4/§5. Vanilla ES2020, no dependencies, browser only.
 */

import { render } from './renderer.js';
import { createPlayer } from './audio-sync.js';
import { createAsk, bindHoldToAsk } from './ask.js';
import { ingestFile, createStepper, createRun } from './ingest.js';
import { renderNegotiate } from './negotiate.js';
import { loadAudit, fetchAudit } from './api.js';
import { createToast } from './ui/toast.js';
import { createTheme } from './ui/theme.js';
import { createLang } from './ui/lang.js';
import { createTabs } from './ui/tabs.js';
import { createQr } from './ui/qr.js';
import { createPresets } from './ui/presets.js';
import { createVault } from './vault.js';
import { createPii } from './ui/pii.js';
import { createOffline } from './ui/offline.js';
import { createA11y } from './ui/a11y.js';
import { createInstall } from './ui/install.js';
import { createBriefAction } from './ui/brief-action.js';
import { createCopyButton } from './ui/copy.js';
import { createErrorBoundary } from './ui/errorboundary.js';
import { createSelfTest } from './ui/selftest.js';

const LANGS = ['kn', 'hi', 'ta', 'en'];
const DEFAULT_LANG = 'en';
const FIRST_PRESET = 'blr-rental';

function log(scope, err) {
  // Never blank the page: a failed subsystem is reported, not thrown.
  console.error(`[main] ${scope} failed`, err);
}

function storedLang() {
  try {
    const value = globalThis.localStorage ? globalThis.localStorage['sc.lang'] : null;
    if (LANGS.includes(value)) return value;
  } catch (err) {
    void err;
  }
  return DEFAULT_LANG;
}

function persistLang(code) {
  try {
    if (globalThis.localStorage) globalThis.localStorage['sc.lang'] = code;
  } catch (err) {
    void err;
  }
}

function boot() {
  const doc = document;
  const shell = doc.querySelector('.app-shell');
  const toastCtl = createToast();
  const stepper = createStepper(shell || doc);

  const state = { audit: null, lang: storedLang() };
  let player = null;
  let ask = null;
  let run = null;
  let offline = null;

  const emit = (name, detail) => {
    try {
      if (shell) shell.dispatchEvent(new CustomEvent(`sc:${name}`, { detail }));
    } catch (err) {
      log(`emit:${name}`, err);
    }
  };

  const applyLangPill = (code) => {
    const pill = doc.querySelector('.lang-pill');
    if (pill) pill.dataset.lang = code;
    for (const btn of doc.querySelectorAll('[data-lang-opt]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.langOpt === code));
    }
    if (doc.documentElement) doc.documentElement.lang = code;
  };

  const makePlayer = () => {
    if (!state.audit) return;
    try {
      player?.stop?.();
    } catch (err) {
      log('player:stop', err);
    }
    try {
      player = createPlayer(doc, state.audit, { language: state.lang });
    } catch (err) {
      player = null;
      log('player:create', err);
    }
  };

  const bindHold = () => {
    const current = doc.querySelector('[data-holdask]');
    if (!current || !state.audit) return;
    try {
      let button = current;
      const host = current.parentNode;
      if (host) {
        button = current.cloneNode(true);
        host.replaceChild(button, current);
      }
      bindHoldToAsk(button, shell, state.audit, {
        language: state.lang,
        onStage: (stage) => {
          try {
            stepper.stage(stage);
          } catch (err) {
            log('holdask:stage', err);
          }
        },
      });
    } catch (err) {
      log('holdask:bind', err);
    }
  };

  const setAudit = (audit) => {
    if (!audit) return;
    state.audit = audit;
    ask = null;
    try {
      render(audit);
    } catch (err) {
      log('render', err);
    }
    try {
      renderNegotiate(audit, doc);
    } catch (err) {
      log('renderNegotiate', err);
    }
    makePlayer();
    bindHold();
    emit('audit', audit);
  };

  const setLang = (code) => {
    if (!LANGS.includes(code)) return;
    state.lang = code;
    persistLang(code);
    if (state.audit) {
      try {
        setAudit({ ...state.audit, language: code });
      } catch (err) {
        log('lang:setAudit', err);
      }
    }
    applyLangPill(code);
    emit('lang', code);
  };

  const ctx = {
    doc,
    shell,
    getAudit: () => state.audit,
    setAudit,
    getLang: () => state.lang,
    setLang,
    toast: (msg, tone) => toastCtl.show(msg, tone),
    emit,
    on: (name, fn) => {
      if (!shell) return;
      shell.addEventListener(`sc:${name}`, (event) => {
        try {
          fn(event.detail);
        } catch (err) {
          log(`on:${name}`, err);
        }
      });
    },
    loadPreset: async (id) => {
      const result = await loadAudit({ presetId: id, language: state.lang });
      setAudit(result.audit);
      if (shell) shell.dataset.offline = String(!!result.offline);
      try {
        offline?.set?.(!!result.offline);
      } catch (err) {
        log('offline:set', err);
      }
      return { offline: result.offline };
    },
  };

  const drawer = doc.querySelector('.ask-drawer');
  const fab = doc.querySelector('[data-ask-fab]');

  const getAsk = () => {
    if (!state.audit) return null;
    if (!ask) {
      try {
        ask = createAsk(doc.querySelector('.app-shell'), state.audit, {
          language: state.lang,
          onStage: (stage) => {
            try {
              stepper.stage(stage);
            } catch (err) {
              log('ask:stage', err);
            }
          },
        });
      } catch (err) {
        ask = null;
        log('ask:create', err);
        return null;
      }
    }
    return ask;
  };

  const setDrawer = (open) => {
    if (drawer) {
      drawer.dataset.open = String(!!open);
      drawer.setAttribute('aria-hidden', String(!open));
    }
    if (fab) fab.setAttribute('aria-expanded', String(!!open));
    if (open) getAsk();
  };

  fab?.addEventListener('click', () => setDrawer(drawer?.dataset.open !== 'true'));
  doc.querySelector('[data-ask-close]')?.addEventListener('click', () => setDrawer(false));

  const askForm = doc.querySelector('[data-ask-form]');
  askForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = askForm.querySelector('.ask-input') || askForm.querySelector('textarea');
    const value = (input?.value || '').trim();
    if (!value) return;
    try {
      getAsk()?.askText(value);
    } catch (err) {
      log('ask:submit', err);
    }
    if (input) input.value = '';
  });

  doc.querySelector('[data-play60]')?.addEventListener('click', () => {
    if (!state.audit || !player) return;
    try {
      player.play();
    } catch (err) {
      log('player:play', err);
    }
  });

  const camera = doc.querySelector('[data-camera-input]');
  const cancelStepper = doc.querySelector('[data-stepper-cancel]');

  const setCancelVisible = (visible) => {
    if (cancelStepper) cancelStepper.hidden = !visible;
  };

  cancelStepper?.addEventListener('click', () => {
    try {
      run?.cancel();
    } catch (err) {
      log('ingest:abort', err);
    }
    try {
      stepper.cancel();
    } catch (err) {
      log('stepper:cancel', err);
    }
    setCancelVisible(false);
  });

  camera?.addEventListener('change', async () => {
    const file = camera.files?.[0];
    if (!file) return;
    run = createRun();
    setCancelVisible(true);
    try {
      const result = await ingestFile(file, {
        signal: run.signal,
        onStage: (stage) => stepper.stage(stage),
        onCount: (name, value) => stepper.count(name, value),
      });
      const pages = Array.isArray(result?.pages) ? result.pages : [];
      let next = null;
      if (pages.length) {
        stepper.stage('ground');
        try {
          next = await fetchAudit({
            pages,
            text: result?.text,
            doc_type: result?.docType || 'residential_rental',
            language: state.lang,
            signal: run.signal,
          });
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          log('ingest:audit', err);
        }
      }
      stepper.stage('speak');
      setAudit(next || state.audit);
      stepper.finish();
    } catch (err) {
      stepper.cancel();
      if (err?.name !== 'AbortError') log('ingest', err);
    } finally {
      setCancelVisible(false);
      try {
        camera.value = '';
      } catch (err) {
        void err;
      }
    }
  });

  applyLangPill(state.lang);

  // Constructed once so `set()` can be driven from the load path and `mount()`
  // from mountAll(); a factory that throws degrades to a no-op.
  const safeFactory = (factory, label) => {
    try {
      return factory(ctx);
    } catch (err) {
      log(`create:${label}`, err);
      return null;
    }
  };
  const offlineInstance = safeFactory(createOffline, 'createOffline');
  offline = offlineInstance;

  const mountAll = () => {
    const factories = [
      createErrorBoundary,
      createTheme,
      createLang,
      createTabs,
      createQr,
      createVault,
      createPresets,
      createPii,
      createA11y,
      createInstall,
      createBriefAction,
      createCopyButton,
      createSelfTest,
    ];
    for (const factory of factories) {
      try {
        factory(ctx)?.mount?.();
      } catch (err) {
        log(`mount:${factory.name}`, err);
      }
    }
    try {
      offline?.mount?.();
    } catch (err) {
      log('mount:offline', err);
    }
  };

  const start = async () => {
    try {
      const result = await loadAudit({ presetId: FIRST_PRESET, language: state.lang });
      setAudit(result.audit);
      if (shell) shell.dataset.offline = String(!!result.offline);
      try {
        offline?.set?.(!!result.offline);
      } catch (err) {
        log('offline:set', err);
      }
      if (result.offline) toastCtl.show('Offline sample', 'warn');
    } catch (err) {
      log('boot:loadAudit', err);
    }
    mountAll();
  };

  return start();
}

function launch() {
  try {
    const started = boot();
    if (started && typeof started.catch === 'function') {
      started.catch((err) => log('boot', err));
    }
  } catch (err) {
    log('boot', err);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', launch, { once: true });
  } else {
    launch();
  }
}
