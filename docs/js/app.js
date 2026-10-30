(function () {
  'use strict';

  // ------------------------------------------------------------------
  // WebSocket plumbing
  // ------------------------------------------------------------------
  let ws = null;
  const pending = []; // messages to send once connected
  const wantLive = !new URLSearchParams(location.search).has('recorded');

  function connect() {
    // GitHub Pages is static: there is no WS/PTY server. If one can't be
    // reached (or we're forced with ?recorded), fall back to replaying the
    // recorded walkthrough in the same click-through model.
    if (!wantLive) { enterRecorded(); return; }

    ws = new WebSocket(`ws://${location.host}/ws`);
    const failTimer = setTimeout(() => {
      if (!ws || ws.readyState !== 1) { enterRecorded(); }
    }, 2500);
    ws.onopen = () => {
      clearTimeout(failTimer);
      setStatus('connected');
      while (pending.length) ws.send(pending.shift());
    };
    ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      clearTimeout(failTimer);
      if (recordedMode) return;
      setStatus('disconnected — retrying…');
      setTimeout(connect, 1500);
    };
    ws.onerror = () => {
      clearTimeout(failTimer);
      if (!ws || ws.readyState !== 1) enterRecorded();
      else ws.close();
    };
  }

  function send(obj) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (ws && ws.readyState === 1) ws.send(s);
    else pending.push(s);
  }

  // ------------------------------------------------------------------
  // Terminal
  // ------------------------------------------------------------------
  let term = null;
  let fit = null;

  function initTerminal() {
    term = new Terminal({
      convertEol: false,
      cursorBlink: false,
      fontFamily: '"SFMono-Regular", "Menlo", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#16212e',
        foreground: '#c9d1d9',
        cursor: '#78be20',
        selectionBackground: '#1f2d3d',
      },
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('terminal'));
    term.onData((data) => send(data)); // user typing in the terminal goes to the PTY
    window.addEventListener('resize', () => {
      try { fit.fit(); } catch (_) { /* noop */ }
    });
    setTimeout(() => {
      try { fit.fit(); } catch (_) { /* noop */ }
    }, 50);
    term.onResize(({ cols, rows }) => send(`resize:${cols},${rows}`));
  }

  // ------------------------------------------------------------------
  // Deck
  // ------------------------------------------------------------------
  let deck = null;

  function initDeck() {
    deck = new Reveal({
      controls: true,
      progress: true,
      history: false,
      center: false,
      hash: false,
      transition: 'fade',
      transitionSpeed: 'fast',
      keyboard: false, // handled in onKey (demo vs narrative mode)
      overview: true,
      touch: false,
    });
    deck.initialize();
    deck.on('slidechanged', (e) => {
      maybeOpenSlide(e.indexh);
      renderRecordedSlide(e.indexh);
    });
    // in case the page loads directly onto a slide that auto-opens a URL
    maybeOpenSlide(deck.getIndices().h);
  }

  // ------------------------------------------------------------------
  // Auto-open URLs: a slide with data-open-url="..." opens
  // that URL once per page load, when the slide becomes visible. The server
  // performs the actual `open` on the presenter's machine.
  // ------------------------------------------------------------------
  const firedOpens = new Set();

  function maybeOpenSlide(idx) {
    if (firedOpens.has(idx)) return;
    const slide = deck.getSlide(idx);
    if (!slide || typeof slide.getAttribute !== 'function') return;
    const url = slide.getAttribute('data-open-url');
    if (!url) return;
    firedOpens.add(idx);
    fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => { /* opening the browser is best-effort */ });
  }

  function goToSlide(index) {
    const total = deck.getTotalSlides();
    if (index < 0 || index >= total) return;
    if (deck.getIndices().h !== index) {
      deck.slide(index);
    }
  }

  // ------------------------------------------------------------------
  // Presenter key handling — two modes:
  //   demo running  -> every key is forwarded to the PTY; the slides follow
  //                    the terminal's beat counter (no manual slide nav, so
  //                    slides can never get ahead of the terminal).
  //   demo idle     -> narrative mode: the presenter click-throughs the deck
  //                    at their own pace (pre-demo slides, post-demo story).
  // ------------------------------------------------------------------
  let demoActive = false;

  function setDemoActive(v) {
    demoActive = v;
    // hides Reveal's on-screen arrows while the demo owns the slides
    document.body.classList.toggle('demo-running', v);
  }

  function forwardKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); send('\r'); }
    else if (e.key === ' ') { e.preventDefault(); send(' '); }
    else if (e.key === 'Backspace') { e.preventDefault(); send('\x7f'); }
    else if (e.key === 'Escape') { e.preventDefault(); send('\x1b'); }
    else if (e.key.length === 1) { send(e.key); }
  }

  function navigateDeck(e) {
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': case 'Enter':
        e.preventDefault(); deck.next(); break;
      case 'ArrowLeft': case 'PageUp':
        e.preventDefault(); deck.prev(); break;
      case 'Home': e.preventDefault(); deck.slide(0); break;
      case 'End': e.preventDefault(); deck.slide(deck.getTotalSlides() - 1); break;
    }
  }

  function onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (demoActive) { forwardKey(e); return; }
    navigateDeck(e);
  }

  // ------------------------------------------------------------------
  // Recorded walkthrough: when the deck is served statically (GitHub
  // Pages), the demo output is replayed from recorded/walkthrough.json.
  // Navigation is standard Reveal (← / → / arrows / controls) — moving to a
  // slide shows the terminal and live stats as they were at that point in
  // the demo, so you can step forward and backward like a normal deck.
  // ------------------------------------------------------------------
  let recordedMode = false;
  let recording = null;      // { meta, events } from recorded/walkthrough.json
  let recEndIdx = {};        // slide -> event index to replay up to (per slide)

  function enterRecorded() {
    if (recordedMode) return;
    recordedMode = true;
    if (ws) { try { ws.close(); } catch (_) { /* noop */ } }
    document.body.classList.add('recorded');
    setStatus('loading recorded walkthrough…');
    const title = document.getElementById('term-title');
    if (title) title.textContent = 'demo.sh — recorded';
    const hint = document.getElementById('start-hint');
    if (hint) hint.textContent = 'Use ← / → to move through the demo. The terminal below shows each stage.';
    loadRecording();
  }

  async function loadRecording() {
    try {
      const res = await fetch('recorded/walkthrough.json');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      recording = await res.json();
      computeRecEndIdx();
      // guarantee the static deck opens on the title slide even on a cold load
      goToSlide(0);
      setStatus('recorded · use ← / → to navigate');
    } catch (err) {
      setStatus('recorded data unavailable');
      console.error('recorded walkthrough:', err);
    }
  }

  // For each demo slide, work out how far through the recorded event stream
  // to replay so the terminal shows that slide's completed step. A `clear`
  // wipes the screen, so we replay up to (but not including) the clear that
  // starts the NEXT slide's step.
  function clearIndexAfterBeat(targetBeat) {
    for (let i = 0; i < recording.events.length; i++) {
      const e = recording.events[i];
      if (e.type === 'beat' && e.beat === targetBeat) {
        for (let j = i + 1; j < recording.events.length; j++) {
          if (recording.events[j].type === 'term' && recording.events[j].data.indexOf('\x1b[3J') >= 0) return j;
        }
        return recording.events.length - 1;
      }
    }
    return -1;
  }

  function computeRecEndIdx() {
    // entry beat per slide from the deck's beat→slide mapping
    const entryBeat = {};
    for (const b of window.BEATS) entryBeat[b.slide] = b.beat;
    const slides = Object.keys(entryBeat).map(Number).filter((s) => s >= 2).sort((a, b) => a - b);
    for (let k = 0; k < slides.length; k++) {
      const s = slides[k];
      let boundary;
      if (k + 1 < slides.length) {
        // stop just before the clear that starts the next slide's step
        boundary = clearIndexAfterBeat(entryBeat[slides[k + 1]]) - 1;
      } else {
        boundary = recording.events.length - 1; // last slide: show the finish
      }
      recEndIdx[s] = boundary < 0 ? -1 : boundary;
    }
  }

  function renderRecordedSlide(index) {
    if (!recordedMode || !recording) return;
    if (term) {
      term.reset();
      let lastBeat = 0;
      const endIdx = (index >= 2 && recEndIdx[index] != null) ? recEndIdx[index] : -1;
      for (let i = 0; i <= endIdx; i++) {
        const ev = recording.events[i];
        if (ev.type === 'term') term.write(ev.data);
        else if (ev.type === 'beat') lastBeat = ev.beat;
        else if (ev.type === 'stats') handleMessage(ev);
      }
      currentBeat = lastBeat;
      const beatEl = document.getElementById('hud-beat');
      if (beatEl) beatEl.textContent = `beat ${lastBeat}`;
    }
    if (index < 2) {
      // intro / bridge / after the demo: clear the live figures
      statsByStage = {};
      currentStage = null;
      updateHUD();
    }
    const label = index >= 2 ? `recorded · slide ${index}` : 'recorded · use ← / → to navigate';
    setStatus(label);
  }

  // ------------------------------------------------------------------
  // Live stats -> HUD + slide numbers + payoff chart
  // ------------------------------------------------------------------
  const STAGE_KEY = {
    'java8with2.6': 'baseline',
    'java27with4.0': 'four',
    'java27patched': 'patched',
  };
  let statsByStage = {};
  let currentStage = null;

  function setNum(id, value, suffix) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value === null || value === undefined) {
      el.textContent = '—';
      el.classList.remove('live');
      return;
    }
    el.textContent = (typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 1 }) : value) + (suffix || '');
    el.classList.add('live');
  }

  function handleStats(stats) {
    if (!stats || !stats.length) return;
    statsByStage = {};
    for (const s of stats) statsByStage[s.stage] = s;
    currentStage = stats[stats.length - 1].stage;

    for (const s of stats) {
      const key = STAGE_KEY[s.stage];
      if (!key) continue;
      setNum(`${key}-cves`, s.cves);
      setNum(`${key}-deps`, s.deps);
      setNum(`${key}-start`, s.startup, 's');
      setNum(`${key}-mem`, s.mem, ' MB');
      const test = s.health === 'UP' ? 'Pass' : (s.health === 'DOWN' ? 'Fail' : null);
      setNum(`${key}-tests`, test);
      const te = document.getElementById(`${key}-tests`);
      if (te) {
        te.classList.toggle('ok', test === 'Pass');
        te.classList.toggle('bad', test === 'Fail');
      }
      // duplicate baseline figures shown on slides 3 & 4 ("the SBOM" / "scan #1")
      if (s.stage === 'java8with2.6') {
        setNum('baseline-deps-2', s.deps);
        setNum('baseline-cves-2', s.cves);
        setNum('hero-cves', s.cves);
      }
    }

    updateHUD();
    updateTable1();
    updatePayoff();
  }

  function updateHUD() {
    const s = statsByStage[currentStage];
    const label = s ? s.label : '—';
    document.getElementById('hud-stage').textContent = label;
    setNum('hud-cves', s ? s.cves : null);
    setNum('hud-deps', s ? s.deps : null);
    setNum('hud-start', s ? s.startup : null, 's');
    setNum('hud-mem', s ? s.mem : null, 'MB');
    document.getElementById('hud-beat').textContent = `beat ${currentBeat}`;
  }

  function updateTable1() {
    const b = statsByStage['java8with2.6'];
    const f = statsByStage['java27with4.0'];
    const body = document.getElementById('t1-body');
    if (!body) return;
    const row = (label, s, cves) => s ? `
      <tr>
        <td>${label}</td>
        <td>${s.startup != null ? s.startup.toFixed(3) + 's' : '—'}</td>
        <td>${s.deps != null ? s.deps : '—'}</td>
        <td class="${cves === 0 ? 'zero' : 'bad'}">${cves != null ? cves : '—'}</td>
        <td>${s.mem != null ? s.mem.toFixed(1) : '—'}</td>
      </tr>` : '';
    body.innerHTML = row('Spring Boot 2.6 · Java 8', b, b && b.cves) + row('Spring Boot 4.1 · Java 27', f, f && f.cves);
    const outcome = document.getElementById('upgrade-outcome');
    if (outcome && f && f.cves != null) {
      outcome.textContent = f.cves === 0
        ? 'The major upgrade cleared every known CVE. The patch pass now verifies dependency currency.'
        : `The major upgrade removed most of the risk. ${f.cves} known ${f.cves === 1 ? 'CVE remains' : 'CVEs remain'} for the patch pass.`;
      outcome.classList.toggle('all-clear', f.cves === 0);
    }
  }

  function updatePayoff() {
    const b = statsByStage['java8with2.6'];
    const f = statsByStage['java27with4.0'];
    const p = statsByStage['java27patched'];
    const rows = [
      { label: 'Spring Boot 2.6 · Java 8', s: b, color: '#e8554e' },
      { label: 'Spring Boot 4.1 · Java 27', s: f, color: '#78be20' },
      { label: '…patched to latest', s: p, color: '#0091da' },
    ];
    const container = document.getElementById('payoff');
    if (!container) return;
    container.innerHTML = '';

    const bar = (label, v, max, unit, color) => {
      const pct = max ? Math.max(2, (v / max) * 100) : 2;
      return `<div class="po-row">
        <div class="po-label">${label}</div>
        <div class="po-track"><div class="po-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="po-value">${v != null ? (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v) : '—'}${unit}</div>
      </div>`;
    };

    const section = (title, metric, unit, pick) => {
      const vals = rows.map(r => r.s ? pick(r.s) : null).filter(v => v != null);
      const max = vals.length ? Math.max(...vals) : 1;
      let html = `<div class="po-group"><div class="po-title">${title}</div>`;
      for (const r of rows) {
        html += r.s ? bar(r.label, pick(r.s), max, unit, r.color) : bar(r.label, null, max, unit, r.color);
      }
      html += '</div>';
      return html;
    };

    const tests = `<div class="po-group">
      <div class="po-title">Tests</div>
      ${rows.map((r) => {
        const pass = r.s ? r.s.health : null;
        const cls = pass === 'UP' ? 'po-ok' : (pass === 'DOWN' ? 'po-bad' : '');
        const val = pass === 'UP' ? 'Pass' : (pass === 'DOWN' ? 'Fail' : '—');
        return `<div class="po-row"><div class="po-label">${r.label}</div><div class="po-value ${cls}">${val}</div></div>`;
      }).join('')}
    </div>`;

    container.innerHTML =
      section('Known CVEs', '', '', (s) => s.cves) +
      section('Startup time', '', 's', (s) => s.startup) +
      section('Memory', '', ' MB', (s) => s.mem) +
      tests;
  }

  // ------------------------------------------------------------------
  // Message dispatch
  // ------------------------------------------------------------------
  let currentBeat = 0;

  function handleMessage(msg) {
    switch (msg.type) {
      case 'term':
        if (term) term.write(msg.data);
        break;
      case 'replay':
        if (term) term.write(msg.data);
        break;
      case 'beat':
        currentBeat = msg.beat;
        goToSlide(window.slideForBeat(currentBeat));
        setStatus(`beat ${currentBeat}`);
        break;
      case 'started':
        setDemoActive(true);
        setStatus('demo running');
        break;
      case 'exit':
        setDemoActive(false);
        setStatus(`demo finished (exit ${msg.code})`);
        break;
      case 'state':
        currentBeat = msg.beat;
        setDemoActive(!!msg.running);
        // don't yank the presenter back to the title slide before the demo
        // has started; after it has (or once beats exist), follow the beat map
        if (msg.running || currentBeat > 0) {
          goToSlide(window.slideForBeat(currentBeat));
        }
        setStatus(msg.running ? 'demo running' : 'ready');
        break;
      case 'stats':
        handleStats(msg.stats);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // UI bits
  // ------------------------------------------------------------------
  function setStatus(text) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = text;
  }

  function wireUI() {
    const start = document.getElementById('btn-start');
    if (start) {
      start.addEventListener('click', () => {
        if (recordedMode) return; // start button is hidden in recorded mode
        send('start');
        start.classList.add('started');
        start.textContent = 'Demo started — press ⏎ to advance';
        start.blur();
      });
    }
    const restart = document.getElementById('btn-restart');
    if (restart) {
      restart.addEventListener('click', () => {
        if (term) term.reset();
        if (recordedMode) {
          currentBeat = 0;
          goToSlide(0); // slidechanged -> renderRecordedSlide resets the view
        } else {
          send('restart');
          currentBeat = 0;
          firedOpens.clear(); // allow auto-open URLs to fire again on the next pass
          goToSlide(0);
        }
        restart.blur();
      });
    }
    document.addEventListener('keydown', onKey);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    initDeck();
    wireUI();
    connect();
  });
})();
