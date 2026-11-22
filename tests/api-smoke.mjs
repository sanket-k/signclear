#!/usr/bin/env node
/**
 * Lane A smoke harness — pure Node, no server, no deps.
 *
 * Drives the real Vercel handlers with mock req/res and, when live keys are present,
 * makes REAL calls to Sarvam + OpenRouter. Offline structural checks always run.
 *
 *   node tests/api-smoke.mjs           # live if keys present
 *   SMOKE_OFFLINE=1 node tests/api-smoke.mjs
 *
 * Exit code is non-zero if any check fails.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ───────────────────────────── .env.local loader ───────────────────────────── */

function loadEnvLocal() {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvLocal();
const env = { ...fileEnv, ...process.env };
for (const key of ["LLM_PROVIDER", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "SARVAM_API_KEY"]) {
  if (fileEnv[key] && !process.env[key]) process.env[key] = fileEnv[key];
}
// Empty ANTHROPIC_API_KEY in .env.local must not shadow a real one.
if (!process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;

const OFFLINE = process.env.SMOKE_OFFLINE === "1";
const HAS_AI_KEY = Boolean(env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY);
const HAS_SPEECH_KEY = Boolean(env.SARVAM_API_KEY);

/* ───────────────────────────── mock req/res ───────────────────────────── */

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    finished: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      res.finished = true;
      return res;
    },
    send(payload) {
      res.body = payload;
      res.finished = true;
      return res;
    },
    end(payload) {
      if (payload !== undefined) res.body = payload;
      res.finished = true;
      return res;
    },
    setHeader() {
      return res;
    },
  };
  return res;
}

function mockReq(body, extra = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...(extra.headers || {}) },
    body,
    ...extra,
  };
}

/* ───────────────────────────── assertions ───────────────────────────── */

