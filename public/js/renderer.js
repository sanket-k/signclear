/**
 * renderer.js — Lane B (UI Shell & Design System)
 * ---------------------------------------------------------------------------
 * Hydrates the whole report from an `audit_result_v1` object.
 *
 * DECOUPLING RULE (Wave 1): this module reads `audit.exposure` and
 * `audit.way_out` DIRECTLY off the audit result. It does NOT import
 * verifier.js / pii-guard.js / prompt-security.js / audio-sync.js. Every
 * display string is escaped locally (escapeHTML below) because it is untrusted
 * contract text (OWASP LLM01 — AGENTS.md §3.3).
 *
 * Anti-liability (§7.3): verdict labels come from a CLOSED SET mapped off
 * `basis_type`. The words Illegal / Sue / AI Lawyer are never produced here.
 *
 * Public API
 *   render(audit, root = document)  — full hydrate, idempotent
 *   focusClause(clauseId, root)     — §5 pulse + dim (reused by audio-sync)
 *   clearClauseFocus(root)          — remove .clause-active/.clause-dim
 *   severityFor(finding)            — normalised severity key
 *   verdictLabelFor(finding)        — closed-set label
 *   formatINR(n)                    — Indian grouping, e.g. ₹1,40,000
 */

/* ─────────────────────────── constants ─────────────────────────────────── */

/** §7.3 — closed set. Mapped from `basis_type`, never free text. */
const VERDICT_LABELS = {
  statutory_conflict: 'Statutory Conflict',
  above_local_norm: 'Above Local Norm',
  missing_protection: 'Missing Protection',
  standard: 'Standard',
};

/** Severity rank for ordering findings (0 = most severe). */
const SEVERITY_RANK = { critical: 0, caution: 1, standard: 2, safe: 3 };

/** §1.3 — every severity carries an icon glyph, never colour alone. */
const SEVERITY_ICON = {
  critical: 'i-alert',
  caution: 'i-caution',
  standard: 'i-check',
  safe: 'i-shield',
};

const SEVERITIES = ['critical', 'caution', 'standard', 'safe'];

const DISCLAIMER_TEXT =
  'SignClear explains agreements in plain language and flags clauses that ' +
  'commonly deviate from Indian norms. It is not legal advice and it is not a ' +
  'law firm. Always read the original agreement before signing.';

const ILLEGIBLE_COPY =
  "This part of the page is unreadable. We won't guess. Tap Original Scan to check.";

const PULSE_MS = 1100; // §5 / §1.5 --dur-pulse

/* ─────────────────────────── escaping (§3.3) ───────────────────────────── */

/**
 * Local copy: renderer must not import prompt-security.js (Lane C owns it).
 * Escapes & < > " ' so nothing in untrusted contract text can become markup.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHTML(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─────────────────────────── formatting ────────────────────────────────── */

/**
 * Indian digit grouping: 140000 -> "1,40,000".
 * Implemented by hand (no Intl dependency) so the value is identical on every
 * device and cannot drift with the host locale.
 * @param {number|string} amount
 * @returns {string}
 */
export function groupIndian(amount) {
  const n = Math.round(Number(amount));
  if (!Number.isFinite(n)) return '0';
  const digits = String(Math.abs(n));
  let grouped;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail;
  }
  return (n < 0 ? '-' : '') + grouped;
}

/**
 * ₹ amount with Indian grouping. §4 hero exposure + §4 way-out readout.
 * @param {number|string} amount
 * @returns {string}
 */
export function formatINR(amount) {
  return '\u20B9' + groupIndian(amount);
}

/**
 * §4 hero band: critical 0–39, caution 40–69, safe 70–100.
 * Accepts the schema's word bands too (`risky` / `fair`).
 * @param {{value?: number, band?: string}} score
 * @returns {'critical'|'caution'|'safe'}
 */
function bandFor(score) {
  const value = Number(score && score.value);
  if (Number.isFinite(value)) {
    if (value <= 39) return 'critical';
    if (value <= 69) return 'caution';
    return 'safe';
  }
  const word = String((score && score.band) || '').toLowerCase();
  if (word === 'risky' || word === 'critical' || word === 'bad') return 'critical';
  if (word === 'safe' || word === 'fair') return 'safe';
  return 'caution';
}

/**
 * Normalised severity of a finding, clamped to the four CSS triplets.
 * @param {object} finding
 * @returns {'critical'|'caution'|'standard'|'safe'}
 */
export function severityFor(finding) {
  const raw = String((finding && finding.severity) || '').toLowerCase();
  if (SEVERITIES.includes(raw)) return raw;
  const basis = String((finding && finding.basis_type) || '').toLowerCase();
  if (basis === 'statutory_conflict') return 'critical';
  if (basis === 'above_local_norm' || basis === 'missing_protection') return 'caution';
  return 'standard';
}

/**
 * §7.3 closed-set verdict label.
 * @param {object} finding
 * @returns {string}
 */
export function verdictLabelFor(finding) {
  const basis = String((finding && finding.basis_type) || '').toLowerCase();
  return VERDICT_LABELS[basis] || VERDICT_LABELS.standard;
}

/* ─────────────────────────── small helpers ─────────────────────────────── */

