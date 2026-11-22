# Shared module contract — frozen before Wave 1

> **Why this file exists:** Lane A (`api/`), Lane B (`public/js/main|renderer|negotiate|vault`),
> and Lane C (`public/js/verifier|prompt-security|pii-guard`) are built in three parallel
> worktrees. They cannot read each other's source while parallel. This document is the
> interface they code against. If a signature here is wrong, fix this file first, then all lanes.

**Owner of this contract:** `main` (Wave 0). Lanes may not change it unilaterally.

---

## 1. Exposure / Way-Out math — `public/js/verifier.js` is canonical

**Decision:** the formula lives in exactly one place, `verifier.js` (ESM, `public/`).
`api/_lib/verifier.js` does not exist. `/api/audit` returns the LLM's `findings` plus a
`math_inputs` block; the **server does not compute rupee amounts**. The client computes
`exposure` and `way_out` with `verifier.js`. This keeps the smoke-test-3 rule ("slider
recomputes with zero network calls") trivially true and avoids two implementations drifting.

> The frozen `docs/audit-result.schema.md` still lists `exposure` and `way_out` on the audit
> result — that shape is satisfied because `buildAuditReport()` (client) fills them before render.
> `public/mock-audit.json` already contains them pre-computed for the visual fixture.

### `computeExposure(inputs) -> Exposure`

```js
/**
 * @param {{
 *   monthly_rent: number,        // rupees/month
 *   deposit_amount: number,      // refundable deposit in rupees
 *   deposit_cap_months: number,  // pack benchmark (e.g. 3)
 *   painting_charge: number,     // fixed exit painting charge, 0 if none
 *   lock_in_penalty: number,     // rupee penalty for early exit, 0 if none
 *   asks_selected?: string[]     // ids: "deposit" | "lock_in" | "painting" | "refund"
 * }} inputs
 * @returns {{
 *   currency: "INR",
 *   current: number, negotiated: number, saved: number,
 *   breakdown: Array<{ label: string, amount: number, negotiated_amount: number }>
 * }}
 */
export function computeExposure(inputs)
```

Rules (must match `mock-audit.json` for the BLR fixture: rent 20000, deposit 200000,
cap 3, painting 40000, lock_in 40000):

- `deposit` line: `amount = deposit_amount`;
  `negotiated_amount = min(deposit_amount, monthly_rent * deposit_cap_months)`.
  → 200000 / 60000.
- `painting` line: `amount = painting_charge`; `negotiated_amount = asks_selected.includes("painting") ? 0 : painting_charge`.
- `lock_in` line: `amount = lock_in_penalty`; `negotiated_amount = asks_selected.includes("lock_in") ? 0 : lock_in_penalty`.
  → 40000 / 40000 (default) or 0 when the ask is ticked.
- `current = Σ amount`; `negotiated = Σ negotiated_amount`; `saved = current - negotiated`.
- Zero lines are omitted from `breakdown`.
- Default (`asks_selected` absent) → `current = 280000`, `negotiated = 140000`, `saved = 140000`. **This is pinned by a guardrail test.**

### `computeWayOut(inputs) -> WayOut`

```js
/**
 * @param {{ current: number, negotiated: number, term_months: number }} inputs
 * @returns {{ months: number, points: Array<{ exit_month: number, current_loss: number, negotiated_loss: number }> }}
 */
export function computeWayOut({ current, negotiated, term_months })
```

- `months = term_months`.
- `points` at `exit_month ∈ {1, round(term/2), term}`.
- `lossAt(m, total) = m >= term ? 0 : round(total * (term - m) / (term - 1))`.
- Both `current_loss` and `negotiated_loss` use the same curve; terminal point is `0`.
- Deterministic, integer rupees, no floats leaking into the DOM.

### `jaccard(a, b) -> number` and `verifyQuote(quote, clauseText)`

- `JACCARD_THRESHOLD = 0.80` (exported const).
- Tokenise: lowercase, replace `/[^a-z0-9₹\s]/g` with space, split on whitespace, dedupe to a Set.
- `jaccard = |A∩B| / |A∪B|`; empty union ⇒ `1`.
- `verifyQuote` returns `{ verified, jaccard, quote: verified ? quote : null }`.
  Below threshold ⇒ `quote` is `null` (dropped, never rendered).

### `resolveCitation(ruleId, pack) -> object|null`

Returns the pack's `statutory_citation` iff `ruleId` exists in `pack.rules`; otherwise `null`.
**No citation is ever rendered from model output.** This is the anti-hallucination gate.

### `buildAuditReport(raw, pack) -> AuditResult`

Applies every §10 invariant from `docs/audit-result.schema.md`: drops findings whose
`rule_id` is absent from `pack`, nulls unverified quotes, fills `exposure`/`way_out` via the
two functions above, asserts `summary_bullets.length === 3`.

---

## 2. cyrb53 + prompt template hash — byte-identical in two lanes

`api/_lib/prompts.js` (CommonJS) and `public/js/prompt-security.js` (ESM) must produce the
**same** hash for the same template text, because the server reports `meta.template_hash` and
the client verifies it. Copy this implementation verbatim into both files:

```js
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function templateHash(text) {
  return "cyrb53:" + cyrb53(text).toString(16);
}
```

(The CJS copy uses `module.exports = { cyrb53, templateHash }`; body identical.)

### Prompt catalog — exactly three ids, no more

| id | purpose | model | temp |
|---|---|---|---|
| `contract.ocr@1` | image → text + `[ILLEGIBLE]` + page/gap hints | haiku-5.5 | 0.0 |
| `contract.audit@1` | pack-grounded findings JSON | sonnet-5.5 | 0.1 |
| `contract.qa@1` | grounded answer + `clause_id` | sonnet-5.5 | 0.15 |

`templateHash` is computed over the literal template string of each prompt, exported as
`PROMPT_HASHES = { "contract.ocr@1": "cyrb53:…", … }` from both lanes.

---

## 3. `public/js/prompt-security.js` exports

```js
export const INJECTION_DEFENSE_ID = "injectionDefense@1";
export function sanitizeForPrompt(text)      // strips control chars, fences user text
export function fence(text)                  // "<untrusted_contract_text>…</untrusted_contract_text>"
export function escapeHTML(s)                // &<>"' → entities; used on EVERY DOM interpolation
export function parseJSONFromLLMResponse(s)  // 4-stage: raw → ```json fence → first {…} → trailing-comma repair
export function cyrb53(str, seed)
export function templateHash(text)
export const PROMPT_HASHES
```

`parseJSONFromLLMResponse` returns a parsed object or `null`; it never throws.
Fenced and truncated JSON must both resolve or return `null` — pinned by guardrail test.

---

## 4. `public/js/pii-guard.js` exports

```js
export function detectPII(text)
// -> {
//   safeToSend: boolean,       // false if a hit exists that cannot be masked
//   maskedText: string,
//   total: number,             // == sum of counts
//   counts: { aadhaar, pan, phone, email, upi, party_header },
//   tokens: Array<{ type, raw, masked, start, end }>
// }
export function redactPII(text)
```

Detectors (regexes shared with `tests/fixtures.test.mjs` — keep identical):

```js
aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g
pan:     /\b[A-Z]{5}\d{4}[A-Z]\b/g
phone:   /\+\91[\s-]?\d{5}[\s-]?\d{5}\b/g
email:   /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g
upi:     /\b[\w.-]+@(?:okhdfcbank|okicici|oksbi|okaxis|paytm|ybl|upi)\b/g
```

- `party_header` = party names (`Mr./Ms./Mrs. Name`) + street-address lines in the party
  block. The **city and state are never masked** (`Bengaluru`, `Karnataka` survive).
  BLR fixture expectation: `party_header: 4` (owner name, owner street, tenant name, tenant street).
- `safeToSend === false` only when a detected identifier cannot be masked; fail closed.
- Mask format: keep last 2 chars for readability (`••••••••9012`), never echo full value.

---

## 5. Lane A — `api/` module exports (CommonJS)

```js
// api/_lib/llm-client.js
module.exports = {
  PROVIDER,                       // "openrouter" | "anthropic"
  MODELS: { ocr: "anthropic/claude-haiku-5.5",
            audit: "anthropic/claude-sonnet-5.5",
            qa: "anthropic/claude-sonnet-5.5" },
  async chat({ messages, model, temperature, max_tokens, signal }) // -> { content, usage, model }
};

// api/_lib/rules.js
module.exports = { loadPack(packId), pickPack({ docType, text }), FALLBACK_PACK_ID, packPromptContext(pack) };

// api/_lib/prompts.js
module.exports = { PROMPTS, PROMPT_HASHES, templateHash, cyrb53, buildPrompt(id, vars) };
```

`chat()` throws a structured error (`{status, code, message}`) on HTTP ≠ 2xx; one retry on
5xx/network, no retry on 4xx. Timeout 45s via `AbortController`.

### Route I/O (all JSON, same-origin, keys server-only)

| Route | Request | Success response |
|---|---|---|
| `POST /api/ocr` | `{ images: string[] (≤3 base64 data URLs), doc_type }` | `{ pages: [{page,text}], illegible: [{page,clause_id}], pages_missing: number[], meta }` |
| `POST /api/audit` | `{ text, pages?: [{page,text}], doc_type, language, pack_id? }` | `AuditResult` minus `exposure`/`way_out` (client fills) + `math_inputs` |
| `POST /api/qa` | `{ question, audit_summary: {clauses, findings}, language }` | `{ answer, clause_id, spoken: {language,text,text_en} }` |
| `POST /api/tts` | `{ text, language }` | `{ audio_base64, mime: "audio/mpeg", speaker, language }` |
| `POST /api/stt` | `{ audio_base64, mime, language? }` | `{ transcript, language_code, language_probability }` |

Errors (all routes): HTTP `{400,401,502,504}` with `{ error: { code, message } }`. Never leak keys.
`api/audit.js` must return `math_inputs = { monthly_rent, deposit_amount, deposit_cap_months, painting_charge, lock_in_penalty, term_months }` so the client can run `computeExposure`.

---

## 6. DOM contract — Lane B owns, Lane C reads

Component names and `data-*` hooks are **frozen in `DESIGN_SYSTEM.md` §9**. Lane B implements
them verbatim; Lane C's `audio-sync`/intake wiring targets the same hooks. Do not invent new
component names. Clause anchors are `[data-clause-id="cN"]` on both the clause card and the
contract-sheet block.

---

## 7. Fake-data fallback (stage safety)

`main.js` boots from `public/mock-audit.json` before any network call. If `/api/audit` is
unreachable, render the preset result and set `.app-shell[data-offline="true"]`. This is the
resilience path in todo Phase 8 and the fallback for every smoke test.
