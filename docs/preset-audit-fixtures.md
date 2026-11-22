# Offline preset audit fixtures — `public/presets/<id>.audit.json`

Why: `/api/audit` needs network + API keys. On stage, and on any failure, the app must
render a **correct, distinct** report per preset. Today every preset falls back to
`mock-audit.json` (the BLR rental), so `missing-page-3` never shows its amber gap banner
and `rbi-loan` / `startup-offer` show the wrong pack. These four files fix that.

## Rule

Each file is a complete `audit_result_v1` object (see `docs/audit-result.schema.md` §2)
**derived from its own preset and rule pack** — never copy-pasted from
`mock-audit.json`. The only thing shared is the shape.

Derive from:
- `public/presets/<id>.json` → `pages[]`, `expected_flags[]`, `expected_pack_id`,
  `expected_completeness`, `document`
- `rules/<expected_pack_id>.json` → each `rule_id`'s `title`, `basis_type`, `severity`,
  `benchmark`, `statutory_citation`, `negotiation_ask`

## Hard requirements

1. `schema_version` = `"audit_result_v1"`; `audit_id` unique per file; `meta.llm_provider`
   = `"fixture"`.
2. `pack.pack_id` = the preset's `expected_pack_id`; `pack.fallback_used` = `false`.
3. `findings[]` — exactly one per entry in `expected_flags`:
   - `rule_id` must exist in that pack (the validator enforces this)
   - `severity` must equal the rule's `severity` (no drift)
   - `clause_id` must reference a `clauses[].clause_id` in the same file
   - `quote` must be a verbatim substring of that clause's `text` (Jaccard 1.0);
     set `quote_verified: true`, `jaccard: 1`
   - copy `title`, `basis_type`, `benchmark`, `statutory_citation`, `negotiation_ask`
     from the rule, filling `{clause_ref}` with the printed clause number
4. `clauses[]` — one per preset page section, ids `c1..cN`, sequential `index`, real
   `text` from the preset pages. `status` `"ok"` except `missing-page-3`.
5. `summary_bullets` — **exactly 3**, each ≤14 words, no "Illegal"/"Sue"/"AI Lawyer".
6. `exposure` + `way_out` — integer rupees; run the documented formulas by hand:
   `lossAt(m,total) = m >= term ? 0 : round(total*(term-m)/(term-1))`.
   `way_out.points` at months `{1, round(term/2), term}`.
7. `spoken_script` — one segment per finding, `seq` from 1, native-script `text` for
   `kn|hi|ta` **and** an English `text_en`, 12–16 words, no markdown/slashes/SSML.
8. `completeness` — copy the preset's `expected_completeness`; give it a `banner`:
   `{ "message": "..." }` only when status ≠ `complete`.

## Validator

`tests/preset-audits.test.mjs` (owned by lane w20) asserts, for all four:

- file parses, `schema_version` correct, unique `audit_id`
- `pack.pack_id === preset.expected_pack_id`
- every `findings[].rule_id` is in that pack, with matching `severity`
- every finding's `clause_id` exists in `clauses[]`
- every verified `quote` is a verbatim substring of its clause text
- `summary_bullets.length === 3`
- `exposure` and `way_out` are internally consistent (saved = current - negotiated;
  last point is 0/0)
- `missing-page-3` has `completeness.status !== "complete"`,
  `pages_missing` includes 3, and `clause_gaps` includes `{from_clause:4,to_clause:7}`
