#!/usr/bin/env node
/**
 * scripts/serve.mjs — zero-dependency static file server for `public/`.
 * ---------------------------------------------------------------------------
 * The app is zero-build (AGENTS.md §2), so there is no `npm start`. This is the
 * checked-in replacement for the throwaway static servers we kept retyping:
 *
 *   node scripts/serve.mjs                # http://127.0.0.1:4173/
 *   node scripts/serve.mjs --port 5000 --root public
 *
 * Deliberate behaviours:
 *   • Serves `index.html` for `/` and for any directory path that has one.
 *   • Correct Content-Type per extension — `.js` / `.mjs` MUST come back as
 *     `text/javascript`, otherwise the browser refuses the ESM module graph and
 *     the whole app fails to boot with a MIME type error.
 *   • `/api/*` answers `404 application/json`, never HTML. The client
 *     (`public/js/api.js`) falls back to `mock-audit.json` when the route is
 *     unreachable, so running this without `vercel dev` still exercises the real
 *     offline path instead of dying on an HTML error page.
 *   • Path traversal is refused: the resolved path must stay inside the root.
 *   • SIGINT / SIGTERM close the listener and exit 0 (no orphan node process).
 *
 * Node built-ins only. No deps, no package.json.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Extension → Content-Type. Anything unknown falls back to octet-stream. */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  // ESM: text/javascript is the load-bearing one — see the header comment.
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const USAGE = `Usage: node scripts/serve.mjs [--port 4173] [--root public]

  --port <n>     TCP port to listen on (default 4173, 1-65535)
  --root <dir>   directory to serve (default public/, resolved from repo root)
  --host <host>  bind address (default 127.0.0.1)
  -h, --help     show this help

Serves the zero-build PWA. /api/* returns JSON 404 so the client offline
fallback (public/mock-audit.json) is the path under test. Ctrl-C stops it.`;

/* ─────────────────────────────── args ────────────────────────────────────── */

function parseArgs(argv) {
  const opts = { port: 4173, root: 'public', host: '127.0.0.1', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--port') opts.port = Number(value());
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length));
    else if (arg === '--root') opts.root = value();
    else if (arg.startsWith('--root=')) opts.root = arg.slice('--root='.length);
    else if (arg === '--host') opts.host = value();
    else if (arg.startsWith('--host=')) opts.host = arg.slice('--host='.length);
    else fail(`unknown argument: ${arg}`);
  }

  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    fail(`--port must be an integer 1-65535, got ${opts.port}`);
  }
  if (!opts.root.trim()) fail('--root must not be empty');
  return opts;
}

function fail(message) {
  process.stderr.write(`[serve] ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

/* ─────────────────────────────── helpers ─────────────────────────────────── */

const contentTypeFor = (file) => CONTENT_TYPES[extname(file).toLowerCase()] || 'application/octet-stream';

/** Strip the query string and normalise the pathname. Throws on bad encodings. */
function pathnameOf(url = '/') {
  const raw = String(url || '/').split('?')[0].split('#')[0];
  const decoded = decodeURIComponent(raw || '/');
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

/** True when `target` is the root itself or lives below it (traversal guard). */
function isInside(root, target) {
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
}

async function statOrNull(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

/* ─────────────────────────────── server ──────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const root = resolve(HERE, opts.root);
  const rootStat = await statOrNull(root);
  if (!rootStat || !rootStat.isDirectory()) {
    fail(`root not found or not a directory: ${root}`);
  }

  const server = createServer(async (req, res) => {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('Method Not Allowed\n');
      return;
    }

    let pathname;
    try {
      pathname = pathnameOf(req.url);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad Request\n');
      return;
    }

    // The app probes /api/* at boot; a JSON 404 keeps its offline fallback honest.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const body = JSON.stringify({
        error: 'not_found',
        message: 'No API routes on the static server. Run `vercel dev` for /api/*.',
        path: pathname,
      });
      res.writeHead(404, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      });
      if (method === 'HEAD') res.end();
      else res.end(body);
      return;
    }

    const target = resolve(root, `.${pathname}`);
    if (!isInside(root, target)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden\n');
      return;
    }

    let file = target;
    let info = await statOrNull(file);
    if (info && info.isDirectory()) {
      file = join(file, 'index.html');
      info = await statOrNull(file);
    }
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`Not Found: ${pathname}\n`);
      return;
    }

    const headers = {
      'content-type': contentTypeFor(file),
      'content-length': info.size,
      'cache-control': 'no-store',
      'last-modified': info.mtime.toUTCString(),
    };
    if (method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    const stream = createReadStream(file);
    stream.on('error', () => {
      res.destroy();
    });
    stream.pipe(res);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[serve] port ${opts.port} is already in use. Pick another with --port <n> ` +
          `(an old server may still be running).\n`
      );
      process.exit(1);
    }
    process.stderr.write(`[serve] ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    process.stdout.write(`\n[serve] ${signal} — closing http://${opts.host}:${opts.port}/\n`);
    server.close(() => process.exit(0));
    // Belt and braces: don't hang on a keep-alive socket.
    setTimeout(() => process.exit(0), 500).unref?.();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(opts.port, opts.host, () => {
    const url = `http://${opts.host}:${opts.port}/`;
    process.stdout.write(
      `[serve] SignClear static server\n` +
        `[serve]   root: ${root}\n` +
        `[serve]   url:  ${url}\n` +
        `[serve]   /api/* → JSON 404 (client falls back to public/mock-audit.json)\n` +
        `[serve]   Ctrl-C to stop.\n`
    );
  });
}

main().catch((err) => {
  process.stderr.write(`[serve] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
