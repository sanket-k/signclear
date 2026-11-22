// SignClear — pii-guard.js
// Lane A local PII shield: runs in the browser BEFORE any upload, so a contract never
// leaves the device carrying Aadhaar / PAN / phone / email / UPI / party headers.
// docs/shared-contract.md §4 is the spec; AGENTS.md §3.2 is the guardrail.
// ZERO DOM dependencies — runs under `node --test` unchanged.

/** Identifier detectors — byte-identical to docs/shared-contract.md §4 and tests/fixtures.test.mjs. */
export const DETECTORS = {
  aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  pan: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  phone: /\+\91[\s-]?\d{5}[\s-]?\d{5}\b/g,
  email: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,
  upi: /\b[\w.-]+@(?:okhdfcbank|okicici|oksbi|okaxis|paytm|ybl|upi)\b/g,
};

const PII_TYPES = ["aadhaar", "pan", "phone", "email", "upi", "party_header"];

/** Order matters: most specific first, so `upi` wins over a looser `email` overlap. */
const DETECT_ORDER = ["aadhaar", "pan", "phone", "upi", "email"];

/** Cities and states are NEVER masked or counted (docs: "never mask cities/states"). */
export const PLACES = [
  "Bengaluru", "Bangalore", "Karnataka", "Mumbai", "Maharashtra", "Delhi", "New Delhi",
  "Chennai", "Tamil Nadu", "Hyderabad", "Telangana", "Pune", "Kolkata", "West Bengal",
  "Ahmedabad", "Gujarat", "Jaipur", "Rajasthan", "Kochi", "Cochin", "Kerala", "Coimbatore",
  "Mysuru", "Mysore", "Mangaluru", "Mangalore", "Hubballi", "Belagavi", "Gurugram", "Gurgaon",
  "Noida", "Ghaziabad", "Chandigarh", "Lucknow", "Indore", "Bhopal", "Surat", "Nagpur",
  "Patna", "Bhubaneswar", "Visakhapatnam", "Goa", "Punjab", "Haryana", "Bihar", "Odisha",
  "Assam", "Uttarakhand", "Jharkhand", "Chhattisgarh", "Madhya Pradesh", "Uttar Pradesh",
  "Andhra Pradesh", "Tamilnadu", "India",
];

