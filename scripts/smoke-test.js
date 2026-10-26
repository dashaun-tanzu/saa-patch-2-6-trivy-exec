#!/usr/bin/env node
// Smoke test: boots the server against the fast fake demo, connects a WS
// client, drives the PTY forward, and asserts beat detection + slide mapping.
const { WebSocket } = require('ws');
const http = require('http');

process.env.PORT = process.env.PORT || '4199';
process.env.DEMO_SCRIPT = './scripts/smoke-demo.sh';
process.env.DEMO_OPEN_CMD = 'true'; // stub: /usr/bin/true swallows the URL
require('../server.js');

const URL = `ws://localhost:${process.env.PORT}/ws`;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${process.env.PORT}${path}`, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const events = [];
  const ws = await new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('message', (d) => events.push(JSON.parse(String(d))));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  await sleep(300);
  const state = events.find((e) => e.type === 'state');
  if (!state) throw new Error('no state message received');
  console.log('state:', JSON.stringify(state));

  ws.send('start');
  await sleep(300);
  if (!events.find((e) => e.type === 'started')) throw new Error('no started message');

  // drive the demo: each time we see a beat, press enter to advance
  let sawTerms = 0;
  for (let i = 0; i < 25; i++) {
    const beats = events.filter((e) => e.type === 'beat');
    sawTerms = events.filter((e) => e.type === 'term').length;
    if (beats.length >= 4) break;
    if (events.find((e) => e.type === 'exit')) break;
    if (sawTerms > 0) ws.send('\r');
    await sleep(120);
  }

  const beats = events.filter((e) => e.type === 'beat').map((e) => e.beat);
  const exit = events.find((e) => e.type === 'exit');
  console.log('term events:', sawTerms);
  console.log('beat events:', JSON.stringify(beats));
  console.log('exit:', exit ? exit.code : 'not yet');

  if (!exit || exit.code !== 0) throw new Error('demo did not exit cleanly');
  if (beats.length < 4) throw new Error(`expected >=4 beats, got ${beats.length}`);
  if (beats.some((b, i) => i > 0 && b <= beats[i - 1])) throw new Error('beats did not monotonically increase');
  const health = await getJson('/healthz');
  console.log('healthz beat:', health.beat);
  if (health.beat !== beats[beats.length - 1]) throw new Error('server beat counter out of sync');

  // static assets
  for (const p of ['/', '/css/exec.css', '/js/app.js', '/js/beats.js', '/vendor/reveal.js', '/vendor/xterm.js', '/fonts/Metropolis-Regular.woff2']) {
    const code = await new Promise((res) => http.get(`http://localhost:${process.env.PORT}${p}`, (r) => { res(r.statusCode); r.resume(); }).on('error', () => res(0)));
    if (code !== 200) throw new Error(`asset ${p} -> ${code}`);
  }

  // auto-open endpoint: POST /api/open (DEMO_OPEN_CMD stubs the opener)
  const post = (body) => new Promise((res) => {
    const data = JSON.stringify(body);
    const r = http.request(`http://localhost:${process.env.PORT}/api/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (out) => {
      let b = ''; out.on('data', (d) => (b += d)); out.on('end', () => res({ code: out.statusCode, body: b }));
    });
    r.on('error', () => res({ code: 0, body: '' }));
    r.end(data);
  });
  const bad = await post({ url: 'not-a-url' });
  if (bad.code !== 400) throw new Error(`/api/open should reject non-http URLs (got ${bad.code})`);
  const good = await post({ url: 'https://example.invalid/hub' });
  if (good.code !== 200) throw new Error(`/api/open should accept an http(s) URL (got ${good.code})`);

  console.log('\nSMOKE TEST PASSED');
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e.message);
  process.exit(1);
});
