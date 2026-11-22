import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Validator for the four offline preset audit fixtures:
//   public/presets/<id>.audit.json  — audit_result_v1, derived from <id>.json + rules/<pack>.json
// Spec: docs/preset-audit-fixtures.md ("Validator" section).
//
// Fixtures are authored by four sibling lanes and may not be merged yet, so every assertion
// is gated on the file being present. The suite is green (and logs a skip) before they land.

const root = new URL("..", import.meta.url).pathname;
const PRESET_IDS = ["blr-rental", "missing-page-3", "rbi-loan", "startup-offer"];

const auditPath = (id) => `public/presets/${id}.audit.json`;
const presetPath = (id) => `public/presets/${id}.json`;
const packPath = (packId) => `rules/${packId}.json`;
const has = (p) => existsSync(join(root, p));
const readJSON = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

// Present-but-unparseable is a failure, not a skip — record the parse error instead of throwing
// at module load so it surfaces as a precise assertion.
const fixtures = new Map();
for (const id of PRESET_IDS) {
  if (!has(auditPath(id))) {
    fixtures.set(id, { id, present: false });
    continue;
  }
  try {
    fixtures.set(id, { id, present: true, audit: readJSON(auditPath(id)) });
  } catch (error) {
    fixtures.set(id, { id, present: true, parseError: error });
  }
}

const present = PRESET_IDS.filter((id) => fixtures.get(id).present);
const absent = PRESET_IDS.filter((id) => !fixtures.get(id).present);

/** Load one parsed fixture or `null` when the file has not been merged yet. */
function auditOf(id) {
  const entry = fixtures.get(id);
  if (!entry || !entry.present) return null;
  assert.equal(entry.parseError, undefined, `${auditPath(id)} is not valid JSON: ${entry.parseError?.message}`);
  return entry.audit;
}

/** Guard for tests that only make sense once at least one fixture exists. */
function skipUnlessAny() {
  if (present.length === 0) {
    console.log(`no preset audit fixtures present (${absent.length}/4 absent) — skipping`);
    return false;
  }
  return true;
}

function presetPack(id) {
  const preset = readJSON(presetPath(id));
  const packId = preset.expected_pack_id;
  assert.equal(typeof packId, "string", `${presetPath(id)}: expected_pack_id must be a string`);
  assert.ok(has(packPath(packId)), `${id}: expected pack ${packId} has no ${packPath(packId)}`);
  return { preset, packId, pack: readJSON(packPath(packId)) };
}

test("audit fixtures are reported", () => {
  console.log("preset audit fixtures present:", present, "absent:", absent);
  assert.ok(true);
});

test("every fixture parses as JSON with schema_version audit_result_v1 and a unique audit_id", () => {
  if (!skipUnlessAny()) return;
  const seen = new Map();
  for (const id of present) {
    const audit = auditOf(id);
    assert.ok(audit && typeof audit === "object" && !Array.isArray(audit), `${auditPath(id)}: must be a JSON object`);
    assert.equal(audit.schema_version, "audit_result_v1", `${auditPath(id)}: wrong schema_version`);
    assert.equal(typeof audit.audit_id, "string", `${auditPath(id)}: audit_id must be a string`);
    assert.ok(audit.audit_id.trim().length > 0, `${auditPath(id)}: audit_id must be non-empty`);
    assert.ok(!seen.has(audit.audit_id), `${auditPath(id)}: audit_id "${audit.audit_id}" duplicates ${seen.get(audit.audit_id)}`);
    seen.set(audit.audit_id, id);
  }
});

test("pack.pack_id equals the preset's expected_pack_id", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    const { packId } = presetPack(id);
    assert.ok(audit.pack, `${auditPath(id)}: missing pack`);
    assert.equal(audit.pack.pack_id, packId, `${auditPath(id)}: pack.pack_id must be ${packId}`);
    assert.equal(audit.pack.fallback_used, false, `${auditPath(id)}: fixtures must not use the fallback pack`);
  }
});

test("every finding's rule_id exists in its pack and its severity does not drift", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    const { pack, packId } = presetPack(id);
    const rules = new Map(pack.rules.map((rule) => [rule.rule_id, rule]));
    assert.ok(Array.isArray(audit.findings) && audit.findings.length > 0, `${auditPath(id)}: findings must be a non-empty array`);
    for (const finding of audit.findings) {
      const label = `${auditPath(id)} ${finding.finding_id}`;
      const rule = rules.get(finding.rule_id);
      assert.ok(rule, `${label}: rule_id ${finding.rule_id} is not in ${packId}`);
      assert.equal(finding.severity, rule.severity, `${label}: severity drift (${finding.severity} vs pack ${rule.severity})`);
    }
  }
});

test("every finding's clause_id exists in the fixture's clauses[]", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    const clauses = new Map(audit.clauses.map((clause) => [clause.clause_id, clause]));
    for (const finding of audit.findings) {
      assert.ok(
        clauses.has(finding.clause_id),
        `${auditPath(id)} ${finding.finding_id}: clause_id ${finding.clause_id} not in clauses[]`
      );
    }
  }
});

test("every quote_verified finding carries a verbatim quote from its clause", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    const clauses = new Map(audit.clauses.map((clause) => [clause.clause_id, clause]));
    for (const finding of audit.findings) {
      if (finding.quote_verified !== true) continue;
      const clause = clauses.get(finding.clause_id);
      assert.ok(clause, `${auditPath(id)} ${finding.finding_id}: no clause for quote check`);
      assert.equal(typeof finding.quote, "string", `${auditPath(id)} ${finding.finding_id}: verified quote must be a string`);
      assert.ok(finding.quote.length > 0, `${auditPath(id)} ${finding.finding_id}: verified quote must be non-empty`);
      assert.ok(
        clause.text.includes(finding.quote),
        `${auditPath(id)} ${finding.finding_id}: quote is not a verbatim substring of ${finding.clause_id} text`
      );
    }
  }
});

