// SignClear — public/js/ui/errorboundary.js
// Honest render-failure surface. docs/ui-wiring-contract.md §2 (Ctx), §3 (factory shape),
// §7 (DoD) + DESIGN_SYSTEM.md §7.1 (honesty surfaces: role="status", never silent failure).
//
// AGENTS.md guardrail 1 is "zero silent failures": main.js catches boot/render errors and only
// console.errors them, which leaves the user staring at an empty shell with no explanation.
// This module is the missing surface. It renders a `.gap-banner.error-banner` card
// (`role="status"`, `#i-alert`) and marks the shell `data-degraded="true"`.
//
// Guarantees:
//  - `wrap(fn, label)` never throws and never returns a rejected promise: sync throws and async
//    rejections both render the card and resolve to `undefined`.
//  - At most ONE banner exists (dedupe on `[data-error-banner]`); repeat failures increment a
//    counter on that banner instead of stacking cards.
//  - Error text is untrusted-ish, so every node is built with `textContent` — never innerHTML.
//  - No DOM (Node) => inert but fully working wrappers. `mount()`/`wrap()` never throw.

const SHELL_SELECTOR = ".app-shell";
const BANNER_ATTR = "data-error-banner";

const COPY =
  "Something went wrong rendering this part of the report. The rest of the page still works.";
const DETAILS_LABEL = "Details";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Coerce anything thrown into a short, printable message without trusting its shape. */
function messageOf(err) {
  try {
    if (err === null || err === undefined) return "Unknown error";
    if (typeof err === "string") return err;
    if (typeof err === "object") {
      const name = typeof err.name === "string" && err.name ? err.name : "";
      const message = typeof err.message === "string" && err.message ? err.message : "";
      if (name && message) return `${name}: ${message}`;
      if (message) return message;
      const text = String(err);
      return text === "[object Object]" ? "Unknown error" : text;
    }
    return String(err);
  } catch {
    return "Unknown error";
  }
}

