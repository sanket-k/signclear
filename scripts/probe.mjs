#!/usr/bin/env node
/**
 * scripts/probe.mjs — headless-Chrome smoke probe (zero deps).
 * ---------------------------------------------------------------------------
 * The only honest way to verify this app is to actually boot it in a browser:
 * the module graph, the 900px breakpoint, the sticky bar vs the floating Ask
 * FAB and the desktop Split contract column are all CSS/JS runtime behaviour.
 * This is the checked-in version of the throwaway probe we kept retyping.
 *
 *   node scripts/probe.mjs
 *   node scripts/probe.mjs --url http://127.0.0.1:4173/ --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
 *
 * How it works (Node built-ins only: fetch + global WebSocket, Node >= 22):
 *   1. Spawn Chrome with --headless=new --remote-debugging-port=<random>.
 *   2. Poll http://127.0.0.1:<port>/json/version until webSocketDebuggerUrl exists.
 *   3. Attach to the page target, Page.enable + Runtime.enable.
 *   4. For each viewport (390x844, then 1440x900): set device metrics, navigate,
 *      wait ~2.5s, then Runtime.evaluate one probe expression.
 *   5. Assert. Exit 1 on any failure, 0 on pass, 2 when Chrome is missing.
 *
 * Expectations asserted (docs/wave2-plan.md, AGENTS.md §5):
 *   • no uncaught page exceptions
 *   • exactly 3 hero/clue bullets at both widths
 *   • 390  → the 62px sticky bar is visible (mobile action bar)
 *   • 1440 → the floating Ask FAB is visible (desktop action)
 *   • no horizontal overflow at either width (zero-pinch requirement)
 *   • 1440 → the Split contract column renders clause blocks (the regression)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ─────────────────────────── configuration ──────────────────────────────── */

const DEFAULT_URL = 'http://127.0.0.1:4173/';
const SETTLE_MS = 2500;
const CDP_TIMEOUT_MS = 20000;
const CHROME_BOOT_TIMEOUT_MS = 20000;

const VIEWPORTS = [
  { name: 'mobile 390x844', width: 390, height: 844, mobile: true },
  { name: 'desktop 1440x900', width: 1440, height: 900, mobile: false },
];

const USAGE = `Usage: node scripts/probe.mjs [--url http://127.0.0.1:4173/] [--chrome <path>]

  --url <url>       page to probe (default ${DEFAULT_URL})
  --chrome <path>   Chrome binary (default: platform path, or $CHROME_PATH)
  --settle <ms>     settle time after navigation (default ${SETTLE_MS})
  -h, --help        show this help

Start the static server first:  node scripts/serve.mjs --port 4173
Exit codes: 0 pass · 1 assertion failure · 2 Chrome missing / could not start.`;

/* ─────────────────────────────── args ──────────────────────────────────── */

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    chrome: process.env.CHROME_PATH || '',
    settle: SETTLE_MS,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) die(`${arg} needs a value`, 2);
      i += 1;
      return next;
    };
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--url') opts.url = value();
    else if (arg.startsWith('--url=')) opts.url = arg.slice('--url='.length);
    else if (arg === '--chrome') opts.chrome = value();
    else if (arg.startsWith('--chrome=')) opts.chrome = arg.slice('--chrome='.length);
    else if (arg === '--settle') opts.settle = Number(value());
    else if (arg.startsWith('--settle=')) opts.settle = Number(arg.slice('--settle='.length));
    else die(`unknown argument: ${arg}`, 2);
  }
  if (!/^https?:\/\//i.test(opts.url)) die(`--url must be http(s): ${opts.url}`, 2);
  if (!Number.isFinite(opts.settle) || opts.settle < 0) die('--settle must be a number >= 0', 2);
  return opts;
}

function die(message, code) {
  process.stderr.write(`[probe] ${message}\n\n${USAGE}\n`);
  process.exit(code);
}

/** Platform default Chrome paths, in preference order. */
function chromeCandidates() {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
}

function resolveChrome(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) {
      die(
        `Chrome binary not found at --chrome "${explicit}".\n` +
          `Install Google Chrome, or pass --chrome "<path>" / set CHROME_PATH.`,
        2
      );
    }
    return explicit;
  }
  for (const candidate of chromeCandidates()) if (existsSync(candidate)) return candidate;
  die(
    'Chrome not found. Install Google Chrome, or pass --chrome "<path>" / set CHROME_PATH.\n' +
      'Checked:\n' +
      chromeCandidates()
        .map((c) => `  - ${c}`)
        .join('\n'),
    2
  );
}