const icon = (id, cls) =>
  `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false">` +
  `<use href="#${id}"/></svg>`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bySeverityThenImpact(findings, exposure) {
  const impactOf = (f) => rankImpact(f, exposure);
  return findings.slice().sort((a, b) => {
    const rank = (SEVERITY_RANK[severityFor(a)] ?? 9) - (SEVERITY_RANK[severityFor(b)] ?? 9);
    if (rank !== 0) return rank;
    return impactOf(b) - impactOf(a);
  });
}

/** Rupee impact heuristic used only to order equal-severity findings. */
function rankImpact(finding, exposure) {
  const category = String((finding && finding.category) || '').toLowerCase();
  const lines = asArray(exposure && exposure.breakdown);
  let total = 0;
  for (const line of lines) {
    const label = String((line && line.label) || '').toLowerCase();
    if (category && label.includes(category.split('_')[0])) total += Number(line.amount) || 0;
  }
  if (total > 0) return total;
  const max = Number(finding && finding.benchmark && finding.benchmark.max_fair_value);
  return Number.isFinite(max) ? max : 0;
}

function findingById(audit, clauseId) {
  return asArray(audit.findings).filter((f) => f && f.clause_id === clauseId);
}

/** First finding anchored to a clause — used by the inspector action buttons. */
function findingForClause(audit, clauseId) {
  return findingById(audit, clauseId)[0] || null;
}

/** Score a bullet against a finding by shared significant tokens (real data only). */
function overlapScore(text, finding) {
  const stop = new Set(['the', 'your', 'and', 'for', 'with', 'that', 'this', 'are', 'you', 'not',
    'no', 'is', 'of', 'to', 'a', 'an', 'in', 'on', 'it', 'if', 'be', 'as', 'at', 'or', 'by',
    'months', 'month', 'rent', 'shall', 'clause']);
  const tokens = (s) =>
    new Set(
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !stop.has(t))
    );
  const a = tokens(text);
  const b = tokens(
    [finding && finding.title, finding && finding.explanation, finding && finding.category].join(' ')
  );
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return hits;
}

/* ─────────────────────────── slot plumbing ─────────────────────────────── */

function slot(root, name) {
  const found =
    (root.querySelector && root.querySelector(`[data-slot="${name}"]`)) || null;
  return found || null;
}

function paint(root, name, html) {
  const host = slot(root, name);
  if (host) {
    host.innerHTML = html;
    return host;
  }
  return null;
}

/* ─────────────────────────── OCR digits (§7.4) ─────────────────────────── */

/**
 * Wrap OCR-sourced digits in `<span class="ocr-digit" data-verify-ocr="…">`.
 * Only applied when the audit genuinely came through OCR:
 *   • explicit `--verify-ocr-N--` markers in the clause text, or
 *   • `ocr.ocr_digit_tokens` raw values, or
 *   • a Lane-B photo/scan source (image_photo) — those digits *are* OCR output.
 * A vector PDF (Lane A) yields no OCR digits, which is the honest result.
 *
 * @param {string} safeText already-escaped clause text
 * @param {object} clause
 * @param {object} audit
 * @returns {string}
 */
function withOCRDigits(safeText, clause, audit) {
  const clauseId = escapeHTML(clause && clause.clause_id);
  let html = safeText;

  // 1. Explicit token markers, e.g. "--verify-ocr-1--".
  const markers = asArray(clause && clause.ocr_tokens);
  for (const token of markers) {
    const marker = escapeHTML(token);
    if (!marker) continue;
    const raw = ocrRawFor(audit, token);
    const shown = escapeHTML(raw || token);
    html = html.split(marker).join(
      `<span class="ocr-digit" data-verify-ocr="${clauseId}">${shown}</span>`
    );
  }

  // 2. Table of OCR digit tokens from `ocr.ocr_digit_tokens`.
  const tokens = asArray(audit && audit.ocr && audit.ocr.ocr_digit_tokens);
  for (const t of tokens) {
    if (!t || !t.raw || t.clause_id !== (clause && clause.clause_id)) continue;
    const raw = escapeHTML(t.raw);
    if (!raw) continue;
    html = html.split(raw).join(
      `<span class="ocr-digit" data-verify-ocr="${clauseId}">${raw}</span>`
    );
  }

  // 3. Lane B photo path: every ₹ amount in the sheet is machine-read.
  const lane = String(
    (audit && audit.document && audit.document.privacy && audit.document.privacy.lane) || ''
  ).toUpperCase();
  const sourceLane = String((audit && audit.document && audit.document.source_lane) || '');
  const isPhoto = lane === 'B' || sourceLane === 'image_photo';
  if (isPhoto && !html.includes('class="ocr-digit"')) {
    html = html.replace(
      /(Rs\.?\s?)?\d[\d,]{3,}/g,
      (match) => `<span class="ocr-digit" data-verify-ocr="${clauseId}">${match}</span>`
    );
  }
  return html;
}

function ocrRawFor(audit, token) {
  const tokens = asArray(audit && audit.ocr && audit.ocr.ocr_digit_tokens);
  const hit = tokens.find((t) => t && t.token === token);
  return hit ? hit.raw : null;
}

/* ─────────────────────────── blocks ────────────────────────────────────── */

