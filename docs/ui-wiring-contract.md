# UI wiring contract — frozen before parallel wave

> **Why this file exists:** `public/index.html` and `public/styles/app.css` are complete
> (299 HTML lines, 2985 CSS lines, zero literals), and `renderer.js`, `negotiate.js`,
> `audio-sync.js`, `ask.js`, `ingest.js`, `brief.js` all exist and pass tests. What is missing
> is the **orchestrator** (`public/js/main.js` is a 4-line stub) and the small UI modules it
> drives. Ten parallel worktrees build those modules against this interface. They may not
> change it unilaterally — fix this file first, then the modules.

`AGENTS.md` wins every conflict. Zero build. Vanilla ES2020 ESM only. No npm install.

---

## 1. File ownership (one worktree per row — no overlaps, no merge conflicts)

| # | Task | Files it may create | Depends on |
|---|---|---|---|
| 1 | theme | `public/js/ui/theme.js` | — |
| 2 | language pill | `public/js/ui/lang.js` | — |
| 3 | tabs + view switch | `public/js/ui/tabs.js` | — |
| 4 | QR modal | `public/js/ui/qr.js` | — |
| 5 | vault | `public/js/vault.js` | — |
| 6 | toast | `public/js/ui/toast.js` | — |
| 7 | api client + presets | `public/js/api.js`, `public/js/ui/presets.js` | — |
| 8 | app icon (PWA) | `public/icons/icon.svg`, `public/manifest.webmanifest` (icons array only) | — |
| 9 | orchestrator | `public/js/main.js` | contract only |
| 10 | wiring tests | `tests/wiring.test.mjs` | contract only |

Every file above is **new** except `manifset.webmanifest` icons array and `main.js`.
No worktree edits `index.html`, `app.css`, `tokens.css`, `renderer.js`, or any `api/` file.

---

## 2. The `Ctx` object — the only thing a module is given

`main.js` builds exactly one `Ctx` and passes it to every `create*()` factory. Modules never
import a sibling UI module and never read global state directly.

```js
/**
 * @typedef {Object} Ctx
 * @property {Document} doc                     // the document
 * @property {HTMLElement} shell                // .app-shell
 * @property {() => object} getAudit            // current audit_result_v1 (never null after boot)
 * @property {(audit: object) => void} setAudit // store + renderer.render(audit)
 * @property {() => 'kn'|'hi'|'ta'|'en'} getLang
 * @property {(lang: string) => void} setLang    // persist (sc.lang) + re-render + update pill
 * @property {(msg: string, tone?: 'ok'|'warn') => void} toast
 * @property {(name: string, detail?: any) => void} emit  // root.dispatchEvent CustomEvent('sc:'+name)
 * @property {(name: string, fn: (detail:any)=>void) => void} on
 * @property {(id: string) => Promise<void>} loadPreset   // 'blr-rental' etc → audit → setAudit
 */
```

## 3. Every UI module exports one factory

```js
export function createXxx(ctx) { /* wire once */ return { mount() { /* attach listeners */ } }; }
```

- `mount()` is called once by `main.js` after the first render. Idempotent (guard with a flag).
- No module throws if an expected element is absent — return early (`if (!el) return`).
- All DOM text interpolation goes through `escapeHTML` from `./prompt-security.js` when the
  value comes from the audit. Static copy may be literal.
- No `setInterval`. Timers only via `setTimeout`, cleared on `destroy` if exposed.

## 4. DOM hooks each module owns (verbatim from `index.html`)

### theme (`ui/theme.js`)
- `[data-theme-toggle]` — `aria-pressed`; sets `document.documentElement.dataset.theme='dark'|'light'`.
- Persist `localStorage['sc.theme']`; first run honours `matchMedia('(prefers-color-scheme: dark)')`.
  Default light. Must not throw in Node (guard `typeof localStorage`).

### lang (`ui/lang.js`)
- `.lang-pill[data-lang]`, buttons `[data-lang-opt="kn|hi|ta|en"]` with `aria-pressed`.
- Click → `ctx.setLang(code)`; pill `data-lang` and each `aria-pressed` reflect the choice.
- Persist `localStorage['sc.lang']`; default `'en'` (or `ctx.getAudit().language`).

### tabs (`ui/tabs.js`)
- Tabs: `.tab[data-tab="understand|negotiate|document"]`, panels `[data-tab-panel]`,
  `aria-selected`, `aria-controls`. Shell attr `data-active-tab`.
- Full ARIA keyboard: ←/→ cycle, `Home`/`End` jump, `Enter`/`Space` activate.
  `tabindex` roving (`0` on active, `-1` others).
- View switch: `[data-view-opt="report|split|contract"]` `aria-pressed`; sets
  `shell.dataset.view`. On mobile (`<900px`) force `feed`.