export function createErrorBoundary(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};

  let mounted = false;
  let boundWindow = null;
  let rendering = false; // recursion guard: a broken render must not loop the global net

  /** The document, only when one exists. */
  function doc() {
    if (typeof document !== "undefined" && document) return document;
    if (c.doc && typeof c.doc.createElement === "function") return c.doc;
    return null;
  }

  /** Win the banner lives in: `ctx.shell`, else `.app-shell`, else the body. */
  function shellEl() {
    if (c.shell && typeof c.shell.appendChild === "function" && c.shell.dataset) return c.shell;
    const d = doc();
    if (!d || typeof d.querySelector !== "function") return null;
    return d.querySelector(SHELL_SELECTOR) || d.body || null;
  }

  function shellOfBanner(banner) {
    const parent = banner && banner.parentNode;
    if (parent && parent.dataset) return parent;
    return shellEl();
  }

  /** Banner already in the shell (from this instance or a previous mount). */
  function existingBanner(d) {
    const sel = `[${BANNER_ATTR}]`;
    const host = shellEl();
    if (host && typeof host.querySelector === "function") {
      const local = host.querySelector(sel);
      if (local) return local;
    }
    // The banner may live on `.app-shell` while `ctx.shell` points elsewhere (or vice versa).
    if (!d || typeof d.querySelector !== "function") return null;
    return d.querySelector(sel) || null;
  }

  function setDegraded(host, degraded) {
    if (!host || !host.dataset) return;
    if (degraded) host.setAttribute("data-degraded", "true");
    else host.removeAttribute("data-degraded");
  }

  function icon(d) {
    const svg = d.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = d.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-alert");
    svg.appendChild(use);
    return svg;
  }

  /** Build the card from scratch — text nodes only, so the error message can never be markup. */
  function buildBanner(d, label, message) {
    const banner = d.createElement("div");
    banner.className = "gap-banner error-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute(BANNER_ATTR, "");
    banner.setAttribute("data-error-count", "1");

    banner.appendChild(icon(d));

    const body = d.createElement("div");
    body.className = "error-banner-body";

    const text = d.createElement("p");
    text.className = "error-banner-text";
    text.textContent = COPY;

    const count = d.createElement("span");
    count.className = "error-banner-count";
    count.setAttribute("aria-hidden", "true");
    text.appendChild(count);

    const details = d.createElement("details");
    details.className = "error-banner-details";
    const summary = d.createElement("summary");
    summary.textContent = DETAILS_LABEL;
    const code = d.createElement("code");
    code.className = "error-banner-code";
    details.appendChild(summary);
    details.appendChild(code);

    body.appendChild(text);
    body.appendChild(details);
    banner.appendChild(body);

    writeDetail(banner, label, message);
    return banner;
  }

  /** Label + message, verbatim but inert (textContent). */
  function writeDetail(banner, label, message) {
    const code = banner.querySelector(".error-banner-code");
    if (!code) return;
    const name = label === null || label === undefined || label === "" ? "render" : String(label);
    code.textContent = `${name}: ${message}`;
  }

  function writeCount(banner, n) {
    banner.setAttribute("data-error-count", String(n));
    const count = banner.querySelector(".error-banner-count");
    if (!count) return;
    count.textContent = n > 1 ? ` ${n} failed parts.` : "";
  }

  /**
   * Show (or update) the single banner. Returns the banner, or null when there is no DOM.
   * Never throws: this runs inside global error handlers.
   */
  function render(label, message) {
    const d = doc();
    if (!d || typeof d.createElement !== "function") return null; // Node: nothing to surface
    if (rendering) return existingBanner(d);                     // a broken render must not recurse
    rendering = true;
    try {
      const existing = existingBanner(d);
      if (existing) {
        const previous = Number(existing.getAttribute("data-error-count")) || 1;
        writeCount(existing, previous + 1);
        writeDetail(existing, label, message);
        setDegraded(shellOfBanner(existing), true);
        return existing;
      }

      const banner = buildBanner(d, label, message);
      const host = shellEl();
      if (host) {
        /* Place it at the top of the shell: the report below it still works. */
        if (typeof host.prepend === "function") host.prepend(banner);
        else host.appendChild(banner);
        setDegraded(host, true);
      } else if (typeof d.body?.appendChild === "function") {
        d.body.appendChild(banner);
        setDegraded(d.body, true);
      } else {
        return null;
      }
      return banner;
    } catch {
      return null; // the surface itself failing is still silent-safe
    } finally {
      rendering = false;
    }
  }

  function isThenable(value) {
    return !!value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
  }

  /**
   * Wrap `fn` so its failure is reported, not thrown. Sync throws and async rejections both
   * render the card; the wrapper returns `undefined` (async: a promise resolving to `undefined`).
   */
  function wrap(fn, label) {
    const name = label === null || label === undefined || label === "" ? "render" : String(label);
    if (typeof fn !== "function") {
      return function inert() {
        return undefined;
      };
    }

    return function wrapped(...args) {
      let result;
      try {
        result = fn.apply(this, args);
      } catch (err) {
        render(name, messageOf(err));
        return undefined;
      }

      if (isThenable(result)) {
        return Promise.resolve(result).catch((err) => {
          render(name, messageOf(err));
          return undefined;
        });
      }
      return result;
    };
  }

  function onWindowError(event) {
    try {
      const message = messageOf(event && (event.error ?? event.message ?? null));
      render("window.error", message);
    } catch {
      /* the net must never throw */
    }
  }

  function onUnhandledRejection(event) {
    try {
      const reason = event && typeof event === "object" ? event.reason : event;
      render("unhandledrejection", messageOf(reason));
    } catch {
      /* the net must never throw */
    }
  }

  return {
    /**
     * Install the global safety nets. Idempotent per window; a missing window is a no-op so
     * the module stays importable in Node.
     */
    mount() {
      if (typeof window === "undefined" || !window) return;
      if (mounted && boundWindow === window) return;
      if (typeof window.addEventListener !== "function") return;
      boundWindow = window;
      mounted = true;
      window.addEventListener("error", onWindowError);
      window.addEventListener("unhandledrejection", onUnhandledRejection);
    },

    wrap,

    /** Not in the §3 minimum, but handy for callers/tests that want the card directly. */
    render(label, err) {
      return render(label, messageOf(err));
    },
  };
}