/** §7.1 — amber gap banner. Never dismissible into silence. */
function gapBannerHTML(audit) {
  const completeness = (audit && audit.completeness) || {};
  if (completeness.status === 'complete') return '';

  const gaps = asArray(completeness.clause_gaps);
  const pagesMissing = asArray(completeness.pages_missing);
  const illegible = asArray(completeness.illegible_segments);

  const facts = [];
  if (gaps.length) {
    // Verbatim beat from smoke test 5: "Clause 4 → 7".
    const parts = gaps
      .map((g) => `Clause ${escapeHTML(g && g.from_clause)} \u2192 ${escapeHTML(g && g.to_clause)}`)
      .join(', ');
    facts.push(`We found ${parts}.`);
  }
  if (pagesMissing.length) {
    const pages = pagesMissing.map((p) => escapeHTML(p)).join(', ');
    facts.push(`Page ${pages} of the scan is missing.`);
  }
  if (illegible.length) {
    facts.push('Part of the scan is unreadable, so it was not guessed.');
  }
  if (!facts.length) facts.push('Some pages could not be read, so this check may be incomplete.');

  const bannerMessage = completeness.banner && completeness.banner.message;
  const lead = bannerMessage ? escapeHTML(bannerMessage) : facts.join(' ');

  const fallbackLine =
    audit && audit.pack && audit.pack.fallback_used
      ? `<p>${icon('i-caution')} Pan-India General Norms Only${
          audit.pack.badge ? ' \u00B7 ' + escapeHTML(audit.pack.badge) : ''
        }</p>`
      : '';

  const gapAttr = gaps.length
    ? `clause_${escapeHTML(gaps[0].from_clause)}->${escapeHTML(gaps[0].to_clause)}`
    : pagesMissing.length
      ? `page_${escapeHTML(pagesMissing[0])}`
      : 'incomplete';

  return (
    `<div class="gap-banner" role="status" data-gap="${gapAttr}">` +
    icon('i-caution') +
    `<div class="gap-banner-body">` +
    `<p><strong>Incomplete scan.</strong> ${lead}</p>` +
    fallbackLine +
    `</div>` +
    `<button class="gap-action" type="button" data-gap-review>Review original</button>` +
    `</div>`
  );
}

/** Hero gap chip — the collapse-safe amber marker next to the score (§7.1). */
function gapChipHTML(audit) {
  const completeness = (audit && audit.completeness) || {};
  if (completeness.status === 'complete') return '';
  const gaps = asArray(completeness.clause_gaps);
  const label = gaps.length
    ? `Clause ${escapeHTML(gaps[0].from_clause)} \u2192 ${escapeHTML(gaps[0].to_clause)} gap`
    : 'Incomplete scan';
  return `<span class="gap-chip">${icon('i-caution')}${label}</span>`;
}

