"use strict";

/**
 * POST /api/qa — { question, audit_summary:{clauses,findings}, language }
 * Sonnet 5.5 @ temp 0.15 → { answer, clause_id, spoken:{language,text,text_en} }
 */

const { chat, MODELS, PROVIDER, parseJSONFromLLMResponse } = require("./_lib/llm-client");
const { buildPrompt, PROMPT_HASHES } = require("./_lib/prompts");

const LANGUAGES = ["kn", "hi", "ta", "en"];

const LANGUAGE_SCRIPT_NAME = {
  kn: "Kannada",
  hi: "Hindi",
  ta: "Tamil",
  en: "English",
};

const FALLBACK_SPOKEN = {
  kn: "ಈ ಪ್ರಶ್ನೆಗೆ ಒಪ್ಪಂದದಲ್ಲಿ ಸ್ಪಷ್ಟ ಉತ್ತರ ಇಲ್ಲ. ಮಾಲೀಕರನ್ನು ನೇರವಾಗಿ ಕೇಳಿ.",
  hi: "इस सवाल का साफ जवाब अनुबंध में नहीं है। मालिक से सीधे पूछें।",
  ta: "இந்தக் கேள்விக்கு ஒப்பந்தத்தில் தெளிவான பதில் இல்லை. உரிமையாளரிடம் நேரடியாகக் கேளுங்கள்.",
  en: "The contract does not clearly answer this. Ask the other side directly.",
};

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

/** OWASP LLM01 — strip control chars and any attempt to close our fences. */
function sanitizeForPrompt(text, max) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/<\/?untrusted_[a-z_]+>/gi, "[tag removed]")
    .slice(0, max || 8000);
}

/** Compact, token-cheap view of the completed audit — clause text + finding facts only. */
function summariseAudit(auditSummary) {
  const clauses = Array.isArray(auditSummary && auditSummary.clauses) ? auditSummary.clauses : [];
  const findings = Array.isArray(auditSummary && auditSummary.findings) ? auditSummary.findings : [];

  const clauseLines = clauses.slice(0, 25).map((c) => {
    const id = String((c && c.clause_id) || "");
    const index = Number.isFinite(Number(c && c.index)) ? Number(c.index) : "";
    const heading = String((c && (c.heading || c.title)) || "").slice(0, 80);
    const text = String((c && c.text) || "").replace(/\s+/g, " ").slice(0, 400);
    return `- ${id} (clause ${index}) ${heading}: ${text}`;
  });

  const findingLines = findings.slice(0, 25).map((f) => {
    const parts = [
      `rule_id=${String((f && f.rule_id) || "")}`,
      `clause=${String((f && f.clause_id) || "")}`,
      `severity=${String((f && f.severity) || "")}`,
      `title=${String((f && f.title) || "")}`,
      `explanation=${String((f && f.explanation) || "").replace(/\s+/g, " ").slice(0, 240)}`,
    ];
    return `- ${parts.join(" | ")}`;
  });

  const packId = String((auditSummary && auditSummary.pack && auditSummary.pack.pack_id) || "");

  return [
    packId ? `RULE PACK: ${packId}` : "",
    "",
    "CLAUSES",
    ...(clauseLines.length ? clauseLines : ["- (none supplied)"]),
    "",
    "FINDINGS",
    ...(findingLines.length ? findingLines : ["- (none supplied)"]),
  ]
    .join("\n")
    .slice(0, 12000);
}

function cleanSpoken(text, maxWords = 16) {
  const cleaned = String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ");
  if (words.length <= maxWords) return cleaned;
  const trimmed = words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

module.exports = async function handler(req, res) {
  const started = Date.now();

  if (req.method && req.method !== "POST") {
    return fail(res, 405, "method_not_allowed", "Use POST");
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, "invalid_json", "Request body must be JSON");

  const question = String(body.question || "").trim();
  if (question.length < 2) {
    return fail(res, 400, "invalid_input", "question is required");
  }
  if (question.length > 500) {
    return fail(res, 400, "question_too_long", "Ask a shorter question (under 500 characters)");
  }

  const language = LANGUAGES.includes(String(body.language)) ? String(body.language) : "en";
  const auditSummary = body.audit_summary && typeof body.audit_summary === "object" ? body.audit_summary : {};

  const knownClauseIds = new Set(
    (Array.isArray(auditSummary.clauses) ? auditSummary.clauses : [])
      .map((c) => String((c && c.clause_id) || ""))
      .filter(Boolean)
  );

  try {
    const prompt = buildPrompt("contract.qa@1", {
      LANGUAGE: language,
      LANGUAGE_SCRIPT_NAME: LANGUAGE_SCRIPT_NAME[language],
      AUDIT_SUMMARY: sanitizeForPrompt(summariseAudit(auditSummary), 12000),
      QUESTION: sanitizeForPrompt(question, 500),
    });

    const result = await chat({
      model: MODELS.qa,
      temperature: 0.15,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content:
            "You answer questions about one Indian contract using only the supplied audit summary. Output strict JSON only. Never cite statutes.",
        },
        { role: "user", content: prompt },
      ],
    });

    const parsed = parseJSONFromLLMResponse(result.content) || {};

    let answer = String(parsed.answer || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    if (!answer) answer = "The contract summary does not cover that. Ask the other side to confirm it in writing.";

    // Only echo a clause_id the client actually sent — never a hallucinated anchor.
    const rawClauseId = String(parsed.clause_id || "").trim();
    const clause_id = knownClauseIds.has(rawClauseId) ? rawClauseId : null;

    const spokenRaw =
      (parsed.spoken && (parsed.spoken.text || parsed.spoken.script)) || parsed.spoken_text || "";
    const spokenText = cleanSpoken(spokenRaw) || cleanSpoken(FALLBACK_SPOKEN[language]);
    const textEn =
      String((parsed.spoken && parsed.spoken.text_en) || parsed.text_en || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240) || answer.slice(0, 240);

    return res.status(200).json({
      answer,
      clause_id,
      spoken: { language, text: spokenText, text_en: textEn },
      meta: {
        llm_provider: PROVIDER,
        model: result.model,
        prompt_ids: ["contract.qa@1"],
        template_hash: PROMPT_HASHES["contract.qa@1"],
        duration_ms: Date.now() - started,
      },
    });
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    const code = (e && e.code) || "qa_failed";
    const message = /unconfigured|_key_missing/.test(String(code))
      ? "The answer engine is not configured on this deployment."
      : /timeout/.test(String(code))
        ? "That took too long. Try a shorter question."
        : "Could not answer that right now. Please retry.";
    return fail(res, status >= 500 ? status : 400, code, message);
  }
};

module.exports._internal = { summariseAudit, cleanSpoken, sanitizeForPrompt };
