# Provider contract — one-variable switch

| Env var | Values | Effect |
|---|---|---|
| `LLM_PROVIDER` | `openrouter` (default) · `anthropic` | Selects the LLM gateway inside `api/_lib/llm-client.js`. |
| `OPENROUTER_API_KEY` | string | Required when provider is `openrouter`. |
| `ANTHROPIC_API_KEY` | string | Required when provider is `anthropic`. |
| `SARVAM_API_KEY` | string | TTS/STT proxy; missing ⇒ client `speechSynthesis` fallback. |

**Switch rules**
- Default is `openrouter` for the whole build; flip to `anthropic` only when event credits activate.
- Both gateways use the same OpenAI-style chat-completions schema, so call sites never branch on provider.
- Model routing is fixed: Haiku 5.5 @ 0.0 (OCR/triage), Sonnet 5.5 @ 0.1 (audit), Sonnet 5.5 @ 0.15 (Q&A).
- A missing key is a JSON error from the server, never a client crash.
- No provider key may be referenced by anything under `public/`.
