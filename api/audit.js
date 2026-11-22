"use strict";

/**
 * POST /api/audit — the pack-grounded auditor.
 *
 * Invariants enforced HERE (docs/audit-result.schema.md §10):
 *  1. Every finding's rule_id must exist in the ACTIVE pack, else dropped.
 *  2. statutory_citation and negotiation_ask come from the pack, never the model.
 *  3. quote_verified => jaccard >= 0.80, else the quote is nulled.
 *  4. No rupee exposure / way_out here — math_inputs only (client computes).
 *  5. summary_bullets.length === 3.
 *  6. completeness.status !== "complete" => banner != null.
 */

const crypto = require("node:crypto");

const { chat, MODELS, PROVIDER, parseJSONFromLLMResponse } = require("./_lib/llm-client");
const { packPromptContext, pickPack, loadPack, ruleIndex } = require("./_lib/rules");
const { buildPrompt, PROMPT_HASHES } = require("./_lib/prompts");

const LANGUAGES = ["kn", "hi", "ta", "en"];
const DOC_TYPES = [
  "residential_rental",
  "personal_loan",
  "employment_offer",
  "commercial_rental",
  "insurance_policy",
  "general",
];

const LANGUAGE_SCRIPT_NAME = {
  kn: "Kannada",
  hi: "Hindi",
  ta: "Tamil",
  en: "English",
};

const SEVERITIES = ["critical", "caution", "standard", "safe"];
const JACCARD_THRESHOLD = 0.8;

const FALLBACK_SPOKEN = {
  kn: "ಈ ಒಪ್ಪಂದದಲ್ಲಿ ಕೆಲವು ಅನ್ಯಾಯದ ಷರತ್ತುಗಳಿವೆ. ಸಹಿ ಮಾಡುವ ಮೊದಲು ಎಚ್ಚರಿಕೆಯಿಂದ ಓದಿ.",
  hi: "इस अनुबंध में कुछ एकतरफा शर्तें हैं। हस्ताक्षर करने से पहले ध्यान से पढ़ें।",
  ta: "இந்த ஒப்பந்தத்தில் சில ஒருதலைச் சார்பான நிபந்தனைகள் உள்ளன. கையெழுத்திடும் முன் கவனமாக படியுங்கள்.",
  en: "This contract has a few one-sided clauses. Read them carefully before you sign.",
};

/* ────────────────────────── helpers: request ────────────────────────── */

function fail(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return {};
}

/* ────────────────────────── helpers: text ────────────────────────── */

/** OWASP LLM01 — strip control chars and fence-breaking tags from untrusted text. */
function sanitizeForPrompt(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<\/?untrusted_contract_text>/gi, "[tag removed]")
    .replace(/\r\n/g, "\n")
    .slice(0, 60000);
}

function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u0DFF\u20B9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return { score: 1, ok: true };
  if (A.size === 0 || B.size === 0) return { score: 0, ok: false };
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  const score = union === 0 ? 1 : inter / union;
  return { score, ok: score >= JACCARD_THRESHOLD };
}

/** Parse "2,00,000" / "40,000" / "₹2,00,000" / "forty thousand" into rupees. */
function parseIndianAmount(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const words = {
    thousand: 1e3,
    lakh: 1e5,
    lakhs: 1e5,
    lac: 1e5,
    crore: 1e7,
  };
  const digits = s.replace(/[^0-9.]/g, "");
  if (digits) {
    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    const unit = Object.keys(words).find((w) => new RegExp(`\\b${w}\\b`).test(s));
    return Math.round(unit ? n * words[unit] : n);
  }
  return null;
}

const AMOUNT_RE = /(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)(?:\s*(thousand|lakh|lakhs|lac|crore))?/i;

