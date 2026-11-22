// Aggregate test entry point — run the whole offline suite with one command:
//
//     node --test tests/all.test.mjs
//
// Why this file exists: `node --test tests/` does NOT work on this Node version.
// The directory argument is resolved as a module entry point rather than globbed,
// so it fails with MODULE_NOT_FOUND / "Cannot find module .../tests". Passing
// individual file paths works, which meant remembering four paths; importing them
// here gives a single command instead.
//
// NOTE: tests/api-smoke.mjs is deliberately NOT imported — it drives a live HTTP
// server (deployed or local) and must be run on its own, on purpose:
//     node --test tests/api-smoke.mjs
//
// Zero-build project: there is intentionally no package.json; do not add one.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dir = fileURLToPath(new URL(".", import.meta.url));
const SELF = "all.test.mjs";
const imported = [];

// Optional siblings are imported conditionally so this aggregate never crashes
// when a lane has not merged its suite yet. Each entry is a plain file name,
// resolved relative to this file.
//
// A file is never imported while it is itself being evaluated: a self-referential
// dynamic `await import()` is an ESM cycle, and the module's own evaluation is
// still pending, so the outer await never settles ("unsettled top-level await")
// and the process exits early. Hence the `name !== SELF` filter below — it keeps
// the list honest without deadlocking the run.
const optionalModules = [
  "preset-audits.test.mjs",
  SELF,
];

for (const name of optionalModules) {
  if (name === SELF) continue; // self-import would deadlock; see note above
  const abs = join(dir, name);
  if (!existsSync(abs)) continue;
  await import(`./${name}`);
  imported.push(name);
}

// Required suite — always present. These are static imports, so ESM evaluates
// them before any of the code above runs; the optional loop can therefore never
// prevent the core suite from registering its tests.
import "./guardrails.test.mjs";
import "./fixtures.test.mjs";
import "./integration.test.mjs";
import "./wiring.test.mjs";

imported.push(
  "guardrails.test.mjs",
  "fixtures.test.mjs",
  "integration.test.mjs",
  "wiring.test.mjs",
);

// Guard against this file silently becoming a no-op (e.g. all imports dropped):
// 4 required suites + whatever optional lanes exist today.
const REQUIRED_MODULES = 4;

test("aggregate suite loaded", () => {
  assert.ok(
    imported.length >= REQUIRED_MODULES,
    `expected >= ${REQUIRED_MODULES} imported test modules, got ${imported.length}: ${imported.join(", ")}`,
  );
  assert.ok(
    !imported.includes("api-smoke.mjs"),
    "api-smoke.mjs needs a live server and must not be part of the aggregate run",
  );
});
