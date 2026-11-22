"use strict";

/**
 * POST /api/stt — { audio_base64, mime, language? } → { transcript, language_code, language_probability }
 * Base64 → Blob → multipart/form-data → Sarvam saaras:v4 (mode=codemix).
 */

const speech = require("./_lib/speech");

const LANGUAGES = ["kn", "hi", "ta", "en"];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // Vercel body limit is 4.5MB

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

module.exports = async function handler(req, res) {
  if (req.method && req.method !== "POST") {
    return fail(res, 405, "method_not_allowed", "Use POST");
  }

  if (!speech.isConfigured()) {
    return fail(res, 502, "speech_unconfigured", "Speech recognition is not configured on this deployment.");
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, "invalid_json", "Request body must be JSON");

  const audioBase64 = String(body.audio_base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!audioBase64) return fail(res, 400, "invalid_input", "audio_base64 is required");

  let buffer;
  try {
    buffer = Buffer.from(audioBase64, "base64");
  } catch {
    return fail(res, 400, "invalid_audio", "audio_base64 is not valid base64");
  }
  if (buffer.length === 0) return fail(res, 400, "invalid_audio", "audio payload is empty");
  if (buffer.length > MAX_AUDIO_BYTES) {
    return fail(res, 400, "audio_too_large", "Recording must be under 30 seconds");
  }

  const mime = String(body.mime || "audio/webm");
  if (!/^audio\/|^video\//.test(mime)) {
    return fail(res, 400, "invalid_mime", "mime must be an audio type");
  }

  try {
    const result = await speech.stt({ buffer, mime });
    return res.status(200).json({
      transcript: result.transcript,
      language_code: result.language_code,
      language_probability: result.language_probability,
    });
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    const code = (e && e.code) || "speech_failed";
    const message =
      status === 504
        ? "Speech recognition timed out. Type your question instead."
        : "Could not transcribe that recording. Type your question instead.";
    return fail(res, status >= 500 ? status : 400, code, message);
  }
};
