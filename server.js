#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const ROOT = __dirname;
const DECK = path.join(ROOT, 'docs');
const PORT = process.env.PORT || 4173;
const DEMO_SCRIPT = process.env.DEMO_SCRIPT || './demo.sh';
// When set, the server records the demo's WS event stream (terminal output,
// beats, stats) so the deck can replay it statically on GitHub Pages.
const RECORD_FILE = process.env.RECORD || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// URL -> filesystem path. Vendored client libs live in docs/vendor (committed
// so the published deck is self-contained); they are served as static files.
const ROUTES = {};

function loadEnv() {
  const env = { ...process.env };
  try {
    const rc = fs.readFileSync(path.join(ROOT, '.envrc'), 'utf8');
    for (const m of rc.matchAll(/^export\s+([A-Z_][A-Z0-9_]*)=(.*)$/gm)) {
      if (!(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* no .envrc */ }
  return env;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/') {
    return sendFile(res, path.join(DECK, 'index.html'));
  }
  if (urlPath.startsWith('/css/') || urlPath.startsWith('/js/') || urlPath.startsWith('/fonts/') || urlPath.startsWith('/img/') || urlPath.startsWith('/vendor/') || urlPath.startsWith('/recorded/')) {
    const file = path.join(DECK, urlPath);
    if (!file.startsWith(DECK)) return send404(res);
    return sendFile(res, file);
  }
  if (ROUTES[urlPath]) {
    return sendFile(res, path.join(ROOT, ROUTES[urlPath]));
  }
  if (urlPath === '/api/open' && req.method === 'POST') {
    return handleOpen(req, res);
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, beat: currentBeat, running: demoRunning }));
  }
  send404(res);
});

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send404(res);
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

