import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const has = (p) => existsSync(join(root, p));
const read = (p) => readFileSync(join(root, p), "utf8");

const LANE_FILES = {
  a: ["api/_lib/llm-client.js", "api/_lib/rules.js", "api/_lib/prompts.js", "api/_lib/speech.js", "api/audit.js", "api/ocr.js", "api/qa.js", "api/tts.js", "api/stt.js"],
  b: ["public/index.html", "public/styles/app.css", "public/js/main.js", "public/js/renderer.js", "public/js/negotiate.js", "public/js/vault.js"],
  c: ["public/js/verifier.js", "public/js/prompt-security.js", "public/js/pii-guard.js", "tests/guardrails.test.mjs"],
};

const merged = Object.fromEntries(
  Object.entries(LANE_FILES).map(([lane, files]) => [lane, files.every(has)])
);

test("lane readiness is reported", () => {
  console.log("lane file presence:", merged);
  assert.ok(true);
});

test("no secret ever appears in client-served files", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|html|json|webmanifest|css)$/.test(entry.name)) {
        const body = readFileSync(full, "utf8");
        if (/sk-or-v1-[A-Za-z0-9]|sk-ant-[A-Za-z0-9]|sk_[a-z0-9]{10,}_/.test(body)) offenders.push(full);
      }
    }
  };
  walk(join(root, "public"));
  assert.deepEqual(offenders, [], `secrets leaked into served files: ${offenders.join(", ")}`);
});

test("no build tooling was introduced", () => {
  assert.ok(!has("package-lock.json"), "package-lock.json means npm install drifted");
  assert.ok(!has("vite.config.js") && !has("webpack.config.js"), "build config was added");
  for (const forbidden of ["node_modules"]) {
    assert.ok(!has(forbidden), `${forbidden} must not exist (zero-build)`);
  }
});

test("vendored libraries are present and non-empty", () => {
  for (const lib of ["public/lib/pdfjs/pdf.min.js", "public/lib/pdfjs/pdf.worker.min.js", "public/lib/jspdf.umd.min.js", "public/lib/qrcode.min.js"]) {
    assert.ok(has(lib), `missing vendored ${lib}`);
    assert.ok(readFileSync(join(root, lib)).length > 1000, `${lib} looks truncated`);
  }
});

test("client modules never import another lane's backend or vice versa", () => {
  if (!merged.b || !merged.c) return;
  for (const file of ["public/js/renderer.js", "public/js/main.js", "public/js/negotiate.js", "public/js/vault.js"]) {
    if (!has(file)) continue;
    const body = read(file);
    assert.ok(!/from\s+["'].*api\//.test(body), `${file} must not import api/`);
  }
  for (const file of ["api/audit.js", "api/ocr.js", "api/qa.js", "api/tts.js", "api/stt.js"]) {
    if (!has(file)) continue;
    const body = read(file);
    assert.ok(!/require\(["'].*public\//.test(body), `${file} must not require public/`);
  }
});

test("index.html honours the frozen DOM contract", () => {
  if (!merged.b) return;
  const html = read("public/index.html");
  const tabs = (html.match(/class="[^"]*\btab\b[^"]*"/g) || []).length;
  assert.ok(tabs >= 3, `expected >=3 .tab elements, found ${tabs}`);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, "exactly one <h1>");
  for (const icon of ["i-play", "i-mic", "i-alert", "i-caution", "i-check", "i-shield", "i-qr", "i-copy"]) {
    assert.ok(html.includes(`id="${icon}"`), `sprite missing #${icon}`);
  }
  for (const hook of ["sticky-bar", "btn-play-60", "btn-hold-ask", "lang-pill", "qr-dialog", "stepper", "disclaimer"]) {
    assert.ok(html.includes(hook), `index.html missing .${hook}`);
  }
  assert.ok(!/http:\/\/localhost|127\.0\.0\.1/.test(html), "no hardcoded localhost");
});

test("app.css contains no raw colour/size literals outside the token file", () => {
  if (!merged.b) return;
  const css = read("public/styles/app.css");
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `app.css raw hex: ${hex.join(", ")}`);
  const ms = css.match(/[0-9]+ms/g) || [];
  assert.deepEqual(ms, [], `app.css raw ms durations: ${ms.join(", ")}`);
  const pxFonts = css.match(/font-size:\s*[0-9]+px/g) || [];
  assert.deepEqual(pxFonts, [], `app.css raw px font sizes: ${pxFonts.join(", ")}`);
});

test("verifier reproduces the BLR fixture math", async () => {
  if (!merged.c) return;
  const { computeExposure, computeWayOut } = await import(join(root, "public/js/verifier.js"));
  const exposure = computeExposure({
    monthly_rent: 20000,
    deposit_amount: 200000,
    deposit_cap_months: 3,
    painting_charge: 40000,
    lock_in_penalty: 40000,
  });
  assert.equal(exposure.current, 280000);
  assert.equal(exposure.negotiated, 140000);
  assert.equal(exposure.saved, 140000);
  const way = computeWayOut({ current: 280000, negotiated: 140000, term_months: 11 });
  assert.equal(way.months, 11);
  const last = way.points.at(-1);
  assert.equal(last.current_loss, 0);
  assert.equal(last.negotiated_loss, 0);
});

test("prompt hashes agree across the two lanes", async () => {
  if (!merged.a || !merged.c) return;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const server = require(join(root, "api/_lib/prompts.js"));
  const client = await import(join(root, "public/js/prompt-security.js"));
  for (const id of ["contract.ocr@1", "contract.audit@1", "contract.qa@1"]) {
    assert.ok(server.PROMPT_HASHES?.[id], `server missing hash ${id}`);
    assert.ok(client.PROMPT_HASHES?.[id], `client missing hash ${id}`);
    assert.match(server.PROMPT_HASHES[id], /^cyrb53:[0-9a-f]+$/, `server ${id} hash shape`);
  }
  assert.equal(
    typeof server.cyrb53("signclear"),
    typeof client.cyrb53("signclear"),
    "cyrb53 must exist in both lanes"
  );
  assert.equal(server.cyrb53("signclear"), client.cyrb53("signclear"), "cyrb53 must agree byte-for-byte");
});

test("each api route exports a callable handler", async () => {
  if (!merged.a) return;
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  for (const route of ["audit", "ocr", "qa", "tts", "stt"]) {
    const handler = require(join(root, `api/${route}.js`));
    assert.equal(typeof handler, "function", `api/${route}.js must export a function`);
  }
});

test("pii guard never masks cities or states", async () => {
  if (!merged.c) return;
  const { detectPII } = await import(join(root, "public/js/pii-guard.js"));
  const preset = JSON.parse(read("public/presets/blr-rental.json"));
  const text = preset.pages.map((p) => p.text).join("\n");
  const result = detectPII(text);
  assert.ok(result.maskedText.includes("Bengaluru"), "Bengaluru must survive masking");
  assert.ok(result.maskedText.includes("Karnataka"), "Karnataka must survive masking");
  assert.equal(result.total, result.counts.aadhaar + result.counts.pan + result.counts.phone + result.counts.email + result.counts.upi + result.counts.party_header);
});
