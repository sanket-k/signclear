// ui/lang.js — language pill (contract §2/§4): resolve kn|hi|ta|en from sc.lang → audit, persist, sync aria-pressed.

const LANGS = ["kn", "hi", "ta", "en"];
const KEY = "sc.lang";
const VALID = new Set(LANGS);

function docRef() {
  return typeof document !== "undefined" && document ? document : null;
}

function readStore() {
  if (typeof localStorage === "undefined" || !localStorage) return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeStore(code) {
  if (typeof localStorage === "undefined" || !localStorage) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {}
}

function readAuditLang(ctx) {
  try {
    const audit = typeof ctx?.getAudit === "function" ? ctx.getAudit() : null;
    return audit && VALID.has(audit.language) ? audit.language : null;
  } catch {
    return null;
  }
}

export function createLang(ctx) {
  let mounted = false;

  const pills = () => {
    const d = docRef();
    return d ? Array.from(d.querySelectorAll(".lang-pill[data-lang]")) : [];
  };

  const options = () => {
    const d = docRef();
    if (!d) return [];
    return Array.from(d.querySelectorAll("[data-lang-opt]")).filter((el) =>
      VALID.has(el.getAttribute("data-lang-opt") || "")
    );
  };

  function apply(code) {
    const value = VALID.has(code) ? code : "en";
    for (const pill of pills()) pill.setAttribute("data-lang", value);
    for (const btn of options()) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-lang-opt") === value ? "true" : "false");
    }
    return value;
  }

  function initial() {
    const stored = readStore();
    if (stored && VALID.has(stored)) return stored;
    return readAuditLang(ctx) || "en";
  }

  function choose(code) {
    const value = VALID.has(code) ? code : "en";
    if (typeof ctx?.setLang === "function") {
      try {
        ctx.setLang(value);
      } catch {}
    }
    apply(value);
    writeStore(value);
  }

  function onClick(event) {
    const target = event ? event.target : null;
    const btn = target && typeof target.closest === "function" ? target.closest("[data-lang-opt]") : null;
    if (!btn) return;
    const code = btn.getAttribute("data-lang-opt");
    if (!VALID.has(code || "")) return;
    choose(code);
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      apply(initial());
      const d = docRef();
      if (!d || typeof d.addEventListener !== "function") return;
      d.addEventListener("click", onClick);
    },
  };
}