test("summary_bullets is exactly 3 and free of anti-liability copy", () => {
  const banned = /illegal|unlawful|void contract|\bsue\b|ai lawyer|guaranteed/i;
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    assert.equal(audit.summary_bullets.length, 3, `${auditPath(id)}: expected exactly 3 summary bullets`);
    for (const bullet of audit.summary_bullets) {
      assert.equal(typeof bullet, "string", `${auditPath(id)}: bullet must be a string`);
      assert.ok(bullet.trim().length > 0, `${auditPath(id)}: empty summary bullet`);
      assert.ok(!banned.test(bullet), `${auditPath(id)}: anti-liability copy in "${bullet}"`);
    }
  }
});

test("exposure is integer and internally consistent (saved = current - negotiated)", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    const { current, negotiated, saved } = audit.exposure;
    assert.ok(Number.isInteger(current), `${auditPath(id)}: exposure.current must be an integer`);
    assert.ok(Number.isInteger(negotiated), `${auditPath(id)}: exposure.negotiated must be an integer`);
    assert.ok(Number.isInteger(saved), `${auditPath(id)}: exposure.saved must be an integer`);
    assert.equal(saved, current - negotiated, `${auditPath(id)}: saved ${saved} != ${current} - ${negotiated}`);
  }
});

test("way_out points are integer, non-empty, and land on 0/0 at exit", () => {
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    assert.ok(Array.isArray(audit.way_out.points) && audit.way_out.points.length > 0, `${auditPath(id)}: way_out.points must be a non-empty array`);
    for (const [i, point] of audit.way_out.points.entries()) {
      assert.ok(Number.isInteger(point.current_loss), `${auditPath(id)}: points[${i}].current_loss must be an integer`);
      assert.ok(Number.isInteger(point.negotiated_loss), `${auditPath(id)}: points[${i}].negotiated_loss must be an integer`);
    }
    const last = audit.way_out.points.at(-1);
    assert.equal(last.current_loss, 0, `${auditPath(id)}: terminal point current_loss must be 0`);
    assert.equal(last.negotiated_loss, 0, `${auditPath(id)}: terminal point negotiated_loss must be 0`);
  }
});

test("spoken_script segments are complete, clause-anchored and native-script for Indic", () => {
  const kannada = /[\u0C80-\u0CFF]/;
  if (!skipUnlessAny()) return;
  for (const id of present) {
    const audit = auditOf(id);
    assert.ok(Array.isArray(audit.spoken_script) && audit.spoken_script.length > 0, `${auditPath(id)}: spoken_script must be non-empty`);
    const clauseIds = new Set(audit.clauses.map((clause) => clause.clause_id));
    for (const segment of audit.spoken_script) {
      const label = `${auditPath(id)} spoken seq ${segment.seq}`;
      assert.ok(Number.isInteger(segment.seq), `${label}: seq must be an integer`);
      assert.ok(clauseIds.has(segment.clause_id), `${label}: unknown clause_id ${segment.clause_id}`);
      assert.match(segment.language, /^(kn|hi|ta|en)$/, `${label}: language must be kn|hi|ta|en`);
      assert.equal(typeof segment.text, "string", `${label}: text must be a string`);
      assert.ok(segment.text.trim().length > 0, `${label}: text must be non-empty`);
      assert.equal(typeof segment.text_en, "string", `${label}: text_en must be a string`);
      assert.ok(segment.text_en.trim().length > 0, `${label}: text_en must be non-empty`);
      if (segment.language === "kn") {
        assert.ok(kannada.test(segment.text), `${label}: Kannada segment has no Kannada codepoints (Romanized?)`);
      }
    }
  }
});

test("missing-page-3 reports its page 3 gap honestly, with an amber banner", () => {
  const audit = auditOf("missing-page-3");
  if (!audit) {
    console.log("missing-page-3 audit fixture absent — skipping");
    return;
  }
  const completeness = audit.completeness;
  assert.notEqual(completeness.status, "complete", "missing-page-3 must not claim a complete scan");
  assert.ok(Array.isArray(completeness.pages_missing), "completeness.pages_missing must be an array");
  assert.ok(completeness.pages_missing.includes(3), "completeness.pages_missing must include page 3");
  assert.ok(Array.isArray(completeness.clause_gaps), "completeness.clause_gaps must be an array");
  assert.ok(
    completeness.clause_gaps.some((gap) => gap.from_clause === 4 && gap.to_clause === 7),
    "completeness.clause_gaps must include {from_clause: 4, to_clause: 7}"
  );
  assert.equal(typeof completeness.banner?.message, "string", "non-complete scan needs banner.message");
  assert.ok(completeness.banner.message.trim().length > 0, "banner.message must be non-empty");
});

test("the other three fixtures claim a complete scan", () => {
  const others = ["blr-rental", "rbi-loan", "startup-offer"];
  const loaded = others.filter((id) => auditOf(id) !== null);
  if (loaded.length === 0) {
    console.log("no complete-scan audit fixtures present — skipping");
    return;
  }
  for (const id of loaded) {
    assert.equal(auditOf(id).completeness.status, "complete", `${auditPath(id)}: expected completeness.status "complete"`);
    assert.deepEqual(auditOf(id).completeness.pages_missing, [], `${auditPath(id)}: complete scan must not report missing pages`);
  }
});
