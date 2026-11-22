// SignClear — public/js/ui/offline.js
// Persistent offline-sample banner (DESIGN_SYSTEM §7.1, docs/ui-wiring-contract.md §2/§3/§7).

const BANNER_SELECTOR = "[data-offline-banner]";
const SHELL_SELECTOR = ".app-shell";
const INTAKE_SELECTOR = ".intake";
const SVG_NS = "http://www.w3.org/2000/svg";
const TEXT =
  "Sample report. The live audit service is unreachable, so this is the offline fixture for this agreement.";

export function createOffline(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const doc = c.doc || (typeof document !== "undefined" ? document : null);

  let mounted = false;
  let banner = null;

  function shellEl() {
    if (c.shell && c.shell.dataset) return c.shell;
    if (!doc || typeof doc.querySelector !== "function") return null;
    return doc.querySelector(SHELL_SELECTOR) || null;
  }

  function findBanner() {
    if (!doc || typeof doc.querySelector !== "function") return null;
    return doc.querySelector(BANNER_SELECTOR) || null;
  }

  function iconNode() {
    if (!doc || typeof doc.createElementNS !== "function") return null;
    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const use = doc.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-caution");
    svg.appendChild(use);
    return svg;
  }

  function buildBanner() {
    if (!doc || typeof doc.createElement !== "function") return null;
    const el = doc.createElement("div");
    el.className = "gap-banner offline-banner";
    el.setAttribute("role", "status");
    el.setAttribute("data-offline-banner", "");
    el.hidden = true;

    const icon = iconNode();
    if (icon) el.appendChild(icon);

    const body = doc.createElement("div");
    body.className = "gap-banner-body";
    const p = doc.createElement("p");
    p.textContent = TEXT;
    body.appendChild(p);
    el.appendChild(body);

    return el;
  }

  function attach(el) {
    if (!el) return null;
    const shell = shellEl();
    if (shell && typeof shell.insertBefore === "function") {
      if (shell.firstChild !== el) shell.insertBefore(el, shell.firstChild);
      return el;
    }
    const intake =
      doc && typeof doc.querySelector === "function" ? doc.querySelector(INTAKE_SELECTOR) : null;
    if (intake && intake.parentNode) {
      intake.parentNode.insertBefore(el, intake);
      return el;
    }
    if (doc && doc.body && typeof doc.body.insertBefore === "function") {
      doc.body.insertBefore(el, doc.body.firstChild);
      return el;
    }
    return el;
  }

  function bannerEl() {
    if (banner && banner.parentNode) return banner;
    const existing = findBanner();
    if (existing) {
      banner = existing;
      return banner;
    }
    const built = buildBanner();
    if (!built) return null;
    banner = attach(built);
    return banner;
  }

  function set(offline) {
    const on = !!offline;
    const shell = shellEl();
    if (shell && shell.dataset) shell.dataset.offline = on ? "true" : "false";
    const el = on ? bannerEl() : banner || findBanner();
    if (!el) return;
    el.hidden = !on;
  }

  return {
    mount() {
      if (mounted) return;
      mounted = true;
      const shell = shellEl();
      const current = shell && shell.dataset ? shell.dataset.offline : null;
      if (current === "true") set(true);
    },
    set,
  };
}
