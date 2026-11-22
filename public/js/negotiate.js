/**
 * negotiate.js — Lane B (UI Shell & Design System)
 * ---------------------------------------------------------------------------
 * The Negotiate tab (§9): tick the asks you want, pick Polite/Firm, pick
 * WhatsApp/Email, and the draft composes live into `.draft-preview`.
 *
 * Anti-liability (§7.3): the draft never contains Illegal / Unlawful / Void /
 * Sue / Court case / AI Lawyer / Legal advice / Guaranteed. The permanent
 * disclaimer sits adjacent to the draft, always.
 *
 * No network. No imports from Lane C. Wave 3 owns the jsPDF Pre-Sign Brief —
 * `exportBrief()` below is a clearly-marked, currently-uncalled stub.
 */

import { escapeHTML, severityFor, verdictLabelFor } from './renderer.js';

const DISCLAIMER_TEXT =
  'SignClear explains agreements in plain language and flags clauses that ' +
  'commonly deviate from Indian norms. It is not legal advice and it is not a ' +
  'law firm. Always read the original agreement before signing.';

/** Words that must never appear in a generated draft (§7.3). */
const BANNED = [
  'illegal',
  'unlawful',
  'void contract',
  'sue',
  'court case',
  'claim damages',
  'ai lawyer',
  'legal advice',
  'guaranteed',
  'you will win',
];

const TONES = { polite: 'Polite', firm: 'Firm' };

