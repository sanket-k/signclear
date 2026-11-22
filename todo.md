# SignClear — Build TODO

> Sources: `AGENTS.md` (wins conflicts) · `knowledge-hub/prd.md` · `knowledge-hub/technical-stack.md` · `rules/schema.json`.
> Freeze 4:15 PM · Demos 6:00 PM.

---

# Phase 0 — Contracts, Docs & Scaffolding

- [x] Freeze the data contract
  - [x] Map `rules/schema.json` required fields (rule + `expected_clauses`).
  - [x] Write `docs/audit-result.schema.md` (`/api/audit` response: score, exposure, findings[], clauses[], spoken_script, completeness).
  - [x] Define `mock-audit.json` shape to match that schema.
- [x] Unblock design — write `DESIGN_SYSTEM.md` (tokens, 900px breakpoint, mobile 62px sticky bar, desktop `[Report|Split|Contract]` 48/52, clause dim-to-18%, telemetry stepper).
- [x] Scaffold directories
  - [x] `public/` (`index.html`, `manifest.webmanifest`, `styles/`, `js/`, `presets/`, `lib/`)
  - [x] `api/` (`ocr.js`, `audit.js`, `qa.js`, `tts.js`, `stt.js`, `_lib/`)
  - [x] `tests/guardrails.test.mjs`
  - [x] `vercel.json`, `.env.example`, `.gitignore`
- [x] Define the 7 smoke tests (replaces the missing §13.2)
  - [x] PII token count visible pre-upload.
  - [x] BLR preset → Kannada audio plays, Clause 3 pulses, others dim.
  - [x] Way-Out slider shows ₹ saved vs current exposure.
  - [x] Kanglish Hold-to-Ask → grounded answer + scroll to clause.
  - [x] Missing Page 3 → amber banner + `Clause 4 → 7` gap.
  - [x] Polite WhatsApp draft copies cleanly.
  - [x] Mobile QR modal serves the same flow on a phone.