const PLACE_RE = new RegExp(`\\b(?:${PLACES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

const PARTY_NAME_RE = /\b(?:Mr|Mrs|Ms|Dr|Shri|Smt|Sri|Prof)\.?\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*/g;
const PARTY_LABEL_RE = /\b(?:Borrower|Lender|Guarantor|Owner|Tenant|Employee|Employer|Landlord)\s*:/g;
const ADDRESS_RE =
  /\b(?:residing at|resident of|address(?:ed)? at|R\/O)\s+([^\n(]{5,140}?)(?=\s*\(|\s*\n|,\s*(?:Aadhaar|PAN|Phone|Mobile|Tel|Email|E-mail|UPI|GSTIN|Passport)\b|$)/gi;
const STREET_LINE_RE = /\b\d{1,4}[A-Za-z]?\s*(?:,|\/)?\s*(?:[A-Za-z]*\s*){0,3}(?:Cross|Main|Road|Street|Layout|Nagar|Colony|Avenue|Lane|Block)\b/i;
const PIN_RE = /\b\d{6}\b/g;

/** A detector hit that spans more than this is treated as a runaway regex, not an identifier. */
const MAX_TOKEN_LEN = 120;
const MASK_BULLET = "•";

/** Keep the last two alphanumerics so a human can still recognise their own document. */
export function maskValue(raw) {
  const s = String(raw ?? "");
  const alnum = s.replace(/[^A-Za-z0-9]/g, "");
  if (!alnum) return MASK_BULLET.repeat(8);
  const tail = alnum.slice(-2).padStart(2, MASK_BULLET);
  return MASK_BULLET.repeat(8) + tail;
}

const overlap = (a, b) => a.start < b.end && b.start < a.end;

function collect(re, text, type, sink) {
  re.lastIndex = 0;
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    if (!raw) continue;
    sink.push({ type, raw, start: match.index, end: match.index + raw.length });
  }
}

/** Mask an address segment while leaving city/state tokens untouched. */
function maskAddress(segment) {
  let out = "";
  let cursor = 0;
  PLACE_RE.lastIndex = 0;
  for (const place of String(segment).matchAll(PLACE_RE)) {
    out += maskValue(segment.slice(cursor, place.index));
    out += place[0];
    cursor = place.index + place[0].length;
  }
  out += maskValue(segment.slice(cursor));
  return out;
}

function lineBounds(text, index) {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const nl = text.indexOf("\n", index);
  return [start, nl === -1 ? text.length : nl];
}

/**
 * Local PII shield.
 * @param {string} text raw contract text (post-OCR)
 * @returns {{
 *   safeToSend: boolean,
 *   maskedText: string,
 *   total: number,
 *   counts: { aadhaar: number, pan: number, phone: number, email: number, upi: number, party_header: number },
 *   tokens: Array<{ type: string, raw: string, masked: string, start: number, end: number }>
 * }}
 */
export function detectPII(text) {
  const source = typeof text === "string" ? text : text === null || text === undefined ? "" : String(text);
  const counts = Object.fromEntries(PII_TYPES.map((t) => [t, 0]));
  const tokens = [];
  let unmaskable = 0;

  // 1. Structured identifiers.
  for (const type of DETECT_ORDER) {
    const found = [];
    collect(DETECTORS[type], source, type, found);
    for (const hit of found) {
      if (tokens.some((t) => overlap(t, hit))) continue; // dedupe cross-detector overlaps
      tokens.push({ ...hit, masked: maskValue(hit.raw) });
    }
  }

  // 2. Party names — honorific form, then labelled party headers with no personal name.
  const names = [];
  collect(PARTY_NAME_RE, source, "party_header", names);
  for (const hit of names) {
    if (tokens.some((t) => overlap(t, hit))) continue;
    tokens.push({ ...hit, masked: maskValue(hit.raw) });
  }

  const labels = [];
  collect(PARTY_LABEL_RE, source, "party_header", labels);
  for (const hit of labels) {
    if (tokens.some((t) => overlap(t, hit))) continue;
    const [, lineEnd] = lineBounds(source, hit.start);
    const remainder = source.slice(hit.end, lineEnd);
    if (/(?:Mr|Mrs|Ms|Dr|Shri|Smt|Sri|Prof)\.?\s+[A-Z]/.test(remainder)) continue; // the name is already counted
    tokens.push({ ...hit, masked: maskValue(hit.raw) });
  }

  // 3. Street addresses in the party block — cities/states stay legible.
  const addresses = [];
  ADDRESS_RE.lastIndex = 0;
  for (const match of source.matchAll(ADDRESS_RE)) {
    const segment = match[1];
    if (!segment || !segment.trim()) continue;
    const start = match.index + match[0].length - segment.length;
    const hit = { type: "party_header", raw: segment, masked: maskAddress(segment), start, end: start + segment.length };
    if (hit.masked === hit.raw) continue; // only city/state in the segment — nothing to redact
    if (tokens.some((t) => overlap(t, hit))) continue;
    addresses.push(hit);
  }
  for (const hit of addresses) tokens.push(hit);

  // 4. Street lines with a house number but no "residing at" lead-in.
  const lines = [];
  let cursor = 0;
  for (const line of source.split("\n")) {
    lines.push([cursor, cursor + line.length]);
    cursor += line.length + 1;
  }
  for (const [lineStart, lineEnd] of lines) {
    const line = source.slice(lineStart, lineEnd);
    if (line.trim().length < 8 || !STREET_LINE_RE.test(line)) continue;
    const hit = { type: "party_header", raw: line, masked: maskAddress(line), start: lineStart, end: lineEnd };
    if (hit.masked === hit.raw) continue;
    if (tokens.some((t) => overlap(t, hit))) continue;
    tokens.push(hit);
  }

  // 5. Bare PIN codes — only where the line labels one, so rupee amounts stay readable.
  const pins = [];
  collect(PIN_RE, source, "party_header", pins);
  for (const hit of pins) {
    const [lineStart, lineEnd] = lineBounds(source, hit.start);
    if (!/\b(?:PIN|Pincode|Pin\s?code)\b/i.test(source.slice(lineStart, lineEnd))) continue;
    if (tokens.some((t) => overlap(t, hit))) continue;
    tokens.push({ ...hit, masked: maskValue(hit.raw) });
  }

  // Tally + maskability check.
  tokens.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = [];
  for (const token of tokens) {
    const maskable =
      token.raw.length <= MAX_TOKEN_LEN && /[A-Za-z0-9]/.test(token.raw) && token.masked !== token.raw;
    counts[token.type] += 1;
    if (!maskable) unmaskable++;
    kept.push(token);
  }

  // Splice masks in from the right so earlier offsets stay valid.
  let maskedText = source;
  for (let i = kept.length - 1; i >= 0; i--) {
    const token = kept[i];
    maskedText = maskedText.slice(0, token.start) + token.masked + maskedText.slice(token.end);
  }

  const total = PII_TYPES.reduce((sum, t) => sum + counts[t], 0);

  return {
    safeToSend: unmaskable === 0,
    maskedText,
    total,
    counts,
    tokens: kept,
  };
}

/** Convenience wrapper: the text you are allowed to upload. */
export function redactPII(text) {
  return detectPII(text).maskedText;
}
