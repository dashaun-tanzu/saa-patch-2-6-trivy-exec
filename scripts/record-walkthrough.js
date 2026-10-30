#!/usr/bin/env node
// Records the demo's WS event stream into docs/recorded/walkthrough.json so
// the deck can replay it statically on GitHub Pages.
//
// 1. Starts server.js with RECORD pointing at the recording file.
// 2. Connects over the live WebSocket and drives demo.sh to completion
//    (presses Enter at each talking point), exactly like verify-java27.js.
// 3. The server writes the recording when the demo exits.
//
// Usage: npm run record   (or: node scripts/record-walkthrough.js)
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || '4205';
const RECORD_FILE = path.join(ROOT, 'docs', 'recorded', 'walkthrough.json');
const MAX_SECONDS = parseInt(process.argv[2] || '900', 10);
const URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(pathStr) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${pathStr}`, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`Recording walkthrough → ${RECORD_FILE}`);
  console.log(`  starting server on :${PORT} (RECORD on, opener stubbed)\n`);

  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT, RECORD: RECORD_FILE, DEMO_OPEN_CMD: 'true' },
    stdio: 'inherit',
  });

  let beat = 0;
  let exitCode = null;
  let ws = null;

  try {
    // wait for the server to come up
    for (let i = 0; i < 60; i++) {
      try { await getJson('/healthz'); break; } catch (_) { await sleep(200); }
    }

    ws = await new Promise((resolve, reject) => {
      const c = new WebSocket(URL);
      c.on('open', () => resolve(c));
      c.on('error', reject);
    });
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'beat') beat = m.beat;
      if (m.type === 'exit') exitCode = m.code;
    });

    console.log('  connected, driving the demo to completion…');
    ws.send('start');
    const t0 = Date.now();
    let lastBeat = -1;
    while (Date.now() - t0 < MAX_SECONDS * 1000) {
      if (exitCode !== null) break;
      ws.send('\r');
      await sleep(1200);
      if (beat !== lastBeat) {
        lastBeat = beat;
        console.log(`  beat ${beat}`);
      }
    }
    ws.close();

    if (exitCode !== 0) {
      throw new Error(`demo did not exit cleanly (exit ${exitCode}, final beat ${beat})`);
    }
    console.log(`\nDone. Demo exited cleanly at beat ${beat}.`);
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('RECORD FAILED:', e.message);
  process.exit(1);
});