/** §4 #2 — exactly 3 bullets. */
function bulletsFor(audit) {
  const raw = asArray(audit && audit.summary_bullets);
  const findings = asArray(audit && audit.findings);
  const ranked = bySeverityThenImpact(findings, audit && audit.exposure);

  if (raw.length !== 3 && typeof console !== 'undefined' && console.warn) {
    // Zero silent failures: the invariant is asserted loudly, then repaired
    // from real data only (never fabricated, never padded to 4).
    console.warn(
      `[renderer] summary_bullets.length === ${raw.length}, expected 3 (audit_result_v1 invariant 5)`
    );
  }

  const bullets = raw.slice(0, 3).map((text) => {
    // Attach the finding whose vocabulary actually matches this bullet.
    let best = null;
    let bestScore = 0;
    for (const f of ranked) {
      const score = overlapScore(text, f);
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return { text, finding: best || ranked[0] || null, synthetic: false };
  });

  // Repair short arrays from real findings (still never a 4th bullet).
  let cursor = 0;
  while (bullets.length < 3 && cursor < ranked.length) {
    const f = ranked[cursor];
    cursor += 1;
    if (bullets.some((b) => b.finding && b.finding.finding_id === f.finding_id)) continue;
    bullets.push({ text: f.title, finding: f, synthetic: true });
  }
  return bullets;
}

function heroHTML(audit) {
  const score = (audit && audit.score) || {};
  const exposure = (audit && audit.exposure) || {};
  const band = bandFor(score);
  const value = Math.max(0, Math.min(100, Math.round(Number(score.value) || 0)));
  const current = Math.round(Number(exposure.current) || 0);
  const saved = Math.round(Number(exposure.saved) || 0);
  // Exactly 3 bullets (§4 #2) — each carries severity icon + real clause link.
  const bulletLis = bulletsFor(audit)
    .map((bullet) => {
      const finding = bullet.finding;
      const severity = finding ? severityFor(finding) : 'standard';
      const clauseId = finding && finding.clause_id ? escapeHTML(finding.clause_id) : '';
      const link = clauseId
        ? `<button class="hero-bullet-link" type="button" data-jump-clause="${clauseId}">` +
          `${icon('i-chevron')}See the clause</button>`
        : '';
      return (
        `<li data-severity="${severity}"${clauseId ? ` data-clause-id="${clauseId}"` : ''}>` +
        `<span class="sev-icon" aria-hidden="true">${icon(SEVERITY_ICON[severity])}</span>` +
        `<div class="hero-bullet-text">` +
        `<span class="visually-hidden">${escapeHTML(
          finding ? verdictLabelFor(finding) : VERDICT_LABELS.standard
        )}: </span>` +
        `${escapeHTML(bullet.text)}${link}</div>` +
        `</li>`
      );
    })
    .join('');

  return (
    `<div class="hero">` +
    `<div class="hero-top">` +
    `<div class="hero-score" data-score="${value}" data-band="${band}">` +
    `<div class="score-dial" style="--score-pct:${value}" role="img" ` +
    `aria-label="Clarity score ${value} out of 100, ${escapeHTML(
      band === 'critical' ? 'several one-sided clauses' : band === 'caution' ? 'a few points to fix' : 'within normal range'
    )}">` +
    `<span class="score-value">${value}</span></div>` +
    `<div class="hero-score-meta">` +
    `<p class="hero-score-label">Clause check score</p>` +
    `<p class="hero-score-title">${escapeHTML(score.label || 'Clause check ready')}</p>` +
    `<p class="hero-exposure-sub">${gapChipHTML(audit)}</p>` +
    `</div></div>` +
    `<div class="hero-exposure" data-exposure-inr="${current}" data-currency="INR">` +
    `<p class="hero-exposure-label">${icon('i-rupee')}Exposure at risk</p>` +
    `<p class="hero-exposure-value">${escapeHTML(formatINR(current))}</p>` +
    `<p class="hero-exposure-sub">Typical practice could bring this to ${escapeHTML(
      formatINR(Number(exposure.negotiated) || 0)
    )} \u00B7 ${escapeHTML(formatINR(saved))} possible saving</p>` +
    `</div></div>` +
    `<ul class="hero-bullets" aria-label="Three things to know">${bulletLis}</ul>` +
    wayOutHTML(audit) +
    `</div>`
  );
}

/* ── Way-Out slider (§4 #3) — pure lookup, zero network ─────────────────── */

function wayOutPoints(audit) {
  const wayOut = (audit && audit.way_out) || {};
  const points = asArray(wayOut.points)
    .map((p) => ({
      exit_month: Math.round(Number(p && p.exit_month)),
      current_loss: Math.round(Number(p && p.current_loss) || 0),
      negotiated_loss: Math.round(Number(p && p.negotiated_loss) || 0),
    }))
    .filter((p) => Number.isFinite(p.exit_month))
    .sort((a, b) => a.exit_month - b.exit_month);
  const months = Math.round(Number(wayOut.months)) || (points.length ? points[points.length - 1].exit_month : 12);
  return { points, months };
}

/**
 * Loss at a given exit month: exact anchor when present, otherwise a linear
 * read between the two bracketing anchors. Deterministic integer rupees.
 * @param {Array<{exit_month:number,current_loss:number,negotiated_loss:number}>} points
 * @param {number} month
 */
function lossAt(points, month) {
  if (!points.length) return { current_loss: 0, negotiated_loss: 0 };
  const exact = points.find((p) => p.exit_month === month);
  if (exact) return exact;
  let lo = points[0];
  let hi = points[points.length - 1];
  for (const p of points) {
    if (p.exit_month <= month) lo = p;
    if (p.exit_month > month) {
      hi = p;
      break;
    }
  }
  if (hi.exit_month === lo.exit_month) return lo;
  const span = hi.exit_month - lo.exit_month;
  const t = (month - lo.exit_month) / span;
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return {
    current_loss: mix(lo.current_loss, hi.current_loss),
    negotiated_loss: mix(lo.negotiated_loss, hi.negotiated_loss),
  };
}

function wayOutHTML(audit) {
  const { points, months } = wayOutPoints(audit);
  if (!points.length) return '';
  const min = points[0].exit_month;
  const max = Math.max(months, points[points.length - 1].exit_month);
  const start = min;
  const initial = lossAt(points, start);
  const saved = Math.max(0, initial.current_loss - initial.negotiated_loss);

  return (
    `<div class="wayout" data-wayout>` +
    `<div class="wayout-head">` +
    `<span class="wayout-title">${icon('i-slider')}Way out</span>` +
    `<span class="wayout-month" data-wayout-month-label>Leave at month ${start} of ${max}</span>` +
    `</div>` +
    `<label class="visually-hidden" for="wayout-slider">Exit month</label>` +
    `<input class="wayout-slider" id="wayout-slider" type="range" min="${min}" max="${max}" ` +
    `step="1" value="${start}" data-wayout-month="${start}" ` +
    `aria-valuetext="${escapeHTML(
      `Leaving at month ${start} costs ${formatINR(initial.current_loss)} today, ${formatINR(
        initial.negotiated_loss
      )} after negotiation. ${formatINR(saved)} saved.`
    )}">` +
    `<div class="wayout-readout">` +
    `<div><span class="readout-label">Today</span>` +
    `<span class="readout-value" data-current-loss="${initial.current_loss}">${escapeHTML(
      formatINR(initial.current_loss)
    )}</span></div>` +
    `<div><span class="readout-label">Negotiated</span>` +
    `<span class="readout-value" data-negotiated-loss="${initial.negotiated_loss}">${escapeHTML(
      formatINR(initial.negotiated_loss)
    )}</span></div>` +
    `<div class="wayout-saved"><span class="readout-label">Saved</span>` +
    `<span class="readout-value" data-saved>${escapeHTML(formatINR(saved))}</span></div>` +
    `</div></div>`
  );
}

/* ── Clause cards + inspector (§4 #4, §9) ───────────────────────────────── */

function clauseCardHTML(audit, finding) {
  const clauseId = escapeHTML(finding.clause_id);
  const severity = severityFor(finding);
  const verdict = verdictLabelFor(finding);
  const verified = finding.quote_verified === true && !!finding.quote;
  const citation = finding.statutory_citation;
  const ruleId = finding.rule_id;

  const citeChip = verified
    ? `<span class="cite-chip" data-verified="true">${icon('i-check')}\u2713 Verified excerpt</span>`
    : '';
  // Statute pills render ONLY when rule_id exists in the active pack.
  const statute = ruleId
    ? `<span class="statute-pill" data-rule-id="${escapeHTML(ruleId)}" title="${escapeHTML(
        citation && citation.act ? `${citation.act} \u2014 ${citation.section}` : ruleId
      )}">${escapeHTML(ruleId)}</span>`
    : '';

  const benchmark = finding.benchmark && finding.benchmark.typical_label;

  return (
    `<article class="clause-card" data-clause-id="${clauseId}" data-severity="${severity}" data-state="idle">` +
    `<button class="clause-card-head" type="button" aria-expanded="false" ` +
    `data-clause-toggle="${clauseId}" aria-controls="inspector-${clauseId}">` +
    `<span class="sev-icon" aria-hidden="true">${icon(SEVERITY_ICON[severity])}</span>` +
    `<span class="clause-card-title">${escapeHTML(finding.title)}` +
    `<span class="clause-card-meta">` +
    `<span class="severity-badge" data-severity="${severity}">${escapeHTML(verdict)}</span>` +
    citeChip +
    statute +
    `</span></span>` +
    `<span class="clause-card-chevron" aria-hidden="true">${icon('i-chevron')}</span>` +
    `</button>` +
    `<div class="clause-inspector" id="inspector-${clauseId}" data-clause-id="${clauseId}" hidden>` +
    (verified
      ? `<blockquote class="inspector-quote">${icon('i-check')} \u201C${escapeHTML(
          finding.quote
        )}\u201D</blockquote>`
      : '') +
    `<p class="inspector-explanation">${escapeHTML(finding.explanation)}</p>` +
    (benchmark
      ? `<p class="inspector-benchmark">Typical practice: <strong>${escapeHTML(
          benchmark
        )}</strong></p>`
      : '') +
    (citation && citation.act
      ? `<p class="inspector-benchmark">Basis: <strong>${escapeHTML(citation.act)}</strong>${
          citation.section ? ' \u00B7 ' + escapeHTML(citation.section) : ''
        }</p>`
      : '') +
    `<div class="inspector-actions">` +
    `<button class="inspector-action" type="button" data-jump-clause="${clauseId}">` +
    `${icon('i-file')}Open in contract</button>` +
    `<button class="inspector-action" type="button" data-ask-clause="${clauseId}">` +
    `${icon('i-mic')}Ask about this</button>` +
    `</div></div></article>`
  );
}

function clauseListHTML(audit) {
  const ranked = bySeverityThenImpact(asArray(audit.findings), audit.exposure).slice(0, 5);
  if (!ranked.length) {
    return `<p class="disclaimer">No clause deviations were found in the pages that could be read.</p>`;
  }
  return (
    `<div class="clause-list-head">` +
    `<h2 class="clause-list-title">What stands out</h2>` +
    `<button class="clause-list-more" type="button" data-open-contract>` +
    `Full contract ${icon('i-chevron')}</button>` +
    `</div>` +
    `<div class="clause-list">${ranked.map((f) => clauseCardHTML(audit, f)).join('')}</div>`
  );
}

/* ── Playlist (§5) ──────────────────────────────────────────────────────── */

function playlistHTML(audit) {
  const script = asArray(audit && audit.spoken_script);
  if (!script.length) return '';
  const items = script
    .map((segment, i) => {
      const clauseId = escapeHTML(segment.clause_id);
      const text = segment.text_en || segment.text || '';
      return (
        `<li><button class="playlist-item" type="button" data-clause-id="${clauseId}" ` +
        `data-state="idle" data-playlist-index="${i}">` +
        `<span class="playlist-index">${i + 1}</span>` +
        `<span class="playlist-glyph" aria-hidden="true">${icon('i-play')}</span>` +
        `<span class="playlist-text">${escapeHTML(text)}</span>` +
        `</button></li>`
      );
    })
    .join('');
  const language = escapeHTML(String((audit && audit.language) || '').toUpperCase());
  return (
    `<div class="playlist">` +
    `<p class="playlist-head">${icon('i-play')}60-second walkthrough \u00B7 ${language}</p>` +
    `<ul class="playlist-items">${items}</ul></div>`
  );
}

/* ── Contract sheet (§9, §7.4) ──────────────────────────────────────────── */

function contractSheetHTML(audit) {
  const clauses = asArray(audit && audit.clauses);
  const completeness = (audit && audit.completeness) || {};
  const gaps = asArray(completeness.clause_gaps);
  const pack = (audit && audit.pack) || {};

  const severityByClause = new Map();
  for (const f of asArray(audit.findings)) {
    if (!f || !f.clause_id) continue;
    const current = severityByClause.get(f.clause_id);
    const next = severityFor(f);
    if (!current || (SEVERITY_RANK[next] ?? 9) < (SEVERITY_RANK[current] ?? 9)) {
      severityByClause.set(f.clause_id, next);
    }
  }

  const blocks = clauses
    .map((clause) => {
      const clauseId = escapeHTML(clause.clause_id);
      const severity = severityByClause.get(clause.clause_id);
      const status = String(clause.status || 'ok');
      const safeText = escapeHTML(clause.text);
      const body =
        status === 'illegible'
          ? `<p class="clause-block-text">${escapeHTML(ILLEGIBLE_COPY)}</p>`
          : `<p class="clause-block-text">${withOCRDigits(safeText, clause, audit)}</p>`;
      return (
        `<div class="clause-block" id="block-${clauseId}" data-clause-id="${clauseId}" ` +
        `data-status="${escapeHTML(status)}"${severity ? ` data-severity="${severity}"` : ''} ` +
        `data-page="${escapeHTML(clause.page)}">` +
        `<p class="clause-block-heading">` +
        `<span class="clause-block-number">${escapeHTML(clause.index)}</span>` +
        `<span>${escapeHTML(clause.heading || 'Clause')}</span></p>` +
        body +
        `</div>`
      );
    })
    .join('');

  // Honest gap blocks rendered where the missing clauses belong.
  const gapBlocks = gaps
    .map((gap) => {
      const from = escapeHTML(gap && gap.from_clause);
      const to = escapeHTML(gap && gap.to_clause);
      return (
        `<div class="clause-block" data-clause-id="gap-${from}" data-status="gap">` +
        `<p class="clause-block-heading"><span class="clause-block-number">${from}\u2013${to}</span>` +
        `<span>Not in this scan</span></p>` +
        `<p class="clause-block-text">Clauses ${from} \u2192 ${to} are missing from the pages that ` +
        `were read. Ask for the missing page before signing.</p></div>`
      );
    })
    .join('');

  const pages = pagesFrom(clauses);
  const scanPages = pages
    .map((page) => {
      const rows = clauses
        .filter((c) => Number(c.page) === page)
        .map((c) => `${c.index}. ${c.heading || ''}\n${c.text || ''}`)
        .join('\n\n');
      return (
        `<div class="scan-page" data-page="${escapeHTML(page)}">` +
        `${escapeHTML(rows || 'No text could be read from this page.')}</div>`
      );
    })
    .join('');

  const expected = expectedClausesHTML(audit);

  return (
    `<div class="contract-panel" data-pack-id="${escapeHTML(pack.pack_id)}">` +
    gapBannerHTML(audit) +
    `<div class="contract-head">` +
    `<h2 class="contract-title">Original agreement</h2>` +
    `<button class="original-scan-toggle" type="button" aria-pressed="false" ` +
    `data-original-scan data-page="${escapeHTML(pages[0] || 1)}">` +
    `${icon('i-camera')}Original Scan</button>` +
    `</div>` +
    `<div class="contract-sheet" data-pack-id="${escapeHTML(pack.pack_id)}">` +
    `<p class="contract-sheet-title">${escapeHTML(
      (audit && audit.document && audit.document.title) || 'Agreement'
    )}${
      pack.display_name ? ' \u00B7 ' + escapeHTML(pack.display_name) : ''
    }${pack.verified_date ? ' \u00B7 norms verified ' + escapeHTML(pack.verified_date) : ''}` +
    `</p>` +
    blocks +
    gapBlocks +
    `</div>` +
    `<div class="original-scan-view" data-original-scan-view hidden>` +
    `<p class="original-scan-label">Original scan \u00B7 tap the toggle to hide</p>` +
    scanPages +
    `</div>` +
    expected +
    `<p class="disclaimer">${icon('i-shield')}${escapeHTML(DISCLAIMER_TEXT)}</p>` +
    `</div>`
  );
}

function pagesFrom(clauses) {
  const seen = new Set();
  const pages = [];
  for (const clause of clauses) {
    const page = Number(clause && clause.page);
    if (Number.isFinite(page) && !seen.has(page)) {
      seen.add(page);
      pages.push(page);
    }
  }
  return pages.sort((a, b) => a - b);
}

function expectedClausesHTML(audit) {
  const expected = asArray(audit && audit.expected_clauses);
  if (!expected.length) return '';
  const items = expected
    .map((entry) => {
      const present = entry.present === true;
      return (
        `<li class="expected-item" data-present="${present}">` +
        `<span class="sev-icon" aria-hidden="true">${icon(present ? 'i-check' : 'i-caution')}</span>` +
        `<div><p class="expected-label">${escapeHTML(entry.label)}` +
        `<span class="expected-state"> \u00B7 ${present ? 'present' : 'missing'}</span></p>` +
        `<p class="expected-why">${escapeHTML(entry.why_it_matters)}</p></div></li>`
      );
    })
    .join('');
  return (
    `<div class="expected-clauses">` +
    `<p class="expected-title">Clauses worth having in any Indian agreement</p>` +
    `<ul class="expected-list">${items}</ul></div>`
  );
}

/* ── Intake badges + stepper counts (real numbers only, §6) ─────────────── */

function paintPrivacyStats(audit, root) {
  const privacy = (audit && audit.document && audit.document.privacy) || {};
  const lane = String(privacy.lane || 'A').toUpperCase() === 'B' ? 'B' : 'A';
  const total = Number(privacy.pii_tokens_found) || 0;
  const types = privacy.pii_token_types || {};

  const intake = root.querySelector && root.querySelector('.intake');
  if (intake) intake.setAttribute('data-lane', lane);

  const badge = root.querySelector && root.querySelector('[data-pii-badge]');
  if (badge) {
    badge.setAttribute('data-lane', lane);
    badge.setAttribute('data-state', 'ok');
    const emoji = badge.querySelector('.pii-emoji');
    const text = badge.querySelector('.pii-text');
    const count = badge.querySelector('.pii-count');
    if (emoji) emoji.textContent = lane === 'A' ? '\uD83D\uDFE2' : '\uD83D\uDFE1';
    if (text) {
      text.textContent =
        lane === 'A' ? 'Local PII Shield' : 'Image Mode \u00B7 EXIF stripped \u00B7 Zero-retention';
    }
    if (count) count.textContent = total > 0 ? `${total} token${total === 1 ? '' : 's'}` : 'no tokens';
  }

  const list = root.querySelector && root.querySelector('[data-pii-types]');
  if (list) {
    const labels = {
      aadhaar: 'Aadhaar',
      pan: 'PAN',
      phone: '+91',
      email: 'email',
      upi: 'UPI',
      party_header: 'headers',
    };
    const rows = Object.keys(types)
      .filter((k) => Number(types[k]) > 0)
      .map(
        (k) =>
          `<li><span>${escapeHTML(labels[k] || k)}</span><span>${escapeHTML(types[k])}</span></li>`
      )
      .join('');
    list.innerHTML = rows || '<li><span>No identifiers found</span><span>0</span></li>';
  }
}

function paintStepperCounts(audit, root) {
  const document = (audit && audit.document) || {};
  const privacy = document.privacy || {};
  const findings = asArray(audit && audit.findings).length;
  const clauses = asArray(audit && audit.clauses).length;
  const script = asArray(audit && audit.spoken_script).length;
  const pages = Number(document.page_count) || pagesFrom(asArray(audit && audit.clauses)).length;
  const language = String((audit && audit.language) || '').toUpperCase();

  const set = (name, value) => {
    const node = root.querySelector && root.querySelector(`[data-count="${name}"]`);
    if (node) node.textContent = value;
  };
  set('pages', `${pages} page${pages === 1 ? '' : 's'}`);
  set('pii', `${Number(privacy.pii_tokens_found) || 0} masked`);
  set('findings', `${clauses} clauses \u00B7 ${findings} flags`);
  set('spoken', `${script} scripted \u00B7 ${language}`);

  const stepper = root.querySelector && root.querySelector('.stepper');
  if (stepper) {
    stepper.setAttribute('data-state', 'done');
    stepper.setAttribute('aria-busy', 'false');
    const status = stepper.querySelector('[data-stepper-status]');
    if (status) {
      status.textContent = 'Complete';
      status.setAttribute('data-tone', 'ok');
    }
    const cancel = stepper.querySelector('.stepper-cancel');
    if (cancel) cancel.hidden = true;
    for (const step of stepper.querySelectorAll('.stepper-step')) {
      step.setAttribute('data-state', 'done');
    }
  }
}

/* ─────────────────────────── §5 focus / dim ────────────────────────────── */

const pulseTimers = new WeakMap();

/**
 * §5 — pulse one clause, dim every other `[data-clause-id]`.
 * Reused by audio-sync (Wave 2) and by the desktop clause list.
 * @param {string} clauseId
 * @param {Document|Element} root
 * @param {{scroll?: boolean, pulseMs?: number}} [opts]
 */
export function focusClause(clauseId, root = document, opts = {}) {
  const id = String(clauseId || '');
  if (!id) return;
  const doc = root.ownerDocument || root;
  clearClauseFocus(root);

  const nodes = Array.from(doc.querySelectorAll('[data-clause-id]')).filter(
    (n) => n.getAttribute('data-clause-id') === id
  );
  const all = Array.from(doc.querySelectorAll('.clause-card[data-clause-id], .clause-block[data-clause-id]'));
  for (const node of all) {
    if (node.getAttribute('data-clause-id') !== id) node.classList.add('clause-dim');
  }
  for (const node of nodes) {
    node.classList.remove('clause-dim');
    node.classList.add('clause-active');
    if (node.classList.contains('clause-card')) node.setAttribute('data-state', 'active');
  }

  if (opts.scroll !== false) {
    const target = nodes.find((n) => n.classList.contains('clause-block')) || nodes[0];
    const reduced =
      typeof doc.defaultView?.matchMedia === 'function' &&
      doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    }
  }

  const wait = Number(opts.pulseMs) || PULSE_MS;
  const timer = setTimeout(() => {
    for (const node of nodes) {
      node.classList.remove('clause-active');
      if (node.classList.contains('clause-card')) node.setAttribute('data-state', 'idle');
    }
    // Dim clears with the pulse so the feed can never stay permanently dimmed.
    clearClauseDim(root);
  }, wait);
  pulseTimers.set(doc, timer);
  return () => clearTimeout(timer);
}

