// SignClear — public/js/api.js
// The only network surface the client owns (docs/ui-wiring-contract.md §4 "api + presets").
//
//   loadAudit({ presetId, language, signal }) -> { audit, offline }   // NEVER throws
//   fetchAudit({ text, pages, doc_type, language, pack_id, signal })  // -> audit, may throw
//
// Contract notes:
//   * docs/shared-contract.md §5 — POST /api/audit returns AuditResult minus
//     exposure/way_out, plus `math_inputs`. The client fills the rupee math with
//     verifier.js (the canonical implementation) so the server never computes money.
//   * docs/shared-contract.md §7 — if /api/audit is unreachable we render the preset
//     result and the shell flips `data-offline="true"`. Stage safety over correctness.
//   * No top-level side effects, no new deps, relative URLs only, `fetch` guarded.

const PRESET_DIR = "./presets/";
const AUDIT_ROUTE = "/api/audit";
const MOCK_AUDIT_URL = "./mock-audit.json";
const DEFAULT_PRESET_ID = "blr-rental";

const LANGUAGES = ["kn", "hi", "ta", "en"];

/** Only ever reach for the global fetch when it actually exists. */
function fetchAvailable() {
  return typeof fetch === "function";
}

function normaliseLanguage(language, fallback = "en") {
  return LANGUAGES.includes(language) ? language : fallback;
}

/** Deterministic, dependency-free "is this a usable audit payload?" check. */
function hasClauses(value) {
  return !!value && typeof value === "object" && Array.isArray(value.clauses);
}

async function getJSON(url, signal) {
  if (!fetchAvailable()) throw new Error("fetch unavailable");
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal,
  });
  if (!res || !res.ok) throw new Error(`GET ${url} failed`);
  const data = await res.json();
  if (!data || typeof data !== "object") throw new Error(`GET ${url} returned non-object JSON`);
  return data;
}

async function postAudit(body, signal) {
  if (!fetchAvailable()) throw new Error("fetch unavailable");
  const res = await fetch(AUDIT_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res || !res.ok) throw new Error(`POST ${AUDIT_ROUTE} failed`);
  const data = await res.json(); // throws on invalid JSON -> caller falls back
  if (!hasClauses(data)) throw new Error(`POST ${AUDIT_ROUTE} missing clauses`);
  return data;
}

/** { pages:[{page,text}] } -> a single contract text block. */
function textFromPages(pages) {
  if (!Array.isArray(pages)) return "";
  return pages
    .map((p) => (p && typeof p.text === "string" ? p.text : ""))
    .filter((t) => t.trim())
    .join("\n\n");
}

/** A preset we can actually send: needs at least one non-empty page. */
function usablePresetDocument(preset) {
  if (!preset || typeof preset !== "object") return null;
  const pages = (Array.isArray(preset.pages) ? preset.pages : [])
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p, i) => ({
      page: Number.isInteger(p.page) && p.page > 0 ? p.page : i + 1,
      text: p.text,
    }));
  if (!pages.length) return null;
  const text = textFromPages(pages);
  if (!text.trim()) return null;
  const docType =
    (preset.document && typeof preset.document.doc_type === "string" && preset.document.doc_type) || undefined;
  return { text, pages, doc_type: docType };
}

/** Same derivation, but sourced from the fixture audit when no preset is readable. */
function usableMockDocument(mock) {
  if (!hasClauses(mock)) return null;
  const pages = mock.clauses
    .filter((c) => c && typeof c.text === "string" && c.text.trim())
    .map((c, i) => ({
      page: Number.isInteger(c.page) && c.page > 0 ? c.page : i + 1,
      text: c.text,
    }));
  const text = textFromPages(pages);
  if (!text.trim()) return null;
  const docType =
    (mock.document && typeof mock.document.doc_type === "string" && mock.document.doc_type) || undefined;
  return { text, pages, doc_type: docType };
}

// --- mock-audit.json, loaded at most once per module instance ----------------
let mockAuditPromise = null;

