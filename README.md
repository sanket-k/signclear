# SignClear

Photo or PDF of an Indian agreement (rental, loan, offer letter) → 60-second spoken clarity in the
signer's language (Kannada / Hindi / Tamil / English), risks grounded against audited Indian rule
packs, and polite WhatsApp / Email asks to negotiate them.

Clarity, not counsel. Zero build. Vanilla ES2020 ESM + stateless Vercel Node functions.

## Status

**Works today**

- **Zero-build PWA shell** — `public/index.html` + `public/styles/{tokens,app}.css`, no
  `package.json`, no `node_modules`, no bundler. Three primary tabs (`Understand`, `Negotiate`,
  `Document / Ask`), desktop `Report | Split | Contract`, mobile 62px sticky bar (`Play 60s` +
  `Hold to Ask`), light/dark toggle, QR dialog, vault drawer.
- **Renderer** — `public/js/renderer.js` renders the full `audit_result_v1` report from a fixture:
  score hero, rupee exposure, exactly 3 bullets, clause cards, gap banner, permanent disclaimer.
- **Guardrail logic + tests green** — `pii-guard.js`, `prompt-security.js`, `verifier.js`,
  `audio-sync.js`, `negotiate.js`, `ask.js`, `ingest.js`. 101 tests pass (see [Tests](#tests)).
- **Five API routes implemented** — `api/{audit,ocr,qa,tts,stt}.js` on
  `api/_lib/{llm-client,prompts,rules,speech}.js`. Offline structural smoke: 19/19 checks pass.
- **Offline fixture path** — `public/js/api.js` boots from `public/mock-audit.json` and flips
  `.app-shell[data-offline="true"]` when `/api/audit` is unreachable, so serving `public/`
  statically renders a complete report with no network and no keys.

**Still rough — do not overclaim these**

- **Live LLM + speech paths need keys.** Without `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` /
  `SARVAM_API_KEY`, 4 of the 23 api-smoke checks are skipped (`19/23`, exit 1); the app falls back
  to the fixture and `window.speechSynthesis`.
- **Per-preset offline fixtures are landing, not landed.** Only `public/mock-audit.json` (the BLR
  rental) exists. The four `public/presets/<id>.audit.json` files specified in
  `docs/preset-audit-fixtures.md` do not exist and `api.js` does not prefer them, so all four preset
  chips currently render the BLR audit (`docs/wave2-plan.md` Phase A, unchecked).
- **Unwired UI beats** — the `[data-pii-badge]` popover has no listener, and
  `negotiate.js#exportBrief()` still throws `scheduled for Wave 3` while the real implementation sits
  unused in `brief.js`.
- **No service worker** — `public/sw.js` is absent; the manifest is installable-shaped only.
  `node --test tests/` also fails (directory path unsupported); run the files individually.

## Quickstart

Zero build. There is nothing to install and no npm step.

```bash
# from the repo root — serve public/ at /
python3 -m http.server 4173 -d public
# open http://localhost:4173/
```

The app boots from `public/mock-audit.json` and shows the "Offline sample" chip: full report,
clause playlist, Way-Out slider, Negotiate tab — all with no network. Equivalent if `npx` is
available (network needed once to fetch the package):

```bash
npx --yes serve public -l 4173
```

**Live API path.** `/api/*` are Vercel Node functions, so a static server cannot serve them (a
static server answers `/api/audit` with 404/501). Use the Vercel CLI, which serves `public/` and
`api/` on one origin:

```bash
cp .env.example .env.local     # fill in the keys; LLM_PROVIDER defaults to openrouter
npx --yes vercel dev           # serves public/ + /api/* same-origin, no CORS
```

Without `vercel dev` or without keys, `POST /api/audit` fails and the client silently renders the
offline fixture — the demo still runs. This checkout has no Vercel CLI, so that command was not
exercised here; the two static commands above were.

## Tests

Pure Node, no dependencies, no server required:

```bash
node --test tests/guardrails.test.mjs   # 48 pass — PII shield, prompt fencing, cyrb53, verifier math
node --test tests/fixtures.test.mjs     # 32 pass — mock-audit vs schema + rule packs + presets
node --test tests/integration.test.mjs  # 11 pass — index.html DOM hooks, CSS literals, API exports
node --test tests/wiring.test.mjs       # 10 pass — no build tooling, module contracts, PWA icon
```

All four together: `node --test tests/guardrails.test.mjs tests/fixtures.test.mjs tests/integration.test.mjs tests/wiring.test.mjs` → **101 pass, 0 fail**.

The API smoke harness is a standalone script (not a `node:test` file — `node --test tests/api-smoke.mjs`
fails). It drives the real handlers with mock req/res, so **no server and no keys** for the offline tier:

```bash
SMOKE_OFFLINE=1 node tests/api-smoke.mjs   # 19/19 checks, exit 0
node tests/api-smoke.mjs                   # 19/23 without keys (4 live checks skipped), exit 1
```

The four live checks (Sarvam TTS, Sarvam STT round-trip, live audit, live Q&A) need `SARVAM_API_KEY`
and an LLM key in `.env.local`.

## Architecture

| Path | What it is |
|---|---|
| `public/` | Zero-build vanilla ES2020 ESM PWA. `index.html`, `styles/tokens.css` + `app.css`, `js/` (orchestrator `main.js`, `renderer.js`, `verifier.js`, `ingest.js`, `pii-guard.js`, `prompt-security.js`, `audio-sync.js`, `ask.js`, `negotiate.js`, `vault.js`, `api.js`, `js/ui/`), vendored UMD libs in `lib/` (`pdf.js`, `jsPDF`, `qrcode`). No build, no bundler. |
| `api/` | Stateless Vercel Node functions: `audit.js`, `ocr.js`, `qa.js`, `tts.js`, `stt.js`. Shared `_lib/`: `llm-client.js` (provider switch), `prompts.js` (3-prompt catalog), `rules.js` (pack loader), `speech.js` (Sarvam). Same-origin, no CORS, no cache, no state. |
| `rules/` | Verified Indian rule packs (`rule_pack_v1`, verified 2026-11-21): `in-ka-rental`, `in-central-rbi-loan`, `in-central-employment`, `in-general-fallback`, plus `schema.json` JSON Schema. 4–5 rules each, every rule carrying `basis_type`, `severity`, `statutory_citation`, `negotiation_ask`. |
| `public/presets/` + `public/mock-audit.json` | Offline fixtures: four `contract_preset_v1` samples (`blr-rental`, `rbi-loan`, `startup-offer`, `missing-page-3`) and the pre-computed `audit_result_v1` report the app boots from. Output of `POST /api/audit` is identical in shape. |
| `docs/` | Frozen contracts: `audit-result.schema.md`, `shared-contract.md`, `ui-wiring-contract.md`, `smoke-tests.md`, `preset.schema.md`, `speech-contract.md`, `env-contract.md`, plus `wave2-plan.md`. |
| `tests/` | `guardrails`, `fixtures`, `integration`, `wiring` (`node:test`), `api-smoke.mjs` (handler harness). |

## Guardrails

1. **Local PII shield** — Aadhaar / PAN / `+91` / email / UPI / party headers are detected and masked
   in the browser before any byte leaves the device; cities and states are never masked; fail-closed
   rescan blocks the upload when a hit cannot be masked.
2. **Zero silent failures** — unreadable pages or clause gaps raise an amber Incomplete Scan Banner
   (`Missing Page 3` → `Clause 4 → 7`); `[ILLEGIBLE]` is never guessed into text.
3. **Prompt-injection fencing (OWASP LLM01)** — `sanitizeForPrompt()` + `<untrusted_contract_text>`
   fences + `injectionDefense@1`; every DOM interpolation goes through `escapeHTML()`.
4. **Dual citations** — a quote renders only if it clears Jaccard ≥ 0.80 against the clause
   (`✓ Verified excerpt`), else it is dropped; statutes render only via a `rule_id` in the active pack.
5. **Deterministic math** — rupee exposure and the Way-Out curve are pure JS in `verifier.js`; the
   server returns `math_inputs`, never money.
6. **Anti-liability copy** — never `Illegal`, `Sue` or `AI Lawyer`; findings use `Statutory Conflict`,
   `Above Local Norm`, `Standard`, and the disclaimer is permanent.
7. **Fail-closed** — unknown pack falls back to `in-general-fallback`, findings without a known
   `rule_id` are dropped, missing keys return a JSON error, never a client crash.

## Environment

Server-only. Copy `.env.example` to `.env.local` for `vercel dev`, or set them in the Vercel dashboard.

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `openrouter` (default) or `anthropic`. The only switch; there is no model picker in the UI. |
| `OPENROUTER_API_KEY` | Required when `LLM_PROVIDER=openrouter`. |
| `ANTHROPIC_API_KEY` | Required when `LLM_PROVIDER=anthropic`. |
| `SARVAM_API_KEY` | Sarvam STT/TTS proxy (`saaras:v4`, `bulbul:v4-flash`). Missing ⇒ `window.speechSynthesis` fallback. |

These keys live only in server functions under `api/`. Nothing under `public/` references them, and no
key is ever returned in a response body.

## Not legal advice

> SignClear explains agreements in plain language and flags clauses that commonly deviate from Indian norms. It is not legal advice and it is not a law firm. Always read the original agreement before signing.

See `AGENTS.md` for the behavioural rules and locked stack, and `docs/smoke-tests.md` for the seven
demo-critical checks.
