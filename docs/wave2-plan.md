# Wave 2 plan — evidence-based

Findings from a real headless-Chrome probe at 390×844 and 1440×900
(`/api/*` returning 404, so the offline path is what was tested).

## Verified defects

- [x] **Desktop Split blank contract column** — fixed (`a2de78d`). Two stacked
      bugs: `tabs.js` set `hidden` on inactive panels; the unscoped mobile tab
      router (`app.css:310`, specificity 0,4,0) outranked the desktop reset (0,2,0).
- [ ] **PII popover never opens** — `[data-pii-badge]` has no listener anywhere
      (renderer only repaints it). Smoke test 1 ("token count visible pre-upload")
      fails: `aria-expanded` stays `false`, `.pii-popover` stays `hidden`.
- [ ] **All four presets render the same audit** — clicking `missing-page-3`,
      `rbi-loan`, `startup-offer` yields pack `in-ka-rental`, score 38, no gap
      banner. Cause: `loadAudit()` falls back to `mock-audit.json` (the BLR
      fixture) for every preset, and no per-preset offline fixture exists.
      Smoke test 5 (`Clause 4 → 7` amber banner) therefore cannot pass.
- [ ] **Pre-Sign Brief uncallable** — `negotiate.js#exportBrief()` throws
      `scheduled for Wave 3`; the real implementation sits unused in
      `brief.js`. No button exists in the Negotiate panel.
- [ ] **No service worker** — manifest is installable-shaped but `sw.js` is absent.
- [ ] **`node --test tests/`** fails (directory path unsupported); needs a script.
- [ ] **Keyboard/ARIA gaps** — no skip link; focus ring untested in dark mode.
- [ ] **No offline/recovery banner module** — `data-offline="true"` is set but
      only surfaced as a toast.

## Phases

### Phase A — offline preset fixtures (unblocks smoke 2/5, pack switching)
- [ ] `public/presets/blr-rental.audit.json`
- [ ] `public/presets/missing-page-3.audit.json` (carries the `Clause 4 → 7` gap)
- [ ] `public/presets/rbi-loan.audit.json`
- [ ] `public/presets/startup-offer.audit.json`
- [ ] `api.js` prefers `<preset>.audit.json` when the live route fails
- [ ] `tests/preset-audits.test.mjs` validates all four offline fixtures

**Gate A:** `node --test tests/preset-audits.test.mjs` green; browser probe shows
`missing-page-3` → gap banner + pack `in-ka-rental`, `rbi-loan` → `in-central-rbi-loan`.

### Phase B — interaction modules
- [ ] `ui/pii.js` (badge popover)
- [ ] `negotiate.js` Brief button → `brief.js#exportBrief`
- [ ] `ui/errorboundary.js` + `ui/offline.js` (recovery banner)
- [ ] `ui/a11y.js` (skip link, focus ring, reduced motion)
- [ ] `ui/copy.js` (shared clipboard helper)
- [ ] `sw.js` + `ui/install.js`
- [ ] `ui/selftest.js` (dev-only smoke runner in-page)

**Gate B:** every new module imports clean in Node with `{}`; browser probe shows
PII popover open/close, Brief produces a PDF blob, offline banner appears.

### Phase C — docs & QA tooling
- [ ] `todo.md` reconciled to reality
- [ ] `README.md`
- [ ] `scripts/serve.mjs`, `scripts/probe.mjs` (checked-in browser QA)
- [ ] `scripts/a11y-audit.mjs`, `scripts/deploy-check.mjs`

**Gate C:** `node scripts/deploy-check.mjs` exits 0; secret scan clean.

### Phase D — integration & freeze
- [ ] main.js wires every new module (single owner, after merges)
- [ ] full suite green; both viewports re-probed; screenshots reviewed
- [ ] `git grep -E "sk-ant|sk-or-v1"` empty
