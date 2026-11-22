> Zero-build, mobile-first PWA + desktop split X-Ray web app.
> Mission: photo or PDF of an Indian agreement (rental, loan, offer letter) → 60-second spoken clarity in the signer's language (Kannada/Hindi/Tamil/English), grounded risks against audited Indian rules, polite WhatsApp/Email asks.

## 1. Behavioral Principles (Karpathy — speedrun calibrated)
- **Think before coding:** 2–4 bullet assumptions before any non-trivial module. Ask ONLY on structural ambiguity (schema mismatch, cross-lane contract change, API uncertainty, scope cut). Push back if a simpler path exists.
- **Simplicity first:** Zero-build Vanilla ES2020 modules (`public/`), plain CSS (`tokens.css` + `app.css`), vendored UMD libs (`pdf.js`, `jspdf`). NEVER add React, TS, Vite, Webpack, Tailwind CLI, or build steps. No login, DB, e-signing, model pickers, 8-tab dashboards.
- **Surgical changes & lane hygiene:** Respect §6 file ownership. Never touch another lane's files. No drive-by refactors.
- **Goal-driven:** Never declare done without `curl` for API routes, `node --test tests/guardrails.test.mjs` for logic/safety, and 390×844 + 1440×900 visual check against `mock-audit.json`.

## 2. Locked Stack (read this before touching any file)
- **Frontend:** Zero-build **Vanilla ES2020 ESM** static PWA in `public/`.
  No React. No TypeScript. No Vite/Webpack/Rollup. No npm build step.
  Vendored UMD libs only: `public/lib/pdfjs/`, `public/lib/jspdf.umd.min.js`.
  If you find yourself typing `npm install`, stop — you have drifted.
- **Backend:** Stateless Vercel Node functions in `api/*.js`.
  Chosen over Cloudflare Workers specifically to avoid the 10ms CPU cap
  on base64 image/audio payloads. Same-origin with `public/` → zero CORS.
  No in-memory state, no server cache, no rate-limit middleware (all stateless).
- **LLM switch (`api/_lib/llm-client.js`):**
  - **Start with `LLM_PROVIDER=openrouter`** (free tier, works pre-event, no key friction).
  - **Flip to `LLM_PROVIDER=anthropic` only when event credits activate** (orientation / after 1:00 PM).
  - Haiku 5.5 (temp 0.0) for OCR/triage; Sonnet 5.5 (0.1 audit / 0.15 Q&A).
  - One env var, zero UI model pickers.
- **Speech (Sarvam):** `saaras:v4` (`mode:"codemix"`, ≤30s, 50 legal keyterms) for STT;
  `bulbul:v4-flash` for TTS. **`window.speechSynthesis` fallback is mandatory** — stage audio never dies.
- **Dual-lane intake:**
  - **Lane A — vector PDF:** PDF.js `isScannable()` <150ms → local fail-closed PII guard → `/api/audit`.
  - **Lane B — photo/scan:** Canvas `max 1500px` color JPEG `0.80` + EXIF strip (**NEVER binarize/threshold**)
    → 100ms blur check + optional 1-tap header blackout → `Promise.all` cap 3 → `/api/ocr` → `/api/audit`.

## 3. Non-negotiable guardrails
1. Zero silent failures: amber Incomplete Scan Banner on page/clause gaps.
2. Honest two-lane privacy: Lane A `🟢 Local PII Shield` (Aadhaar/PAN/+91/email/UPI/party headers; never mask cities/states; fail-closed rescan). Lane B `🟡 Image Mode · EXIF stripped · Zero-retention`.
3. OWASP LLM01: `sanitizeForPrompt()` + `<untrusted_contract_text>` fences + `injectionDefense@1` + `escapeHTML()` on DOM writes.
4. 3-prompt catalog only (`contract.ocr@1`, `contract.audit@1`, `contract.qa@1`) + cyrb53 `templateHash` + 4-stage `parseJSONFromLLMResponse()`.
5. Dual citations: verbatim verified (Jaccard ≥0.80 → `✓ Verified excerpt`; unmatched dropped). Statutes ONLY via `rule_id` in active pack. OCR digits wrapped in dashed `--verify-ocr-*` linked to `Original Scan`.
6. Deterministic math only: rupee exposure + Way-Out in pure JS (`verifier.js`).
7. Anti-liability copy: never "Illegal", "Sue", "AI Lawyer". Use `Statutory Conflict` / `Above Local Norm` / `Standard` + permanent disclaimer.

## 4. Voice & sync
- Clause-level playlist (NO word karaoke); `onplay` smooth-scrolls to `data-clause-id`, pulses `.clause-active` (1100ms), dims others to 18%.
- `spoken_script`: native Indic script + English legal terms (NEVER Romanized Indic for Bulbul), 12–16 word spoken sentences, no markdown/slashes/SSML, calm friend persona.
- Written WhatsApp/Email drafts default to polite English + `Polite & Collaborative`.

## 5. Design & screens
- Single `tokens.css`: primary Trust Indigo `#1D4ED8` (never orange/amber primary); red/amber/emerald severity triplets; light default + dark toggle + `prefers-reduced-motion`; body 15–16px; contract serif 16px/1.7; inline SVG sprite.
- Max 3 primary tabs (`Understand`, `Negotiate`, `Document / Ask`). Hero: Score + ₹Exposure → exactly 3 bullets → Way-Out slider → top 3–5 clauses.
- Breakpoint 900px: mobile = zero-pinch card feed + 62px sticky bar (`Play 60s` + `Hold to Ask`), no stacked sheets. Desktop = `[Report|Split|Contract]` (Split default 48/52) + floating Ask + `Mobile QR` modal.
- Mandatory Live Telemetry Stepper (`M3`/`D2`) with real counts + `Cancel`.

## 6. File ownership
- Lane A: `api/**`, `vercel.json` (reads `rules/*.json`)
- Lane B: `public/index.html`, `public/manifest.webmanifest`, `public/styles/**`, `public/js/main.js`, `renderer.js`, `negotiate.js`, `vault.js` (reads `mock-audit.json`)
- Lane C: `public/js/ingest.js`, `pii-guard.js`, `prompt-security.js`, `verifier.js`, `audio-sync.js`, `tests/guardrails.test.mjs` (reads `rules/*.json`, `public/presets/*.json`)

## 7. Verification & cutline
- Pass `node --test tests/guardrails.test.mjs` + 7 smoke tests (§13.2) + `git grep -E "sk-ant|sk-or-v1"` empty before **4:15 PM hard freeze**.
- DO NOT BUILD: auth, cloud DB, e-signing, `.docx` tracked changes, PDF diffing, calendar sync, 28 state packs, OpenCV/Tesseract WASM, word karaoke, 8-tab dashboards.
