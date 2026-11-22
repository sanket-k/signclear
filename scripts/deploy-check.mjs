#!/usr/bin/env node
/**
 * scripts/deploy-check.mjs — pre-deploy gate (zero deps, Node built-ins only).
 * ---------------------------------------------------------------------------
 * Everything here is a rule we have already broken once. It is cheaper to fail
 * here than on stage or on Vercel:
 *
 *   1. No build tooling / deps      — package.json, package-lock.json,
 *                                     node_modules, vite.config.js,
 *                                     webpack.config.js must not exist
 *                                     (AGENTS.md §2 + tests/wiring.test.mjs).
 *   2. No secrets in shipped code   — public/ and api/ are served to the browser
 *                                     and bundled into the function; an
 *                                     Anthropic/OpenRouter key there is public.
 *   3. DESIGN_SYSTEM §DoD           — public/styles/app.css may not carry raw
 *                                     hex colours, `<n>ms` durations or
 *                                     `font-size: <n>px`; every value is a token.
 *   4. index.html references exist  — every local src=/href= resolves on disk
 *                                     (a typo'd path is a dead app on deploy).
 *   5. .vercelignore keeps rules/   — api/_lib/rules.js reads rules/*.json at
 *                                     runtime; ignoring rules/ 404s every audit.
 *
 *   node scripts/deploy-check.mjs      # exit 0 = safe to deploy, 1 = blocked
 *
 * Prints one PASS/FAIL line per check plus a summary. Exits 1 if anything fails.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/* ─────────────────────────── configuration ─────────────────────────────── */

/** AGENTS.md §2 — zero build, zero deps. */
const FORBIDDEN_PATHS = [
  'package.json',
  'package-lock.json',
  'node_modules',
  'vite.config.js',
  'webpack.config.js',
];

/** Anything shipped to the client or bundled into the Node function. */
const SECRET_ROOTS = ['public', 'api'];

/** Anthropic / OpenRouter / generic `sk_…_` style keys. */
const SECRET_PATTERN = /sk-ant-[A-Za-z0-9]|sk-or-v1-[A-Za-z0-9]|sk_[a-z0-9]{10,}_/;