/** The stage-safety fixture. Rejects only if it truly cannot be read. */
function loadMockAudit(signal) {
  if (!mockAuditPromise) {
    mockAuditPromise = getJSON(MOCK_AUDIT_URL, signal).then((data) => {
      if (!hasClauses(data)) throw new Error("mock-audit.json has no clauses");
      return data;
    });
    // A failed fetch must not poison the cache for the next caller.
    mockAuditPromise.catch(() => {
      mockAuditPromise = null;
    });
  }
  return mockAuditPromise;
}

/**
 * Fill `exposure`/`way_out` from `math_inputs` using verifier.js — the canonical
 * implementation (docs/shared-contract.md §1). Loaded lazily so importing api.js
 * never drags the maths module into the module graph (no cycle risk).
 *
 * Deliberately does NOT call buildAuditReport(): that needs the rule pack, which the
 * client does not hold, and passing `null` would silently drop every finding.
 */
async function fillMath(audit) {
  if (!audit || typeof audit !== "object") return audit;
  const mathInputs = audit.math_inputs;
  const hasMathInputs = !!mathInputs && typeof mathInputs === "object";
  const needsExposure = !audit.exposure || typeof audit.exposure !== "object";
  const needsWayOut = !audit.way_out || typeof audit.way_out !== "object";

  if (!hasMathInputs || (!needsExposure && !needsWayOut)) return audit;

  let verifier;
  try {
    verifier = await import("./verifier.js");
  } catch {
    return audit; // math module unavailable — renderer copes with missing values
  }

  try {
    let exposure = audit.exposure;
    if ((!exposure || typeof exposure !== "object") && typeof verifier.computeExposure === "function") {
      exposure = verifier.computeExposure(mathInputs);
    }
    let wayOut = audit.way_out;
    if (
      (!wayOut || typeof wayOut !== "object") &&
      exposure &&
      typeof verifier.computeWayOut === "function"
    ) {
      wayOut = verifier.computeWayOut({
        current: exposure.current,
        negotiated: exposure.negotiated,
        term_months:
          typeof mathInputs.term_months === "number" && Number.isFinite(mathInputs.term_months)
            ? mathInputs.term_months
            : 12,
      });
    }
    if (exposure && typeof exposure === "object") audit.exposure = exposure;
    if (wayOut && typeof wayOut === "object") audit.way_out = wayOut;
  } catch {
    /* leave whatever we have; a partial audit still renders */
  }
  return audit;
}

/** Last-resort payload so downstream code always gets `clauses: []`, never a throw. */
function minimalAudit(language) {
  return {
    schema_version: "audit_result_v1",
    audit_id: "offline-empty",
    created_at: new Date().toISOString(),
    language: normaliseLanguage(language),
    pack: {
      schema_version: "rule_pack_v1",
      pack_id: "in-general-fallback",
      display_name: "",
      jurisdiction: { country: "IN", state: null, cities: [] },
      verified_date: "",
      legal_basis: "",
      fallback_used: true,
      badge: null,
    },
    document: {
      doc_type: "general",
      title: "",
      source_lane: "vector_pdf",
      page_count: 1,
      privacy: {
        lane: "A",
        pii_tokens_found: 0,
        pii_token_types: { aadhaar: 0, pan: 0, phone: 0, email: 0, upi: 0, party_header: 0 },
        exif_stripped: true,
        zero_retention: false,
      },
    },
    score: { value: 0, band: "caution", label: "" },
    exposure: { currency: "INR", current: 0, negotiated: 0, saved: 0, breakdown: [] },
    way_out: { months: 12, points: [] },
    summary_bullets: [
      "This summary is guidance, not legal advice.",
      "Ask for the changes below before you sign.",
      "Amounts are estimated from the figures printed in your agreement.",
    ],
    findings: [],
    clauses: [],
    expected_clauses: [],
    spoken_script: [],
    completeness: {
      status: "complete",
      pages_found: [],
      pages_missing: [],
      clause_gaps: [],
      illegible_segments: [],
      banner: null,
    },
    ocr: { engine: "none", ocr_digit_tokens: [], illegible_count: 0 },
    meta: {
      llm_provider: "",
      model: "",
      prompt_ids: [],
      template_hash: "",
      duration_ms: 0,
    },
  };
}