/** Remove every `.clause-dim` — on `ended`, tab switch and `Escape` (§5). */
export function clearClauseDim(root = document) {
  const doc = root.ownerDocument || root;
  for (const node of doc.querySelectorAll('.clause-dim')) node.classList.remove('clause-dim');
}

/** Clear both `.clause-active` and `.clause-dim`. */
export function clearClauseFocus(root = document) {
  const doc = root.ownerDocument || root;
  for (const node of doc.querySelectorAll('.clause-active')) node.classList.remove('clause-active');
  for (const node of doc.querySelectorAll('.clause-card[data-state="active"]')) {
    node.setAttribute('data-state', 'idle');
  }
  clearClauseDim(doc);
}

/* ─────────────────────────── main render ───────────────────────────────── */

/**
 * Hydrate the whole report from an `audit_result_v1` object.
 * Reads `audit.exposure` and `audit.way_out` directly — no verifier import.
 * @param {object} audit
 * @param {Document|Element} [root]
 * @returns {object} the audit that was rendered
 */
export function render(audit, root = document) {
  const result = audit || {};
  const doc = root.ownerDocument || root;
  if (!root.querySelector && !doc.querySelector) return result;

  paint(root, 'gap-banner', gapBannerHTML(result));
  paint(root, 'hero', heroHTML(result));
  paint(root, 'clauses', clauseListHTML(result));
  paint(root, 'playlist', playlistHTML(result));
  paint(root, 'contract', contractSheetHTML(result));
  paint(
    root,
    'disclaimer',
    `<p class="disclaimer">${icon('i-shield')}${escapeHTML(DISCLAIMER_TEXT)}</p>`
  );

  paintPrivacyStats(result, doc);
  paintStepperCounts(result, doc);

  wireWayOut(root, result);
  wireClauseInspector(root);
  wireOriginalScan(root);

  if (doc.documentElement) {
    doc.documentElement.setAttribute('lang', String(result.language || 'en'));
  }
  return result;
}