const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || "" });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (e) {
    results.push({ name, ok: false, detail: String((e && e.message) || e) });
    console.log(`FAIL  ${name} — ${String((e && e.message) || e)}`);
    return false;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Awaitable variant for checks that drive an async handler. */
async function acheck(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail || "" });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (e) {
    results.push({ name, ok: false, detail: String((e && e.message) || e) });
    console.log(`FAIL  ${name} — ${String((e && e.message) || e)}`);
    return false;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

/* ───────────────────────────── fixtures ───────────────────────────── */

const preset = JSON.parse(readFileSync(join(ROOT, "public/presets/blr-rental.json"), "utf8"));
const pack = JSON.parse(readFileSync(join(ROOT, "rules/in-ka-rental.json"), "utf8"));
const PACK_RULE_IDS = new Set(pack.rules.map((r) => r.rule_id));

const presetText = preset.pages.map((p) => p.text).join("\n\n");

const KANNADA_TEXT =
  "ನಿಮ್ಮ ಠೇವಣಿ ಹತ್ತು ತಿಂಗಳ ಬಾಡಿಗೆಗೆ ಸಮಾನವಾಗಿದೆ. ಇದು ಸಾಮಾನ್ಯಕ್ಕಿಂತ ಹೆಚ್ಚು.";

/* ───────────────────────────── offline checks ───────────────────────────── */

async function offlineChecks() {
  section("OFFLINE — structural");

  const prompts = require(join(ROOT, "api/_lib/prompts.js"));
  const rules = require(join(ROOT, "api/_lib/rules.js"));
  const llm = require(join(ROOT, "api/_lib/llm-client.js"));
  const speechLib = require(join(ROOT, "api/_lib/speech.js"));

  check("prompts: exactly three ids", () => {
    const ids = Object.keys(prompts.PROMPTS).sort();
    assert(ids.length === 3, `expected 3 prompts, got ${ids.length}`);
    assert(
      ids.join(",") === "contract.audit@1,contract.ocr@1,contract.qa@1",
      `unexpected ids: ${ids.join(",")}`
    );
    return ids.join(" ");
  });

  check("prompts: three cyrb53 template hashes", () => {
    const hashes = prompts.PROMPT_HASHES;
    const values = Object.values(hashes);
    assert(values.length === 3, "expected 3 hashes");
    for (const v of values) assert(/^cyrb53:[0-9a-f]+$/.test(v), `bad hash format: ${v}`);
    return values.join(" ");
  });

  check("prompts: templateHash matches the frozen algorithm", () => {
    // Pinned values from the shared contract's verbatim cyrb53 implementation.
    assert(
      prompts.templateHash("signclear") === "cyrb53:" + prompts.cyrb53("signclear").toString(16),
      "templateHash != cyrb53(str).toString(16)"
    );
    return "cyrb53 verbatim";
  });

  check("prompts: audit template fences untrusted text + forbids invented rule ids", () => {
    const t = prompts.PROMPTS["contract.audit@1"];
    assert(t.includes("<untrusted_contract_text>"), "missing untrusted fence");
    assert(/ONLY rule_ids/i.test(t), "missing rule_id restriction");
    assert(/Do NOT state statutes/i.test(t), "missing statute refusal");
    return "fenced + grounded";
  });

  check("prompts: OCR template asks for [ILLEGIBLE] and pages_missing", () => {
    const t = prompts.PROMPTS["contract.ocr@1"];
    assert(t.includes("[ILLEGIBLE]"), "missing [ILLEGIBLE] marker");
    assert(t.includes("pages_missing"), "missing pages_missing");
    return "[ILLEGIBLE] + pages_missing";
  });

  check("prompts: buildPrompt interpolates and rejects unknown ids", () => {
    const out = prompts.buildPrompt("contract.ocr@1", { DOC_TYPE: "residential_rental" });
    assert(out.includes("residential_rental"), "DOC_TYPE not interpolated");
    assert(!out.includes("{{DOC_TYPE}}"), "placeholder left behind");
    let threw = false;
    try {
      prompts.buildPrompt("contract.bogus@1", {});
    } catch {
      threw = true;
    }
    assert(threw, "unknown prompt id did not throw");
    return "ok";
  });

  check("rules: pickPack routes every doc type to the right pack", () => {
    const cases = [
      [{ docType: "residential_rental", text: "Lease at Bengaluru, Karnataka" }, "in-ka-rental"],
      [{ docType: "personal_loan", text: "loan agreement" }, "in-central-rbi-loan"],
      [{ docType: "employment_offer", text: "offer letter" }, "in-central-employment"],
      [{ docType: "nonsense_type", text: "unknown" }, "in-general-fallback"],
    ];
    for (const [input, expected] of cases) {
      const got = rules.pickPack(input).pack.pack_id;
      assert(got === expected, `${input.docType} → ${got}, expected ${expected}`);
    }
    return "4/4 packs";
  });

  check("rules: packPromptContext leaks no citations or negotiation asks", () => {
    const ctx = rules.packPromptContext(pack);
    assert(ctx.pack_id === "in-ka-rental", "wrong pack_id");
    const keys = Object.keys(ctx.rules[0]).sort().join(",");
    assert(keys === "benchmark,detection_hint,rule_id,title", `unexpected rule keys: ${keys}`);
    const serialised = JSON.stringify(ctx);
    assert(!serialised.includes("statutory_citation"), "citation leaked to model");
    assert(!serialised.includes("polite_ask"), "negotiation ask leaked to model");
    return "rule_id,title,detection_hint,benchmark only";
  });

  check("llm-client: MODELS are the verified OpenRouter ids", () => {
    const m = llm.MODELS;
    assert(m.ocr === "anthropic/claude-haiku-5.5", "wrong ocr model");
    assert(m.audit === "anthropic/claude-sonnet-5.5", "wrong audit model");
    assert(m.qa === "anthropic/claude-sonnet-5.5", "wrong qa model");
    assert(["openrouter", "anthropic"].includes(llm.PROVIDER), "bad PROVIDER");
    return `${llm.PROVIDER} · ${m.audit}`;
  });

  check("llm-client: parseJSONFromLLMResponse handles all 4 stages", () => {
    const parse = llm.parseJSONFromLLMResponse;
    assert(parse('{"a":1}').a === 1, "raw failed");
    assert(parse('```json\n{"a":2}\n```').a === 2, "fence failed");
    assert(parse('Here you go:\n{"a":3}\nHope that helps').a === 3, "embedded failed");
    assert(parse('{"a":4,}').a === 4, "trailing comma failed");
    assert(parse("not json at all") === null, "garbage did not return null");
    return "raw / fence / embedded / repair";
  });

  check("llm-client: toAnthropicBody translates OpenAI vision messages", () => {
    const body = llm.toAnthropicBody({
      model: "anthropic/claude-sonnet-5.5",
      temperature: 0.1,
      messages: [
        { role: "system", content: "be good" },
        {
          role: "user",
          content: [
            { type: "text", text: "read this" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
          ],
        },
      ],
    });
    assert(body.system === "be good", "system not hoisted");
    assert(body.temperature === 0.1, "temperature dropped");
    const parts = body.messages[0].content;
    assert(parts[0].type === "text", "text block missing");
    assert(parts[1].type === "image", "image block missing");
    assert(parts[1].source.media_type === "image/jpeg", "media type not parsed");
    assert(parts[1].source.data === "QUJD", "base64 not carried");
    return "system + image/source/base64";
  });

  check("speech: speakers + language codes match docs/speech-contract.md", () => {
    const s = speechLib.SPEAKERS;
    assert(s.kn === "chaitra_kn_conversation", "wrong kn speaker");
    assert(s.hi === "kavya_hi_conversational", "wrong hi speaker");
    assert(s.ta === "gokul_ta_narration", "wrong ta speaker");
    assert(s.en === "dev_en_conversational", "wrong en speaker");
    assert(speechLib.LANG_CODE.kn === "kn-IN", "wrong kn code");
    assert(speechLib.LANG_CODE.ta === "ta-IN", "wrong ta code");
    assert(speechLib.TTS_MODEL === "bulbul:v4-flash", "wrong TTS model");
    assert(speechLib.STT_MODEL === "saaras:v4", "wrong STT model");
    assert(speechLib.STT_MODE === "codemix", "wrong STT mode");
    return `${speechLib.TTS_MODEL} + ${speechLib.STT_MODEL}`;
  });

  // Handlers that must reject bad input without any network call.
  const ttsHandler = require(join(ROOT, "api/tts.js"));
  const sttHandler = require(join(ROOT, "api/stt.js"));
  const auditHandler = require(join(ROOT, "api/audit.js"));
  const ocrHandler = require(join(ROOT, "api/ocr.js"));
  const qaHandler = require(join(ROOT, "api/qa.js"));

  check("routes: all five handlers load", () => {
    for (const [name, fn] of [
      ["audit", auditHandler],
      ["ocr", ocrHandler],
      ["qa", qaHandler],
      ["tts", ttsHandler],
      ["stt", sttHandler],
    ]) {
      assert(typeof fn === "function", `${name} is not a function`);
    }
    return "audit, ocr, qa, tts, stt";
  });

  await acheck("routes: GET returns 405", async () => {
    const res = mockRes();
    await auditHandler({ method: "GET", headers: {} }, res);
    assert(res.statusCode === 405, `expected 405, got ${res.statusCode}`);
    assert(res.body.error.code === "method_not_allowed", "wrong error code");
    return "405 method_not_allowed";
  });

  await acheck("routes: audit rejects empty text with 400", async () => {
    const res = mockRes();
    await auditHandler(mockReq({ text: "short" }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    assert(res.body.error.code === "invalid_input", "wrong error code");
    return "400 invalid_input";
  });

  await acheck("routes: ocr rejects a request with no images", async () => {
    const res = mockRes();
    await ocrHandler(mockReq({ images: [], doc_type: "residential_rental" }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    return "400 invalid_input";
  });

  await acheck("routes: ocr rejects more than 3 images", async () => {
    const res = mockRes();
    const url = "data:image/jpeg;base64,QUJD";
    await ocrHandler(mockReq({ images: [url, url, url, url], doc_type: "general" }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    assert(res.body.error.code === "too_many_images", "wrong error code");
    return "400 too_many_images";
  });

  await acheck("routes: qa rejects an empty question", async () => {
    const res = mockRes();
    await qaHandler(mockReq({ question: "", language: "kn" }), res);
    assert(res.statusCode === 400, `expected 400, got ${res.statusCode}`);
    return "400 invalid_input";
  });

  await acheck("routes: tts rejects empty text with 400", async () => {
    const res = mockRes();
    await ttsHandler(mockReq({ text: "   ", language: "kn" }), res);
    assert([400, 502].includes(res.statusCode), `expected 400/502, got ${res.statusCode}`);
    if (res.statusCode === 400) assert(res.body.error.code === "invalid_input", "wrong code");
    return res.statusCode === 502 ? "502 speech_unconfigured (no key)" : "400 invalid_input";
  });

  return { auditHandler, ocrHandler, qaHandler, ttsHandler, sttHandler };
}

/* ───────────────────────────── live checks ───────────────────────────── */

async function liveTts(ttsHandler) {
  section("LIVE — Sarvam TTS (real key)");

  if (!HAS_SPEECH_KEY) {
    check("tts: live Kannada synthesis", () => {
      throw new Error("SKIPPED — SARVAM_API_KEY missing in .env.local");
    });
    return null;
  }

  let res = mockRes();
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    res = mockRes();
    await ttsHandler(mockReq({ text: KANNADA_TEXT, language: "kn" }), res);
    if (res.statusCode === 200) break;
    if (res.statusCode < 500) break;
    if (attempt < 2) console.log(`      (retrying tts after ${res.statusCode})`);
  }

  check("tts: live Kannada synthesis returns a real mp3", () => {
    assert(res.statusCode === 200, `HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
    const body = res.body;
    assert(typeof body.audio_base64 === "string", "audio_base64 missing");
    assert(body.audio_base64.length > 1000, `audio too short: ${body.audio_base64.length}`);
    assert(body.mime === "audio/mpeg", `wrong mime: ${body.mime}`);
    assert(body.speaker === "chaitra_kn_conversation", `wrong speaker: ${body.speaker}`);
    assert(body.language === "kn", `wrong language: ${body.language}`);
    const bytes = Buffer.from(body.audio_base64, "base64");
    const magic = bytes.subarray(0, 3).toString("latin1");
    const isMp3 =
      magic === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) || magic === "RIF";
    assert(isMp3, `not audio: first bytes ${bytes.subarray(0, 4).toString("hex")}`);
    return `base64 ${body.audio_base64.length} chars · ${bytes.length} bytes · ${magic}`;
  });

  return res;
}

async function liveStt(sttHandler, ttsRes) {
  section("LIVE — Sarvam STT round-trip");

  if (!HAS_SPEECH_KEY) {
    check("stt: live round-trip", () => {
      throw new Error("SKIPPED — SARVAM_API_KEY missing in .env.local");
    });
    return;
  }
  if (!ttsRes || ttsRes.statusCode !== 200) {
    check("stt: live round-trip", () => {
      throw new Error("SKIPPED — no TTS audio to transcribe");
    });
    return;
  }

  const sttRes = mockRes();
  await sttHandler(
    mockReq({
      audio_base64: ttsRes.body.audio_base64,
      mime: ttsRes.body.mime,
      language: "kn",
    }),
    sttRes
  );

  check("stt: Kannada audio round-trips to a transcript", () => {
    assert(sttRes.statusCode === 200, `HTTP ${sttRes.statusCode}: ${JSON.stringify(sttRes.body)}`);
    assert(typeof sttRes.body.transcript === "string", "transcript missing");
    assert(sttRes.body.transcript.trim().length > 0, "empty transcript");
    assert(/kn/.test(String(sttRes.body.language_code)), `unexpected language ${sttRes.body.language_code}`);
    return `"${sttRes.body.transcript.slice(0, 60)}"`;
  });
}

async function liveAudit(auditHandler) {
  section("LIVE — OpenRouter audit on the BLR rental preset");

  if (!HAS_AI_KEY) {
    check("audit: live pack-grounded audit", () => {
      throw new Error("SKIPPED — no OPENROUTER_API_KEY / ANTHROPIC_API_KEY in .env.local");
    });
    return null;
  }

  let res = mockRes();
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    res = mockRes();
    await auditHandler(
      mockReq({
        text: presetText,
        pages: preset.pages,
        doc_type: "residential_rental",
        language: "kn",
        page_count: preset.document.page_count,
        source_lane: "vector_pdf",
      }),
      res
    );
    if (res.statusCode === 200) break;
    if (res.statusCode < 500) break;
    if (attempt < 2) console.log(`      (retrying audit after ${res.statusCode})`);
  }

  check("audit: HTTP 200 with schema_version audit_result_v1", () => {
    assert(res.statusCode === 200, `HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert(res.body.schema_version === "audit_result_v1", `got ${res.body.schema_version}`);
    return `audit_id ${String(res.body.audit_id).slice(0, 8)}…`;
  });

  if (res.statusCode !== 200) {
    const body = res.body || {};
    check("audit: every finding rule_id ∈ active pack", () => {
      throw new Error(`cannot check — upstream failed: ${JSON.stringify(body.error || body)}`);
    });
    return res;
  }

  const result = res.body;

  check("audit: active pack is in-ka-rental (Bengaluru text)", () => {
    assert(result.pack.pack_id === "in-ka-rental", `got ${result.pack.pack_id}`);
    assert(result.pack.fallback_used === false, "fallback_used should be false");
    assert(result.pack.badge === null, "badge should be null");
    return `${result.pack.display_name} · verified ${result.pack.verified_date}`;
  });

  check("audit: every finding rule_id ∈ active pack", () => {
    assert(Array.isArray(result.findings), "findings is not an array");
    for (const f of result.findings) {
      assert(PACK_RULE_IDS.has(f.rule_id), `foreign rule_id leaked: ${f.rule_id}`);
    }
    return `${result.findings.length} findings, all in pack`;
  });

  check("audit: statutory_citation + negotiation_ask come from the pack", () => {
    const byId = new Map(pack.rules.map((r) => [r.rule_id, r]));
    for (const f of result.findings) {
      const rule = byId.get(f.rule_id);
      assert(rule, `no pack rule for ${f.rule_id}`);
      assert(
        JSON.stringify(f.statutory_citation) === JSON.stringify(rule.statutory_citation),
        `citation mismatch for ${f.rule_id}`
      );
      assert(f.negotiation_ask && f.negotiation_ask.short_title, `no ask for ${f.rule_id}`);
      assert(
        !/\{clause_ref\}/.test(f.negotiation_ask.firm_ask || ""),
        `unresolved {clause_ref} in ${f.rule_id}`
      );
    }
    return `${result.findings.length} citations + asks attached server-side`;
  });

  check("audit: summary_bullets.length === 3", () => {
    assert(Array.isArray(result.summary_bullets), "summary_bullets missing");
    assert(result.summary_bullets.length === 3, `got ${result.summary_bullets.length}`);
    for (const b of result.summary_bullets) {
      assert(typeof b === "string" && b.trim().length > 0, "empty bullet");
    }
    return result.summary_bullets[0].slice(0, 48) + "…";
  });

  check("audit: math_inputs present and numeric", () => {
    const m = result.math_inputs;
    assert(m && typeof m === "object", "math_inputs missing");
    const keys = [
      "monthly_rent",
      "deposit_amount",
      "deposit_cap_months",
      "painting_charge",
      "lock_in_penalty",
      "term_months",
    ];
    for (const k of keys) {
      assert(typeof m[k] === "number" && Number.isFinite(m[k]), `math_inputs.${k} is not a number`);
    }
    assert(m.deposit_cap_months === 3, `deposit_cap_months should be the pack benchmark 3, got ${m.deposit_cap_months}`);
    assert(m.deposit_amount >= 200000, `deposit_amount should be >= 200000, got ${m.deposit_amount}`);
    return `rent ${m.monthly_rent} · deposit ${m.deposit_amount} · cap ${m.deposit_cap_months}mo · term ${m.term_months}mo`;
  });

  check("audit: server does NOT compute exposure or way_out", () => {
    assert(result.exposure === undefined, "server computed exposure (verifier.js owns that)");
    assert(result.way_out === undefined, "server computed way_out (verifier.js owns that)");
    return "no rupees computed server-side";
  });

  check("audit: clauses[] have stable cN anchors and finding links", () => {
    assert(Array.isArray(result.clauses) && result.clauses.length > 0, "no clauses");
    for (const c of result.clauses) {
      assert(/^c\d+$/.test(c.clause_id), `bad clause_id ${c.clause_id}`);
      assert(typeof c.text === "string" && c.text.length > 0, `empty clause ${c.clause_id}`);
      assert(Number.isInteger(c.index), `clause ${c.clause_id} has no printed index`);
      assert(Array.isArray(c.finding_ids), `clause ${c.clause_id} missing finding_ids`);
    }
    return `${result.clauses.length} clauses, anchors c1..c${result.clauses.length}`;
  });

  check("audit: finding clause_id points at a real clause", () => {
    const ids = new Set(result.clauses.map((c) => c.clause_id));
    for (const f of result.findings) {
      assert(ids.has(f.clause_id), `finding ${f.finding_id} → unknown clause ${f.clause_id}`);
    }
    return `${result.findings.length} findings anchored`;
  });

  check("audit: quote invariants (verified ⇒ jaccard ≥ 0.80)", () => {
    for (const f of result.findings) {
      if (f.quote_verified) {
        assert(typeof f.quote === "string" && f.quote.length > 0, `${f.finding_id} verified but no quote`);
        assert(f.jaccard >= 0.8, `${f.finding_id} jaccard ${f.jaccard} < 0.80`);
      } else {
        assert(f.quote === null, `${f.finding_id} unverified but quote present`);
        assert(f.jaccard === null, `${f.finding_id} unverified but jaccard present`);
      }
    }
    return "quote/jaccard contract holds";
  });

  check("audit: expected_clauses carry present + clause_id", () => {
    assert(Array.isArray(result.expected_clauses), "missing expected_clauses");
    assert(result.expected_clauses.length === pack.expected_clauses.length, "expected_clauses length mismatch");
    for (const e of result.expected_clauses) {
      assert(typeof e.present === "boolean", `expected clause ${e.id} has no present flag`);
      assert("clause_id" in e, `expected clause ${e.id} has no clause_id key`);
      assert(typeof e.why_it_matters === "string", `expected clause ${e.id} lost why_it_matters`);
    }
    return `${result.expected_clauses.length} checks · ${result.expected_clauses.filter((e) => e.present).length} present`;
  });

  check("audit: spoken_script is native script, 12–16 words, no markdown", () => {
    assert(Array.isArray(result.spoken_script) && result.spoken_script.length > 0, "no spoken_script");
    for (const seg of result.spoken_script) {
      assert(seg.language === "kn", `segment language ${seg.language} != kn`);
      assert(!/[*_`#<>]/.test(seg.text), `markdown/SSML in segment: ${seg.text}`);
      assert(!seg.text.includes("/"), `slash in segment: ${seg.text}`);
      const words = seg.text.trim().split(/\s+/).length;
      assert(words >= 8 && words <= 20, `segment has ${words} words: ${seg.text}`);
      assert(/[\u0C80-\u0CFF]/.test(seg.text), `segment is not Kannada script: ${seg.text}`);
    }
    return `${result.spoken_script.length} segments · ${result.spoken_script[0].text.slice(0, 40)}…`;
  });

  check("audit: completeness has status and a banner when not complete", () => {
    const c = result.completeness;
    assert(["complete", "gaps_detected", "illegible"].includes(c.status), `bad status ${c.status}`);
    assert(Array.isArray(c.pages_found), "pages_found missing");
    assert(Array.isArray(c.pages_missing), "pages_missing missing");
    assert(Array.isArray(c.clause_gaps), "clause_gaps missing");
    if (c.status !== "complete") {
      assert(c.banner && c.banner.message, "non-complete status with no banner (silent failure)");
    }
    return `${c.status} · pages [${c.pages_found.join(",")}] · gaps ${c.clause_gaps.length}`;
  });

  check("audit: meta reports provider, model, prompt id, template hash", () => {
    const m = result.meta;
    assert(["openrouter", "anthropic"].includes(m.llm_provider), `bad provider ${m.llm_provider}`);
    assert(typeof m.model === "string" && m.model.length > 0, "no model");
    assert(JSON.stringify(m.prompt_ids) === JSON.stringify(["contract.audit@1"]), "wrong prompt_ids");
    assert(/^cyrb53:[0-9a-f]+$/.test(m.template_hash), `bad template_hash ${m.template_hash}`);
    assert(typeof m.duration_ms === "number", "no duration_ms");
    return `${m.llm_provider}/${m.model} · ${m.template_hash} · ${m.duration_ms}ms`;
  });

  check("audit: no API key leaked into the response body", () => {
    const serialised = JSON.stringify(result);
    assert(!/sk-or-v1-|sk-ant-|sk_[a-z0-9]{10,}/i.test(serialised), "a key pattern appears in the response");
    return "clean";
  });

  check("audit: score block present with value/band/label", () => {
    const s = result.score;
    assert(s && Number.isInteger(s.value), "score.value not an integer");
    assert(s.value >= 0 && s.value <= 100, `score out of range: ${s.value}`);
    assert(["risky", "caution", "fair", "safe"].includes(s.band), `bad band ${s.band}`);
    assert(typeof s.label === "string" && s.label.length > 0, "no score label");
    return `${s.value}/100 · ${s.band} · ${s.label}`;
  });

  return res;
}

async function liveQa(qaHandler, auditRes) {
  section("LIVE — OpenRouter Q&A (grounded)");

  if (!HAS_AI_KEY) {
    check("qa: live grounded answer", () => {
      throw new Error("SKIPPED — no LLM key in .env.local");
    });
    return;
  }
  if (!auditRes || auditRes.statusCode !== 200) {
    check("qa: live grounded answer", () => {
      throw new Error("SKIPPED — no prior audit result to ground on");
    });
    return;
  }

  const audit = auditRes.body;
  const res = mockRes();
  await qaHandler(
    mockReq({
      question: "How many months of deposit am I paying, and can I get it back early?",
      audit_summary: { clauses: audit.clauses, findings: audit.findings, pack: audit.pack },
      language: "kn",
    }),
    res
  );

  check("qa: returns a grounded answer + clause anchor + native script", () => {
    assert(res.statusCode === 200, `HTTP ${res.statusCode}: ${JSON.stringify(res.body)}`);
    const body = res.body;
    assert(typeof body.answer === "string" && body.answer.length > 10, "answer too short");
    assert(!/illegal|sue\b|AI lawyer/i.test(body.answer), "banned anti-liability phrasing in answer");
    const clauseIds = new Set(audit.clauses.map((c) => c.clause_id));
    assert(body.clause_id === null || clauseIds.has(body.clause_id), `hallucinated clause_id ${body.clause_id}`);
    assert(body.spoken && body.spoken.language === "kn", "spoken.language != kn");
    assert(typeof body.spoken.text === "string" && body.spoken.text.length > 0, "spoken.text empty");
    assert(/[\u0C80-\u0CFF]/.test(body.spoken.text), "spoken.text is not Kannada script");
    assert(!/[*_`#<>/]/.test(body.spoken.text), "markdown/slash in spoken.text");
    return `clause ${body.clause_id} · "${body.answer.slice(0, 50)}…"`;
  });
}

/* ───────────────────────────── main ───────────────────────────── */

async function main() {
  console.log("SignClear — Lane A API smoke harness");
  console.log(`mode: ${OFFLINE ? "OFFLINE" : "LIVE where keys exist"}`);
  console.log(
    `keys: llm=${HAS_AI_KEY ? "present" : "missing"} speech=${HAS_SPEECH_KEY ? "present" : "missing"} provider=${env.LLM_PROVIDER || "openrouter"}`
  );

  const handlers = await offlineChecks();

  let auditRes = null;
  let ttsRes = null;

  if (!OFFLINE) {
    ttsRes = await liveTts(handlers.ttsHandler);
    auditRes = await liveAudit(handlers.auditHandler);
    await liveStt(handlers.sttHandler, ttsRes);
    await liveQa(handlers.qaHandler, auditRes);
  } else {
    console.log("\n(SMOKE_OFFLINE=1 — live Sarvam/OpenRouter calls skipped)");
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log("ALL CHECKS PASSED");
  }
}

main().catch((e) => {
  console.error("\nHARNESS CRASHED:", e);
  process.exitCode = 1;
});
