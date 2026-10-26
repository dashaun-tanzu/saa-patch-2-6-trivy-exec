#!/usr/bin/env node
// Drives the REAL demo.sh over the deck's WebSocket until the upgraded
// Spring Boot 4.1 app has been validated on Java 27, then asserts on the
// terminal output and the live stats stream.
// Usage: node scripts/verify-java27.js [port] [maxSeconds]
const { WebSocket } = require('ws');
const fs = require('fs');

const PORT = process.argv[2] || '4205';
const MAX_SECONDS = parseInt(process.argv[3] || '600', 10);
const URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const term = { text: '' };
  const stats = [];
  const timeline = [];
  let beat = 0;
  let exitCode = null;

  const ws = await new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.type === 'term') term.text += m.data;
    if (m.type === 'beat') {
      beat = m.beat;
      timeline.push(`${Math.round(Date.now() / 1000) % 10000} beat ${beat}`);
    }
    if (m.type === 'stats') stats.length = 0, stats.push(...m.stats);
    if (m.type === 'exit') exitCode = m.code;
  });

  ws.send('start');
  const t0 = Date.now();
  let lastPrint = 0;

  while (Date.now() - t0 < MAX_SECONDS * 1000) {
    const patched = stats.find((s) => s.stage === 'java27patched');
    if (patched && patched.cves === 0 && patched.health === 'UP' && patched.startup != null) break;
    if (beat >= 31 || exitCode !== null) break;
    ws.send('\r');
    await sleep(1200);
    if (Date.now() - lastPrint > 30000) {
      lastPrint = Date.now();
      console.log(`... ${Math.round((Date.now() - t0) / 1000)}s, beat ${beat}, stats stages: ${stats.map((s) => s.stage).join(', ') || 'none'}`);
    }
  }
  ws.close();

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\ndrove for ${elapsed}s, final beat ${beat}, exit ${exitCode}`);
  console.log('stats received:');
  for (const s of stats) {
    console.log(`  ${s.stage}: cves=${s.cves} deps=${s.deps} startup=${s.startup} mem=${s.mem} health=${s.health}`);
  }

  const clean = term.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  const four = stats.find((s) => s.stage === 'java27with4.0') || {};
  const patched = stats.find((s) => s.stage === 'java27patched') || {};
  const checks = {
    'java 27 selected': clean.includes('Using java version 27.0.0+36-librca'),
    'java -version shows 27': /openjdk version "27"/.test(clean),
    'keys step removed': !clean.includes('top level elements'),
    'git metadata shown': clean.includes('Information about the git repository'),
    'baseline scan ran': /Found \d+ known CVEs/.test(clean),
    'upgrade applied (pom changed)': fs.readFileSync('upgrade-example/pom.xml', 'utf8').includes('<version>4.1'),
    'no advisor recipe errors': !clean.includes('Could not apply the recipe'),
    'no native-access warnings': !/WARNING: A restricted method in java\.lang\.System/.test(clean),
    'no unsafe warnings': !/terminally deprecated method in sun\.misc\.Unsafe/.test(clean),
    'no final-field warnings': !/enable-final-field-mutation/.test(clean),
    '4.1 health UP (stats)': four.health === 'UP',
    'patch stage ran': (patched.deps != null),
    'patched health UP (stats)': patched.health === 'UP',
    'payoff: 0 CVEs': patched.cves === 0,
  };
  let failed = 0;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
    if (!v) failed++;
  }

  // excerpt of the java switch + version output
  const idx = clean.indexOf('Switch to Java 27');
  if (idx >= 0) console.log('\n--- excerpt (java 27 switch) ---\n' + clean.slice(idx, idx + 400).replace(/\n{2,}/g, '\n'));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