const icon = (id) =>
  `<svg class="icon" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;

/* ─────────────────────────── draft composition ─────────────────────────── */

/**
 * Compose the draft text. Pure function of (asks, tone, channel, audit) so the
 * same inputs always produce byte-identical clipboard content (smoke test 6).
 *
 * @param {Array<object>} findings selected findings, in render order
 * @param {'polite'|'firm'} tone
 * @param {'whatsapp'|'email'} channel
 * @param {object} audit
 * @returns {{subject: string, body: string, text: string}}
 */
export function composeDraft(findings, tone, channel, audit) {
  const title = (audit && audit.document && audit.document.title) || 'the agreement';
  const safeTitle = String(title);
  const picked = Array.isArray(findings) ? findings.filter(Boolean) : [];

  if (!picked.length) {
    return {
      subject: 'Quick question on ' + safeTitle,
      body:
        'I would like to discuss a few points in this agreement before signing. ' +
        'Could we find a short time to go through them together?',
      text:
        'I would like to discuss a few points in this agreement before signing. ' +
        'Could we find a short time to go through them together?',
    };
  }

  const closing =
    tone === 'firm'
      ? 'I would like to settle these points before signing. Could we agree on a revised draft?'
      : 'I am happy to sign once we are aligned on these points. Thank you for considering them.';

  const greeting = channel === 'email' ? 'Hello,' : 'Hello,';
  const opener =
    tone === 'firm'
      ? `I have reviewed "${safeTitle}" and would like the following revisions before signing.`
      : `I have read "${safeTitle}" and would like to request a few small changes.`;

  const lines = picked.map((finding, index) => {
    const ask = finding.negotiation_ask || {};
    const clauseNo = clauseNumberFor(audit, finding.clause_id);
    const clauseRef = clauseNo ? `Clause ${clauseNo}` : 'the relevant clause';
    const request =
      tone === 'firm'
        ? ask.firm_ask || ask.polite_ask || finding.title
        : ask.polite_ask || ask.firm_ask || finding.title;
    return `${index + 1}. ${clauseRef}: ${request}`;
  });

  const body = [greeting, '', opener, '', ...lines.flatMap((l) => [l, '']), closing].join('\n').trim();

  const subject =
    tone === 'firm'
      ? `Requested revisions before signing — ${safeTitle}`
      : `A few changes to discuss — ${safeTitle}`;

  const text = channel === 'email' ? `Subject: ${subject}\n\n${body}` : body;
  return { subject, body, text };
}

/** Printed clause number for a clause_id (c3 -> 3), when the audit has it. */
function clauseNumberFor(audit, clauseId) {
  const clauses = Array.isArray(audit && audit.clauses) ? audit.clauses : [];
  const hit = clauses.find((c) => c && c.clause_id === clauseId);
  if (hit && Number.isFinite(Number(hit.index))) return String(Number(hit.index));
  const numeric = String(clauseId || '').replace(/[^0-9]/g, '');
  return numeric || '';
}

/** Guardrail: the composed draft may never contain a banned phrase. */
function assertDraftClean(text) {
  const lower = String(text).toLowerCase();
  for (const word of BANNED) {
    if (lower.includes(word)) {
      console.warn(`[negotiate] blocked anti-liability phrase in draft: "${word}"`);
      return lower.split(word).join('revise');
    }
  }
  return text;
}

/* ─────────────────────────── markup ────────────────────────────────────── */

function askRowHTML(finding, index, checked) {
  const ask = finding.negotiation_ask || {};
  const severity = severityFor(finding);
  const verdict = verdictLabelFor(finding);
  const clauseNo = clauseNumberFor(null, finding.clause_id);
  const title = ask.short_title || finding.title;

  return (
    `<label class="ask-checkbox" data-rule-id="${escapeHTML(finding.rule_id || '')}" ` +
    `data-finding-id="${escapeHTML(finding.finding_id || '')}" ` +
    `data-clause-id="${escapeHTML(finding.clause_id || '')}" ` +
    `aria-checked="${checked ? 'true' : 'false'}">` +
    `<input type="checkbox"${checked ? ' checked' : ''} data-ask-input>` +
    `<span class="ask-box" aria-hidden="true">${icon('i-check')}</span>` +
    `<span class="ask-body">` +
    `<span class="ask-short">${escapeHTML(title)}</span>` +
    `<span class="ask-detail">${escapeHTML(finding.explanation || '')}</span>` +
    `<span class="ask-clause-ref">` +
    `<span class="severity-badge" data-severity="${severity}">${escapeHTML(verdict)}</span>` +
    (clauseNo ? ` \u00B7 Clause ${escapeHTML(clauseNo)}` : '') +
    `</span></span></label>`
  );
}

/**
 * Render the whole Negotiate tab into `root` (a `.tabpanel` slot).
 * @param {object} audit audit_result_v1
 * @param {Document|Element} [root]
 */
export function renderNegotiate(audit, root = document) {
  const doc = root.ownerDocument || root;
  const host =
    (root.querySelector && root.querySelector('[data-slot="negotiate"]')) ||
    (doc.querySelector && doc.querySelector('[data-slot="negotiate"]')) ||
    root;
  if (!host) return;

  const findings = (Array.isArray(audit && audit.findings) ? audit.findings : [])
    .filter((f) => f && f.negotiation_ask)
    .slice()
    .sort((a, b) => {
      const rank = { critical: 0, caution: 1, standard: 2, safe: 3 };
      return (rank[severityFor(a)] ?? 9) - (rank[severityFor(b)] ?? 9);
    });

  if (!findings.length) {
    host.innerHTML =
      `<div class="negotiate"><p class="neg-sub">No clause asks were generated for ` +
      `the pages that could be read.</p>` +
      `<p class="disclaimer">${icon('i-shield')}${escapeHTML(DISCLAIMER_TEXT)}</p></div>`;
    return;
  }

  // Default: tick the two most severe asks (smoke test 6 ticks two).
  const checked = new Set(findings.slice(0, Math.min(2, findings.length)).map((f) => f.finding_id));

  const rows = findings
    .map((f, i) => askRowHTML(f, i, checked.has(f.finding_id)))
    .join('');

  host.innerHTML =
    `<div class="negotiate">` +
    `<div class="neg-head">` +
    `<h2 class="neg-title">Ask for a change</h2>` +
    `<span class="neg-sub">Polite English, ready to send</span>` +
    `</div>` +
    `<div class="neg-asks" role="group" aria-label="Requested changes">${rows}</div>` +
    `<div class="neg-controls">` +
    `<div class="neg-control-row">` +
    `<span class="neg-control-label">Tone</span>` +
    `<div class="tone-switch" role="group" aria-label="Tone" data-tone="polite">` +
    `<button class="tone-opt" type="button" aria-pressed="true" data-tone-opt="polite">` +
    `${escapeHTML(TONES.polite)} &amp; Collaborative</button>` +
    `<button class="tone-opt" type="button" aria-pressed="false" data-tone-opt="firm">` +
    `${escapeHTML(TONES.firm)}</button>` +
    `</div></div>` +
    `<div class="neg-control-row">` +
    `<span class="neg-control-label">Send via</span>` +
    `<div class="channel-pill" role="group" aria-label="Channel" data-channel="whatsapp">` +
    `<button class="channel-opt" type="button" aria-pressed="true" data-channel-opt="whatsapp">` +
    `${icon('i-whatsapp')}WhatsApp</button>` +
    `<button class="channel-opt" type="button" aria-pressed="false" data-channel-opt="email">` +
    `${icon('i-mail')}Email</button>` +
    `</div></div></div>` +
    `<div class="draft-head">` +
    `<span class="draft-label">Your draft</span>` +
    `<button class="draft-copy" type="button" data-draft-copy>` +
    `${icon('i-copy')}Copy</button>` +
    `</div>` +
    `<div class="draft-preview" data-draft-preview role="textbox" aria-readonly="true" ` +
    `aria-multiline="true" tabindex="0"></div>` +
    `<textarea class="draft-copy-fallback" data-draft-fallback hidden readonly aria-label="Draft text"></textarea>` +
    `<p class="disclaimer">${icon('i-shield')}${escapeHTML(DISCLAIMER_TEXT)}</p>` +
    `</div>`;

  wireNegotiate(host, audit, findings, checked);
}

/* ─────────────────────────── interaction ───────────────────────────────── */

function wireNegotiate(host, audit, findings, checked) {
  const doc = host.ownerDocument || document;
  const state = {
    tone: 'polite',
    channel: 'whatsapp',
    checked,
  };

  const preview = host.querySelector('[data-draft-preview]');
  const fallback = host.querySelector('[data-draft-fallback]');

  const selected = () => findings.filter((f) => state.checked.has(f.finding_id));

  const repaint = () => {
    const draft = composeDraft(selected(), state.tone, state.channel, audit);
    const clean = assertDraftClean(draft.text);
    if (preview) preview.textContent = clean;
    if (fallback) fallback.value = clean;
    return clean;
  };

  // Checkboxes (§9 .ask-checkbox[data-rule-id], aria-checked mirrored)
  for (const row of host.querySelectorAll('.ask-checkbox')) {
    const input = row.querySelector('[data-ask-input]');
    const findingId = row.getAttribute('data-finding-id');
    const paint = () => {
      const on = input ? input.checked : row.getAttribute('aria-checked') === 'true';
      row.setAttribute('aria-checked', on ? 'true' : 'false');
      if (on) state.checked.add(findingId);
      else state.checked.delete(findingId);
      repaint();
    };
    row.addEventListener('click', (event) => {
      // The label already toggles the input; only intervene on the box itself.
      if (event.target !== input) {
        event.preventDefault();
        if (input) input.checked = !input.checked;
        paint();
      }
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (input) input.checked = !input.checked;
      paint();
    });
    row.setAttribute('tabindex', '0');
    if (input) input.addEventListener('change', paint);
  }

  // Tone switch
  for (const button of host.querySelectorAll('[data-tone-opt]')) {
    button.addEventListener('click', () => {
      state.tone = button.getAttribute('data-tone-opt') === 'firm' ? 'firm' : 'polite';
      for (const other of host.querySelectorAll('[data-tone-opt]')) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      }
      const group = host.querySelector('.tone-switch');
      if (group) group.setAttribute('data-tone', state.tone);
      repaint();
    });
  }

  // Channel pill
  for (const button of host.querySelectorAll('[data-channel-opt]')) {
    button.addEventListener('click', () => {
      state.channel = button.getAttribute('data-channel-opt') === 'email' ? 'email' : 'whatsapp';
      for (const other of host.querySelectorAll('[data-channel-opt]')) {
        other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
      }
      const group = host.querySelector('.channel-pill');
      if (group) group.setAttribute('data-channel', state.channel);
      repaint();
    });
  }

  // Copy — clipboard with a visible <textarea> fallback (§ smoke test 6).
  const copyButton = host.querySelector('[data-draft-copy]');
  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      const text = repaint();
      const ok = await copyText(text, fallback, doc);
      announce(doc, ok ? 'Draft copied' : 'Select the text and copy', ok ? 'ok' : 'warn');
    });
  }

  repaint();
}

/**
 * Copy with `navigator.clipboard`, falling back to a selectable <textarea>.
 * @returns {Promise<boolean>}
 */
async function copyText(text, fallback, doc) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  if (fallback) {
    fallback.hidden = false;
    fallback.value = text;
    fallback.focus();
    fallback.select();
    try {
      return doc.execCommand ? doc.execCommand('copy') : false;
    } catch {
      return false;
    }
  }
  return false;
}

/** Toast (§9 .toast) — shown through main.js when present, else a no-op. */
function announce(doc, message, tone) {
  const toast = doc.querySelector ? doc.querySelector('.toast') : null;
  if (!toast) return;
  const text = toast.querySelector('[data-toast-text]');
  if (text) text.textContent = message;
  toast.setAttribute('data-tone', tone || 'ok');
  toast.hidden = false;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

/* ─────────────────────────── Wave 3 stub ───────────────────────────────── */

/**
 * Pre-Sign Brief PDF export — **Wave 3, not wired yet.**
 * Intentionally a stub: Wave 1 ships the shell only, and the vendored
 * `public/lib/jspdf.umd.min.js` global must not be loaded on the demo path
 * until the brief layout is designed. Calls are made nowhere in Wave 1.
 *
 * @param {object} _audit
 * @returns {Promise<never>}
 */
export async function exportBrief(_audit) {
  throw new Error('exportBrief(): Pre-Sign Brief PDF is scheduled for Wave 3 (jsPDF).');
}

export { composeDraft as composeNegotiationDraft, BANNED as BANNED_PHRASES };