/** DESIGN_SYSTEM §DoD — app.css is token-only. */
const CSS_FILE = 'public/styles/app.css';
const CSS_RULES = [
  { label: 'raw hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { label: 'raw <n>ms duration', pattern: /[0-9]+ms/g },
  { label: 'raw px font-size', pattern: /font-size:\s*[0-9]+px/g },
];

const INDEX_HTML = 'public/index.html';
const VERCELIGNORE = '.vercelignore';

/** Files we never scan as text (vendored binaries). Decoding them is noise. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.woff', '.woff2', '.ttf', '.otf', '.wasm', '.zip', '.mp3', '.wav',
]);

/** Skip huge vendored files for the secret scan; they are third-party UMD builds. */
const SECRET_SCAN_MAX_BYTES = 4 * 1024 * 1024;

/* ─────────────────────────────── helpers ──────────────────────────────── */

const abs = (rel) => join(REPO_ROOT, rel);

async function exists(rel) {
  try {
    await stat(abs(rel));
    return true;
  } catch {
    return false;
  }
}

async function readText(rel) {
  return readFile(abs(rel), 'utf8');
}

function extensionOf(file) {
  const base = file.slice(file.lastIndexOf(sep) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** Recursively list files under `rel`, skipping dot-dirs and node_modules. */
async function walk(rel, out = []) {
  let entries;
  try {
    entries = await readdir(abs(rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = `${rel}/${entry.name}`;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) await walk(child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

/** 1-indexed line numbers for every match, so the failure is actionable. */
function matchLines(text, pattern) {
  const hits = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let m;
    while ((m = re.exec(lines[i])) !== null) {
      hits.push({ line: i + 1, text: m[0].trim().slice(0, 120) });
      if (!re.global) break;
    }
  }
  return hits;
}

/* ─────────────────────────────── checks ──────────────────────────────── */

const results = [];
function record(label, ok, detail = '') {
  results.push({ label, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}\n`);
  return ok;
}

/** 1. Zero-build: none of the forbidden artefacts exist. */
async function checkNoBuildTooling() {
  process.stdout.write('\n── 1. zero build tooling / no deps ' + '─'.repeat(30) + '\n');
  const present = [];
  for (const rel of FORBIDDEN_PATHS) if (await exists(rel)) present.push(rel);
  record(
    'no package.json / lockfile / node_modules / vite|webpack config',
    present.length === 0,
    present.length ? `found: ${present.join(', ')}` : 'none present (zero-build preserved)'
  );
}

/** 2. No API keys in anything served to the browser or bundled into api/. */
async function checkNoSecrets() {
  process.stdout.write('\n── 2. no secrets in public/ or api/ ' + '─'.repeat(29) + '\n');
  const offenders = [];
  let scanned = 0;

  for (const root of SECRET_ROOTS) {
    if (!(await exists(root))) continue;
    for (const rel of await walk(root)) {
      if (BINARY_EXTENSIONS.has(extensionOf(rel))) continue;
      let info;
      try {
        info = await stat(abs(rel));
      } catch {
        continue;
      }
      if (info.size > SECRET_SCAN_MAX_BYTES) continue;
      let text;
      try {
        text = await readText(rel);
      } catch {
        continue;
      }
      scanned += 1;
      for (const hit of matchLines(text, SECRET_PATTERN)) {
        offenders.push(`${rel}:${hit.line} ${hit.text}`);
      }
    }
  }

  record(
    `no sk-ant-* / sk-or-v1-* / sk_*_ key in public/ or api/ (${scanned} files scanned)`,
    offenders.length === 0,
    offenders.length ? offenders.slice(0, 8).join(' | ') : 'clean'
  );
}

/** 3. DESIGN_SYSTEM §DoD — app.css holds no literals. */
async function checkCssLiterals() {
  process.stdout.write('\n── 3. app.css is token-only (DESIGN_SYSTEM §DoD) ' + '─'.repeat(17) + '\n');
  if (!(await exists(CSS_FILE))) {
    record(`${CSS_FILE} exists`, false, 'missing — cannot verify the DoD rule');
    return;
  }
  const css = await readText(CSS_FILE);
  let ok = true;
  for (const rule of CSS_RULES) {
    const hits = matchLines(css, rule.pattern);
    ok = record(
      `no ${rule.label}`,
      hits.length === 0,
      hits.length
        ? `${hits.length} hit(s): ${hits.slice(0, 5).map((h) => `L${h.line} ${h.text}`).join(' | ')}`
        : 'clean — every value is a var(--token)'
    ) && ok;
  }
}

/** 4. Every local asset index.html points at actually exists. */
async function checkIndexReferences() {
  process.stdout.write('\n── 4. index.html local refs resolve ' + '─'.repeat(30) + '\n');
  if (!(await exists(INDEX_HTML))) {
    record(`${INDEX_HTML} exists`, false, 'missing');
    return;
  }
  const html = await readText(INDEX_HTML);
  const seen = new Map();
  const attrPattern = /\b(?:src|href)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = attrPattern.exec(html)) !== null) {
    const raw = (m[2] !== undefined ? m[2] : m[3] || '').trim();
    if (!raw) continue;
    // Fragments are the inline SVG sprite; remote/data URLs are not our files.
    if (raw.startsWith('#') || raw.startsWith('//')) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:)/i.test(raw) && !/^file:/i.test(raw)) continue;
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      /* leave percent signs as-is */
    }
    // Resolve relative to public/ (where index.html lives).
    const rooted = decoded.startsWith('/') ? `public${decoded}` : `public/${decoded}`;
    const normalised = rooted.replace(/\/{2,}/g, '/').replace(/\/\.\//g, '/');
    if (!seen.has(normalised)) seen.set(normalised, []);
    seen.get(normalised).push(raw);
  }

  if (!seen.size) {
    record('index.html references resolvable assets', false, 'no local src/href found — parser drifted');
    return;
  }

  const missing = [];
  const resolved = [];
  for (const [rel, sources] of seen) {
    // `./icons/icon.svg` appears twice (rel=icon + apple-touch-icon): one check.
    if (await exists(rel)) resolved.push(`${rel}${sources.length > 1 ? ` ×${sources.length}` : ''}`);
    else missing.push(`${rel} (from ${sources.join(', ')})`);
  }

  record(
    `all ${seen.size} local index.html reference(s) exist`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(' | ')}` : resolved.join(', ')
  );
}

/** 5. .vercelignore must not drop rules/ (api reads rules/*.json at runtime). */
async function checkVercelIgnore() {
  process.stdout.write('\n── 5. .vercelignore keeps rules/ deployed ' + '─'.repeat(25) + '\n');
  if (!(await exists(VERCELIGNORE))) {
    record(`${VERCELIGNORE} exists`, true, 'absent — nothing is ignored, so rules/ ships');
    return;
  }
  const text = await readText(VERCELIGNORE);
  const offending = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    // A bare `rules/`, `/rules`, `rules`, `rules/*` … entry excludes the packs.
    const normalized = line.replace(/^[!/]+/, '').replace(/\/+$/, '');
    if (normalized === 'rules' || normalized.startsWith('rules/')) {
      offending.push(`L${i + 1} ${line}`);
    }
  }
  record(
    '.vercelignore has no rules/ exclusion',
    offending.length === 0,
    offending.length
      ? `api/_lib/rules.js would 404: ${offending.join(' | ')}`
      : 'rules/*.json stays in the deployment'
  );
}

/* ──────────────────────────────── main ──────────────────────────────── */

async function main() {
  process.stdout.write(`deploy-check · ${REPO_ROOT}\n`);

  await checkNoBuildTooling();
  await checkNoSecrets();
  await checkCssLiterals();
  await checkIndexReferences();
  await checkVercelIgnore();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`\n${'─'.repeat(64)}\n`);
  if (failed.length) {
    process.stdout.write(
      `DEPLOY BLOCKED — ${failed.length}/${results.length} check(s) failed:\n` +
        failed.map((r) => `  ✗ ${r.label} — ${r.detail}`).join('\n') +
        '\n'
    );
    return 1;
  }
  process.stdout.write(`DEPLOY OK — ${results.length}/${results.length} checks passed.\n`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`[deploy-check] fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
