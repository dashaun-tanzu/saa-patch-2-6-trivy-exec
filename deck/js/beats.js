// Maps the demo's screen-change counter (each `clear` from demo-magic's
// talkingPoint) to a slide index. The deck follows the terminal: when the
// server reports a new beat, we show the slide whose range contains it.
//
// Beat numbering: clear #1 is `init` at demo start, then one clear per
// talkingPoint — 30 total, matching demo.sh's main flow. Unlike the
// usaa-ai-summit variant, this demo switches to Java 27 *visibly*
// (its own talkingPoint), so the flow has one extra beat. The demo is
// CLEAR-FIRST: every command runs *after* the clear that introduces its
// slide, so the slide on screen describes exactly what the terminal below
// is doing. Beat X = the command executed between clear X and clear X+1.
//
// Slide layout (see deck/index.html):
//   0      title            (pre-demo, presenter-driven)
//   1      the portfolio    (pre-demo: dashaun-demo org + app table)
//   2      start the demo   (pre-demo: bridge + Start button)
//   3..20  the live exec demo (terminal-driven via beats; slide 12 is the
//          visible `sdk use java 27` switch)
//   21..25 at-scale story   (post-demo, presenter-driven: scale, loop, best,
//                           proof/PRs, Tanzu Hub)
window.BEATS = [
  { beat: 0,  slide: 0 },   // title (before the demo starts)
  { beat: 1,  slide: 3 },   // init -> Act I legacy baseline (sdk use java 8 runs under it)
  { beat: 4,  slide: 4 },   // advisor reads the app (advisor build-config get runs under it)
  { beat: 5,  slide: 5 },   // git metadata (jq '.git-metadata' runs under it)
  { beat: 6,  slide: 6 },   // the SBOM (jq '.sbom.components | length' runs under it)
  { beat: 7,  slide: 7 },   // Maven coordinates (jq '.submodules' runs under it)
  { beat: 8,  slide: 8 },   // the tools (jq '.tools' runs under it)
  { beat: 9,  slide: 9 },   // trivy scan #1 (scan runs under it, CVE count pops in)
  { beat: 10, slide: 10 },  // what "normal" costs (app starts; beats 11-13 health/memory/stop stay)
  { beat: 14, slide: 11 },  // Act II the plan (upgrade-plan get runs under it)
  { beat: 15, slide: 12 },  // switch to Java 27 (sdk use java 27 runs under it)
  { beat: 16, slide: 13 },  // Spring Boot 4.1 in one pass (apply --squash under it; beat 17 re-read stays)
  { beat: 18, slide: 14 },  // residual CVEs (re-read + trivy scan #2 under it)
  { beat: 19, slide: 15 },  // faster and lighter (start #2; beats 20-22 health/memory/stop stay)
  { beat: 23, slide: 16 },  // table #1 (statsSoFarTableColored prints under it)
  { beat: 24, slide: 17 },  // finish the job (patch apply runs under it; beat 25 re-read stays)
  { beat: 26, slide: 18 },  // zero (re-read + trivy scan #3 under it)
  { beat: 27, slide: 19 },  // the payoff (start #3; beats 28-30 health/memory/stop stay)
  { beat: 31, slide: 20 },  // wrap (final comparison table prints under it)
];

window.slideForBeat = function (beat) {
  let s = window.BEATS[0].slide;
  for (const b of window.BEATS) {
    if (beat >= b.beat) s = b.slide;
  }
  return s;
};

// The demo-driven slide range. Outside it, the presenter navigates the deck
// directly (click-through at their own pace); inside it, the slides follow
// the terminal and keys are forwarded to the PTY.
window.DEMO_SLIDE_FIRST = 3;
window.DEMO_SLIDE_LAST = 20;