/** Find `Rs. X` near a keyword, searching clause text and then the full text. */
function findAmount(text, keywordPattern) {
  const src = String(text || "");
  // The gap may not cross a sentence end or newline: without this, "\brent\b"
  // at the end of "…months rent." would capture the next clause's number ("4").
  // Wrap alternations so "(deposit|equal to)" binds as one keyword; an ungrouped
  // pattern like "deposit|equal\s+to" would let the first branch skip the capture.
  const re = new RegExp(
    `(?:${keywordPattern})[^0-9.\\n]{0,80}(?:rs\\.?|inr|₹)?\\s*([0-9][0-9,]*(?:\\.\\d{1,2})?)`,
    "i"
  );
  const m = re.exec(src);
  if (!m || m[1] == null) return null;
  const amount = parseIndianAmount(m[1]);
  // A bare 1–2 digit hit is almost always a clause number, not rupees.
  if (amount != null && amount < 100 && !/(?:rs|inr|₹)/i.test(m[0])) return null;
  return amount;
}

function countMonths(text, keywordPattern) {
  const src = String(text || "");
  const re = new RegExp(`(?:${keywordPattern})[^\\n\\d]{0,60}([0-9]{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s*(?:\\(\\d{1,2}\\)\\s*)?month`, "i");
  const m = re.exec(src);
  if (!m || m[1] == null) return null;
  const word = m[1].toLowerCase();
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
    nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  return words[word] || Number(word) || null;
}

/* ────────────────────────── clause segmentation ────────────────────────── */

/**
 * Deterministic fallback segmentation when the model returns no clauses.
 * Splits on printed "3. Heading" / "3) Heading" markers, keeping verbatim text.
 */
function splitClausesFromText(text, pageOf) {
  const src = String(text || "");
  const clauses = [];
  const re = /(?:^|\n)\s*(\d{1,2})\s*[.)]\s+([A-Z][^\n.]{0,80})[.\n]/g;
  const hits = [];
  let m;
  while ((m = re.exec(src)) !== null) hits.push({ index: m.index, n: Number(m[1]), heading: m[2].trim() });

  if (hits.length === 0) {
    if (!src.trim()) return [];
    return [
      {
        clause_id: "c1",
        index: 1,
        heading: "Agreement",
        text: src.trim(),
        page: pageOf(0) || 1,
        status: "ok",
        finding_ids: [],
        ocr_tokens: [],
      },
    ];
  }

  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index + (src[hits[i].index] === "\n" ? 1 : 0);
    const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
    const body = src.slice(start, end).trim();
    const withoutNumber = body.replace(/^\d{1,2}\s*[.)]\s*/, "");
    const [firstLine, ...rest] = withoutNumber.split("\n");
    const bodyText = rest.join("\n").trim() || firstLine.trim();
    clauses.push({
      clause_id: `c${i + 1}`,
      index: hits[i].n,
      heading: hits[i].heading.replace(/[.\s]+$/, ""),
      text: bodyText,
      page: pageOf(start) || 1,
      status: bodyText.includes("[ILLEGIBLE]") ? "illegible" : "ok",
      finding_ids: [],
      ocr_tokens: [],
    });
  }
  return clauses;
}

function normaliseClauses(parsedClauses, fallbackText, pageOf) {
  const list = Array.isArray(parsedClauses) ? parsedClauses : [];
  const cleaned = [];
  list.forEach((c, i) => {
    const text = String((c && c.text) || "").trim();
    if (!text) return;
    const index = Number.isFinite(Number(c && c.index)) ? Number(c.index) : i + 1;
    cleaned.push({
      clause_id: `c${i + 1}`,
      index,
      heading: String((c && (c.heading || c.title)) || "").trim().slice(0, 120) || `Clause ${index}`,
      text,
      page: Number.isFinite(Number(c && c.page)) ? Number(c.page) : pageOf(0) || 1,
      status: text.includes("[ILLEGIBLE]") ? "illegible" : "ok",
      finding_ids: [],
      ocr_tokens: [],
    });
  });
  if (cleaned.length > 0) return cleaned;
  return splitClausesFromText(fallbackText, pageOf);
}