// ---------------------------------------------------------------------------
// Auto-open URLs on the presenter's machine. The deck POSTs { url } here when
// a slide with data-open-url becomes visible.
// ---------------------------------------------------------------------------
function handleOpen(req, res) {
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4096) req.destroy();
  });
  req.on('end', () => {
    let url = null;
    try {
      ({ url } = JSON.parse(body));
    } catch (_) { /* fall through to 400 */ }
    if (typeof url !== 'string' || !/^https?:\/\/[\w.-]+(:\d+)?(\/[^\s]*)?$/.test(url)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'expected an http(s) URL' }));
    }
    // DEMO_OPEN_CMD overrides the opener (used by tests); otherwise the
    // platform default. detached + unref'd: the browser outlives this
    // request, and a missing opener must not crash the server.
    const opener = process.env.DEMO_OPEN_CMD
      || (process.platform === 'darwin' ? 'open' : 'xdg-open');
    const child = spawn(opener, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    console.log(`  [open] ${url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, url }));
  });
}

// ---------------------------------------------------------------------------
// WebSocket: bridges the deck to a single live PTY running ./demo.sh
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();
let ptyProcess = null;
let demoRunning = false;
let currentBeat = 0;
let termHistory = '';
let recEvents = []; // event stream captured when RECORD_FILE is set

function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const c of clients) {
    if (c.readyState === 1) c.send(s);
  }
  if (RECORD_FILE && (obj.type === 'term' || obj.type === 'beat' || obj.type === 'stats' || obj.type === 'exit')) {
    recEvents.push(obj);
  }
}

function onTermData(data) {
  // ring buffer so a reloading deck can catch up on the live demo
  termHistory += data;
  if (termHistory.length > 600000) termHistory = termHistory.slice(-400000);

  // demo-magic `talkingPoint` runs `clear` -> \x1b[3J\x1b[H\x1b[2J.
  // Count each full 3J-H-2J sequence as one beat. A single `clear` emits the
  // sequence exactly once and talkingPoints are seconds apart, so no
  // deduplication is needed.
  let n = 0;
  const re = /\x1b\[3J[\x1b\[H]*\x1b\[2J/g;
  let m;
  while ((m = re.exec(data))) n++;
  if (n > 0) {
    currentBeat += n;
    broadcast({ type: 'beat', beat: currentBeat });
  }
  broadcast({ type: 'term', data });
}

function startDemo() {
  if (ptyProcess) {
    try { ptyProcess.kill(); } catch (_) { /* already dead */ }
    ptyProcess = null;
  }
  currentBeat = 0;
  termHistory = '';
  recEvents = [];
  const env = loadEnv();
  const shell = process.env.SHELL || '/bin/bash';
  ptyProcess = pty.spawn(shell, ['-lc', `cd ${JSON.stringify(ROOT)} && exec ${DEMO_SCRIPT}`], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: ROOT,
    env,
  });
  demoRunning = true;
  ptyProcess.onData(onTermData);
  ptyProcess.onExit(({ exitCode }) => {
    demoRunning = false;
    broadcast({ type: 'term', data: `\r\n\x1b[1;32m[demo finished, exit ${exitCode}]\x1b[0m\r\n` });
    broadcast({ type: 'exit', code: exitCode });
    if (RECORD_FILE) {
      try {
        fs.writeFileSync(RECORD_FILE, JSON.stringify({
          meta: {
            slides: 20,
            demoSliceFirst: 2,
            demoSliceLast: 19,
            recordedAt: new Date().toISOString(),
            exitCode,
          },
          events: recEvents,
        }));
        console.log(`  [record] ${recEvents.length} events → ${RECORD_FILE}`);
      } catch (err) {
        console.error(`  [record] failed to write ${RECORD_FILE}: ${err.message}`);
      }
    }
  });
  broadcast({ type: 'started', beat: 0 });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'state', beat: currentBeat, running: demoRunning }));
  if (termHistory) {
    ws.send(JSON.stringify({ type: 'replay', data: termHistory }));
  }
  ws.on('message', (data) => {
    const msg = String(data);
    if (msg === 'start') { startDemo(); return; }
    if (msg === 'restart') { startDemo(); return; }
    if (msg === '\x03') { if (ptyProcess) ptyProcess.kill(); return; }
    if (msg.startsWith('resize:')) {
      const [cols, rows] = msg.slice(7).split(',').map(Number);
      if (ptyProcess && cols > 0 && rows > 0) {
        try { ptyProcess.resize(cols, rows); } catch (_) { /* noop */ }
      }
      return;
    }
    if (ptyProcess && demoRunning) ptyProcess.write(msg);
  });
  ws.on('close', () => clients.delete(ws));
});

// ---------------------------------------------------------------------------
// Live benchmark numbers: watch upgrade-example/* written by demo.sh
// ---------------------------------------------------------------------------
const STAGES = {
  'java8with2.6': 'Spring Boot 2.6 + Java 8',
  'java27with4.0': 'Spring Boot 4.1 + Java 27',
  'java27patched': 'Spring Boot 4.1 patched',
};

function readStats() {
  const dir = path.join(ROOT, 'upgrade-example');
  const out = [];
  for (const stage of Object.keys(STAGES)) {
    const base = path.join(dir, stage);
    const cves = readInt(base + '.cves');
    const deps = readInt(base + '.deps');
    const mem = readFloat(base + '.log2');
    const startup = readStartup(base + '.log');
    const health = readHealth(base + '.health');
    if (cves === null && deps === null && mem === null && startup === null && health === null) continue;
    out.push({ stage, label: STAGES[stage], cves, deps, mem, startup, health });
  }
  return out;
}

function readInt(file) {
  try {
    const v = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(v) ? v : null;
  } catch (_) { return null; }
}

function readFloat(file) {
  try {
    const v = parseFloat(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(v) ? v : null;
  } catch (_) { return null; }
}

function readStartup(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    const m = txt.match(/Started .* in ([0-9]+\.[0-9]+) seconds/);
    return m ? parseFloat(m[1]) : null;
  } catch (_) { return null; }
}

function readHealth(file) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    return v ? v : null;
  } catch (_) { return null; }
}

let lastStatsJson = '';
function pollStats() {
  const stats = readStats();
  const j = JSON.stringify(stats);
  if (j !== lastStatsJson) {
    lastStatsJson = j;
    broadcast({ type: 'stats', stats });
  }
}
setInterval(pollStats, 1000);

server.listen(PORT, () => {
  console.log(`\n  Spring Application Advisor — executive deck`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  (press "Start demo" on the title slide to run demo.sh)\n`);
});
