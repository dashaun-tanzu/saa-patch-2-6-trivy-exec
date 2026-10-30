# Spring Application Advisor — Live Executive Demo

A presenter-driven deck that runs the Spring Application Advisor terminal demo
live, with a real terminal docked at the bottom of every slide. As the presenter
advances the demo, the slides follow the terminal — so you can tell the
executive story above the code while the actual upgrade runs in front of the
audience.

The deck lives in [`docs/`](docs/), so it can be published as-is on GitHub
Pages as a static site. When it can't reach a live demo server (i.e. on GitHub
Pages), it automatically replays a **recorded walkthrough** of the demo in the
same click-through, slides-follow-terminal model.

## What it does

The demo takes a real Spring Boot 2.6 application on Java 8 all the way to
Spring Boot 4.1 on Java 27 — analyzed, upgraded, patched, and measured — in one
live run:

- **Act I · Analyze** — Advisor captures the software bill of materials, git
  metadata, Maven coordinates, and build tools; Trivy scans the dependency graph.
- **Act II · Upgrade** — Advisor produces an ordered upgrade plan, squashes 11
  migration steps into a single pass, and swaps the runtime to Java 27.
- **Act III · Patch** — Advisor takes every dependency to its latest patch
  release, and the result is re-scanned.

The deck ships with `demo.sh`, which drives the whole thing: each stage builds
and runs the app, records startup time and memory, and writes the live numbers
the slides stream in.

## What you get

- **20 executive slides** — one live Analyze → Upgrade → Patch story in a dark
  theme with a Spring-green accent.
- **Live terminal** — the real `demo.sh` runs in a PTY; the presenter drives it
  with the keyboard, exactly like the terminal demo.
- **Slide sync** — the slides follow the terminal as it advances, so the story
  stays aligned with what's running at any moment.
- **Live numbers** — CVE counts, dependency counts, startup time, and memory
  come from *this* run; nothing is a hardcoded value.
- **Recorded walkthrough** — when there's no live server, the deck replays a
  captured run and you navigate it with normal Reveal controls (← / →), like
  any other presentation. Each slide shows the terminal and stats as they were
  at that point in the demo.

## Run it live

```bash
./run.sh    # installs deps (first time), starts the server, opens the browser
```

Then, on the title slide, click **▶ Start the live demo**, and advance with
**Enter / Space**. The slides follow the terminal.

Requires the same prerequisites as the terminal demo (SDKMAN, Spring
Application Advisor, Trivy, vendir, httpie, jq, bc, git, tar, network) plus
Node.js (>= 18). `ADVISOR_VERSION` is read from `.envrc` (currently 1.7.1).

## Publish on GitHub Pages

The whole deck — Reveal.js, xterm.js, fonts, and the recorded walkthrough — is
committed under `docs/`, so `docs/` is a self-contained static site.

1. In the repo Settings → Pages, set **Source** to *Deploy from a branch* and
   select the `main` branch with the `/docs` folder.
2. Visit your Pages URL. The deck loads and, because no live demo server is
   reachable, switches to the recorded walkthrough. It behaves like a normal
   presentation: use **← / → (arrows or the on-screen controls)** to move
   through the slides, forward and backward. The docked terminal and the live
   numbers update to show the demo state at each slide.

You can also force recorded mode locally with `?recorded` on the URL.

## Record a fresh walkthrough

The published deck replays whatever is in `docs/recorded/walkthrough.json`. To
re-capture it (e.g. after bumping Advisor or when the numbers change), run the
real demo against the server with recording enabled:

```bash
npm run record      # starts the server with RECORD on and drives demo.sh to completion
```

This writes a fresh `docs/recorded/walkthrough.json` with the terminal output,
beat count, and stats for all three stages. Commit it and the published deck
replays the new run.

## Controls

| Key | Effect |
|-----|--------|
| `←` / `→` (or on-screen arrows) | navigate the deck, forward and backward |
| `Enter` / `Space` | live mode: advance the demo (and thus the slides) |
| `Esc` | live mode: send Escape to the terminal |
| `Restart` (terminal bar) | live mode: kill and restart the demo; recorded mode: return to slide 0 |
| `Home` / `End` | jump to the first / last slide |

## Project layout

| Path | Purpose |
|------|---------|
| `docs/index.html` | the Reveal deck: slides, docked terminal, HUD |
| `docs/js/app.js` | terminal I/O, WS client, recorded replay, beat→slide nav, live stats |
| `docs/js/beats.js` | beat → slide mapping |
| `docs/css/exec.css` | theme |
| `docs/vendor/` | Reveal.js, xterm.js, addon-fit (committed, offline-safe) |
| `docs/recorded/walkthrough.json` | the recorded demo the static deck replays |
| `server.js` | static server + WebSocket + PTY spawn of `demo.sh` + stats watcher (+ `RECORD` capture) |
| `run.sh` | install-if-needed, start server, open browser |
| `record-walkthrough.js` | `npm run record` — drive the demo and write the recording |
| `scripts/smoke-test.js` | automated server + PTY + sync + recording test (`npm run smoke`) |
| `demo.sh` + friends | self-contained copy of the terminal demo |

Client libraries and the recording are committed, so `docs/` works fully
offline and on GitHub Pages with no build step.

## Testing

```bash
npm run smoke    # boots the server against a fast fake demo, drives beats, checks assets + recording
```

## Attribution

The underlying demo and story come from the
[`saa-patch-2-6-trivy-demo`](https://github.com/dashaun-tanzu/saa-patch-2-6-trivy-demo)
terminal demo. Reveal.js, xterm.js, node-pty, and demo-magic are used under
their respective licenses.
