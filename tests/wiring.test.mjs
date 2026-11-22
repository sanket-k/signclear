// Lane 10 wiring — UI orchestration + module contract suite. `node --test tests/wiring.test.mjs`
// Pure Node (node:fs + regex), no DOM, no deps. Pins docs/ui-wiring-contract.md §2–§7.
// Every assertion that targets a not-yet-merged file is guarded (same pattern as
// integration.test.mjs `if (!merged.b) return;`) so this file is green pre- and post-merge.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const has = (p) => existsSync(join(root, p));
const read = (p) => readFileSync(join(root, p), "utf8");

const MAIN = "public/js/main.js";
const STUB_MAX_CHARS = 400;

// Import/require specifiers, in source order. Catches `import x from "p"`, `import("p")`,
// `import "p"` and `export … from "p"` (never `export {};`).
const importsOf = (src) => {
  const out = [];
  const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
};

// Recursive .js/.mjs listing, relative to the repo root ("public/js/ui/theme.js").
const walkJS = (rel) => {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const files = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkJS(child));
    else if (/\.(js|mjs)$/.test(entry.name)) files.push(child);
  }
  return files;
};

// main.js is a stub while `export {};` is all it has (175 bytes today, orchestrator later).
const mainSrc = has(MAIN) ? read(MAIN) : "";
const mainImports = importsOf(mainSrc);
const mainIsStub =
  !has(MAIN) ||
  mainSrc.length < STUB_MAX_CHARS ||
  (mainSrc.includes("export {};") && mainImports.length === 0);