function locateClause(clauses, clauseId, quote) {
  if (clauseId) {
    const hit = clauses.find((c) => c.clause_id === clauseId);
    if (hit) return hit;
    // model may return "3" or "3." instead of "c3"
    const num = String(clauseId).replace(/[^0-9]/g, "");
    if (num) {
      const byIndex = clauses.find((c) => String(c.index) === num);
      if (byIndex) return byIndex;
    }
  }
  if (quote) {
    let best = null;
    let bestScore = 0;
    for (const c of clauses) {
      const { score } = jaccard(quote, c.text);
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.35) return best;
  }
  return null;
}

/* ────────────────────────── findings ────────────────────────── */

function resolveClauseRef(ask, clause) {
  const printed = clause ? String(clause.index) : "the relevant clause";
  const replace = (value) =>
    typeof value === "string" ? value.replace(/\{clause_ref\}/g, printed) : value;
  return {
    short_title: replace(ask.short_title),
    polite_ask: replace(ask.polite_ask),
    firm_ask: replace(ask.firm_ask),
    replacement_wording: replace(ask.replacement_wording),
  };
}

function buildFindings(rawFindings, clauses, pack) {
  const index = ruleIndex(pack);
  const kept = [];
  let dropped = 0;

  for (const raw of Array.isArray(rawFindings) ? rawFindings : []) {
    const ruleId = String((raw && raw.rule_id) || "").trim();
    const rule = index.get(ruleId);
    if (!rule) {
      dropped++; // invariant 1: rule must exist in the ACTIVE pack
      continue;
    }

    const clause = locateClause(clauses, raw.clause_id, raw.quote);
    if (!clause) {
      dropped++;
      continue;
    }

    const quote = typeof raw.quote === "string" ? raw.quote.trim() : "";
    const check = quote ? jaccard(quote, clause.text) : { score: 0, ok: false };

    const finding = {
      finding_id: `F${kept.length + 1}`,
      rule_id: rule.rule_id,
      category: rule.category,
      title: rule.title,
      basis_type: rule.basis_type,
      severity: SEVERITIES.includes(rule.severity) ? rule.severity : "caution",
      benchmark: rule.benchmark,
      statutory_citation: rule.statutory_citation || null, // invariant 2: pack only
      clause_id: clause.clause_id,
      quote: check.ok ? quote : null,
      quote_verified: check.ok,
      jaccard: check.ok ? Number(check.score.toFixed(3)) : null,
      explanation: String((raw && raw.explanation) || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400),
      negotiation_ask: resolveClauseRef(rule.negotiation_ask, clause),
    };

    if (!finding.explanation) {
      finding.explanation = `${rule.title}. Worth negotiating before you sign.`;
    }

    clause.finding_ids.push(finding.finding_id);
    kept.push(finding);
  }

  // Stable order: critical → caution → standard → safe.
  const rank = { critical: 0, caution: 1, standard: 2, safe: 3 };
  kept.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
  kept.forEach((f, i) => (f.finding_id = `F${i + 1}`));
  for (const c of clauses) c.finding_ids = [];
  for (const f of kept) {
    const c = clauses.find((x) => x.clause_id === f.clause_id);
    if (c) c.finding_ids.push(f.finding_id);
  }

  return { findings: kept, dropped };
}

/* ────────────────────────── completeness ────────────────────────── */

function buildCompleteness({ clauses, pagesMissing, pages, illegible }) {
  const indices = clauses.map((c) => c.index).sort((a, b) => a - b);
  const clauseGaps = [];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] > indices[i - 1] + 1) {
      clauseGaps.push({ from_clause: indices[i - 1], to_clause: indices[i] });
    }
  }

  const pagesFound = pages.length
    ? [...new Set(pages.map((p) => p.page))].sort((a, b) => a - b)
    : clauses.length
      ? [...new Set(clauses.map((c) => c.page))].sort((a, b) => a - b)
      : [];

  const illegibleSegments = clauses
    .filter((c) => c.status === "illegible")
    .map((c) => ({ clause_id: c.clause_id, page: c.page }));

  const missing = [...new Set(pagesMissing)].filter((n) => !pagesFound.includes(n)).sort((a, b) => a - b);

  let status = "complete";
  let message = null;

  if (missing.length > 0) {
    status = "gaps_detected";
    const gap = clauseGaps[0];
    message = gap
      ? `Page ${missing.join(", ")} missing — showing Clause ${gap.from_clause} → ${gap.to_clause} gap.`
      : `Page ${missing.join(", ")} missing — part of the contract was not read.`;
  } else if (clauseGaps.length > 0) {
    status = "gaps_detected";
    const gap = clauseGaps[0];
    message = `Clause ${gap.from_clause} → ${gap.to_clause} gap detected — a page or clause may be missing.`;
  } else if (illegibleSegments.length > 0) {
    status = "illegible";
    message = `${illegibleSegments.length} part${illegibleSegments.length > 1 ? "s" : ""} could not be read — rescan or check the original.`;
  }

  return {
    status,
    pages_found: pagesFound,
    pages_missing: missing,
    clause_gaps: clauseGaps,
    illegible_segments: illegibleSegments,
    banner: message ? { level: "amber", message } : null,
  };
}

