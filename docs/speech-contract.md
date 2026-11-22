# Speech contract — Sarvam (verified live, 2026-11-22)

> Values here were confirmed against the live API with the event test key. Lane A proxies
> these; Lane C consumes the same shapes. Do not guess speaker names.

## Models

| Purpose | Model | Notes |
|---|---|---|
| TTS | `bulbul:v4-flash` | `bulbul:v2` is deprecated; `bulbul:v3` exists but v4-flash is the locked choice. |
| STT | `saaras:v4` | `mode: "codemix"`, ≤30s clip, 50 legal keyterms. |

## Speaker map (confirmed compatible with `bulbul:v4-flash`)

| lang | default speaker | alternates |
|---|---|---|
| `kn` | `chaitra_kn_conversation` | `chetan_kn_conversation`, `chaitra_kn_narration`, `suchitra_kn_narration` |
| `hi` | `kavya_hi_conversational` | `aayan_hi_conversational`, `amit_hi_conversational`, `manan_hi_conversational` |
| `ta` | `gokul_ta_narration` | `vijay_ta_narration`, `aravind_ta_ads`, `aravind_ta_suspense` |
| `en` | `dev_en_conversational` | `roopa_en_conversational`, `simran_en_conversation`, `zarina_en_conversation` |

`api/_lib/speech.js` (created by Lane A) owns `SPEAKERS = { kn, hi, ta, en }` mapping.

## TTS — `POST https://api.sarvam.ai/text-to-speech`

Request:
```json
{
  "text": "ನಿಮ್ಮ ಠೇವಣಿ ಹತ್ತು ತಿಂಗಳ ಬಾಡಿಗೆಗೆ ಸಮಾನವಾಗಿದೆ.",
  "target_language_code": "kn-IN",
  "speaker": "chaitra_kn_conversation",
  "model": "bulbul:v4-flash",
  "speech_sample_rate": 22050,
  "output_audios": ["mp3"]
}
```
Headers: `api-subscription-key: <SARVAM_API_KEY>`, `Content-Type: application/json`.

Response (200): `{ "request_id": "...", "audios": ["<base64 mp3>"] }`
Verified: a 13-word Kannada sentence produced a 127,052-byte mp3.

`/api/tts` normalises this to `{ audio_base64, mime: "audio/mpeg", speaker, language }`.

Language code map: `kn→kn-IN`, `hi→hi-IN`, `ta→ta-IN`, `en→en-IN`.

## STT — `POST https://api.sarvam.ai/speech-to-text`

`multipart/form-data`:
- `file` = audio blob (mp3/wav), ≤30s
- `model` = `saaras:v4`
- `mode` = `codemix`

Headers: `api-subscription-key: <SARVAM_API_KEY>`.

Response (200): `{ "request_id": "...", "transcript": "...", "language_code": "kn-IN", "language_probability": 1.0 }`
Verified: the Kannada TTS output round-tripped back to `"ನಿಮ್ಮ ಠೇವಣಿ 10 ತಿಂಗಳ ಬಾಡಿಗೆಗೆ ಸಮಾನವಾಗಿದೆ."`.

`/api/stt` accepts `{ audio_base64, mime }`, forwards as a file part, returns the transcript.

## Failure contract

- Missing `SARVAM_API_KEY` ⇒ HTTP 502 `{ error: { code: "speech_unconfigured" } }`.
- Any Sarvam error ⇒ HTTP 502 with the upstream message sanitised (no key echo).
- **Client must always fall back to `window.speechSynthesis`** using the same `spoken_script`
  segment, driving the same `data-state` calls so clause pulse/dim behaves identically.
  A `/api/tts` failure must never surface as an error state in the UI.
