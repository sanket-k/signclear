// ui/brief-action.js — mounts the "Pre-Sign Brief (PDF)" button into the Negotiate
// panel and exports the current audit + ticked asks via ../brief.js (vendored jsPDF).

const LIB_SRC = "./lib/jspdf.umd.min.js";
const LIB_TIMEOUT_MS = 4000;
const LIB_SCRIPT_ATTR = "data-brief-lib";
const BUTTON_CLASS = "btn-brief";
const BUTTON_TEXT = "Pre-Sign Brief (PDF)";

let libPromise = null;

function getDoc(ctx) {
  if (ctx && ctx.doc) return ctx.doc;
  return typeof document !== "undefined" && document ? document : null;
}

function jsPdfCtor() {
  try {
    return globalThis.jspdf?.jsPDF || globalThis.jsPDF || null;
  } catch {
    return null;
  }
}

function loadJsPdf(doc) {
  const ready = jsPdfCtor();
  if (ready) return Promise.resolve(ready);
  if (!doc || typeof doc.createElement !== "function") return Promise.resolve(null);
  if (libPromise) return libPromise;

  libPromise = new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!value) libPromise = null;
      resolve(value || null);
    };

    let script = null;
    try {
      script = doc.querySelector(`script[${LIB_SCRIPT_ATTR}]`);
    } catch {
      script = null;
    }

    if (!script) {
      try {
        script = doc.createElement("script");
        script.src = LIB_SRC;
        script.async = true;
        script.defer = true;
        script.setAttribute(LIB_SCRIPT_ATTR, "");
        (doc.head || doc.body || doc.documentElement).appendChild(script);
      } catch {
        finish(null);
        return;
      }
    }

    try {
      script.addEventListener("load", () => finish(jsPdfCtor()));
      script.addEventListener("error", () => finish(null));
    } catch {
      finish(null);
      return;
    }

    const landed = jsPdfCtor();
    if (landed) {
      finish(landed);
      return;
    }

    try {
      timer = setTimeout(() => finish(jsPdfCtor()), LIB_TIMEOUT_MS);
    } catch {
      finish(jsPdfCtor());
    }
  });

  return libPromise;
}

function selectedRuleIds(doc) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const ids = [];
  let rows = [];
  try {
    rows = doc.querySelectorAll('.ask-checkbox[data-rule-id][aria-checked="true"]');
  } catch {
    rows = [];
  }
  for (const row of rows) {
    const id = row && typeof row.getAttribute === "function" ? row.getAttribute("data-rule-id") : "";
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function createBriefAction(ctx) {
  const doc = getDoc(ctx);
  const state = { mounted: false };

  function notify(msg, tone) {
    try {
      ctx?.toast?.(msg, tone);
    } catch {
      void 0;
    }
  }

  function ensureButton() {
    if (!doc || typeof doc.querySelector !== "function") return null;
    let host = null;
    try {
      host = doc.querySelector('[data-slot="negotiate"]');
    } catch {
      host = null;
    }
    if (!host || typeof host.appendChild !== "function") return null;

    let existing = null;
    try {
      existing = host.querySelector(`.${BUTTON_CLASS}`);
    } catch {
      existing = null;
    }
    if (existing) return existing;

    try {
      const button = doc.createElement("button");
      button.className = BUTTON_CLASS;
      button.type = "button";
      button.textContent = BUTTON_TEXT;
      host.appendChild(button);
      return button;
    } catch {
      return null;
    }
  }

  async function run() {
    try {
      const JsPDF = await loadJsPdf(doc);
      if (!JsPDF) throw new Error("jspdf_unavailable");
      const audit = typeof ctx?.getAudit === "function" ? ctx.getAudit() : null;
      if (!audit) throw new Error("audit_unavailable");
      const { exportBrief } = await import("../brief.js");
      await exportBrief(audit, selectedRuleIds(doc));
      notify("Brief ready", "ok");
    } catch {
      notify("Brief unavailable", "warn");
    }
  }

  function onClick(event) {
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return;
    let button = null;
    try {
      button = target.closest(`.${BUTTON_CLASS}`);
    } catch {
      button = null;
    }
    if (!button) return;
    run();
  }

  function mount() {
    if (!doc || typeof doc.querySelector !== "function") return;
    ensureButton();
    if (state.mounted) return;
    state.mounted = true;
    try {
      doc.addEventListener("click", onClick);
      ctx?.on?.("audit", ensureButton);
    } catch {
      void 0;
    }
  }

  return { mount };
}
