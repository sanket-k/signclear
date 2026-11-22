"use strict";

/**
 * SignClear LLM gateway — one env var switches provider (§5 shared-contract).
 * Zero deps: Node 24 global fetch + AbortController.
 */

const PROVIDER = process.env.LLM_PROVIDER || "openrouter";

const MODELS = {
  ocr: "anthropic/claude-haiku-5.5",
  audit: "anthropic/claude-sonnet-5.5",
  qa: "anthropic/claude-sonnet-5.5",
};

const TIMEOUT_MS = 45000;
const ANTHROPIC_VERSION = "2023-06-01";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function llmError(status, code, message, retryable) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.retryable = retryable;
  return err;
}

function apiKey(provider) {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY || "";
  return process.env.OPENROUTER_API_KEY || "";
}

/** Pull every text part of a message content value (string or OpenAI-style parts). */
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

/** data:image/jpeg;base64,AAA -> { media_type: "image/jpeg", data: "AAA" } */
function splitDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(url || ""));
  if (!m) return null;
  return { media_type: m[1], data: m[2] };
}

/** OpenAI-style messages -> Anthropic Messages API body. */
function toAnthropicBody({ messages, model, temperature, max_tokens }) {
  const system = [];
  const converted = [];

  for (const msg of messages || []) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    if (msg.role === "system") {
      system.push(textOf(msg.content));
      continue;
    }

    let content;
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = [];
      for (const part of msg.content) {
        if (!part) continue;
        if (part.type === "text") {
          content.push({ type: "text", text: String(part.text || "") });
        } else if (part.type === "image_url") {
          const url = part.image_url && part.image_url.url ? part.image_url.url : part.image_url;
          const parsed = splitDataUrl(url);
          if (parsed) {
            content.push({
              type: "image",
              source: { type: "base64", media_type: parsed.media_type, data: parsed.data },
            });
          }
        } else if (part.type === "image" && part.source) {
          content.push(part);
        }
      }
    } else {
      content = textOf(msg.content);
    }

    if (!content || (Array.isArray(content) && content.length === 0)) continue;

    // Anthropic rejects two consecutive messages with the same role — merge.
    const prev = converted[converted.length - 1];
    if (prev && prev.role === role) {
      const prevBlocks = Array.isArray(prev.content)
        ? prev.content
        : [{ type: "text", text: String(prev.content) }];
      const blocks = Array.isArray(content) ? content : [{ type: "text", text: String(content) }];
      prev.content = prevBlocks.concat(blocks);
    } else {
      converted.push({ role, content });
    }
  }

  const body = { model, max_tokens: max_tokens || 2048, messages: converted };
  if (typeof temperature === "number") body.temperature = temperature;
  if (system.length) body.system = system.join("\n\n");
  return body;
}