test("main.js is a real orchestrator, not the stub", () => {
  if (mainIsStub) {
    console.log(`SKIP: ${MAIN} is still the stub (${mainSrc.length} chars) — orchestrator lane not merged`);
    return;
  }

  const targets = [
    "renderer.js",
    "audio-sync.js",
    "ask.js",
    "ingest.js",
    "negotiate.js",
    "api.js",
    "ui/toast.js",
    "ui/theme.js",
    "ui/lang.js",
    "ui/tabs.js",
    "ui/qr.js",
    "ui/presets.js",
    "vault.js",
  ];

  // Normalise every specifier once: "./ui/toast.js" → "ui/toast.js".
  const specifiers = mainImports.map((spec) => spec.replace(/^\.\//, ""));
  for (const target of targets) {
    assert.ok(
      specifiers.some((spec) => spec === target || spec.endsWith(`/${target}`)),
      `${MAIN} must import ${target} (found: ${specifiers.join(", ") || "none"})`
    );
  }

  // The single Ctx is the only thing modules receive (§2) — "defines a Ctx" == it exposes
  // that surface (getAudit/setAudit/loadPreset/toast), whatever the local binding is named.
  const required = ["getAudit", "setAudit", "loadPreset", "toast"];
  for (const key of required) {
    assert.ok(mainSrc.includes(key), `${MAIN} Ctx is missing ${key}`);
  }
});

test("every index.html interactive hook is bound somewhere in public/js", () => {
  if (mainIsStub) {
    console.log("SKIP: main.js is still the stub — nothing can be bound yet");
    return;
  }
  assert.ok(has("public/index.html"), "public/index.html is missing");

  // [hook, optional data-* token when the attribute differs from the hook name]
  const HOOKS = [
    ["theme-toggle"],
    ["lang-opt"],
    ["preset"],
    ["view-opt"],
    ["tab"],
    ["tab-panel"],
    ["play", "play60"],
    ["holdask"],
    ["ask-fab"],
    ["ask-close"],
    ["ask-form"],
    ["qr-open"],
    ["qr-close"],
    ["qr-url"],
    ["qr-copy"],
    ["vault-open"],
    ["vault-close"],
    ["vault-save"],
    ["vault-clear"],
    ["vault-list"],
    ["vault-nosave"],
    ["camera-input"],
    ["stepper-cancel"],
  ];

  const files = walkJS("public/js");
  assert.ok(files.length > 0, "public/js has no modules to bind with");
  const bodies = files.map((file) => ({ file, body: read(file) }));
  const html = read("public/index.html");

  for (const [hook, token] of HOOKS) {
    const attr = `data-${token ?? hook}`;
    assert.ok(html.includes(attr), `index.html declares ${attr} but nothing binds it`);
    const owners = bodies.filter(({ body }) => body.includes(attr)).map(({ file }) => file);
    assert.ok(owners.length > 0, `${attr} is declared in index.html but unbound under public/js/`);
  }
});

test("each UI module exists and exports its factory", () => {
  const FACTORY_RE = /export\s+function\s+create(Theme|Lang|Tabs|Qr|Presets|Vault|Toast)\b/;
  const UI_MODULES = [
    "public/js/ui/theme.js",
    "public/js/ui/lang.js",
    "public/js/ui/tabs.js",
    "public/js/ui/qr.js",
    "public/js/ui/presets.js",
    "public/js/vault.js",
    "public/js/ui/toast.js",
  ];

  for (const file of UI_MODULES) {
    if (!has(file)) {
      console.log(`SKIP: ${file} not merged yet`);
      continue;
    }
    const body = read(file);
    assert.match(body, FACTORY_RE, `${file} must export function createXxx(ctx)`);
    // §3 every UI module returns { mount() }; toast is the documented exception (§4) and
    // returns { show(msg, tone) } instead.
    if (file === "public/js/ui/toast.js") {
      assert.match(body, /show\s*\(/, "ui/toast.js must return { show(msg, tone) } (§4)");
    } else {
      assert.match(body, /mount\s*\(/, `${file} must return { mount() } (§3)`);
    }
  }

  // vault.js ships named helpers alongside its factory (§4).
  if (has("public/js/vault.js")) {
    const body = read("public/js/vault.js");
    for (const helper of ["saveDoc", "listDocs", "clearDocs", "removeDoc", "KEY"]) {
      assert.ok(body.includes(helper), `public/js/vault.js must export ${helper}`);
    }
    assert.ok(/sc\.vault/.test(body), "vault.js KEY must be 'sc.vault'");
  } else {
    console.log("SKIP: public/js/vault.js helpers not merged yet");
  }

  // api.js is the only network surface main.js may import (§4).
  if (has("public/js/api.js")) {
    const body = read("public/js/api.js");
    for (const fn of ["loadAudit", "fetchAudit"]) {
      assert.match(
        body,
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b|export\\s*\\{[^}]*\\b${fn}\\b`),
        `public/js/api.js must export ${fn}`
      );
    }
  } else {
    console.log("SKIP: public/js/api.js not merged yet");
  }
});

test("no module imports a sibling UI module", () => {
  // Modules talk only through Ctx (§2) — a cross-import here means shared global state.
  const uiSet = ["public/js/vault.js", "public/js/api.js", ...walkJS("public/js/ui")];
  const present = uiSet.filter(has);
  if (present.length === 0) {
    console.log("SKIP: no ui/, vault.js or api.js merged yet");
    return;
  }

  const normalise = (fromFile, spec) => {
    if (!spec.startsWith(".")) return spec;
    const abs = resolve(join(root, dirname(fromFile)), spec);
    return abs.startsWith(root) ? abs.slice(root.length) : abs;
  };

  const targets = new Set(present);
  for (const file of present) {
    const specs = importsOf(read(file));
    for (const spec of specs) {
      const target = normalise(file, spec).replace(/^\.\//, "");
      assert.equal(
        targets.has(target) && target !== file,
        false,
        `${file} imports sibling module ${spec}; UI modules must communicate only via Ctx`
      );
    }
  }
});

test("no build tooling or deps were introduced", () => {
  for (const forbidden of [
    "package.json",
    "package-lock.json",
    "node_modules",
    "vite.config.js",
    "webpack.config.js",
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.ts",
  ]) {
    assert.ok(!has(forbidden), `${forbidden} must not exist (zero-build, no deps)`);
  }
});

test("app.css stays literal-free", () => {
  assert.ok(has("public/styles/app.css"), "public/styles/app.css is missing");
  const css = read("public/styles/app.css");
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hex, [], `app.css raw hex: ${hex.join(", ")}`);
  const ms = css.match(/[0-9]+ms/g) || [];
  assert.deepEqual(ms, [], `app.css raw ms durations: ${ms.join(", ")}`);
  const pxFonts = css.match(/font-size:\s*[0-9]+px/g) || [];
  assert.deepEqual(pxFonts, [], `app.css raw px font sizes: ${pxFonts.join(", ")}`);
});

test("PWA icon exists and manifest references it", () => {
  if (!has("public/icons/icon.svg")) {
    console.log("SKIP: public/icons/icon.svg not merged yet");
    return;
  }
  const svg = read("public/icons/icon.svg");
  assert.ok(svg.trim().length > 100, "icon.svg looks truncated");
  assert.ok(!/href="http|xlink:href="http/.test(svg), "icon.svg must not reference the network");

  assert.ok(has("public/manifest.webmanifest"), "manifest.webmanifest is missing");
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.ok(Array.isArray(manifest.icons), "manifest.icons must be an array");
  assert.ok(
    manifest.icons.some((icon) => icon && icon.src === "./icons/icon.svg"),
    `manifest.icons must reference './icons/icon.svg' (found: ${JSON.stringify(manifest.icons)})`
  );
});

test("modules are loadable in Node without a document", async () => {
  const SMOKE = [
    ["public/js/vault.js", "createVault"],
    ["public/js/ui/theme.js", "createTheme"],
  ];

  for (const [file, preferred] of SMOKE) {
    if (!has(file)) {
      console.log(`SKIP: ${file} not merged yet`);
      continue;
    }

    const href = pathToFileURL(join(root, file)).href;
    const mod = await import(href);
    const factory =
      (typeof mod[preferred] === "function" && [preferred, mod[preferred]]) ||
      Object.entries(mod).find(([, value]) => typeof value === "function" && /^create/.test(value));
    assert.ok(factory, `${file} must export a create*() factory for the Node smoke test`);

    const [name, create] = factory;
    let instance;
    assert.doesNotThrow(() => {
      instance = create({});
    }, `${name}({}) must not throw outside a browser`);
    assert.ok(instance && typeof instance === "object", `${name}({}) must return a module object`);
    if (typeof instance.mount === "function") {
      assert.doesNotThrow(() => instance.mount(), `${file}: mount() must not throw without a document`);
    }
  }
});