/* ── Way-Out interaction: pure local recompute, no fetch (§4, smoke test 3) ─ */

function wireWayOut(root, audit) {
  const slider = root.querySelector && root.querySelector('.wayout-slider');
  if (!slider) return;
  const { points } = wayOutPoints(audit);
  if (!points.length) return;

  const host = slider.closest('.wayout');
  const readCurrent = host && host.querySelector('[data-current-loss]');
  const readNegotiated = host && host.querySelector('[data-negotiated-loss]');
  const readSaved = host && host.querySelector('[data-saved]');
  const monthLabel = host && host.querySelector('[data-wayout-month-label]');
  const max = Number(slider.max) || points[points.length - 1].exit_month;

  const update = () => {
    const month = Math.round(Number(slider.value));
    const point = lossAt(points, month);
    const saved = Math.max(0, point.current_loss - point.negotiated_loss);
    slider.setAttribute('data-wayout-month', String(month));
    if (readCurrent) {
      readCurrent.textContent = formatINR(point.current_loss);
      readCurrent.setAttribute('data-current-loss', String(point.current_loss));
    }
    if (readNegotiated) {
      readNegotiated.textContent = formatINR(point.negotiated_loss);
      readNegotiated.setAttribute('data-negotiated-loss', String(point.negotiated_loss));
    }
    if (readSaved) readSaved.textContent = formatINR(saved);
    if (monthLabel) monthLabel.textContent = `Leave at month ${month} of ${max}`;
    slider.setAttribute(
      'aria-valuetext',
      `Leaving at month ${month} costs ${formatINR(point.current_loss)} today, ` +
        `${formatINR(point.negotiated_loss)} after negotiation. ` +
        `${formatINR(saved)} saved.`
    );
  };
  slider.addEventListener('input', update);
  update();
}