/** One HTTP attempt. Never throws on HTTP status — the caller maps it. */
async function attempt({ messages, model, temperature, max_tokens, signal }) {
  const provider = PROVIDER === "anthropic" ? "anthropic" : "openrouter";
  const key = apiKey(provider);
  if (!key) {
    throw llmError(502, "llm_unconfigured", `${provider}_api_key_missing`, false);
  }

  const isAnthropic = provider === "anthropic";
  const url = isAnthropic ? ANTHROPIC_URL : OPENROUTER_URL;
  const body = isAnthropic
    ? toAnthropicBody({ messages, model, temperature, max_tokens })
    : {
        model,
        messages,
        ...(typeof temperature === "number" ? { temperature } : {}),
        max_tokens: max_tokens || 2048,
      };

  const headers = isAnthropic
    ? {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      }
    : {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "x-title": "SignClear",
      };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();

    if (!res.ok) {
      const retryable = res.status >= 500;
      const detail = raw.replace(/\s+/g, " ").slice(0, 300);
      throw llmError(
        retryable ? 502 : res.status === 401 || res.status === 403 ? 401 : 400,
        retryable ? "upstream_llm_error" : "llm_request_rejected",
        `llm_http_${res.status}: ${detail}`,
        retryable
      );
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw llmError(502, "upstream_llm_error", "llm_non_json_response", true);
    }

    let content = "";
    let usage = null;

    if (isAnthropic) {
      const blocks = Array.isArray(json.content) ? json.content : [];
      content = blocks
        .filter((b) => b && b.type === "text")
        .map((b) => b.text)
        .join("");
      if (json.usage) {
        usage = {
          prompt_tokens: json.usage.input_tokens,
          completion_tokens: json.usage.output_tokens,
          total_tokens: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0),
        };
      }
    } else {
      const choice = json.choices && json.choices[0];
      content = (choice && choice.message && choice.message.content) || "";
      if (Array.isArray(content)) {
        content = content
          .map((p) => (typeof p === "string" ? p : p && p.text ? p.text : ""))
          .join("");
      }
      usage = json.usage || null;
    }

    if (!content) throw llmError(502, "upstream_llm_error", "llm_empty_content", true);

    return { content, usage, model: json.model || model, provider };
  } catch (e) {
    if (e && e.status) throw e;
    if (timedOut) throw llmError(504, "llm_timeout", "llm request exceeded 45s", true);
    throw llmError(502, "upstream_llm_error", `llm_network_error: ${String(e && e.message)}`, true);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", forwardAbort);
  }
}

/**
 * @param {{messages:any[], model?:string, temperature?:number, max_tokens?:number, signal?:AbortSignal}} opts
 * @returns {Promise<{content:string, usage:object|null, model:string, provider:string}>}
 */
async function chat({ messages, model, temperature = 0, max_tokens = 2048, signal } = {}) {
  const chosenModel = model || MODELS.audit;
  let lastError = null;

  for (let i = 0; i < 2; i++) {
    try {
      return await attempt({ messages, model: chosenModel, temperature, max_tokens, signal });
    } catch (e) {
      lastError = e;
      if (e && e.retryable === false) throw e;
      if (!e || !e.retryable) throw e;
    }
  }

  throw lastError || llmError(502, "upstream_llm_error", "llm_failed", true);
}

/** Local tolerant JSON parser (4-stage, no deps). Never throws. */
function parseJSONFromLLMResponse(input) {
  if (input && typeof input === "object") return input;
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;

  const finish = (candidate) => {
    try {
      const value = JSON.parse(candidate);
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  };

  // 1. raw
  let hit = finish(text);
  if (hit) return hit;

  // 2. ```json fence (or any fence)
  const fences = [...text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)];
  for (const f of fences) {
    hit = finish(f[1].trim());
    if (hit) return hit;
  }

  // 3. first balanced {...} (string-aware) anywhere in the text
  const scan = (src) => {
    const start = src.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      }
    }
    return null; // truncated
  };

  const balanced = scan(text);
  if (balanced) {
    hit = finish(balanced) || finish(repairJson(balanced));
    if (hit) return hit;
  } else {
    // 3b. truncated object — close the open brackets and repair.
    hit = finish(repairJson(closeOpenBraces(text)));
    if (hit) return hit;
  }

  // 4. trailing-comma / smart-quote repair on the whole text, then on each brace chunk
  hit = finish(repairJson(text));
  if (hit) return hit;

  for (const f of fences) {
    hit = finish(repairJson(f[1].trim()));
    if (hit) return hit;
  }

  return null;
}

const TRAILING_COMMA = /,\s*([}\]])/g;

/** Close brackets left open by a truncated model response. */
function closeOpenBraces(src) {
  const start = src.indexOf("{");
  if (start === -1) return src;
  const body = src.slice(start);
  let inString = false;
  let escaped = false;
  const stack = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = body;
  if (inString) out += '"';
  while (stack.length) out += stack.pop();
  return out;
}

function repairJson(s) {
  return String(s)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(TRAILING_COMMA, "$1")
    .replace(/,\s*$/, "");
}

module.exports = {
  PROVIDER,
  MODELS,
  TIMEOUT_MS,
  chat,
  parseJSONFromLLMResponse,
  toAnthropicBody,
};
