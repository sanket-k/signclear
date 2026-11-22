import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const load = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

// Minimal JSON Schema (draft 2020-12) subset — enough for rules/schema.json + preset schema.
// Zero-build: no ajv, no package.json.
function validate(schema, value, path = "$") {
  const errors = [];

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const ok = types.some((t) =>
      t === "integer" ? Number.isInteger(value) : t === "number" ? typeof value === "number" : t === actual
    );
    if (!ok) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${actual}`);
      return errors;
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        errors.push(`${path}: not a valid uri`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.items) {
      value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    }
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) {
        errors.push(...validate(props[key], v, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  return errors;
}

const ruleSchema = load("rules/schema.json");
const packFiles = readdirSync(join(root, "rules")).filter((f) => f.endsWith(".json") && f !== "schema.json");
const packs = new Map(
  packFiles.map((f) => {
    const pack = load(`rules/${f}`);
    return [pack.pack_id, pack];
  })
);

// `*.audit.json` files are audit_result_v1 fixtures (see docs/preset-audit-fixtures.md), not
// contract_preset_v1 — they must never enter the preset assertions below.
const presetFiles = readdirSync(join(root, "public/presets")).filter((f) => f.endsWith(".json") && !f.endsWith(".audit.json"));
const presets = presetFiles.map((f) => load(`public/presets/${f}`));

test("every rule pack validates against rules/schema.json", () => {
  assert.ok(packs.size >= 4, `expected >=4 packs, found ${packs.size}`);
  for (const [id, pack] of packs) {
    assert.deepEqual(validate(ruleSchema, pack), [], `${id} failed schema`);
  }
});

test("every pack carries id, verified_date and a pack_id matching its filename", () => {
  for (const f of packFiles) {
    const pack = load(`rules/${f}`);
    assert.equal(`${pack.pack_id}.json`, f, `pack_id must match filename for ${f}`);
    assert.match(pack.verified_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(pack.pack_id, /^[a-z0-9-]+$/);
  }
});

test("every rule carries basis_type, severity, citation and a full negotiation ask", () => {
  for (const [id, pack] of packs) {
    assert.ok(pack.rules.length > 0, `${id} has no rules`);
    const seen = new Set();
    for (const rule of pack.rules) {
      assert.match(rule.rule_id, /^IN_[A-Z0-9_]+$/, `${id}: bad rule_id ${rule.rule_id}`);
      assert.ok(!seen.has(rule.rule_id), `${id}: duplicate rule_id ${rule.rule_id}`);
      seen.add(rule.rule_id);
      assert.ok(["statutory_conflict", "above_local_norm", "missing_protection", "standard"].includes(rule.basis_type));
      assert.ok(["critical", "caution", "standard", "safe"].includes(rule.severity));
      assert.ok(rule.statutory_citation.act && rule.statutory_citation.section);
      for (const k of ["short_title", "polite_ask", "firm_ask", "replacement_wording"]) {
        assert.ok(rule.negotiation_ask[k]?.trim(), `${id}/${rule.rule_id}: empty negotiation_ask.${k}`);
      }
      assert.ok(rule.detection_hint.length >= 20);
    }
    assert.ok(seen.size === pack.rules.length);
  }
});

test("required pack coverage — rental, RBI loan, employment", () => {
  const required = { "in-ka-rental": "residential_rental", "in-central-rbi-loan": "personal_loan", "in-central-employment": "employment_offer" };
  for (const [id, docType] of Object.entries(required)) {
    assert.ok(packs.has(id), `missing pack ${id}`);
    assert.ok(packs.get(id).contract_types.includes(docType), `${id} missing doc type ${docType}`);
  }
  const rentalIds = packs.get("in-ka-rental").rules.map((r) => r.rule_id);
  for (const r of ["IN_KA_DEPOSIT_CAP", "IN_KA_LOCK_IN_ONE_SIDED", "IN_KA_NOTICE_SYMMETRY", "IN_KA_DEPOSIT_REFUND_TIMELINE", "IN_KA_EXIT_PAINTING_CHARGE"]) {
    assert.ok(rentalIds.includes(r), `in-ka-rental missing ${r}`);
  }
});

test("all four presets exist and point at a valid pack and doc type", () => {
  const ids = presets.map((p) => p.preset_id).sort();
  assert.deepEqual(ids, ["blr-rental", "missing-page-3", "rbi-loan", "startup-offer"]);
  for (const preset of presets) {
    assert.equal(preset.schema_version, "contract_preset_v1");
    const pack = packs.get(preset.expected_pack_id);
    assert.ok(pack, `${preset.preset_id}: unknown pack ${preset.expected_pack_id}`);
    assert.ok(pack.contract_types.includes(preset.document.doc_type), `${preset.preset_id}: doc_type not in pack`);
    assert.ok(preset.pages.length > 0, `${preset.preset_id}: no pages`);
  }
});

test("every expected flag resolves to a rule in its preset's pack", () => {
  for (const preset of presets) {
    const pack = packs.get(preset.expected_pack_id);
    const ruleIds = new Set(pack.rules.map((r) => r.rule_id));
    assert.ok(preset.expected_flags.length > 0, `${preset.preset_id}: no expected flags`);
    for (const flag of preset.expected_flags) {
      assert.ok(ruleIds.has(flag.rule_id), `${preset.preset_id}: ${flag.rule_id} not in ${pack.pack_id}`);
      const rule = pack.rules.find((r) => r.rule_id === flag.rule_id);
      assert.equal(flag.severity, rule.severity, `${preset.preset_id}/${flag.rule_id}: severity drift`);
    }
  }
});

test("pages are ordered and only missing where completeness says so", () => {
  for (const preset of presets) {
    const pages = preset.pages.map((p) => p.page);
    assert.deepEqual(pages, [...pages].sort((a, b) => a - b), `${preset.preset_id}: pages out of order`);
    assert.equal(new Set(pages).size, pages.length, `${preset.preset_id}: duplicate page number`);
    const missing = preset.expected_completeness?.pages_missing || [];
    for (const page of missing) {
      assert.ok(!pages.includes(page), `${preset.preset_id}: page ${page} listed missing but present`);
    }
  }
});

test("missing-page-3 encodes the Clause 4 -> 7 gap honestly", () => {
  const preset = presets.find((p) => p.preset_id === "missing-page-3");
  assert.equal(preset.expected_completeness.status, "gaps_detected");
  assert.deepEqual(preset.expected_completeness.pages_missing, [3]);
  assert.deepEqual(preset.expected_completeness.clause_gaps, [{ from_clause: 4, to_clause: 7 }]);
  assert.deepEqual(preset.pages.map((p) => p.page), [1, 2, 4]);
});

test("document.page_count equals found plus missing pages", () => {
  for (const preset of presets) {
    const found = preset.expected_completeness?.pages_found || preset.pages.map((p) => p.page);
    const missing = preset.expected_completeness?.pages_missing || [];
    assert.equal(
      preset.document.page_count,
      found.length + missing.length,
      `${preset.preset_id}: page_count ${preset.document.page_count} != ${found.length} found + ${missing.length} missing`
    );
    assert.equal(found.length, preset.pages.length, `${preset.preset_id}: pages_found != provided pages`);
  }
});

test("image-lane fixtures declare EXIF handling honestly", () => {
  for (const preset of presets) {
    if (preset.document.source_lane === "image_photo") {
      assert.ok(preset.expected_completeness, `${preset.preset_id}: image lane needs completeness metadata`);
    }
    assert.ok(["vector_pdf", "image_photo"].includes(preset.document.source_lane));
  }
});

test("fixtures never mask cities or states", () => {
  for (const preset of presets) {
    for (const type of Object.keys(preset.expected_pii?.pii_token_types || {})) {
      assert.ok(!["city", "state", "location"].includes(type), `${preset.preset_id}: must not mask ${type}`);
    }
  }
  const blr = presets.find((p) => p.preset_id === "blr-rental");
  const text = blr.pages.map((p) => p.text).join("\n");
  assert.match(text, /Bengaluru/);
  assert.match(text, /Karnataka/);
});

test("preset PII counts sum to the declared total", () => {
  for (const preset of presets) {
    if (!preset.expected_pii) continue;
    const sum = Object.values(preset.expected_pii.pii_token_types).reduce((a, b) => a + b, 0);
    assert.equal(preset.expected_pii.pii_tokens_found, sum, `${preset.preset_id}: token count mismatch`);
  }
});

// Detectors mirror the Phase 2 pii-guard contract, kept loose so this test fails only when a
// fixture stops containing the thing it claims to contain.
const detectors = {
  aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  phone: /\+\91[\s-]?\d{5}[\s-]?\d{5}\b/g,
  email: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,
  upi: /\b[\w.-]+@(?:okhdfcbank|okicici|oksbi|okaxis|paytm|ybl|upi)\b/g,
};

test("declared PII token types are actually present in the fixture text", () => {
  for (const preset of presets) {
    const declared = preset.expected_pii?.pii_token_types || {};
    const text = preset.pages.map((p) => p.text).join("\n");
    for (const [type, count] of Object.entries(declared)) {
      const detector = detectors[type];
      if (!detector) continue;
      detector.lastIndex = 0;
      const hits = text.match(detector) || [];
      assert.equal(hits.length, count, `${preset.preset_id}: declared ${count} ${type}, found ${hits.length}`);
    }
  }
});

test("every fixture declares a valid PII shield shape", () => {
  const allowed = ["aadhaar", "pan", "phone", "email", "upi", "party_header"];
  for (const preset of presets) {
    assert.ok(preset.expected_pii, `${preset.preset_id}: missing expected_pii`);
    for (const type of Object.keys(preset.expected_pii.pii_token_types)) {
      assert.ok(allowed.includes(type), `${preset.preset_id}: unknown PII type ${type}`);
    }
  }
});

test("declared party_header count matches the fixture's party blocks", () => {
  const roleMarker = /\(the (?:Owner|Tenant|Borrower|Lender|Employee|Employer|Landlord|Guarantor)\)/g;
  const labelledParty = /\b(?:Borrower|Lender|Guarantor|Owner|Tenant|Employee|Employer|Landlord)\s*:/g;
  const streetAddress = /\bresiding at\b/g;
  for (const preset of presets) {
    const declared = preset.expected_pii.pii_token_types.party_header || 0;
    const text = preset.pages.map((p) => p.text).join("\n");
    const count = (re) => (text.match(re) || []).length;
    const expected = count(roleMarker) + count(labelledParty) + count(streetAddress);
    assert.equal(declared, expected, `${preset.preset_id}: party_header ${declared} but fixture has ${expected} party blocks`);
  }
});

test("blr-rental privacy block matches the frozen mock-audit fixture", () => {
  const mock = load("public/mock-audit.json");
  const preset = presets.find((p) => p.preset_id === "blr-rental");
  assert.equal(preset.expected_pii.pii_tokens_found, mock.document.privacy.pii_tokens_found);
  assert.deepEqual(preset.expected_pii.pii_token_types, mock.document.privacy.pii_token_types);
  assert.equal(preset.expected_pack_id, mock.pack.pack_id);
  assert.equal(preset.document.doc_type, mock.document.doc_type);
});

test("blr-rental flag clause numbers agree with the mock clause indices", () => {
  const mock = load("public/mock-audit.json");
  const preset = presets.find((p) => p.preset_id === "blr-rental");
  const mockIndexByRule = new Map(
    mock.findings.map((f) => [f.rule_id, mock.clauses.find((c) => c.clause_id === f.clause_id).index])
  );
  for (const flag of preset.expected_flags) {
    assert.equal(
      flag.clause_index,
      mockIndexByRule.get(flag.rule_id),
      `${flag.rule_id}: preset clause ${flag.clause_index} != mock clause ${mockIndexByRule.get(flag.rule_id)}`
    );
  }
});

test("blr-rental fixture text contains each finding's verified quote verbatim", () => {
  const mock = load("public/mock-audit.json");
  const preset = presets.find((p) => p.preset_id === "blr-rental");
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9₹\s]/g, " ").replace(/\s+/g, " ").trim();
  const fixtureText = norm(preset.pages.map((p) => p.text).join(" "));
  for (const finding of mock.findings) {
    if (!finding.quote) continue;
    assert.ok(
      fixtureText.includes(norm(finding.quote)),
      `${finding.finding_id}: quote not present in blr-rental fixture text`
    );
  }
});

test("every fixture's expected flags are a subset of its pack's finding-able rules", () => {
  for (const preset of presets) {
    const pack = packs.get(preset.expected_pack_id);
    const ruleIds = pack.rules.map((r) => r.rule_id).sort();
    for (const flag of preset.expected_flags) {
      assert.ok(ruleIds.includes(flag.rule_id), `${preset.preset_id}: ${flag.rule_id}`);
    }
  }
});

test("expected_flags clause_index values are plausible (>=1, unique per rule)", () => {
  for (const preset of presets) {
    const seen = new Set();
    for (const flag of preset.expected_flags) {
      assert.ok(Number.isInteger(flag.clause_index) && flag.clause_index >= 1, `${preset.preset_id}: bad clause_index`);
      assert.ok(!seen.has(flag.rule_id), `${preset.preset_id}: duplicate flag ${flag.rule_id}`);
      seen.add(flag.rule_id);
    }
  }
});

test("every expected flag points at a clause number actually printed in the fixture", () => {
  for (const preset of presets) {
    const text = preset.pages.map((p) => p.text).join("\n");
    const printed = new Set([...text.matchAll(/(?:^|\n)\s*(\d{1,2})\.\s+[A-Z]/g)].map((m) => Number(m[1])));
    assert.ok(printed.size > 0, `${preset.preset_id}: no numbered clauses found in fixture text`);
    for (const flag of preset.expected_flags) {
      assert.ok(
        printed.has(flag.clause_index),
        `${preset.preset_id}: ${flag.rule_id} -> clause ${flag.clause_index}, but fixture prints clauses [${[...printed].sort((a, b) => a - b)}]`
      );
    }
  }
});

test("missing-page-3 flags never point into the missing clause range", () => {
  const preset = presets.find((p) => p.preset_id === "missing-page-3");
  const gaps = preset.expected_completeness.clause_gaps;
  for (const flag of preset.expected_flags) {
    for (const gap of gaps) {
      const inGap = flag.clause_index > gap.from_clause && flag.clause_index < gap.to_clause;
      assert.ok(!inGap, `${flag.rule_id}: clause ${flag.clause_index} sits inside the unread gap ${gap.from_clause}->${gap.to_clause}`);
    }
  }
});

test("mock-audit rule ids all resolve in the active pack", () => {
  const mock = load("public/mock-audit.json");
  const pack = packs.get(mock.pack.pack_id);
  assert.ok(pack, `mock pack ${mock.pack.pack_id} not found`);
  const ruleIds = new Set(pack.rules.map((r) => r.rule_id));
  for (const finding of mock.findings) {
    assert.ok(ruleIds.has(finding.rule_id), `mock finding ${finding.finding_id} rule ${finding.rule_id} not in pack`);
  }
});

test("mock-audit satisfies the Checkpoint 1 report floor", () => {
  const mock = load("public/mock-audit.json");
  assert.ok(mock.clauses.length >= 5, "need >=5 clauses");
  const severities = new Set(mock.findings.map((f) => f.severity));
  assert.ok(["critical", "caution", "standard"].every((s) => severities.has(s)), `severities: ${[...severities]}`);
  assert.equal(mock.summary_bullets.length, 3);
  assert.equal(mock.exposure.current, mock.exposure.breakdown.reduce((s, b) => s + b.amount, 0));
  assert.equal(mock.exposure.saved, mock.exposure.current - mock.exposure.negotiated);
  assert.ok(mock.way_out.points.length >= 2 && mock.way_out.months > 0);
});

// Token Jaccard — the same shape verifier.js will use in Phase 2.
function jaccard(a, b) {
  const norm = (s) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9₹\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
    );
  const A = norm(a);
  const B = norm(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

// Packs may use {clause_ref}; the served finding must carry it resolved to the printed clause.
const resolveAsk = (ask, clauseIndex) => ({
  short_title: ask.short_title,
  polite_ask: ask.polite_ask.replaceAll("{clause_ref}", String(clauseIndex)),
  firm_ask: ask.firm_ask.replaceAll("{clause_ref}", String(clauseIndex)),
  replacement_wording: ask.replacement_wording.replaceAll("{clause_ref}", String(clauseIndex)),
});

test("mock citations are the active pack's citations, never model memory", () => {
  const mock = load("public/mock-audit.json");
  const pack = packs.get(mock.pack.pack_id);
  for (const finding of mock.findings) {
    const rule = pack.rules.find((r) => r.rule_id === finding.rule_id);
    assert.ok(rule, `${finding.finding_id}: rule not in pack`);
    const clause = mock.clauses.find((c) => c.clause_id === finding.clause_id);
    assert.deepEqual(
      finding.statutory_citation,
      rule.statutory_citation,
      `${finding.finding_id}: citation must equal pack citation`
    );
    assert.deepEqual(finding.benchmark.max_fair_value, rule.benchmark.max_fair_value, `${finding.finding_id}: benchmark drift`);
    assert.deepEqual(
      finding.negotiation_ask,
      resolveAsk(rule.negotiation_ask, clause.index),
      `${finding.finding_id}: ask must be the pack ask with {clause_ref} resolved`
    );
    assert.equal(finding.basis_type, rule.basis_type);
    assert.equal(finding.severity, rule.severity);
    assert.equal(finding.title, rule.title);
  }
});

test("no pack leaves an unresolved {clause_ref} in a served-shape field", () => {
  for (const [id, pack] of packs) {
    for (const rule of pack.rules) {
      for (const [key, value] of Object.entries(rule.negotiation_ask)) {
        if (key === "short_title") continue;
        assert.ok(!/\{\w+\}/.test(value.replaceAll("{clause_ref}", "")), `${id}/${rule.rule_id}.${key}: stray placeholder`);
      }
    }
  }
  const mock = load("public/mock-audit.json");
  for (const finding of mock.findings) {
    for (const value of Object.values(finding.negotiation_ask)) {
      assert.ok(!value.includes("{clause_ref}"), `${finding.finding_id}: served ask still has placeholder`);
    }
  }
});

test("every verified mock quote actually passes Jaccard >= 0.80 against its clause", () => {
  const mock = load("public/mock-audit.json");
  const clauseById = new Map(mock.clauses.map((c) => [c.clause_id, c]));
  for (const finding of mock.findings) {
    const clause = clauseById.get(finding.clause_id);
    assert.ok(clause, `${finding.finding_id}: clause ${finding.clause_id} missing`);
    if (finding.quote_verified) {
      const score = jaccard(finding.quote, clause.text);
      assert.ok(score >= 0.8, `${finding.finding_id}: quote scores ${score.toFixed(3)} < 0.80`);
      assert.equal(
        Number(score.toFixed(3)),
        Number(finding.jaccard.toFixed(3)),
        `${finding.finding_id}: declared jaccard ${finding.jaccard} must equal computed ${score.toFixed(3)}`
      );
      assert.equal(typeof finding.quote, "string");
    } else {
      assert.equal(finding.quote, null);
      assert.equal(finding.jaccard, null);
    }
  }
});

test("mock clause <-> finding links are bidirectional and complete", () => {
  const mock = load("public/mock-audit.json");
  const findingIds = new Set(mock.findings.map((f) => f.finding_id));
  for (const clause of mock.clauses) {
    for (const id of clause.finding_ids) {
      assert.ok(findingIds.has(id), `${clause.clause_id}: dangling finding ${id}`);
      const finding = mock.findings.find((f) => f.finding_id === id);
      assert.equal(finding.clause_id, clause.clause_id, `${id}: back-link mismatch`);
    }
  }
  for (const finding of mock.findings) {
    const clause = mock.clauses.find((c) => c.clause_id === finding.clause_id);
    assert.ok(clause.finding_ids.includes(finding.finding_id), `${finding.finding_id}: not listed on its clause`);
  }
});

test("mock spoken script is clause-anchored, same language, and within spoken rules", () => {
  const mock = load("public/mock-audit.json");
  const clauseIds = new Set(mock.clauses.map((c) => c.clause_id));
  const seqs = mock.spoken_script.map((s) => s.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "spoken seq must be ascending");
  for (const seg of mock.spoken_script) {
    assert.ok(clauseIds.has(seg.clause_id), `spoken ${seg.seq}: unknown clause ${seg.clause_id}`);
    assert.equal(seg.language, mock.language, `spoken ${seg.seq}: language must match audit language`);
    assert.match(seg.language, /^(kn|hi|ta|en)$/);
    assert.ok(!/[#*/\\]|<[^>]+>/.test(seg.text.replace(/--verify-ocr-\d+--/g, "")), `spoken ${seg.seq}: markdown/ssml/slash`);
    const words = seg.text.trim().split(/\s+/).length;
    assert.ok(words >= 8 && words <= 24, `spoken ${seg.seq}: ${words} words outside calm-speech band`);
    assert.ok(seg.text_en?.trim(), `spoken ${seg.seq}: text_en required`);
  }
});

test("mock completeness, banner and language obey the contract", () => {
  const mock = load("public/mock-audit.json");
  assert.match(mock.schema_version, /^audit_result_v1$/);
  assert.ok(["kn", "hi", "ta", "en"].includes(mock.language));
  assert.equal(mock.score.value >= 0 && mock.score.value <= 100, true);
  assert.ok(["risky", "caution", "fair", "safe"].includes(mock.score.band));
  if (mock.completeness.status !== "complete") {
    assert.ok(mock.completeness.banner, "non-complete status needs a banner");
    assert.equal(mock.completeness.banner.level, "amber");
  }
  const lastMonth = mock.way_out.points.at(-1);
  assert.equal(lastMonth.current_loss, 0, "terminal Way-Out loss should be 0");
  assert.equal(lastMonth.negotiated_loss, 0);
});

test("mock expected_clauses mirror the active pack's expected_clauses", () => {
  const mock = load("public/mock-audit.json");
  const pack = packs.get(mock.pack.pack_id);
  assert.deepEqual(
    mock.expected_clauses.map((c) => c.id),
    pack.expected_clauses.map((c) => c.id),
    "expected_clauses ids must match the pack"
  );
  for (const check of mock.expected_clauses) {
    const source = pack.expected_clauses.find((c) => c.id === check.id);
    assert.equal(check.label, source.label);
    assert.equal(check.why_it_matters, source.why_it_matters);
    assert.equal(typeof check.present, "boolean");
    if (check.present) {
      assert.ok(mock.clauses.some((c) => c.clause_id === check.clause_id), `${check.id}: present but no clause`);
    } else {
      assert.equal(check.clause_id, null);
    }
  }
});

test("mock every expected_clause id matches a pack across all presets' packs", () => {
  const mock = load("public/mock-audit.json");
  const allPackClauseIds = new Set([...packs.values()].flatMap((p) => p.expected_clauses.map((c) => c.id)));
  for (const check of mock.expected_clauses) {
    assert.ok(allPackClauseIds.has(check.id), `${check.id} not defined by any pack`);
  }
});
