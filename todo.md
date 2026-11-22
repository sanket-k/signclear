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
- [x] `mock-audit.json` — ≥5 clauses, 3 severity types, rupee exposure, Way-Out inputs.

**✓ Checkpoint 1:** All 4 packs validate; 4 presets exist; `mock-audit.json` renders a full report on paper.

---

# Phase 2 — Pure Logic + Guardrail Tests

- [ ] `public/js/prompt-security.js`
  - [ ] `sanitizeForPrompt()` + `<untrusted_contract_text>` fence + `injectionDefense@1`.
  - [ ] `escapeHTML()`.
  - [ ] 4-stage `parseJSONFromLLMResponse()`.
  - [ ] cyrb53 `templateHash` for the 3-prompt catalog.
- [ ] `public/js/verifier.js`
  - [ ] Jaccard ≥0.80; drop unmatched quotes.
  - [ ] Pure-JS rupee exposure math.
  - [ ] Way-Out computation (current vs negotiated loss at exit month).
  - [ ] Rule-id pinning: no `rule_id` in active pack ⇒ statute not rendered.
- [ ] `public/js/pii-guard.js` (logic only)
  - [ ] Detectors: Aadhaar, PAN, +91, email, UPI, party headers.
  - [ ] Never mask cities/states.
  - [ ] Fail-closed: unmaskable hit ⇒ `{ safeToSend: false }`.
- [ ] `tests/guardrails.test.mjs`
  - [ ] Injection corpus.
  - [ ] Jaccard boundary (0.799 fails / 0.80 passes).
  - [ ] PII true/false positives incl. cities/states.
  - [ ] Rupee + Way-Out arithmetic.
  - [ ] Unknown-statute rejection.
  - [ ] Malformed / fenced / truncated JSON parse.

**✓ Checkpoint 2:** `node --test tests/guardrails.test.mjs` green; no DOM dependencies in these modules.

---

# Phase 3 — Backend API

- [ ] `api/_lib/llm-client.js` — single `LLM_PROVIDER` switch; Haiku 5.5 @0.0 / Sonnet 5.5 @0.1 audit / @0.15 QA; timeout + one retry.
- [ ] `api/_lib/rules.js` — load pack by id; inject only `rule_id`, titles, `detection_hint`, `benchmark`; unknown pack ⇒ `in-general-fallback` + `panIndiaOnly`.
- [ ] `api/_lib/prompts.js` — exactly `contract.ocr@1`, `contract.audit@1`, `contract.qa@1` + hashes.
- [ ] `api/ocr.js` — ≤3 base64 images, Haiku vision, text + `[ILLEGIBLE]` + page/gap hints.
- [ ] `api/audit.js` — pack-grounded prompt, parser-enforced JSON, `rule_id` on every finding, drop findings without a pack rule, completeness/gap signal.
- [ ] `api/qa.js` — grounded answer + `clause_id` + audio-ready script.
- [ ] `api/tts.js` / `api/stt.js` — Sarvam `bulbul:v4-flash` / `saaras:v4` (`mode:"codemix"`, ≤30s, 50 keyterms); base64 audio; JSON errors.
- [ ] `vercel.json` — same-origin static + functions; 4.5MB body awareness.

**✓ Checkpoint 3:** `curl` returns valid JSON from all 5 routes using fixtures; no key appears in any client-served file.

---

# Phase 4 — Dual-Lane Intake & Privacy

- [ ] `public/js/ingest.js`
  - [ ] Lane A: PDF.js `isScannable()` <150ms.
  - [ ] Lane B: canvas max 1500px, color JPEG 0.80, EXIF stripped, never binarize.
  - [ ] 100ms blur check + verdict.
  - [ ] Optional 1-tap Header Blackout.
  - [ ] `Promise.all` concurrency cap 3; Cancel via `AbortController`.
- [ ] PII Shield UI
  - [ ] `🟢 Local PII Shield` badge + token-type popover with real counts.
  - [ ] Fail-closed rescan blocks upload with an explicit message.
