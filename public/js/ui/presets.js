// SignClear — public/js/ui/presets.js
// Sample-agreement chips. docs/ui-wiring-contract.md §3 (factory shape) + §4 (DOM hooks).
//
// Owns: `.preset-chip[data-preset]` with `aria-pressed` (exactly one active),
// click -> ctx.loadPreset(id), and `.app-shell[data-offline]` from the loader result.
// No imports, no global state, no throw when elements or the DOM are absent.

const CHIP_SELECTOR = ".preset-chip[data-preset]";
const SHELL_SELECTOR = ".app-shell";

export function createPresets(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const doc = typeof document !== "undefined" ? c.doc || document : null;

  let mounted = false;
  let loading = false;

  function root() {
    return doc || null;
  }

  function chipList() {
    const d = root();
    if (!d || typeof d.querySelectorAll !== "function") return [];
    return Array.from(d.querySelectorAll(CHIP_SELECTOR));
  }

  /** `.app-shell`, found once lazily so a late-mounted shell still works. */
  function shellEl() {
    if (c.shell && c.shell.dataset) return c.shell;
    const d = root();
    if (!d || typeof d.querySelector !== "function") return null;
    return d.querySelector(SHELL_SELECTOR) || null;
  }

  function setOffline(offline) {
    const shell = shellEl();
    if (shell && shell.dataset) shell.dataset.offline = offline ? "true" : "false";
  }

  function setPressed(activeChip) {
    for (const chip of chipList()) {
      const active = chip === activeChip;
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }

  function activeChip() {
    return chipList().find((chip) => chip.getAttribute("aria-pressed") === "true") || null;
  }

  function setChipState(chip, state) {
    if (!chip || !chip.dataset) return;
    if (state) chip.dataset.state = state;
    else delete chip.dataset.state;
  }

  function toast(message, tone) {
    if (typeof c.toast === "function") {
      try {
        c.toast(message, tone);
      } catch {
        /* a broken toast must not break preset switching */
      }
    }
  }

  function emit(name, detail) {
    if (typeof c.emit === "function") {
      try {
        c.emit(name, detail);
      } catch {
        /* ignore */
      }
    }
  }

  async function activate(chip) {
    const id = chip && chip.dataset ? chip.dataset.preset : null;
    if (!id) return;

    setPressed(chip);
    setChipState(chip, "loading");

    if (typeof c.loadPreset !== "function") {
      setChipState(chip, null);
      return;
    }

    let result;
    try {
      result = await c.loadPreset(id);
    } catch {
      result = { offline: true };
    } finally {
      setChipState(chip, null);
    }

    const offline = !!(result && typeof result === "object" && result.offline);
    setOffline(offline);
    if (offline) toast("Offline sample", "warn");
    emit("preset", { presetId: id, offline });
  }

  async function onClick(event) {
    if (loading) return;
    const target = event && event.target;
    if (!target || typeof target.closest !== "function") return;
    const chip = target.closest(CHIP_SELECTOR);
    if (!chip) return;
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    loading = true;
    try {
      await activate(chip);
    } finally {
      loading = false;
    }
  }

  return {
    mount() {
      if (mounted) return;
      const d = root();
      if (!d || typeof d.addEventListener !== "function") return; // no DOM: stay inert
      mounted = true;

      // Normalise the initial state: exactly one chip pressed.
      const chips = chipList();
      if (chips.length) {
        const current = activeChip();
        setPressed(current || chips[0]);
      }

      // One delegated listener on the document: resilient to re-rendered chips.
      d.addEventListener("click", onClick);
    },
  };
}
