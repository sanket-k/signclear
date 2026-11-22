# Preset Contract — `contract_preset_v1`

> One-click demo fixtures in `public/presets/*.json`. Consumed by the intake chips
> (Phase 4 `ingest.js`) and by `tests/fixtures.test.mjs`. A preset is *never* sent to
> `/api/audit` as-is — `ingest.js` turns its `pages[]` into the same text payload a real
> upload produces, so the preset path exercises the real audit code.

**Shape version:** `contract_preset_v1` · **Served from:** `public/presets/`

---

## 1. Top-level shape

```jsonc
{
  "schema_version": "contract_preset_v1",
  "preset_id": "blr-rental",              // must match the .json filename
  "label": "BLR Rental",                  // chip label
  "description": "One-line hint under the chip",
  "language_default": "kn",               // "kn" | "hi" | "ta" | "en"

  "expected_pack_id": "in-ka-rental",     // active pack for this fixture
  "document": {
    "doc_type": "residential_rental",     // must be in the pack's contract_types
    "title": "11-Month Residential Lease — Indiranagar",
    "page_count": 4,
    "source_lane": "vector_pdf"           // "vector_pdf" | "image_photo"
  },

  "pages": [                              // ordered; `page` is 1-based
    { "page": 1, "text": "…verbatim fixture text…" }
  ],

  "expected_flags": [                     // rule_id must exist in expected_pack_id
    { "rule_id": "IN_KA_DEPOSIT_CAP", "clause_index": 3, "severity": "critical" }
  ],

  "expected_completeness": {              // optional; default = complete
    "status": "complete",                 // "complete" | "gaps_detected" | "illegible"
    "pages_found": [1, 2, 3, 4],
    "pages_missing": [],
    "clause_gaps": []                     // [{ "from_clause": 4, "to_clause": 7 }]
  },

  "expected_pii": {                       // optional; drives the pre-upload shield badge
    "pii_tokens_found": 9,
    "pii_token_types": { "aadhaar": 1, "pan": 1, "phone": 1, "email": 1, "upi": 1, "party_header": 4 }
  }
}
```

---

## 2. Rules

- `preset_id` matches the filename (`blr-rental.json` → `blr-rental`).
- `expected_pack_id` must resolve to a `rules/*.json` pack whose `contract_types` contains
  `document.doc_type`.
- Every `expected_flags[].rule_id` must exist in that pack (Phase 0 invariant: no finding
  without a pack rule).
- `pages[]` must use consecutive `page` numbers **except** where `expected_completeness`
  deliberately encodes a missing page. A missing page is honest: the gap must be
  represented in `pages_missing` and in `clause_gaps`.
- Fixture PII is synthetic and is what the local PII shield counts pre-upload. Cities and
  states (`Bengaluru`, `Karnataka`) are **not** PII and must never be masked.
- `party_header` counts masked identity fragments in the party blocks, one per party name
  and one per party street address (e.g. Owner name + Owner address + Tenant name + Tenant
  address = 4). Street lines are masked; the city and state inside them are kept.
- `blr-rental` must agree with the frozen `public/mock-audit.json` privacy block (9 total,
  `party_header` 4) because it is the same demo-hero document on both paths.
- Presets are demo-only and live under `public/`, so no secrets, no real personal data.
