// ─── ui/qr.js — Mobile QR modal (§8.1 of DESIGN_SYSTEM.md) ───────────────────
// Owns: [data-qr-open], [data-qr-close], #qr-dialog, [data-qr-url], [data-qr-copy],
//       and a real QR rendered into .qr-img from the vendored UMD lib
//       public/lib/qrcode.min.js (global `qrcode`).
//
// Contract: docs/ui-wiring-contract.md §3 (factory), §4 (qr hooks), §6 (vendored
// UMD loading). Never a top-level ESM import of the UMD file; it is injected as a
// <script> exactly once and awaited with a 2000ms ceiling. If it fails, the
// placeholder SVG in index.html is left untouched — the modal still works.
//
// Node-safe: no top-level DOM access, everything guarded by typeof checks.

/** @typedef {{ toast?: (msg: string, tone?: 'ok'|'warn') => void, doc?: Document }} QrCtx */

const LIB_SRC = "./lib/qrcode.min.js";
const LIB_TIMEOUT_MS = 2000;
const LIB_SCRIPT_ATTR = "data-qr-lib";

// Await the vendored lib at most once per page, no matter how many createQr()
// instances exist (module-level, so a second mount() reuses the same promise).
let libPromise = null;

function getDoc(ctx) {
  if (ctx && ctx.doc) return ctx.doc;
  return typeof document !== "undefined" && document ? document : null;
}

function getWin() {
  return typeof window !== "undefined" && window ? window : null;
}

/** location.origin + location.pathname, or '' when there is no location. */
function currentUrl() {
  try {
    if (typeof location === "undefined" || !location) return "";
    const origin = typeof location.origin === "string" ? location.origin : "";
    const path = typeof location.pathname === "string" ? location.pathname : "";
    return origin + path;
  } catch {
    return "";
  }
}

/**
 * Inject <script src="./lib/qrcode.min.js"> once (guarding window.qrcode) and
 * resolve with the global `qrcode` factory, or null on error / 2s timeout.
 * @returns {Promise<Function|null>}
 */
function loadQrLib(doc) {
  const win = getWin();
  if (!win || typeof win.qrcode === "function") {
    return Promise.resolve(typeof win?.qrcode === "function" ? win.qrcode : null);
  }
  if (libPromise) return libPromise;

  libPromise = new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        try {
          clearTimeout(timer);
        } catch {
          /* ignore */
        }
        timer = null;
      }
      resolve(typeof value === "function" ? value : null);
    };

    // The lib may already be on the page (injected elsewhere) — reuse it.
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
      script.addEventListener("load", () => finish(win.qrcode));
      script.addEventListener("error", () => finish(null));
    } catch {
      finish(null);
      return;
    }

    // The lib may have landed between the guard above and the listener attach.
    if (typeof win.qrcode === "function") {
      finish(win.qrcode);
      return;
    }

    // Ceiling: after 2s give up and keep the placeholder SVG.
    try {
      timer = setTimeout(() => finish(win.qrcode), LIB_TIMEOUT_MS);
    } catch {
      finish(win.qrcode);
    }
  });

  return libPromise;
}

/**
 * Build a data URI for `text` using the vendored lib.
 * Prefers createSvgTag() (crisp at any --qr-size), falls back to the lib's
 * GIF createDataURL()/createImgTag() output.
 */
