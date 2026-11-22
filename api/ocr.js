"use strict";

/**
 * POST /api/ocr — { images: [dataUrl] (≤3), doc_type }
 * Haiku 5.5 vision @ temp 0 → { pages:[{page,text}], illegible, pages_missing, meta }
 */

const { chat, MODELS, PROVIDER, parseJSONFromLLMResponse } = require("./_lib/llm-client");
const { buildPrompt, PROMPT_HASHES } = require("./_lib/prompts");

const MAX_IMAGES = 3;

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

function isDataUrl(value) {
  return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/.test(value);
}

function asPageList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((p, i) => ({
      page: Number.isFinite(Number(p && p.page)) ? Number(p.page) : i + 1,
      text: typeof (p && p.text) === "string" ? p.text : "",
    }))
    .filter((p) => p.text.trim().length > 0);
}

module.exports = async function handler(req, res) {
  const started = Date.now();

  if (req.method && req.method !== "POST") {
    return fail(res, 405, "method_not_allowed", "Use POST");
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, "invalid_json", "Request body must be JSON");

  const images = Array.isArray(body.images) ? body.images.filter(isDataUrl) : [];
  if (images.length === 0) {
    return fail(res, 400, "invalid_input", "images[] must contain 1-3 base64 image data URLs");
  }
  if (images.length > MAX_IMAGES) {
    return fail(res, 400, "too_many_images", `At most ${MAX_IMAGES} pages per request`);
  }

  const docType = String(body.doc_type || "general").replace(/[^a-z_]/g, "");

  try {
    const prompt = buildPrompt("contract.ocr@1", { DOC_TYPE: docType || "general" });

    const result = await chat({
      model: MODELS.ocr,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...images.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
    });

    const parsed = parseJSONFromLLMResponse(result.content) || {};
    const pages = asPageList(parsed.pages);

    // Fall back to a single blob so a lazy model response never loses text.
    if (pages.length === 0 && typeof parsed.text === "string" && parsed.text.trim()) {
      pages.push({ page: 1, text: parsed.text });
    }

    const illegible = (Array.isArray(parsed.illegible) ? parsed.illegible : [])
      .map((item) => ({
        page: Number.isFinite(Number(item && item.page)) ? Number(item.page) : null,
        snippet: String((item && (item.snippet || item.text)) || "").slice(0, 200),
      }))
      .filter((item) => item.page !== null);

    const pagesMissing = (Array.isArray(parsed.pages_missing) ? parsed.pages_missing : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);

    const pageCount = Number(parsed.page_count) > 0 ? Number(parsed.page_count) : images.length;

    return res.status(200).json({
      pages,
      illegible,
      pages_missing: pagesMissing,
      page_count: pageCount,
      notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 300) : "",
      meta: {
        llm_provider: PROVIDER,
        model: result.model,
        prompt_ids: ["contract.ocr@1"],
        template_hash: PROMPT_HASHES["contract.ocr@1"],
        duration_ms: Date.now() - started,
      },
    });
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    const code = (e && e.code) || "ocr_failed";
    // Never echo a key or an upstream body back to the client.
    const message = /unconfigured|_key_missing/.test(code)
      ? "Image reading is not configured on this deployment."
      : /timeout/.test(code)
        ? "The scan reader took too long. Try again with fewer pages."
        : "Could not read the scan right now. Try again or rescan the page.";
    return fail(res, status >= 500 ? status : 400, code, message);
  }
};