/* ────────────────────────── summary + score + script ────────────────────────── */

function buildSummaryBullets(parsedBullets, findings) {
  const bullets = (Array.isArray(parsedBullets) ? parsedBullets : [])
    .map((b) => String(b || "").replace(/\s+/g, " ").trim())
    .filter((b) => b.length > 0)
    .slice(0, 3);

  for (const finding of findings) {
    if (bullets.length >= 3) break;
    if (!bullets.some((b) => b.toLowerCase().includes(finding.rule_id.toLowerCase()))) {
      bullets.push(`${finding.title}.`);
    }
  }
  while (bullets.length < 3) {
    bullets.push(
      bullets.length === 0
        ? "No major risk was detected against the audited norms for this document."
        : "Read the full clauses again before you sign anything."
    );
  }
  return bullets.slice(0, 3);
}

function buildScore(findings, expectedClauses) {
  let value = 100;
  for (const f of findings) {
    if (f.severity === "critical") value -= 18;
    else if (f.severity === "caution") value -= 8;
    else if (f.severity === "standard") value -= 3;
  }
  const missing = expectedClauses.filter((e) => !e.present).length;
  value -= missing * 4;
  value = Math.max(5, Math.min(100, Math.round(value)));

  const band = value >= 80 ? "safe" : value >= 60 ? "fair" : value >= 40 ? "caution" : "risky";
  const label =
    band === "safe"
      ? "Broadly fair to you"
      : band === "fair"
        ? "A few clauses need a conversation"
        : band === "caution"
          ? "Several clauses are one-sided"
          : "Several one-sided clauses";

  return { value, band, label };
}

