// SignClear — verifier.js
// Canonical exposure / Way-Out math + the anti-hallucination gate.
// docs/shared-contract.md §1 is the spec; docs/audit-result.schema.md §10 is the invariant list.
// ZERO DOM dependencies: this module runs under `node --test` unchanged.

/** Jaccard threshold above which an LLM quote counts as a verified excerpt. */
export const JACCARD_THRESHOLD = 0.8;

/** Tokens are lowercased, punctuation becomes space, whitespace-split, deduped.
 *  Identical to the tokenizer in tests/fixtures.test.mjs. */
function tokenize(text) {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9₹\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** |A∩B| / |A∪B|; an empty union scores 1 (two empty texts are "the same"). */
export function jaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  let inter = 0;
  for (const token of A) if (B.has(token)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Verify a model-supplied quote against the clause text it claims to quote.
 * Below threshold the quote is dropped (`quote: null`) — it is never rendered.
 * @returns {{ verified: boolean, jaccard: number, quote: string|null }}
 */
export function verifyQuote(quote, clauseText) {
  const q = typeof quote === "string" ? quote : "";
  if (!q.trim()) return { verified: false, jaccard: 0, quote: null };
  const score = jaccard(q, clauseText);
  const verified = score >= JACCARD_THRESHOLD;
  return { verified, jaccard: score, quote: verified ? q : null };
}

/**
 * The only legal source of a statutory citation: the active rule pack.
 * Returns null when the rule_id is unknown — model memory is never trusted.
 */
export function resolveCitation(ruleId, pack) {
  if (!ruleId || !pack || !Array.isArray(pack.rules)) return null;
  const rule = pack.rules.find((r) => r && r.rule_id === ruleId);
  return rule && rule.statutory_citation ? rule.statutory_citation : null;
}

const num = (value, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const money = (value) => Math.max(0, Math.round(num(value)));

/** Default deposit benchmark when the pack does not supply one (Bengaluru norm). */
const DEFAULT_DEPOSIT_CAP_MONTHS = 3;

/**
 * Deterministic rupee exposure. No LLM, no network, no floats in the output.
 * @param {{
 *   monthly_rent?: number, deposit_amount?: number, deposit_cap_months?: number,
 *   painting_charge?: number, lock_in_penalty?: number, asks_selected?: string[]
 * }} inputs
 * @returns {{ currency: "INR", current: number, negotiated: number, saved: number,
 *   breakdown: Array<{ label: string, amount: number, negotiated_amount: number }> }}
 */
export function computeExposure(inputs) {
  const i = inputs && typeof inputs === "object" ? inputs : {};
  const monthlyRent = money(i.monthly_rent);
  const depositAmount = money(i.deposit_amount);
  const capMonths =
    typeof i.deposit_cap_months === "number" && Number.isFinite(i.deposit_cap_months) && i.deposit_cap_months > 0
      ? i.deposit_cap_months
      : DEFAULT_DEPOSIT_CAP_MONTHS;
  const paintingCharge = money(i.painting_charge);
  const lockInPenalty = money(i.lock_in_penalty);
  const asks = Array.isArray(i.asks_selected) ? i.asks_selected.map(String) : [];

  const breakdown = [];

  if (depositAmount > 0) {
    breakdown.push({
      label: "Deposit at risk",
      amount: depositAmount,
      negotiated_amount: Math.round(Math.min(depositAmount, monthlyRent * capMonths)),
    });
  }

  if (paintingCharge > 0) {
    breakdown.push({
      label: "Painting / exit charge",
      amount: paintingCharge,
      negotiated_amount: asks.includes("painting") ? 0 : paintingCharge,
    });
  }

  if (lockInPenalty > 0) {
    breakdown.push({
      label: "Lock-in penalty",
      amount: lockInPenalty,
      negotiated_amount: asks.includes("lock_in") ? 0 : lockInPenalty,
    });
  }

  const current = breakdown.reduce((sum, line) => sum + line.amount, 0);
  const negotiated = breakdown.reduce((sum, line) => sum + line.negotiated_amount, 0);

  return { currency: "INR", current, negotiated, saved: current - negotiated, breakdown };
}

/** Loss if you exit at month `m` out of `term`. Terminal month loses nothing. */
function lossAt(m, total, term) {
  if (m >= term) return 0;
  const denom = term - 1;
  if (denom <= 0) return 0;
  return Math.round((total * (term - m)) / denom);
}

/**
 * Three sampled points on the Way-Out slider: first month, mid-term, contract end.
 * @param {{ current?: number, negotiated?: number, term_months?: number }} inputs
 * @returns {{ months: number, points: Array<{ exit_month: number, current_loss: number, negotiated_loss: number }> }}
 */
export function computeWayOut(inputs) {
  const i = inputs && typeof inputs === "object" ? inputs : {};
  const term = Math.max(1, Math.round(num(i.term_months, 12)));
  const current = money(i.current);
  const negotiated = money(i.negotiated);

  const exitMonths = [...new Set([1, Math.round(term / 2), term])]
    .filter((m) => Number.isInteger(m) && m >= 1 && m <= term)
    .sort((a, b) => a - b);

  return {
    months: term,
    points: exitMonths.map((exitMonth) => ({
      exit_month: exitMonth,
      current_loss: lossAt(exitMonth, current, term),
      negotiated_loss: lossAt(exitMonth, negotiated, term),
    })),
  };
}

// ---------------------------------------------------------------------------
// buildAuditReport — applies every docs/audit-result.schema.md §10 invariant.
// ---------------------------------------------------------------------------

const LANGUAGES = ["kn", "hi", "ta", "en"];
const BANDS = ["risky", "caution", "fair", "safe"];
const BASIS_TYPES = ["statutory_conflict", "above_local_norm", "missing_protection", "standard"];
const SEVERITIES = ["critical", "caution", "standard", "safe"];

const FALLBACK_BULLETS = [
  "This summary is guidance, not legal advice.",
  "Ask for the changes below before you sign.",
  "Amounts are estimated from the figures printed in your agreement.",
];

function bandForScore(value) {
  if (value < 50) return "risky";
  if (value < 70) return "caution";
  if (value < 85) return "fair";
  return "safe";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

const round3 = (value) => Number(Number(value).toFixed(3));

/** Fill {clause_ref} in a pack negotiation ask with the printed clause number. */
function resolveAsk(ask, clauseIndex) {
  if (!ask || typeof ask !== "object") return null;
  const ref = clauseIndex === null || clauseIndex === undefined ? "this clause" : String(clauseIndex);
  const out = {};
  for (const [key, value] of Object.entries(ask)) {
    out[key] = typeof value === "string" ? value.replaceAll("{clause_ref}", ref) : value;
  }
  return out;
}

/**
 * Normalise whatever the model produced into a renderable audit_result_v1.
 * Never throws: every optional field falls back to a safe default.
 * @param {object} raw  /api/audit payload (findings + math_inputs, no rupee math)
 * @param {object} pack active rule pack (the only citation authority)
 * @returns {object} AuditResult
 */
export function buildAuditReport(raw, pack) {
  const r = asObject(raw);
  const p = asObject(pack);
  const packRules = asArray(p.rules).filter((rule) => rule && rule.rule_id);
  const ruleById = new Map(packRules.map((rule) => [rule.rule_id, rule]));

  const language = LANGUAGES.includes(r.language) ? r.language : "en";

  // --- clauses -------------------------------------------------------------
  const clauses = asArray(r.clauses).map((input, i) => {
    const c = asObject(input);
    const clauseId = asString(c.clause_id, `c${i + 1}`) || `c${i + 1}`;
    const index = Number.isInteger(c.index) && c.index > 0 ? c.index : i + 1;
    const status = ["ok", "gap", "illegible"].includes(c.status) ? c.status : "ok";
    return {
      clause_id: clauseId,
      index,
      heading: asString(c.heading),
      text: asString(c.text),
      page: Number.isInteger(c.page) && c.page > 0 ? c.page : 1,
      status,
      finding_ids: [],
      ocr_tokens: asArray(c.ocr_tokens).filter((t) => typeof t === "string"),
    };
  });
  const clauseById = new Map(clauses.map((clause) => [clause.clause_id, clause]));

  // --- findings (invariant 1, 2, 3) ---------------------------------------
  const findings = [];
  for (const input of asArray(r.findings)) {
    const f = asObject(input);
    const ruleId = asString(f.rule_id);
    if (!ruleId || !ruleById.has(ruleId)) continue; // invariant 1 — dropped
    const rule = ruleById.get(ruleId);
    const clause = clauseById.get(asString(f.clause_id));
    const clauseText = typeof f.clause_text === "string" && f.clause_text ? f.clause_text : clause ? clause.text : "";

    // invariant 3 — quote only survives verification
    let quote = null;
    let quoteVerified = false;
    let quoteScore = null;
    const rawQuote = typeof f.quote === "string" ? f.quote : "";
    if (rawQuote.trim() && clauseText) {
      const check = verifyQuote(rawQuote, clauseText);
      quoteVerified = check.verified;
      quote = check.quote;
      quoteScore = round3(check.jaccard);
    }
    if (!quoteVerified) {
      quote = null;
      quoteScore = null;
    }

    const severity = SEVERITIES.includes(f.severity) ? f.severity : rule.severity || "standard";
    const basisType = BASIS_TYPES.includes(f.basis_type) ? f.basis_type : rule.basis_type || "standard";

    findings.push({
      finding_id: asString(f.finding_id, `F${findings.length + 1}`) || `F${findings.length + 1}`,
      rule_id: ruleId,
      category: asString(f.category, rule.category || "general") || "general",
      title: asString(f.title, rule.title || ""),
      basis_type: basisType,
      severity,
      benchmark: typeof f.benchmark === "object" && f.benchmark !== null ? f.benchmark : rule.benchmark || null,
      // invariant 2 — pack only, never model memory
      statutory_citation: resolveCitation(ruleId, p),
      clause_id: clause ? clause.clause_id : null,
      quote,
      quote_verified: quoteVerified,
      jaccard: quoteScore,
      explanation: asString(f.explanation),
      negotiation_ask: asObject(f.negotiation_ask).short_title
        ? f.negotiation_ask
        : resolveAsk(rule.negotiation_ask, clause ? clause.index : null),
    });
  }

  // Re-link clauses -> findings so both directions agree.
  for (const finding of findings) {
    const clause = finding.clause_id ? clauseById.get(finding.clause_id) : null;
    if (clause) clause.finding_ids.push(finding.finding_id);
  }

  // --- math (invariant 4) --------------------------------------------------
  const mathInputs = asObject(r.math_inputs);
  const exposure = computeExposure(mathInputs);
  const wayOut = computeWayOut({
    current: exposure.current,
    negotiated: exposure.negotiated,
    term_months: num(mathInputs.term_months, 12),
  });

  // --- summary bullets (invariant 5) --------------------------------------
  const bullets = asArray(r.summary_bullets)
    .filter((b) => typeof b === "string" && b.trim())
    .slice(0, 3);
  let bi = 0;
  while (bullets.length < 3) bullets.push(FALLBACK_BULLETS[bi++ % FALLBACK_BULLETS.length]);

  // --- score ---------------------------------------------------------------
  const rawScore = asObject(r.score);
  const scoreValue = Math.min(100, Math.max(0, Math.round(num(rawScore.value, 50))));
  const band = BANDS.includes(rawScore.band) ? rawScore.band : bandForScore(scoreValue);

  // --- completeness (invariant 6) -----------------------------------------
  const rawCompleteness = asObject(r.completeness);
  const pagesMissing = asArray(rawCompleteness.pages_missing).filter((n) => Number.isInteger(n));
  let status = ["complete", "gaps_detected", "illegible"].includes(rawCompleteness.status)
    ? rawCompleteness.status
    : pagesMissing.length
      ? "gaps_detected"
      : "complete";
  let banner = rawCompleteness.banner && typeof rawCompleteness.banner === "object" ? rawCompleteness.banner : null;
  if (!banner && status !== "complete") {
    banner = {
      level: "amber",
      message: pagesMissing.length
        ? `Page ${pagesMissing.join(", ")} missing — parts of this agreement could not be read.`
        : "Some parts of this agreement could not be read — check the original scan.",
    };
  }
  if (status === "complete") banner = null;

  // --- document ------------------------------------------------------------
  const rawDoc = asObject(r.document);
  const rawPrivacy = asObject(rawDoc.privacy);
  const privacyTypes = asObject(rawPrivacy.pii_token_types);
  const pageCount =
    Number.isInteger(rawDoc.page_count) && rawDoc.page_count > 0
      ? rawDoc.page_count
      : Math.max(pagesMissing.length + asArray(r.pages).length, clauses.length ? Math.max(...clauses.map((c) => c.page)) : 0, 1);

  // --- expected_clauses ----------------------------------------------------
  const rawChecks = new Map(
    asArray(r.expected_clauses)
      .map((c) => asObject(c))
      .filter((c) => typeof c.id === "string")
      .map((c) => [c.id, c])
  );
  const expectedSource = asArray(p.expected_clauses).length
    ? asArray(p.expected_clauses)
    : asArray(r.expected_clauses);
  const expectedClauses = expectedSource.map((input) => {
    const check = asObject(input);
    const served = rawChecks.get(check.id) || {};
    const present = typeof served.present === "boolean" ? served.present : false;
    const clauseId = present ? asString(served.clause_id, check.clause_id || "") || null : null;
    return {
      id: asString(check.id),
      label: asString(check.label),
      why_it_matters: asString(check.why_it_matters),
      present,
      clause_id: clauseId && clauseById.has(clauseId) ? clauseId : null,
    };
  });

  // --- spoken script (invariant 8) ----------------------------------------
  const spoken = asArray(r.spoken_script).map((input, i) => {
    const s = asObject(input);
    return {
      seq: Number.isInteger(s.seq) ? s.seq : i + 1,
      clause_id: clauseById.has(asString(s.clause_id)) ? s.clause_id : null,
      language,
      text: asString(s.text),
      text_en: asString(s.text_en),
      audio_url: typeof s.audio_url === "string" ? s.audio_url : null,
    };
  });

  const rawOcr = asObject(r.ocr);
  const rawMeta = asObject(r.meta);
  const rawPack = asObject(r.pack);
  const packId = asString(p.pack_id) || asString(rawPack.pack_id) || "in-general-fallback";
  const fallbackUsed =
    typeof rawPack.fallback_used === "boolean" ? rawPack.fallback_used : packId === "in-general-fallback";

  return {
    schema_version: "audit_result_v1",
    audit_id: asString(r.audit_id) || `audit-${Date.now().toString(36)}`,
    created_at: asString(r.created_at) || new Date().toISOString(),
    language,
    pack: {
      schema_version: "rule_pack_v1",
      pack_id: packId,
      display_name: asString(p.display_name),
      jurisdiction: asObject(p.jurisdiction).country
        ? p.jurisdiction
        : { country: "IN", state: null, cities: [] },
      verified_date: asString(p.verified_date),
      legal_basis: asString(p.legal_basis),
      fallback_used: fallbackUsed,
      badge: typeof rawPack.badge === "string" ? rawPack.badge : null,
    },
    document: {
      doc_type: asString(rawDoc.doc_type) || asArray(p.contract_types)[0] || "general",
      title: asString(rawDoc.title),
      source_lane: rawDoc.source_lane === "image_photo" ? "image_photo" : "vector_pdf",
      page_count: pageCount,
      privacy: {
        lane: rawPrivacy.lane === "B" ? "B" : "A",
        pii_tokens_found: Number.isInteger(rawPrivacy.pii_tokens_found)
          ? rawPrivacy.pii_tokens_found
          : Object.values(privacyTypes).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0),
        pii_token_types: {
          aadhaar: num(privacyTypes.aadhaar),
          pan: num(privacyTypes.pan),
          phone: num(privacyTypes.phone),
          email: num(privacyTypes.email),
          upi: num(privacyTypes.upi),
          party_header: num(privacyTypes.party_header),
        },
        exif_stripped: rawPrivacy.exif_stripped !== false,
        zero_retention: rawPrivacy.zero_retention === true,
      },
    },
    score: {
      value: scoreValue,
      band,
      label: asString(rawScore.label),
    },
    exposure,
    way_out: wayOut,
    summary_bullets: bullets,
    findings,
    clauses,
    expected_clauses: expectedClauses,
    spoken_script: spoken,
    completeness: {
      status: status,
      pages_found: asArray(rawCompleteness.pages_found).filter((n) => Number.isInteger(n)),
      pages_missing: pagesMissing,
      clause_gaps: asArray(rawCompleteness.clause_gaps).filter((g) => g && typeof g === "object"),
      illegible_segments: asArray(rawCompleteness.illegible_segments).filter((s) => s && typeof s === "object"),
      banner,
    },
    ocr: {
      engine: asString(rawOcr.engine),
      ocr_digit_tokens: asArray(rawOcr.ocr_digit_tokens).filter((t) => t && typeof t === "object"),
      illegible_count: Number.isInteger(rawOcr.illegible_count) ? rawOcr.illegible_count : 0,
    },
    meta: {
      llm_provider: asString(rawMeta.llm_provider),
      model: asString(rawMeta.model),
      prompt_ids: asArray(rawMeta.prompt_ids).filter((id) => typeof id === "string"),
      template_hash: asString(rawMeta.template_hash),
      duration_ms: num(rawMeta.duration_ms),
    },
  };
}