/* ───────────────────────────── small utils ─────────────────────────────── */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Grab a free TCP port by binding :0, then release it. */
function freePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

/* ─────────────────────────── CDP client ───────────────────────────────── */

class Cdp {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => this._onMessage(event.data));
    ws.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`${this.label}: socket closed before reply`));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl, label) {
    const ws = new WebSocket(wsUrl);
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}: WebSocket open timed out`)), CDP_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        done();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`${label}: WebSocket failed to open (${wsUrl})`));
      });
    });
    return new Cdp(ws, label);
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new Error(`${this.label} ${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
      return;
    }
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        /* a listener must never break the socket pump */
      }
    }
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} ${method}: timed out after ${CDP_TIMEOUT_MS}ms`));
      }, CDP_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/* ────────────────────────── the probe expression ───────────────────────── */

/**
 * Runs inside the page. Returns a plain JSON object — no DOM nodes, no cycles.
 * "Visible" means rendered (display/visibility/size), not "currently in the
 * viewport": the sticky bar is sticky, so it can legitimately sit off-screen.
 */
const PROBE_EXPRESSION = `(() => {
  const shell = document.querySelector('.app-shell');
  const text = (sel) => {
    const node = document.querySelector(sel);
    return node ? (node.textContent || '').trim() : null;
  };
  const rectVisible = (node) => {
    if (!node) return false;
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const box = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };

  const sticky = document.querySelector('.sticky-bar');
  const fab = document.querySelector('[data-ask-fab]');
  const contractCol = document.querySelector('.contract-col');
  const contractBlocks = contractCol ? Array.from(contractCol.querySelectorAll('.clause-block')) : [];
  const docEl = document.documentElement;
  const body = document.body;

  return {
    url: location.href,
    viewport: { width: innerWidth, height: innerHeight },
    view: shell ? shell.dataset.view || null : null,
    activeTab: shell ? shell.dataset.activeTab || null : null,
    offline: shell ? shell.dataset.offline || null : null,
    theme: docEl ? docEl.dataset.theme || null : null,
    lang: docEl ? docEl.lang || null : null,
    score: text('.hero-score .score-value'),
    scoreLabel: text('.hero-score-title'),
    exposure: text('.hero-exposure-value'),
    clueBullets: document.querySelectorAll('.hero-bullets > li').length,
    clauseCards: document.querySelectorAll('.clause-card').length,
    clauseBlocks: contractBlocks.filter(rectVisible).length,
    clauseBlocksRendered: contractBlocks.length,
    contractColVisible: rectVisible(contractCol),
    disclaimer: !!document.querySelector('.disclaimer'),
    disclaimerText: text('.disclaimer'),
    piiBadge: text('[data-pii-badge] .pii-text'),
    stepperState: (() => {
      const el = document.querySelector('.stepper');
      return el ? el.dataset.state || null : null;
    })(),
    stickyBar: { visible: rectVisible(sticky), box: box(sticky) },
    askFab: { visible: rectVisible(fab), box: box(fab) },
    overflow: {
      horizontal: docEl.scrollWidth > docEl.clientWidth + 1,
      scrollWidth: docEl.scrollWidth,
      clientWidth: docEl.clientWidth,
      bodyScrollWidth: body ? body.scrollWidth : null,
    },
    bodyFontSize: body ? getComputedStyle(body).fontSize : null,
    bodyFontSizePx: body ? Math.round(parseFloat(getComputedStyle(body).fontSize) * 100) / 100 : null,
  };
})()`;

/* ────────────────────────────── runner ───────────────────────────────── */

function startChrome(binary, port, userDataDir) {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-process-singleton-dialog',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,MediaRouter',
    '--mute-audio',
    '--hide-crash-restore-bubble',
    '--window-size=1440,900',
    'about:blank',
  ];
  const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const capture = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) log.push(line.trim());
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return { child, log };
}

async function waitForDevTools(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + CHROME_BOOT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const info = await getJson(endpoint);
      if (info && info.webSocketDebuggerUrl) return info;
      lastError = new Error('no webSocketDebuggerUrl yet');
    } catch (err) {
      lastError = err;
    }
    await sleep(120);
  }
  throw new Error(
    `Chrome DevTools endpoint never came up at ${endpoint}: ${lastError ? lastError.message : 'timeout'}`
  );
}

async function pageTarget(port) {
  const list = await getJson(`http://127.0.0.1:${port}/json/list`);
  const pages = (list || []).filter((t) => t && t.type === 'page' && t.webSocketDebuggerUrl);
  return pages[0] || null;
}

