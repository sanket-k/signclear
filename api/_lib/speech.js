"use strict";

/**
 * Sarvam speech proxy (§ speech-contract.md). Server-only key, never echoed.
 * TTS: bulbul:v4-flash · STT: saaras:v4 (mode=codemix).
 */

const TTS_URL = "https://api.sarvam.ai/text-to-speech";
const STT_URL = "https://api.sarvam.ai/speech-to-text";

const TTS_MODEL = "bulbul:v4-flash";
const STT_MODEL = "saaras:v4";
const STT_MODE = "codemix";
const TIMEOUT_MS = 45000;

const SPEAKERS = {
  kn: "chaitra_kn_conversation",
  hi: "kavya_hi_conversational",
  ta: "gokul_ta_narration",
  en: "dev_en_conversational",
};

const LANG_CODE = {
  kn: "kn-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  en: "en-IN",
};

function speechError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function isConfigured() {
  return Boolean(process.env.SARVAM_API_KEY);
}

function normaliseLanguage(language) {
  const key = String(language || "kn").toLowerCase().slice(0, 2);
  return SPEAKERS[key] ? key : "en";
}

/** Strip SSML/markdown so Bulbul never reads markup aloud. */
function speakableText(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function postJson(url, body, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw speechError(
        502,
        "speech_upstream_error",
        `sarvam_http_${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 240)}`
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw speechError(502, "speech_upstream_error", "sarvam_non_json_response");
    }
  } catch (e) {
    if (e && e.status) throw e;
    if (e && e.name === "AbortError") {
      throw speechError(504, "speech_timeout", "sarvam request exceeded 45s");
    }
    throw speechError(502, "speech_upstream_error", `sarvam_network_error: ${String(e && e.message)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{text:string, language?:string}} args
 * @returns {Promise<{audio_base64:string, mime:string, speaker:string, language:string, request_id?:string}>}
 */
async function tts({ text, language }) {
  if (!isConfigured()) throw speechError(502, "speech_unconfigured", "SARVAM_API_KEY missing");

  const cleaned = speakableText(text);
  if (!cleaned) throw speechError(400, "empty_text", "text is required");

  const lang = normaliseLanguage(language);
  const speaker = SPEAKERS[lang];

  const json = await postJson(
    TTS_URL,
    {
      text: cleaned.slice(0, 2500),
      target_language_code: LANG_CODE[lang],
      speaker,
      model: TTS_MODEL,
      speech_sample_rate: 22050,
      output_audio_codec: "mp3",
    },
    {
      "api-subscription-key": process.env.SARVAM_API_KEY,
      "content-type": "application/json",
    }
  );

  const audio = Array.isArray(json.audios) ? json.audios[0] : null;
  if (!audio) throw speechError(502, "speech_upstream_error", "sarvam returned no audio");

  return {
    audio_base64: audio,
    mime: "audio/mpeg",
    speaker,
    language: lang,
    request_id: json.request_id || null,
  };
}

/**
 * @param {{buffer:Buffer|Uint8Array, mime?:string, filename?:string}} args
 * @returns {Promise<{transcript:string, language_code:string, language_probability:number}>}
 */
async function stt({ buffer, mime, filename }) {
  if (!isConfigured()) throw speechError(502, "speech_unconfigured", "SARVAM_API_KEY missing");
  if (!buffer || buffer.length === 0) throw speechError(400, "empty_audio", "audio is required");

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const type = mime || "audio/mpeg";
  const ext = type.includes("wav")
    ? "wav"
    : type.includes("ogg")
      ? "ogg"
      : type.includes("webm")
        ? "webm"
        : type.includes("mp4") || type.includes("m4a")
          ? "m4a"
          : "mp3";

  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename || `audio.${ext}`);
  form.append("model", STT_MODEL);
  form.append("mode", STT_MODE);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let json;
  try {
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
      body: form,
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw speechError(
        502,
        "speech_upstream_error",
        `sarvam_http_${res.status}: ${raw.replace(/\s+/g, " ").slice(0, 240)}`
      );
    }
    try {
      json = JSON.parse(raw);
    } catch {
      throw speechError(502, "speech_upstream_error", "sarvam_non_json_response");
    }
  } catch (e) {
    if (e && e.status) throw e;
    if (e && e.name === "AbortError") {
      throw speechError(504, "speech_timeout", "sarvam request exceeded 45s");
    }
    throw speechError(502, "speech_upstream_error", `sarvam_network_error: ${String(e && e.message)}`);
  } finally {
    clearTimeout(timer);
  }

  return {
    transcript: String(json.transcript || ""),
    language_code: json.language_code || null,
    language_probability:
      typeof json.language_probability === "number" ? json.language_probability : null,
  };
}

module.exports = {
  SPEAKERS,
  LANG_CODE,
  TTS_MODEL,
  STT_MODEL,
  STT_MODE,
  isConfigured,
  tts,
  stt,
};
