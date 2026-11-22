# AuditResult Contract — `audit_result_v1`

> Frozen in Phase 0. `/api/audit` returns exactly this shape; `public/mock-audit.json`
> matches it byte-for-byte in structure. Renderer, verifier, audio-sync, negotiate, and
> the backend all code against this document. AGENTS.md wins on conflicts.

**Shape version:** `audit_result_v1` · **Served by:** `POST /api/audit` · **Consumed by:** `renderer.js`, `verifier.js`, `audio-sync.js`, `negotiate.js`

Every `clause_id` is a stable anchor (`c1`, `c2`, …) used by `data-clause-id`, audio sync
scroll/pulse, and finding → clause links. Every `finding_id` is stable within one result

---

## 1. Mapping from `rules/schema.json`

`/api/audit` is only allowed to emit what a validated rule pack can support.

| Rule pack field (`rules/schema.json`) | Where it lands in `AuditResult` | Rule |
|---|---|---|
| `schema_version` (`rule_pack_v1`) | `pack.schema_version` | Echoed. |
| `pack_id` | `pack.pack_id` | Must be the active pack; unknown pack ⇒ `in-general-fallback` + `pack.fallback_used=true`. |
| `display_name` | `pack.display_name` | Shown in pack badge. |
| `jurisdiction` | `pack.jurisdiction` | Cities/states are **never** PII-masked. |
| `contract_types` | `document.doc_type` selection | Doc type must be one of the pack's `contract_types`. |
| `verified_date` | `pack.verified_date` | Displayed next to statutory citations. |
| `legal_basis` | `pack.legal_basis` | Optional footnote. |
| `rules[].rule_id` | `findings[].rule_id` | **Required on every finding.** A finding without a `rule_id` present in the active pack is dropped. |
| `rules[].category` | `findings[].category` | Echoed. |
| `rules[].title` | `findings[].title` | Echoed, escaped on render. |
| `rules[].basis_type` | `findings[].basis_type` | One of `statutory_conflict` / `above_local_norm` / `missing_protection` / `standard`. |
| `rules[].severity` | `findings[].severity` | One of `critical` / `caution` / `standard` / `safe`. |
| `rules[].benchmark` | `findings[].benchmark` | Echoed (`metric`, `typical_label`, `max_fair_value` when present). |
| `rules[].statutory_citation` | `findings[].statutory_citation` | Rendered **only** when `rule_id` is in the active pack; otherwise `null`. |
| `rules[].detection_hint` | — | Server-side prompt input only; never returns to client. |
| `rules[].negotiation_ask` | `findings[].negotiation_ask` | Source for the Negotiate tab checkboxes. |
| `expected_clauses[]` (`id`, `label`, `why_it_matters`) | `expected_clauses[]` | Audit reports presence/absence of each expected clause; missing ones feed `completeness`. |

---

## 2. Top-level shape

```jsonc
{
  "schema_version": "audit_result_v1",
  "audit_id": "string",                 // opaque, client-side id
  "created_at": "2026-11-22T10:00:00Z", // ISO 8601 UTC

  "language": "kn",                     // "kn" | "hi" | "ta" | "en"

  "pack": {
    "schema_version": "rule_pack_v1",
    "pack_id": "in-ka-rental",
    "display_name": "Karnataka Residential Rental Norms",
    "jurisdiction": { "country": "IN", "state": "KA", "cities": ["Bengaluru"] },
    "verified_date": "2026-11-21",
    "fallback_used": false,
    "badge": null                        // "Pan-India General Norms Only" when fallback_used
  },

  "document": {
    "doc_type": "residential_rental",
    "title": "11-Month Residential Lease",
    "source_lane": "vector_pdf",         // "vector_pdf" | "image_photo"
    "page_count": 4,
    "privacy": {
      "lane": "A",                       // "A" = local PII shield, "B" = image mode
      "pii_tokens_found": 9,             // total redactions/tokens, shown pre-upload
      "pii_token_types": { "aadhaar": 1, "pan": 1, "phone": 1, "email": 1, "upi": 1, "party_header": 4 },
      "exif_stripped": true,
      "zero_retention": false            // true only for Lane B
    }
  },

  "score": {
    "value": 38,                         // 0–100 (higher = safer)
    "band": "risky",                     // "risky" | "caution" | "fair" | "safe"
    "label": "Several one-sided clauses"
  },

  "exposure": {
    "currency": "INR",
    "current": 280000,                   // deterministic rupee exposure
    "negotiated": 140000,                // after way-out asks
    "saved": 140000,
    "breakdown": [                       // each line must be pure-JS derivable
      { "label": "Deposit at risk", "amount": 200000 },
      { "label": "Painting / exit charge", "amount": 40000 },
      { "label": "Lock-in penalty", "amount": 40000 }
    ]
  },

  "way_out": {
    "months": 11,                        // slider max = contract term
    "points": [                          // one point per exit month
      { "exit_month": 1, "current_loss": 280000, "negotiated_loss": 140000 },
      { "exit_month": 6, "current_loss": 280000, "negotiated_loss": 140000 },
      { "exit_month": 11, "current_loss": 0, "negotiated_loss": 0 }
    ]
  },

  "summary_bullets": ["…", "…", "…"],    // exactly 3 short bullets

  "findings": [ /* Finding[] — §3 */ ],
  "clauses": [ /* Clause[] — §4 */ ],
  "expected_clauses": [ /* ExpectedClauseCheck[] — §5 */ ],
  "spoken_script": [ /* SpokenSegment[] — §6 */ ],
  "completeness": { /* Completeness — §7 */ },
  "ocr": { /* OcrMeta — §8 */ },
  "meta": { /* Meta — §9 */ }
}
```