### qr (`ui/qr.js`)
- `[data-qr-open]` opens `#qr-dialog` via `showModal()`; `[data-qr-close]` closes.
- Backdrop click (target === dialog) closes. Escape is native.
- `[data-qr-url]` shows `location.origin + location.pathname` in mono.
- `[data-qr-copy]` copies the URL via `navigator.clipboard.writeText` → `ctx.toast('Link copied')`.
- Render a real QR into `.qr-img` using the vendored `public/lib/qrcode.min.js`
  (global `qrcode`) **only if present**; otherwise leave the existing placeholder SVG.
  The lib is UMD loaded by a `<script>` tag main.js injects before use (see §6).

### vault (`public/js/vault.js` — note: NOT under ui/)
- Export `createVault(ctx)` (same factory shape) **and** named helpers
  `saveDoc(record)`, `listDocs()`, `clearDocs()`, `removeDoc(id)`, `KEY = 'sc.vault'`.
- `localStorage['sc.vault']` = JSON array, ≤20KB total, ≤50 docs (drop oldest).
- Record: `{ id, title, note, score, exposure_inr, lang, saved_at }`.
  Never store pages, images, audio, or masked text.
- UI: `[data-vault-open]`/`[data-vault-close]` toggle `#vault-drawer[data-open]` +
  `aria-expanded`/`aria-hidden`; `[data-vault-save]` saves the current audit;
  `[data-vault-clear]` empties; `[data-vault-nosave]` disables saving;
  `[data-vault-list]` renders `.vault-item[data-doc-id]` rows with title + score + delete.
- Guard every `localStorage` access (`typeof localStorage !== 'undefined'`) so Node can import it.

### toast (`ui/toast.js`)
- Export `createToast()` returning `{ show(msg, tone) }` — main.js adapts it to `ctx.toast`.
- `.toast` element, `[data-toast-text]`, `data-tone="ok|warn"`, `role="status"`.
- `hidden` false on show, auto-hide after 2200ms, re-announce via `aria-live="polite"`.
- Pure DOM + `setTimeout`; no deps.

### api + presets (`api.js`, `ui/presets.js`)
- `public/js/api.js` exports:
  ```js
  export async function loadAudit({ presetId, language, signal } = {}) -> { audit, offline:boolean }
  export async function fetchAudit({ text, pages, doc_type, language, pack_id, signal }) -> audit
  ```
  `loadAudit` order: (1) `/api/audit` with the preset's text; (2) on any failure or
  non-JSON, fall back to `public/mock-audit.json` (fetch) or the matching
  `public/presets/<id>.json` → still returns `{audit, offline:true}`. Never throws.
  When it does get a live audit, fill `exposure`/`way_out` via `verifier.buildAuditReport`
  if `math_inputs` is present and the fields are missing.
- `ui/presets.js`: `[data-preset="…"]` chips, `aria-pressed` (one active), click →
  `ctx.loadPreset(id)`, set `shell[data-offline]` from the loader result via toast on
  offline (`ctx.toast('Offline sample', 'warn')`).

### icon (`public/icons/icon.svg`, manifest)
- One square SVG 512×512, Trust Indigo `#1D4ED8` background, white shield + check glyph,
  no external refs, no fonts. Add an `icons` array to `manifest.webmanifest`:
  ```json
  "icons": [{ "src": "./icons/icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
  ```
  Keep every existing manifest key untouched.

### orchestrator (`public/js/main.js`)
- Import the factories + `render` from `./renderer.js`, `createPlayer` from `./audio-sync.js`,
  `bindHoldToAsk`/`createAsk` from `./ask.js`, `ingestFile`/`createStepper` from `./ingest.js`,
  `renderNegotiate` from `./negotiate.js`.
- Build `Ctx`, boot from `./api.js` `loadAudit({presetId:'blr-rental'})`, `render`, then
  `mount()` every module.
- Wire: `[data-play60]` → `player.play()`; `[data-holdask]` → `bindHoldToAsk`;
  `[data-ask-fab]`/`[data-ask-close]`/`[data-ask-form]` → `createAsk`; `[data-camera-input]`
  → `ingestFile` with stepper stage/count callbacks; `[data-stepper-cancel]` → abort.
- Must run in the browser only; guard `typeof window`.

## 5. Boot order (main.js) — must not report an error if any step fails

1. `document.readyState` guard.
2. `const { audit, offline } = await loadAudit({ presetId: 'blr-rental', language })`.
3. `ctx.setAudit(audit)` → `render(audit)`.
4. Mount: theme, lang, tabs, toast, qr, vault, presets, player, ask.
5. If `offline`, `ctx.toast('Offline sample', 'warn')` and `shell[data-offline="true"]`.

## 6. Vendored UMD loading

`qrcode.min.js` defines global `qrcode`. `qr.js` must inject
`<script src="./lib/qrcode.min.js">` once (guard `window.qrcode`) and resolve after `load`,
with a 2s timeout → placeholder. Never a top-level ESM import of a UMD file.

## 7. Definition of done per worktree

- File exists, `node --check <file>` (or `node -e "import(…)"` for ESM) passes.
- Importing/instantiating with `{}`-ish `ctx` never throws (Node smoke: `map ||= new Map` guards).
- No new dependency, no build step, no `package.json`.
- `node --test tests/guardrails.test.mjs tests/integration.test.mjs` still green after merge.