/** Attach to the first page target; create one via the browser socket if needed. */
async function attachPage(port, versionInfo) {
  const existing = await pageTarget(port);
  if (existing) return { wsUrl: existing.webSocketDebuggerUrl, createdTargetId: null, browser: null };

  const browser = await Cdp.connect(versionInfo.webSocketDebuggerUrl, 'browser');
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const list = await getJson(`http://127.0.0.1:${port}/json/list`);
    const hit = (list || []).find((t) => t && t.id === targetId && t.webSocketDebuggerUrl);
    if (hit) return { wsUrl: hit.webSocketDebuggerUrl, createdTargetId: targetId, browser };
    await sleep(100);
  }
  throw new Error('created target never exposed a webSocketDebuggerUrl');
}

async function runViewport(page, viewport, opts) {
  const exceptions = [];
  const consoleErrors = [];
  const off = page.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params && msg.params.exceptionDetails;
      const description =
        (details && details.exception && details.exception.description) ||
        (details && details.text) ||
        'unknown exception';
      exceptions.push(String(description).split('\n')[0]);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      consoleErrors.push(
        (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? a.type)
          .join(' ')
          .slice(0, 300)
      );
    }
  });

  try {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    // maxTouchPoints must be 1-16, so only send it when we actually emulate touch.
    await page.send(
      'Emulation.setTouchEmulationEnabled',
      viewport.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false }
    );
    // A fresh document, so the media queries and module graph boot at this width.
    await page.send('Page.navigate', { url: opts.url });
    const deadline = Date.now() + CDP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { result } = await page.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      if (result && result.value === 'complete') break;
      await sleep(100);
    }
    await sleep(opts.settle);

    const evaluated = await page.send('Runtime.evaluate', {
      expression: PROBE_EXPRESSION,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    });

    if (evaluated.exceptionDetails) {
      const d = evaluated.exceptionDetails;
      exceptions.push(
        String((d.exception && d.exception.description) || d.text || 'probe expression threw').split('\n')[0]
      );
      return { viewport, result: null, exceptions, consoleErrors };
    }
    if (!evaluated.result || !evaluated.result.value) {
      exceptions.push('probe expression returned no value');
      return { viewport, result: null, exceptions, consoleErrors };
    }
    return { viewport, result: evaluated.result.value, exceptions, consoleErrors };
  } finally {
    off();
  }
}

/* ───────────────────────────── assertions ─────────────────────────────── */

function assertionsFor({ viewport, result, exceptions }) {
  const checks = [];
  const check = (label, ok, detail) => checks.push({ label, ok: !!ok, detail });

  check('no uncaught page exceptions', exceptions.length === 0, exceptions.length ? exceptions.join(' | ') : 'none');
  if (!result) {
    check('probe expression evaluated', false, 'no result');
    return checks;
  }

  check(
    'clue bullets === 3',
    result.clueBullets === 3,
    `hero-bullets=${result.clueBullets} (expected exactly 3, AGENTS.md §5)`
  );
  check(
    'no horizontal overflow',
    result.overflow && result.overflow.horizontal === false,
    `scrollWidth=${result.overflow && result.overflow.scrollWidth} clientWidth=${
      result.overflow && result.overflow.clientWidth
    }`
  );
  check('disclaimer present', result.disclaimer === true, result.disclaimer ? 'present' : 'missing .disclaimer');
  check(
    'hero score + exposure rendered',
    !!result.score && !!result.exposure,
    `score=${result.score} exposure=${result.exposure}`
  );

  if (viewport.width < 900) {
    check(
      'sticky bar visible (mobile action bar)',
      result.stickyBar && result.stickyBar.visible === true,
      result.stickyBar && result.stickyBar.box ? JSON.stringify(result.stickyBar.box) : 'not rendered'
    );
    check(
      'floating Ask FAB hidden on mobile',
      result.askFab && result.askFab.visible === false,
      result.askFab && result.askFab.visible ? 'FAB is visible at mobile width' : 'hidden as designed'
    );
  } else {
    check(
      'floating Ask FAB visible (desktop action)',
      result.askFab && result.askFab.visible === true,
      result.askFab && result.askFab.box ? JSON.stringify(result.askFab.box) : 'not rendered'
    );
    check(
      'Split contract column has clause blocks',
      result.contractColVisible === true && result.clauseBlocks > 0,
      `contract-col visible=${result.contractColVisible} blocks=${result.clauseBlocks}/${
        result.clauseBlocksRendered
      } (blank contract column = the Split regression)`
    );
  }
  return checks;
}