---

## 3. `Finding`

```jsonc
{
  "finding_id": "F1",
  "rule_id": "IN_KA_DEPOSIT_CAP",        // MUST exist in active pack, else dropped
  "category": "deposit",
  "title": "Deposit exceeds local norm",
  "basis_type": "above_local_norm",
  "severity": "caution",
  "benchmark": { "metric": "deposit_months", "max_fair_value": 3, "typical_label": "2–3 months" },

  "statutory_citation": {                // null when rule not in active pack
    "act": "Karnataka Rent Act, 1999",
    "section": "…",
    "source_url": "https://indiacode.nic.in"
  },

  "clause_id": "c3",                     // anchor for scroll/pulse
  "quote": "Interest-free security deposit of ₹2,00,000 …",
  "quote_verified": true,                // Jaccard >= 0.80 against clause text
  "jaccard": 0.93,                       // null when quote_verified=false (quote dropped)

  "explanation": "Your deposit is ten months' rent …",
  "negotiation_ask": {
    "short_title": "Cap the deposit",
    "polite_ask": "…",
    "firm_ask": "…",
    "replacement_wording": "…"
  }
}
```

Rules:
- `statutory_citation` is `null` unless `rule_id` resolves in the **active** pack.
- `quote_verified=false` ⇒ `quote` and `jaccard` are `null`; the finding still renders the explanation.
- `severity` drives the color triplet; `basis_type` drives the legal label.

---

## 4. `Clause`

```jsonc
{
  "clause_id": "c3",
  "index": 3,                            // 1-based clause number as printed
  "heading": "Security Deposit",
  "text": "verbatim clause text…",       // OCR output; digits may hold --verify-ocr-* tokens
  "page": 2,
  "status": "ok",                        // "ok" | "gap" | "illegible"
  "finding_ids": ["F1"],
  "ocr_tokens": ["--verify-ocr-1--"]     // tokens appearing in `text`
}
```

---

## 5. `ExpectedClauseCheck`

Derived from the pack's `expected_clauses[]`:

```jsonc
{
  "id": "deposit_refund_days",
  "label": "Specific deposit refund timeline",
  "why_it_matters": "Open-ended refund language delays refunds after handover.",
  "present": false,
  "clause_id": null                      // linked clause when present
}
```

---

## 6. `SpokenSegment` (clause-level playlist — no word karaoke)

```jsonc
{
  "seq": 1,
  "clause_id": "c3",
  "language": "kn",
  "text": "ನಿಮ್ಮ ಠೇವಣಿ ಹತ್ತು ತಿಂಗಳ ಬಾಡಿಗೆಗೆ ಸಮಾನವಾಗಿದೆ.",  // native Indic + English legal terms
  "text_en": "Your deposit equals ten months' rent.",
  "audio_url": "data:audio/mpeg;base64,…" // null until /api/tts; speechSynthesis fallback
}
```

Rules: 12–16 spoken words per segment; no markdown, slashes, or SSML; native Indic script
never Romanized for Bulbul.

---

## 7. `Completeness`

```jsonc
{
  "status": "gaps_detected",             // "complete" | "gaps_detected" | "illegible"
  "pages_found": [1, 2, 4],
  "pages_missing": [3],
  "clause_gaps": [ { "from_clause": 4, "to_clause": 7 } ],
  "illegible_segments": [ { "clause_id": "c8", "page": 4 } ],
  "banner": {
    "level": "amber",
    "message": "Page 3 missing — showing Clause 4 → 7 gap."
  }
}
```

`status != "complete"` ⇒ amber Incomplete Scan Banner is mandatory (zero silent failures).

---

## 8. `OcrMeta`

```jsonc
{
  "engine": "haiku-vision",
  "ocr_digit_tokens": [
    { "token": "--verify-ocr-1--", "raw": "2,00,000", "page": 2, "clause_id": "c3" }
  ],
  "illegible_count": 1
}
```

OCR-digit tokens render in `--verify-ocr-*` style and link to the `Original Scan`.
`raw` is display-only; rupee math always uses the parsed number.

---

## 9. `Meta`

```jsonc
{
  "llm_provider": "openrouter",          // "openrouter" | "anthropic"
  "model": "anthropic/claude-sonnet-5.5",
  "prompt_ids": ["contract.audit@1"],
  "template_hash": "cyrb53:ab12cd34",
  "duration_ms": 4123
}
```

---

## 10. Hard invariants (enforced in `verifier.js` / `api/audit.js`)

1. Every finding has a `rule_id` present in the active pack; otherwise dropped.
2. No `statutory_citation` renders from model memory — pack only.
3. `quote_verified` true ⇒ `jaccard >= 0.80`; otherwise quote dropped.
4. `exposure`, `way_out`, and `saved` are computed in pure JS, not by the LLM.
5. `summary_bullets.length === 3`.
6. `completeness.status != "complete"` ⇒ `completeness.banner != null`.
7. All display strings are escaped at render (`escapeHTML`), never trusted.
8. `language` ∈ `{kn, hi, ta, en}`; `spoken_script[].language` matches.