- [ ] Lane B honesty badge — `🟡 Image Mode · EXIF stripped · Zero-retention`.
- [ ] Gap UX
  - [ ] Amber Incomplete Scan Banner (`Clause 4 → 7`).
  - [ ] `[ILLEGIBLE]` refusal copy + 1-tap `Original Scan` toggle.
- [ ] Telemetry stepper — M3/D2, real counts, `Cancel` bound to AbortController.

**✓ Checkpoint 4:** Photo and vector PDF both reach `/api/audit`; a seeded PII hit blocks upload; blurred and gapped scans show the amber banner.

---

# Phase 5 — UI Shell & Design System

- [ ] `public/styles/tokens.css` — Trust Indigo `#1D4ED8`, severity triplets, light/dark, `prefers-reduced-motion`, type scale, SVG sprite.
- [ ] `public/styles/app.css` + `index.html` — 900px split (mobile feed / desktop `[Report|Split|Contract]` at 48/52), 62px sticky bar, floating Ask, `Mobile QR` `<dialog>`, max 3 tabs.
- [ ] `public/js/renderer.js`
  - [ ] Hydrate from `mock-audit.json`, then real `/api/audit`.
  - [ ] Hero: Score + ₹Exposure → exactly 3 bullets → Way-Out slider → top 3–5 clauses.
  - [ ] `escapeHTML()` on every interpolation; OCR digits in `--verify-ocr-*` linked to `Original Scan`.
  - [ ] Clause inspector with `data-clause-id` anchors.
- [ ] `public/js/main.js` — language pill (KN/HI/TA/EN), presets, view switching, stepper wiring.
- [ ] `public/manifest.webmanifest` + icons — installable, indigo theme.

**✓ Checkpoint 5:** `mock-audit.json` renders correctly at 390×844 and 1440×900 with zero pinch-zoom.

---

# Phase 6 — Audio, Voice Q&A & Sync

- [ ] `public/js/audio-sync.js`
  - [ ] Clause-level playlist (no word karaoke).
  - [ ] `onplay`: smooth-scroll, pulse `.clause-active` 1100ms, dim others to 18%.
  - [ ] `spoken_script` rules: native Indic + English terms, 12–16 words, no markdown/slashes/SSML.
  - [ ] Mandatory `speechSynthesis` fallback.
- [ ] Hold-to-Ask — ≤30s capture → `/api/stt` → `/api/qa` → `/api/tts`; pinned card + scroll to clause; text-only fallback.
- [ ] Mobile playback — every play initiated by user gesture.

**✓ Checkpoint 6:** Kannada walkthrough pulses the right clause and dims others; a Kanglish question returns audio + scrolls to its clause; killing the TTS route still speaks via `speechSynthesis`.

---

# Phase 7 — Negotiate, Vault & Pre-Sign Brief

- [ ] `public/js/negotiate.js` — checkbox asks from pack `negotiation_ask`; `Polite`/`Firm`; `WhatsApp`/`Email`; copy with `<textarea>` fallback.
- [ ] jsPDF Pre-Sign Brief — 1 page (score, exposure, top findings, chosen asks, disclaimer), offline via vendored jsPDF.
- [ ] `public/js/vault.js` — `localStorage` ~20KB/doc, history drawer, editable title, 1-line note, "Don't save" toggle, clear-all; never persist images/audio.

**✓ Checkpoint 7:** Selecting asks produces a copyable WhatsApp draft and a valid 1-page PDF; vault survives refresh and clears in one tap.

---

# Phase 8 — Integration, Verification & Freeze

- [ ] `node --test tests/guardrails.test.mjs` green.
- [ ] `git grep -E "sk-ant|sk-or-v1"` returns empty.
- [ ] `curl` all 5 routes; record commands + sample responses.
- [ ] Run the 7 smoke tests on desktop 1440×900.
- [ ] Run the 7 smoke tests on a real phone via QR.
- [ ] Resilience: network-off preset path, provider-down path, cached audit path.
- [ ] Rehearse the 2-minute stage script end to end.
- [ ] Freeze at 4:15 PM — demo-blocking fixes only after.
- [ ] Verify deployed URL from a clean phone.

**✓ Checkpoint 8:** 7/7 smoke tests pass live on a phone and the projector; secret scan clean; deployed and frozen.