/* ──────────────────────────────── main ──────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const binary = resolveChrome(opts.chrome);

  // Fail fast with a useful message when the static server isn't up.
  try {
    const res = await fetch(opts.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    die(
      `cannot reach ${opts.url} (${err && err.message}).\n` +
        `Start the static server first:  node scripts/serve.mjs --port 4173`,
      1
    );
  }

  const port = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), 'sc-probe-'));
  const { child, log } = startChrome(binary, port, userDataDir);

  let page = null;
  let browser = null;
  let exitCode = 0;

  try {
    const versionInfo = await waitForDevTools(port);
    const attached = await attachPage(port, versionInfo);
    browser = attached.browser;
    page = await Cdp.connect(attached.wsUrl, 'page');
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    process.stdout.write(
      `[probe] chrome: ${binary}\n` +
        `[probe] url:    ${opts.url}\n` +
        `[probe] cdp:    ws://127.0.0.1:${port}\n\n`
    );

    const runs = [];
    for (const viewport of VIEWPORTS) {
      const run = await runViewport(page, viewport, opts);
      runs.push(run);

      const r = run.result || {};
      process.stdout.write(`── ${viewport.name} ${'─'.repeat(Math.max(0, 48 - viewport.name.length))}\n`);
      if (run.result) {
        process.stdout.write(
          `   view=${r.view} activeTab=${r.activeTab} offline=${r.offline} theme=${r.theme} lang=${r.lang}\n` +
            `   score=${JSON.stringify(r.score)} label=${JSON.stringify(r.scoreLabel)}\n` +
            `   exposure=${JSON.stringify(r.exposure)}  bodyFontSize=${r.bodyFontSize}\n` +
            `   clueBullets=${r.clueBullets} clauseCards=${r.clauseCards} contractClauseBlocks=${r.clauseBlocks}/${r.clauseBlocksRendered}\n` +
            `   disclaimer=${r.disclaimer} stickyBar=${r.stickyBar.visible} askFab=${r.askFab.visible} hOverflow=${r.overflow.horizontal} (${r.overflow.scrollWidth}/${r.overflow.clientWidth})\n`
        );
      } else {
        process.stdout.write('   (probe expression produced no result)\n');
      }
      if (run.consoleErrors.length) {
        process.stdout.write(`   console errors:\n${run.consoleErrors.map((e) => `     ! ${e}`).join('\n')}\n`);
      }
      if (run.exceptions.length) {
        process.stdout.write(`   exceptions:\n${run.exceptions.map((e) => `     ! ${e}`).join('\n')}\n`);
      }

      const checks = assertionsFor(run);
      for (const c of checks) {
        process.stdout.write(`   ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}  — ${c.detail}\n`);
        if (!c.ok) exitCode = 1;
      }
      process.stdout.write(`   → ${checks.every((c) => c.ok) ? 'PASS' : 'FAIL'}\n\n`);
    }

    const failed = exitCode !== 0;
    process.stdout.write(
      `[probe] ${failed ? 'FAIL' : 'PASS'} — ${runs.length} viewport${runs.length === 1 ? '' : 's'}: ` +
        `${runs
          .map((run) => {
            const checks = assertionsFor(run);
            return `${run.viewport.name} ${checks.every((c) => c.ok) ? 'PASS' : 'FAIL'}`;
          })
          .join(' · ')}\n`
    );
    if (failed) {
      process.stdout.write(
        '[probe] assertions above are unweakened: a FAIL is a real regression, not a tolerant threshold.\n'
      );
    }
  } finally {
    // Always kill Chrome and drop the throwaway profile.
    if (page) page.close();
    if (browser) browser.close();
    try {
      child.kill('SIGKILL');
    } catch {
      /* already dead */
    }
    await new Promise((done) => {
      if (child.exitCode !== null || child.signalCode) return done();
      const timer = setTimeout(done, 3000);
      child.on('exit', () => {
        clearTimeout(timer);
        done();
      });
    });
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    if (exitCode !== 0 && log.length) {
      process.stdout.write(`[probe] chrome log tail:\n${log.slice(-12).map((l) => `  ${l}`).join('\n')}\n`);
    }
  }

  return exitCode;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    process.stderr.write(`[probe] fatal: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