/* ── Clause inspector: in-place expand (mobile) / select (desktop) ──────── */

function isDesktop(doc) {
  return typeof doc.defaultView?.matchMedia === 'function'
    ? doc.defaultView.matchMedia('(min-width: 900px)').matches
    : false;
}

function wireClauseInspector(root) {
  const doc = root.ownerDocument || root;
  if (!root.querySelector) return;

  for (const trigger of root.querySelectorAll('[data-clause-toggle]')) {
    if (trigger.dataset.scBound === '1') continue;
    trigger.dataset.scBound = '1';
    trigger.addEventListener('click', () => {
      const card = trigger.closest('.clause-card');
      const clauseId = trigger.getAttribute('data-clause-toggle');
      const inspector = card && card.querySelector('.clause-inspector');
      const open = trigger.getAttribute('aria-expanded') === 'true';

      // Only one inspector open at a time — one surface at a time on mobile.
      for (const other of doc.querySelectorAll('[data-clause-toggle][aria-expanded="true"]')) {
        if (other === trigger) continue;
        other.setAttribute('aria-expanded', 'false');
        const otherCard = other.closest('.clause-card');
        const otherPanel = otherCard && otherCard.querySelector('.clause-inspector');
        if (otherPanel) otherPanel.hidden = true;
      }

      trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (inspector) inspector.hidden = open;

      if (!open && isDesktop(doc)) {
        // Desktop: selecting a clause highlights + scrolls the matching
        // contract block (the two panes share `data-clause-id`).
        focusClause(clauseId, doc, { scroll: true });
      }
    });
  }
}

/* ── Original Scan toggle (§7.1, §9) ────────────────────────────────────── */

function wireOriginalScan(root) {
  if (!root.querySelector) return;
  const toggle = root.querySelector('[data-original-scan]');
  const view = root.querySelector('[data-original-scan-view]');
  if (!toggle || !view) return;
  if (toggle.dataset.scBound === '1') return;
  toggle.dataset.scBound = '1';
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-pressed') === 'true';
    toggle.setAttribute('aria-pressed', open ? 'false' : 'true');
    view.hidden = open;
  });
}

/** Reset the original-scan toggle (used by tests / view switches). */
export function collapseOriginalScan(root = document) {
  const doc = root.ownerDocument || root;
  const toggle = doc.querySelector('[data-original-scan]');
  const view = doc.querySelector('[data-original-scan-view]');
  if (toggle) toggle.setAttribute('aria-pressed', 'false');
  if (view) view.hidden = true;
}

export { VERDICT_LABELS, SEVERITY_ICON, DISCLAIMER_TEXT, ILLEGIBLE_COPY };