/**
 * Boot loader: live audit when possible, fixture when not. Always resolves.
 * @param {{ presetId?: string, language?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ audit: object, offline: boolean }>}
 */
export async function loadAudit({ presetId = DEFAULT_PRESET_ID, language, signal } = {}) {
  const id = typeof presetId === "string" && presetId.trim() ? presetId.trim() : DEFAULT_PRESET_ID;

  // 1. The preset supplies the text we send, so read it first (and keep whatever
  //    we learn about the fixture, so a later failure needs no second fetch).
  let presetDocument = null;
  let fixture = null;
  try {
    const preset = await getJSON(`${PRESET_DIR}${id}.json`, signal);
    presetDocument = usablePresetDocument(preset);
  } catch {
    presetDocument = null;
  }

  if (!presetDocument) {
    // Fall back to mock-audit.json as the source of truth for both text and result.
    try {
      fixture = await loadMockAudit(signal);
      presetDocument = usableMockDocument(fixture);
    } catch {
      presetDocument = null;
    }
  }

  // 2. Live audit — the happy path.
  if (presetDocument) {
    try {
      const live = await postAudit(
        {
          text: presetDocument.text,
          pages: presetDocument.pages,
          doc_type: presetDocument.doc_type,
          language: normaliseLanguage(language, undefined) || undefined,
        },
        signal
      );
      if (hasClauses(live)) {
        await fillMath(live);
        if (!live.language) live.language = normaliseLanguage(language);
        // Server keeps math_inputs out of the rendered shape.
        if (live.math_inputs !== undefined) delete live.math_inputs;
        return { audit: live, offline: false };
      }
    } catch {
      /* fall through to the fixture */
    }
  }

  // 3. Offline path — never throws.
  try {
    const mock = fixture || (await loadMockAudit(signal));
    if (hasClauses(mock)) {
      const audit = Object.assign({}, mock);
      if (!audit.language) audit.language = normaliseLanguage(language);
      return { audit, offline: true };
    }
  } catch {
    /* fall through to the minimal shape */
  }

  return { audit: minimalAudit(language), offline: true };
}

/**
 * Direct audit call for ingested documents. Throws on failure — callers decide
 * whether to surface an error or drop back to loadAudit().
 * @param {{ text?: string, pages?: Array<{page:number,text:string}>, doc_type?: string,
 *   language?: string, pack_id?: string, signal?: AbortSignal }} [opts]
 * @returns {Promise<object>} AuditResult (exposure/way_out filled when math_inputs arrive)
 */
export async function fetchAudit({ text, pages, doc_type, language, pack_id, signal } = {}) {
  const body = {};

  const pageList = Array.isArray(pages)
    ? pages
        .filter((p) => p && typeof p.text === "string")
        .map((p, i) => ({ page: Number.isInteger(p.page) && p.page > 0 ? p.page : i + 1, text: p.text }))
    : null;
  if (pageList && pageList.length) body.pages = pageList;

  const sourceText =
    typeof text === "string" && text.trim() ? text : pageList ? textFromPages(pageList) : "";
  if (!sourceText.trim()) throw new Error("fetchAudit requires text or pages");
  body.text = sourceText;

  if (typeof doc_type === "string" && doc_type) body.doc_type = doc_type;
  if (typeof language === "string" && language) body.language = normaliseLanguage(language, language);
  if (typeof pack_id === "string" && pack_id) body.pack_id = pack_id;

  const audit = await postAudit(body, signal);
  await fillMath(audit);
  if (audit.math_inputs !== undefined) delete audit.math_inputs;
  return audit;
}
