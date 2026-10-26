# Spring Application Advisor — Executive Deck (saa-patch-2-6-trivy-exec)

A **presenter-driven, executive version** of the `saa-patch-2-6-trivy-demo`
terminal demo. It's a self-contained web deck that runs the *real* `demo.sh`
in a live terminal docked at the bottom of every slide. As the presenter
advances the demo, the slides follow the terminal — so you stay "above the
code" and tell the story while the actual upgrade happens in front of the
audience.

## What you get

- **16 executive slides** — one per story beat (Analyze → Upgrade → Patch),
  dark theme with a Spring-green accent.
- **Live terminal** — the real `demo.sh` runs in a PTY via `node-pty`; the
  presenter drives it with the keyboard exactly like the terminal demo.
- **Slide sync** — each `clear` in the demo (demo-magic's `talkingPoint`) is
  a beat; the deck navigates to the slide for the current beat.
- **Live numbers** — CVE counts, dependency counts, startup time, and memory
  are read from the `upgrade-example/` files the demo writes, and stream into
  a corner HUD and the payoff charts in real time. Numbers are always from
  *this* run — CVEs change every hour, so nothing is hardcoded.

## Quick start

```bash
./run.sh          # installs deps (first time), starts server, opens the browser
```

Then, on the title slide, click **▶ Start the live demo**. Advance the demo
with **Enter / Space** — the slides follow the terminal.

Requires the same prerequisites as the terminal demo (SDKMAN, Spring
Application Advisor, Trivy, vendir, httpie, jq, bc, git, tar, network) plus
Node.js (>= 18). `ADVISOR_VERSION` is read from `.envrc` (default 1.6.7).

> The app is upgraded to Boot 4.1 and **runs on Java 27**. Advisor's
> OpenRewrite recipes still execute on a pinned toolchain JDK (third `java=`
> line in `.sdkmanrc`) because they can't parse on JDK 27 yet — invisible to
> the audience; the demo shows the clean advisor commands.

## How the presenter-driven sync works

1. `demo.sh`'s `talkingPoint` is demo-magic's `wait` (one silent keypress,
   auto-advances after `PROMPT_TIMEOUT=5`) followed by `clear`.
2. The presenter presses a key **in the deck** → it's forwarded to the PTY →
   the demo advances and clears the screen.
3. The server detects each `\x1b[3J\x1b[H\x1b[2J` clear sequence, increments
   a beat counter, and broadcasts it.
4. The deck navigates to the slide mapped for that beat (`deck/js/beats.js`).

Because the slides follow the terminal (not the other way round), the 5s
auto-advance timeout and a browser reload both stay in sync — the server is
the source of truth and reconnects replay recent output.

## Controls

| Key | Effect |
|-----|--------|
| `Enter` / `Space` | advance the live demo (and thus the slides) |
| `Esc` | send Escape to the terminal |
| `↻ restart` (HUD) | kill and restart `demo.sh` from slide 0 |
| Arrow keys / click | Reveal navigation (also available) |

## Project layout

| File | Purpose |
|------|---------|
| `server.js` | static file server + WebSocket + PTY spawn of `demo.sh` + stats watcher |
| `deck/index.html` | the Reveal deck: slides, docked terminal, HUD |
| `deck/js/app.js` | terminal I/O, WS client, beat→slide navigation, live stats rendering |
| `deck/js/beats.js` | beat → slide mapping (edit to regroup slides) |
| `deck/css/exec.css` | theme |
| `run.sh` | install-if-needed, start server, open browser |
| `scripts/smoke-test.js` | automated server+PTY+sync test (`npm run smoke`) |
| `demo.sh` + friends | self-contained copy of the terminal demo |

Client libraries (Reveal.js, xterm.js) are served straight from `node_modules`,
so the deck works fully offline once installed.

## Adjusting the slide mapping

`deck/js/beats.js` lists `{ beat, slide }` thresholds. Each entry means "when
the demo's clear counter reaches `beat`, show slide `slide`". The demo has 31
clears (beat 1 is `init` at startup); the wrap slide is reached when the demo
exits cleanly. Regroup the executive story by changing these thresholds.

## Testing

```bash
npm run smoke      # boots the server against a fast fake demo, drives beats, checks assets
```

A real end-to-end check is just running `./run.sh` and presenting — the demo
itself is the test.

## Attribution

Same story and demo script as
[`saa-patch-2-6-trivy-demo`](https://github.com/dashaun-tanzu/saa-patch-2-6-trivy-demo).
Reveal.js, xterm.js, node-pty, and demo-magic are used under their respective
licenses.