/** Spoken rule: no markdown/slashes/SSML, 12–16 words, native script. */
function cleanSpoken(text, maxWords = 16) {
  const cleaned = String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return cleaned;
  const trimmed = words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildSpokenScript(parsedScript, findings, clauses, language) {
  const segments = [];
  for (const raw of Array.isArray(parsedScript) ? parsedScript : []) {
    const text = cleanSpoken(raw && (raw.text || raw.script));
    if (!text || text.split(" ").length < 5) continue;
    const clause = locateClause(clauses, raw && raw.clause_id, null);
    segments.push({
      seq: segments.length + 1,
      clause_id: clause ? clause.clause_id : null,
      language,
      text,
      text_en: String((raw && raw.text_en) || "").replace(/\s+/g, " ").trim().slice(0, 240) || null,
      audio_url: null,
    });
    if (segments.length === 5) break;
  }

  if (segments.length === 0) {
    const fallback = cleanSpoken(FALLBACK_SPOKEN[language] || FALLBACK_SPOKEN.en);
    segments.push({
      seq: 1,
      clause_id: findings.length ? findings[0].clause_id : null,
      language,
      text: fallback,
      text_en: "This contract has a few one-sided clauses. Read them carefully before you sign.",
      audio_url: null,
    });
  }

  return segments.map((s, i) => ({ ...s, seq: i + 1 }));
}

/* ────────────────────────── math_inputs ────────────────────────── */

function buildMathInputs(parsedMath, fullText, pack, findings) {
  const model = parsedMath && typeof parsedMath === "object" ? parsedMath : {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const text = String(fullText || "");

  // Deposit — maximum of every "security deposit" amount mentioned.
  const depositCandidates = [];
  const depositRe = /(?:security\s+)?deposit[^\n\d]{0,90}?(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi;
  let dm;
  while ((dm = depositRe.exec(text)) !== null) {
    const amt = parseIndianAmount(dm[1]);
    if (amt && amt >= 100) depositCandidates.push(amt);
  }
  const depositAmount = depositCandidates.length ? Math.max(...depositCandidates) : num(model.deposit_amount);

  // Rent — explicit rent amount, else deposit ÷ stated deposit months.
  let monthlyRent = findAmount(text, "\\brent\\b(?:\\s+of)?") || 0;
  const depositMonths = countMonths(text, "deposit|equal\\s+to");
  if (!monthlyRent && depositAmount && depositMonths) {
    monthlyRent = Math.round(depositAmount / depositMonths);
  }
  if (!monthlyRent) monthlyRent = num(model.monthly_rent);

  const paintingCharge =
    findAmount(text, "painting(?:\\s+and\\s+cleaning)?\\s+charges?|repaint\\w*|paint\\s+charges?") ||
    num(model.painting_charge);

  // Lock-in penalty — rupee amount first, else "forfeit N months rent".
  let lockInPenalty = findAmount(text, "lock-?\\s?in(?:\\s+charges?|\\s+penalty)?|forfeit\\w*");
  if (!lockInPenalty) {
    const penaltyMonths = countMonths(text, "forfeit|lose|lock-?\\s?in");
    if (penaltyMonths && monthlyRent) lockInPenalty = penaltyMonths * monthlyRent;
  }
  if (!lockInPenalty) lockInPenalty = num(model.lock_in_penalty);

  let termMonths =
    countMonths(text, "term\\s+of\\s+(?:the\\s+)?\\s*(?:lease|agreement)|period\\s+of|tenure\\s+of") || 0;
  if (!termMonths) {
    const m = /(\d{1,2})\s*[-\s]?(?:month|months)/i.exec(text);
    if (m) termMonths = Number(m[1]);
  }
  if (!termMonths) termMonths = num(model.term_months);

  // Deposit cap comes from the ACTIVE pack benchmark — never from the model.
  let depositCapMonths = 0;
  for (const f of findings) {
    const bench = f.benchmark || {};
    if (bench.metric === "deposit_months" && Number.isFinite(Number(bench.max_fair_value))) {
      depositCapMonths = Number(bench.max_fair_value);
      break;
    }
  }
  if (!depositCapMonths) {
    const rule = (pack.rules || []).find(
      (r) => r.benchmark && r.benchmark.metric === "deposit_months"
    );
    if (rule) depositCapMonths = Number(rule.benchmark.max_fair_value) || 0;
  }

  return {
    monthly_rent: monthlyRent,
    deposit_amount: depositAmount,
    deposit_cap_months: depositCapMonths,
    painting_charge: paintingCharge,
    lock_in_penalty: lockInPenalty,
    term_months: termMonths,
  };
}

/* ────────────────────────── OCR digit tokens (image lane) ────────────────────────── */

const VERIFY_TOKEN_RE = /(?:rs\.?|inr|₹)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{2,3}){1,3}\b/gi;

function wrapOcrDigits(clauses, findings, sourceLane) {
  const tokensOut = [];
  const illegibleCount = clauses.filter((c) => c.status === "illegible").length;
  if (sourceLane !== "image_photo") {
    return { ocr_digit_tokens: tokensOut, illegible_count: illegibleCount };
  }

  const byClause = new Map();

  const wrapSegment = (segment, clause) => {
    if (!segment) return segment;
    let n = 0;
    const rewritten = segment.replace(VERIFY_TOKEN_RE, (match) => {
      n++;
      const token = `--verify-ocr-${tokensOut.length + 1}--`;
      tokensOut.push({ token, raw: match.trim(), page: clause.page, clause_id: clause.clause_id });
      if (!byClause.has(clause.clause_id)) byClause.set(clause.clause_id, []);
      byClause.get(clause.clause_id).push(token);
      return token;
    });
    return n > 0 ? rewritten : segment;
  };

  for (const clause of clauses) {
    // Verified finding quotes stay byte-identical so invariant 3 keeps holding.
    const protectedQuotes = findings
      .filter((f) => f.clause_id === clause.clause_id && f.quote_verified && f.quote)
      .map((f) => f.quote)
      .filter((q) => clause.text.includes(q));

    if (protectedQuotes.length === 0) {
      clause.text = wrapSegment(clause.text, clause);
      continue;
    }

    // Rewrite the clause around each protected quote span.
    let out = "";
    let rest = clause.text;
    while (rest.length > 0) {
      const hit = protectedQuotes
        .map((q) => ({ q, at: rest.indexOf(q) }))
        .filter((h) => h.at >= 0)
        .sort((a, b) => a.at - b.at)[0];
      if (!hit) {
        out += wrapSegment(rest, clause);
        break;
      }
      out += wrapSegment(rest.slice(0, hit.at), clause) + hit.q;
      rest = rest.slice(hit.at + hit.q.length);
    }
    clause.text = out;
  }

  for (const clause of clauses) {
    const list = byClause.get(clause.clause_id) || [];
    if (list.length) clause.ocr_tokens = list;
  }

  return { ocr_digit_tokens: tokensOut, illegible_count: illegibleCount };
}

/* ────────────────────────── handler ────────────────────────── */

module.exports = async function handler(req, res) {
  const started = Date.now();

  if (req.method && req.method !== "POST") {
    return fail(res, 405, "method_not_allowed", "Use POST");
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, "invalid_json", "Request body must be JSON");

  const pages = (Array.isArray(body.pages) ? body.pages : [])
    .map((p, i) => ({
      page: Number.isFinite(Number(p && p.page)) ? Number(p.page) : i + 1,
      text: typeof (p && p.text) === "string" ? p.text : "",
    }))
    .filter((p) => p.text.trim().length > 0);

  const text = String(body.text || (pages.length ? pages.map((p) => p.text).join("\n\n") : ""));
  if (text.trim().length < 40) {
    return fail(res, 400, "invalid_input", "text (or pages[].text) is required and must be a contract");
  }

  const language = LANGUAGES.includes(String(body.language)) ? String(body.language) : "en";
  const docType = DOC_TYPES.includes(String(body.doc_type)) ? String(body.doc_type) : "general";
  const sourceLane =
    body.source_lane === "image_photo" || body.image_mode === true ? "image_photo" : "vector_pdf";

  // Pack selection: explicit valid pack_id wins, else contract_types + text hint.
  let picked;
  try {
    if (body.pack_id) {
      const explicit = loadPack(String(body.pack_id));
      picked = { pack: explicit, fallback_used: explicit.pack_id === "in-general-fallback" };
    } else {
      picked = pickPack({ docType, text });
    }
  } catch {
    picked = pickPack({ docType, text });
  }
  const { pack, fallback_used } = picked;

  // Page lookup so clause.page is real even when the model guesses.
  const pageOf = (offset) => {
    if (!pages.length) return 1;
    let cursor = 0;
    for (const p of pages) {
      cursor += p.text.length + 2;
      if (offset < cursor) return p.page;
    }
    return pages[pages.length - 1].page;
  };

  try {
    const prompt = buildPrompt("contract.audit@1", {
      DOC_TYPE: docType,
      LANGUAGE: language,
      LANGUAGE_SCRIPT_NAME: LANGUAGE_SCRIPT_NAME[language],
      PACK_CONTEXT: JSON.stringify(packPromptContext(pack), null, 2),
      CONTRACT_TEXT: sanitizeForPrompt(text),
    });

    const result = await chat({
      model: MODELS.audit,
      temperature: 0.1,
      max_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "You are a grounded contract auditor. You output strict JSON only. You never invent rule ids or statutes.",
        },
        { role: "user", content: prompt },
      ],
    });

    const parsed = parseJSONFromLLMResponse(result.content) || {};

    const clauses = normaliseClauses(parsed.clauses, text, pageOf);
    const { findings } = buildFindings(parsed.findings, clauses, pack);

    // Expected clauses: pack is truth for id/label/why; model only says present/absent.
    const presentMap = new Map();
    for (const item of Array.isArray(parsed.expected_clauses_present) ? parsed.expected_clauses_present : []) {
      const id = String((item && item.id) || "");
      if (!id) continue;
      const clause = locateClause(clauses, (item && item.clause_id) || null, null);
      presentMap.set(id, clause ? clause.clause_id : null);
    }
    const expectedClauses = ((pack && pack.expected_clauses) || []).map((e) => ({
      id: e.id,
      label: e.label,
      why_it_matters: e.why_it_matters,
      present: presentMap.has(e.id),
      clause_id: presentMap.get(e.id) || null,
    }));

    const summaryBullets = buildSummaryBullets(parsed.summary_bullets, findings);
    const spokenScript = buildSpokenScript(parsed.spoken_script, findings, clauses, language);
    const completeness = buildCompleteness({
      clauses,
      pagesMissing: (Array.isArray(body.pages_missing) ? body.pages_missing : []).map(Number),
      pages,
      illegible: parsed.illegible,
    });
    const mathInputs = buildMathInputs(parsed.math_inputs, text, pack, findings);
    const score = buildScore(findings, expectedClauses);
    const ocr = wrapOcrDigits(clauses, findings, sourceLane);

    const auditId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `audit-${Date.now()}`;

    return res.status(200).json({
      schema_version: "audit_result_v1",
      audit_id: auditId,
      created_at: new Date().toISOString(),

      language,

      pack: {
        schema_version: pack.schema_version,
        pack_id: pack.pack_id,
        display_name: pack.display_name,
        jurisdiction: pack.jurisdiction,
        verified_date: pack.verified_date,
        fallback_used,
        badge: fallback_used ? "Pan-India General Norms Only" : null,
      },

      document: {
        doc_type: docType,
        title:
          String(parsed.document_title || "").trim().slice(0, 160) ||
          `${docType.replace(/_/g, " ")} document`,
        source_lane: sourceLane,
        page_count:
          Number(body.page_count) ||
          pages.length ||
          (completeness.pages_found.length ? Math.max(...completeness.pages_found) : clauses.length ? 1 : 0),
        privacy: null, // Lane B/C owns the local PII shield counts; server never sees them
      },

      score,

      summary_bullets: summaryBullets,
      findings,
      clauses,
      expected_clauses: expectedClauses,
      spoken_script: spokenScript,
      completeness,

      math_inputs: mathInputs,

      ocr: {
        engine: sourceLane === "image_photo" ? "haiku-vision" : "none",
        ocr_digit_tokens: ocr.ocr_digit_tokens,
        illegible_count: ocr.illegible_count,
      },

      meta: {
        llm_provider: PROVIDER,
        model: result.model,
        prompt_ids: ["contract.audit@1"],
        template_hash: PROMPT_HASHES["contract.audit@1"],
        duration_ms: Date.now() - started,
      },
    });
  } catch (e) {
    if (process.env.DEBUG_API) console.error("[api/audit]", e);
    const status = e && e.status ? e.status : 502;
    const code = (e && e.code) || "audit_failed";
    const message = /unconfigured|_key_missing/.test(String(code))
      ? "The audit engine is not configured on this deployment."
      : /timeout/.test(String(code))
        ? "The audit took too long. Try a shorter document or retry."
        : "Could not complete the audit right now. Please retry.";
    return fail(res, status >= 500 ? status : 400, code, message);
  }
};

// Exported for the smoke harness / potential unit checks (no side effects).
module.exports._internal = {
  sanitizeForPrompt,
  jaccard,
  parseIndianAmount,
  splitClausesFromText,
  buildMathInputs,
  buildCompleteness,
  buildScore,
  cleanSpoken,
};
