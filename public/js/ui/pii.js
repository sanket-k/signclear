// ─── ui/pii.js — PII shield badge → popover (§7.2, docs/ui-wiring-contract.md §3) ──
// Owns: [data-pii-badge] (click/aria-expanded) and the sibling .pii-popover[data-pii-type]
// `hidden` attribute. renderer.js only paints the badge, so the disclosure is bound here.
// Delegated on document so it survives every render(audit) repaint; attributes only.

let bound = false;

function getDoc(ctx) {
  if (ctx && ctx.doc && typeof ctx.doc.querySelector === "function") return ctx.doc;
  return typeof document !== "undefined" && document ? document : null;
}

function popoverFor(doc, badge) {
  let node = null;
  try {
    const intake = badge.closest && badge.closest(".intake");
    node = (intake && intake.querySelector && intake.querySelector(".pii-popover")) || null;
  } catch {
    node = null;
  }
  if (node) return node;
  try {
    return (doc && doc.querySelector && doc.querySelector(".pii-popover")) || null;
  } catch {
    return null;
  }
}

function setOpen(badge, popover, open) {
  try {
    if (open) popover.removeAttribute("hidden");
    else popover.setAttribute("hidden", "");
  } catch {
    /* detached node — nothing to paint */
  }
  try {
    badge.setAttribute("aria-expanded", open ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ doc?: Document }} ctx
 * @returns {{ mount: () => void }}
 */
export function createPii(ctx) {
  const state = { open: null, badge: null };

  function close() {
    if (!state.open || !state.badge) {
      state.open = null;
      state.badge = null;
      return;
    }
    setOpen(state.badge, state.open, false);
    state.open = null;
    state.badge = null;
  }

  function onBadgeClick(doc, badge) {
    const popover = popoverFor(doc, badge);
    if (!popover) return;

    let blocked = false;
    try {
      blocked = badge.getAttribute("data-state") === "blocked";
    } catch {
      blocked = false;
    }

    if (blocked) {
      if (state.open === popover) close();
      else setOpen(badge, popover, false);
      return;
    }

    if (state.open === popover) {
      close();
      return;
    }

    close();
    state.open = popover;
    state.badge = badge;
    setOpen(badge, popover, true);
  }

  function mount() {
    if (bound) return;
    const doc = getDoc(ctx);
    if (!doc || typeof doc.addEventListener !== "function") return;
    bound = true;

    try {
      doc.addEventListener("click", (event) => {
        const target = event && event.target;
        if (!target || typeof target.closest !== "function") return;

        const badge = target.closest("[data-pii-badge]");
        if (badge) {
          onBadgeClick(doc, badge);
          return;
        }

        if (!state.open) return;
        if (state.open.contains && state.open.contains(target)) return;
        if (state.badge && state.badge.contains && state.badge.contains(target)) return;
        close();
      });
    } catch {
      /* no addEventListener — nothing to wire */
    }

    try {
      doc.addEventListener("keydown", (event) => {
        if (!state.open) return;
        if (!event || event.key !== "Escape") return;
        close();
      });
    } catch {
      /* ignore */
    }
  }

  return { mount };
}