- [x] Env + provider contract
  - [x] `.env.example`: `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `SARVAM_API_KEY`.
  - [x] Document one-var switch (`openrouter` default → `anthropic` at credits).

**✓ Checkpoint 0:** Audit schema frozen, `mock-audit.json` shape agreed, design spec exists, all directories and config files present, 7 smoke tests written down.

---

# Phase 1 — Rule Packs & Fixtures

- [x] `in-ka-rental` — deposit norm, lock-in months, notice symmetry, painting/exit charges, refund timeline.
- [x] `in-central-rbi-loan` — KFS disclosure, APR/all-in cost, prepayment penalty, penal-charge cap.
- [x] `in-central-employment` — Sec 27 non-compete void, bond/clawback, notice, ESOP lock-in.
- [x] Every rule carries `basis_type`, `severity`, `statutory_citation`, `verified_date`, `negotiation_ask` (polite + firm + replacement).
- [x] Validate all packs against `rules/schema.json` (`pack_id`, `rule_id`, `verified_date`).
- [x] Presets in `public/presets/*.json`
  - [x] `blr-rental`, `rbi-loan`, `startup-offer`, `missing-page-3`.
  - [x] Each = contract text fixture + expected pack id + expected flags.
  - [x] Missing Page 3 encodes the `Clause 4 → 7` gap.
  - [ ] Per-preset offline audit results (`public/presets/<id>.audit.json`) — specified in `docs/preset-audit-fixtures.md`, still pending from sibling lanes; all presets fall back to `mock-audit.json` today.
- [x] `mock-audit.json` — ≥5 clauses, 3 severity types, rupee exposure, Way-Out inputs.

**✓ Checkpoint 1:** All 4 packs validate (32/32 `fixtures.test.mjs`); 4 presets exist; `mock-audit.json` renders a full report on paper. Per-preset audit fixtures still outstanding.

---

# Phase 2 — Pure Logic + Guardrail Tests

- [x] `public/js/prompt-security.js`
  - [x] `sanitizeForPrompt()` + `<untrusted_contract_text>` fence + `injectionDefense@1`.
  - [x] `escapeHTML()`.
  - [x] 4-stage `parseJSONFromLLMResponse()`.
  - [x] cyrb53 `templateHash` for the 3-prompt catalog.
- [x] `public/js/verifier.js`
  - [x] Jaccard ≥0.80; drop unmatched quotes.
  - [x] Pure-JS rupee exposure math.
  - [x] Way-Out computation (current vs negotiated loss at exit month).
  - [x] Rule-id pinning: no `rule_id` in active pack ⇒ statute not rendered.
- [x] `public/js/pii-guard.js` (logic only)
  - [x] Detectors: Aadhaar, PAN, +91, email, UPI, party headers.
  - [x] Never mask cities/states.
  - [x] Fail-closed: unmaskable hit ⇒ `{ safeToSend: false }`.
- [x] `tests/guardrails.test.mjs`
  - [x] Injection corpus.
  - [x] Jaccard boundary (0.799 fails / 0.80 passes).
  - [x] PII true/false positives incl. cities/states.
  - [x] Rupee + Way-Out arithmetic.
  - [x] Unknown-statute rejection.
  - [x] Malformed / fenced / truncated JSON parse.

**✓ Checkpoint 2:** `node --test tests/guardrails.test.mjs` → 48/48 green; no DOM dependencies in these modules (`wiring.test.mjs` loads them in Node).

---

# Phase 3 — Backend API

- [x] `api/_lib/llm-client.js` — single `LLM_PROVIDER` switch; Haiku 5.5 @0.0 / Sonnet 5.5 @0.1 audit / @0.15 QA; timeout + one retry.
- [x] `api/_lib/rules.js` — load pack by id; inject only `rule_id`, titles, `detection_hint`, `benchmark`; unknown pack ⇒ `in-general-fallback` + `panIndiaOnly`.
  - (partial: fallback pack is returned correctly, but no `panIndiaOnly` flag exists anywhere in `api/`)
- [x] `api/_lib/prompts.js` — exactly `contract.ocr@1`, `contract.audit@1`, `contract.qa@1` + hashes.
- [x] `api/ocr.js` — ≤3 base64 images, Haiku vision, text + `[ILLEGIBLE]` + page/gap hints.
- [x] `api/audit.js` — pack-grounded prompt, parser-enforced JSON, `rule_id` on every finding, drop findings without a pack rule, completeness/gap signal.
- [x] `api/qa.js` — grounded answer + `clause_id` + audio-ready script.
- [x] `api/tts.js` / `api/stt.js` — Sarvam `bulbul:v4-flash` / `saaras:v4` (`mode:"codemix"`, ≤30s, 50 keyterms); base64 audio; JSON errors.
  - (partial: models, `codemix` and the ≤30s cap are enforced; the 50-keyterm bias list is not in `api/_lib/speech.js`)
- [x] `vercel.json` — same-origin static + functions; 4.5MB body awareness.
  - (partial: `outputDirectory: public`, `functions: api/*.js` @ `maxDuration` 60; the 4.5MB ceiling is only documented in `api/stt.js`)

**✓ Checkpoint 3:** All 5 handlers load and reject bad input — `SMOKE_OFFLINE=1 node tests/api-smoke.mjs` → 19/19; `tests/integration.test.mjs` proves no key appears in any client-served file.

---

# Phase 4 — Dual-Lane Intake & Privacy

- [x] `public/js/ingest.js`
  - [x] Lane A: PDF.js `isScannable()` <150ms.
  - [x] Lane B: canvas max 1500px, color JPEG 0.80, EXIF stripped, never binarize.
  - [x] 100ms blur check + verdict.
  - [x] Optional 1-tap Header Blackout.
  - [x] `Promise.all` concurrency cap 3; Cancel via `AbortController`.
- [x] PII Shield UI
  - [x] `🟢 Local PII Shield` badge + token-type popover with real counts.
  - [ ] Fail-closed rescan blocks upload with an explicit message — `detectPII()` returns `safeToSend`, but `main.js` never gates the upload on it and only `.pii-badge[data-state="blocked"]` CSS exists.
- [x] Lane B honesty badge — `🟡 Image Mode · EXIF stripped · Zero-retention`.
- [x] Gap UX
  - [x] Amber Incomplete Scan Banner (`Clause 4 → 7`).
  - [x] `[ILLEGIBLE]` refusal copy + 1-tap `Original Scan` toggle.
- [x] Telemetry stepper — M3/D2, real counts, `Cancel` bound to AbortController.

**✓ Checkpoint 4:** Photo (Lane B) and vector PDF (Lane A) both build an ingest result for `/api/audit`; gapped/blurred scans render the amber banner. Fail-closed upload gating is still missing.

---

# Phase 5 — UI Shell & Design System

- [x] `public/styles/tokens.css` — Trust Indigo `#1D4ED8`, severity triplets, light/dark, `prefers-reduced-motion`, type scale, SVG sprite.
- [x] `public/styles/app.css` + `index.html` — 900px split (mobile feed / desktop `[Report|Split|Contract]` at 48/52), 62px sticky bar, floating Ask, `Mobile QR` `<dialog>`, max 3 tabs.
- [x] `public/js/renderer.js`
  - [x] Hydrate from `mock-audit.json`, then real `/api/audit`.
  - [x] Hero: Score + ₹Exposure → exactly 3 bullets → Way-Out slider → top 3–5 clauses.
  - [x] `escapeHTML()` on every interpolation; OCR digits in `--verify-ocr-*` linked to `Original Scan`.
  - [x] Clause inspector with `data-clause-id` anchors.
- [x] `public/js/main.js` — language pill (KN/HI/TA/EN), presets, view switching, stepper wiring.
- [x] `public/manifest.webmanifest` + icons — installable, indigo theme.

**✓ Checkpoint 5:** Markup + CSS verified in source and by `wiring.test.mjs` (literal-free `app.css`, contract panel visible above the mobile router). Visual re-check at 390×844 / 1440×900 still to be done in-browser.

---

# Phase 6 — Audio, Voice Q&A & Sync

- [x] `public/js/audio-sync.js`
  - [x] Clause-level playlist (no word karaoke).
  - [x] `onplay`: smooth-scroll, pulse `.clause-active` 1100ms, dim others to 18%.
  - [x] `spoken_script` rules: native Indic + English terms, 12–16 words, no markdown/slashes/SSML.
  - [x] Mandatory `speechSynthesis` fallback.
- [x] Hold-to-Ask — ≤30s capture → `/api/stt` → `/api/qa` → `/api/tts`; pinned card + scroll to clause; text-only fallback.
- [x] Mobile playback — every play initiated by user gesture.

**✓ Checkpoint 6:** Player builds a clause playlist, pulses/dims the right clause, and falls back to `speechSynthesis` when `/api/tts` fails; Kanglish ask path wired end to end. Live browser walkthrough not yet re-run.

---

# Phase 7 — Negotiate, Vault & Pre-Sign Brief

- [x] `public/js/negotiate.js` — checkbox asks from pack `negotiation_ask`; `Polite`/`Firm`; `WhatsApp`/`Email`; copy with `<textarea>` fallback.
- [ ] jsPDF Pre-Sign Brief — 1 page (score, exposure, top findings, chosen asks, disclaimer), offline via vendored jsPDF.
  - (partial: `public/js/brief.js` + `public/lib/jspdf.umd.min.js` are in place, but nothing imports `brief.js` — `negotiate.exportBrief()` is still the throwing stub a sibling lane is wiring)
- [x] `public/js/vault.js` — `localStorage` ~20KB/doc, history drawer, editable title, 1-line note, "Don't save" toggle, clear-all; never persist images/audio.
  - (partial: 20KB cap, drawer, "Don't save" and clear-all exist; title comes from the pack label and `note` is always empty — no inline editor yet)

**✓ Checkpoint 7:** Selecting asks produces a deterministic, copyable WhatsApp/Email draft; the vault survives refresh and clears in one tap. The 1-page PDF is implemented but not wired into the Negotiate tab.

---

# Phase 8 — Integration, Verification & Freeze

- [x] `node --test tests/guardrails.test.mjs` green — 48/48 (plus `fixtures` 32/32, `integration` 11/11, `wiring` 10/10).
- [x] No secret in any client-served file — `public/` and `api/` contain no `sk-ant` / `sk-or-v1` / `sk_…` key; `tests/integration.test.mjs` fails the build if one appears. (The repo-wide `git grep` the old line implied is *not* empty: it only hits `AGENTS.md`/`todo.md` prose and the test regexes that assert absence.)
- [ ] `curl` all 5 routes; record commands + sample responses — handler-level smoke is green offline (19/19) but no live-key curl samples are recorded.
- [ ] Run the 7 smoke tests on desktop 1440×900.
- [ ] Run the 7 smoke tests on a real phone via QR.
- [x] Resilience: network-off preset path, provider-down path, cached audit path.
  - (paths implemented in `public/js/api.js`: preset → live → `mock-audit.json` fallback with `offline: true`, memoised fixture; not yet rehearsed live. No service worker or asset cache exists yet, so "network-off" means the fixture path, not a cold offline load.)
- [ ] Rehearse the 2-minute stage script end to end.
- [ ] Freeze at 4:15 PM — demo-blocking fixes only after.
- [ ] Verify deployed URL from a clean phone.

**✓ Checkpoint 8:** Logic + wiring suites are all green and the client bundle is secret-clean; the live phone/projector smoke run, recorded route samples, rehearsal and 4:15 PM freeze are still open.

---

## Cutline (from `AGENTS.md` §7)

DO NOT BUILD: auth, cloud DB, e-signing, `.docx` tracked changes, PDF diffing, calendar sync, 28 state packs, OpenCV/Tesseract WASM, word karaoke, 8-tab dashboards.