function buildQrDataUri(lib, text) {
  if (typeof lib !== "function" || !text) return "";

  let code = null;
  try {
    // typeNumber 0 => the lib auto-detects the smallest version that fits.
    code = lib(0, "M");
    code.addData(text);
    code.make();
  } catch {
    return "";
  }

  // 1) SVG data URI — scalable, no raster quiet-zone seams.
  try {
    if (typeof code.createSvgTag === "function") {
      const svg = code.createSvgTag({
        cellSize: 4,
        margin: 16,
        scalable: true,
        alt: "QR code to open SignClear on your phone",
      });
      if (svg) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
  } catch {
    /* fall through to the raster path */
  }

  // 2) The lib's own GIF data URL.
  try {
    if (typeof code.createDataURL === "function") {
      const uri = code.createDataURL(4, 16);
      if (uri) return uri;
    }
  } catch {
    /* fall through */
  }

  return "";
}

/**
 * Swap the placeholder `.qr-img` for a generated <img class="qr-img">.
 * Returns true when the DOM was updated.
 */
function paintQr(doc, lib, url) {
  if (!doc || typeof lib !== "function" || !url) return false;

  const existing =
    doc.querySelector("#qr-dialog .qr-img") || doc.querySelector(".qr-img");
  if (!existing) return false;

  const dataUri = buildQrDataUri(lib, url);
  if (!dataUri) return false;

  try {
    const img = doc.createElement("img");
    img.className = "qr-img";
    img.src = dataUri;
    img.alt = "QR code to open SignClear on your phone";
    img.setAttribute("role", "img");
    img.setAttribute("decoding", "async");

    const parent = existing.parentNode;
    if (parent && typeof parent.replaceChild === "function") {
      parent.replaceChild(img, existing);
      return true;
    }
    if (typeof existing.replaceWith === "function") {
      existing.replaceWith(img);
      return true;
    }
  } catch {
    /* keep the placeholder */
  }
  return false;
}

/**
 * @param {QrCtx} ctx
 * @returns {{ mount: () => void }}
 */
export function createQr(ctx) {
  const doc = getDoc(ctx);
  const state = { mounted: false, rendered: false };

  function setUrlText() {
    const url = currentUrl();
    if (!url) return url;
    let node = null;
    try {
      node = doc.querySelector("[data-qr-url]");
    } catch {
      node = null;
    }
    if (node) node.textContent = url;
    return url;
  }

  function openDialog(dialog) {
    if (!dialog) return;
    try {
      if (dialog.open) return;
    } catch {
      /* ignore */
    }
    try {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
        return;
      }
    } catch {
      /* fall through to the attribute fallback */
    }
    try {
      dialog.setAttribute("open", "");
    } catch {
      /* nothing else we can do */
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    try {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    } catch {
      try {
        dialog.removeAttribute("open");
      } catch {
        /* ignore */
      }
    }
  }

  async function copyUrl() {
    const url = currentUrl() || setUrlText() || "";
    try {
      if (
        url &&
        typeof navigator !== "undefined" &&
        navigator &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* clipboard can reject on insecure origins / denied permission */
    }
    try {
      ctx?.toast?.("Link copied");
    } catch {
      /* toast is best-effort */
    }
  }

  function mount() {
    if (state.mounted) return;
    if (!doc || typeof doc.querySelector !== "function") return;
    state.mounted = true;

    // URL readout is static copy + location — no audit values, no escaping needed.
    const url = setUrlText();

    // Real QR: async, best-effort. The placeholder SVG stays on failure/timeout.
    if (!state.rendered && url) {
      loadQrLib(doc)
        .then((lib) => {
          if (!lib || state.rendered) return;
          state.rendered = paintQr(doc, lib, currentUrl() || url);
        })
        .catch(() => {
          /* keep the placeholder */
        });
    }

    // Click delegation keeps this to one listener and survives re-renders.
    try {
      doc.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;

        if (target.closest("[data-qr-open]")) {
          setUrlText();
          openDialog(doc.querySelector("#qr-dialog"));
          return;
        }

        if (target.closest("[data-qr-close]")) {
          closeDialog(doc.querySelector("#qr-dialog"));
          return;
        }

        if (target.closest("[data-qr-copy]")) {
          copyUrl();
          return;
        }

        // Backdrop click: the platform reports a click on the <dialog> element
        // itself (its ::backdrop has no separate node) — close, but only if the
        // dialog is actually the open modal.
        const dialog = doc.querySelector("#qr-dialog");
        if (!dialog) return;
        if (target !== dialog) return;
        let isOpen = false;
        try {
          isOpen = dialog.open === true || dialog.hasAttribute("open");
        } catch {
          isOpen = false;
        }
        if (isOpen) closeDialog(dialog);
      });
    } catch {
      /* no addEventListener — nothing to wire */
    }

    // A cancelled (Escape) native dialog is already handled by the platform.
  }

  return { mount };
}
