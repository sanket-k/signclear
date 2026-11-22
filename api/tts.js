"use strict";

/**
 * POST /api/tts — { text, language } → { audio_base64, mime, speaker, language }
 * Missing SARVAM_API_KEY ⇒ 502 { error: { code: "speech_unconfigured" } }.
 * The client must fall back to speechSynthesis; never surface this as a UI error state.
 */

const speech = require("./_lib/speech");

const LANGUAGES = ["kn", "hi", "ta", "en"];

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
    return fail(res, 502, "speech_unconfigured", "Speech synthesis is not configured on this deployment.");
  }

  const body = readBody(req);
  if (!body) return fail(res, 400, "invalid_json", "Request body must be JSON");

  const text = String(body.text || "").trim();
  if (!text) return fail(res, 400, "invalid_input", "text is required");
  if (text.length > 2500) return fail(res, 400, "text_too_long", "Text must be under 2500 characters");

  const language = LANGUAGES.includes(String(body.language)) ? String(body.language) : "en";

  try {
    const audio = await speech.tts({ text, language });
    return res.status(200).json({
      audio_base64: audio.audio_base64,
      mime: audio.mime,
      speaker: audio.speaker,
      language: audio.language,
    });
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    const code = (e && e.code) || "speech_failed";
    const message =
      status === 504
        ? "Speech synthesis timed out. The app will use the device voice instead."
        : "Speech synthesis failed. The app will use the device voice instead.";
    return fail(res, status >= 500 ? status : 400, code, message);
  }
};
