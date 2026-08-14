/**
 * Draw a blind sample for the independent judge (HANDOFF.md §5.2 decision 4).
 *
 *   fetch bundles -> filter -> place -> random sample -> two files:
 *     spikes/gdelt/audit_sample_judge.jsonl   full records, traces included
 *     build/judge.html                        the blind sheet the judge opens
 *
 * **The point of this is that the judge is not me.** The same party designed
 * rule H and scored it, which §5.2 calls the weakest link in the evidence. So
 * everything here is arranged to keep the judge's verdict uncontaminated:
 *
 * 1. **The sheet shows the headline, the source and the placement. Nothing
 *    else.** No trace, no branch, no mention counts, no expected answer, and
 *    above all not the 69.7% — an anchor is the failure mode a second judge
 *    exists to avoid, and it is free to prevent here.
 * 2. **No link to the article.** §5.1's method is "judged by reading the
 *    headline against the placement", and UNJUDGEABLE is a real verdict for
 *    headlines that do not say enough. A judge who can open the article never
 *    marks UNJUDGEABLE, which silently changes the denominator and makes this
 *    draw incomparable with the one it is checking. The URL is in the JSONL for
 *    traceability and is deliberately not on screen.
 * 3. **Disjoint from every previous draw**, by URL, so this is a fresh sample
 *    and not a re-scoring of records that already have a verdict.
 * 4. **Unstratified**, per §5.1 — the PIN number has to be an honest population
 *    estimate, so the draw is not balanced between pins and containers.
 *
 * The one addition to §5.1's method: a WRONG verdict also picks a **reason**.
 * That is what makes the draw do double duty — it populates the failure taxonomy
 * at usable n instead of the 15 records that were classified by hand. It cannot
 * bias the accuracy number, because the reason is only asked for *after* the
 * verdict is already WRONG.
 *
 * Run:  node scripts/draw-judge-sample.ts [n] [--bundles N] [--seed N]
 *       n defaults to 90, which yields ~46 pins at the measured 51% pin share —
 *       enough to bring the lower bound from ~52.7% to ~56% if the point
 *       estimate holds. See §5.2 for why that margin matters.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBundle, newestStamp, shiftStamp } from "../worker/fetch.ts";
import { filterArticles } from "../worker/filter.ts";
import { parseBundle } from "../worker/parse.ts";
import { type PlacementTrace, explainPlacement } from "../worker/place.ts";
import { loadRefData } from "../worker/refdata.ts";
import type { Article } from "../lib/types.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPIKE_DIR = path.join(REPO_ROOT, "spikes", "gdelt");
const SAMPLE_OUT = path.join(SPIKE_DIR, "audit_sample_judge.jsonl");
const SHEET_OUT = path.join(REPO_ROOT, "build", "judge.html");

const DEFAULT_N = 90;
const DEFAULT_BUNDLES = 8;

/** What the judge picks from after marking WRONG. Judge-facing wording, not the internal taxonomy. */
export const FAILURE_REASONS = [
  { code: "no-place", label: "The story isn't about any particular place" },
  { code: "wrong-place", label: "The headline points somewhere else entirely" },
  { code: "near-miss", label: "Right area, wrong spot (or right country, wrong city)" },
  { code: "not-a-place", label: "That isn't really a place" },
  { code: "other", label: "Something else" },
];

type SampleRecord = {
  id: string;
  title: string;
  domain: string;
  url: string;
  kind: "PIN" | "CONTAINER";
  placedAt: string;
  /** Not shown to the judge. Joined back by score-audit.ts. */
  trace: PlacementTrace;
};

/** Deterministic PRNG so a draw can be reproduced from its seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every URL that has appeared in any previous draw, so this one is disjoint. */
async function alreadyDrawn(): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const file of await readdir(SPIKE_DIR)) {
    if (!file.startsWith("audit_") || !file.endsWith(".jsonl")) continue;
    const body = await readFile(path.join(SPIKE_DIR, file), "utf8");
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const url = JSON.parse(line).url;
        if (url) seen.add(url);
      } catch {
        // A malformed line in a hand-edited audit file is not worth failing on.
      }
    }
  }
  return seen;
}

/**
 * How the placement is put to the judge — the same claim the map makes.
 *
 * Deliberately mirrors `lib/popup.ts`: a container says "somewhere in", because
 * it is a weaker claim than a pin and judging it as though it were an exact
 * location would score it against a claim the map never made (§2.2).
 */
function claimFor(kind: string, placedAt: string): string {
  return kind === "CONTAINER" ? `Somewhere in ${placedAt}` : placedAt;
}

function sheetHtml(records: SampleRecord[], meta: Record<string, unknown>): string {
  // The judge's copy carries no trace, no reason and no expected answer.
  const blind = records.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    claim: claimFor(r.kind, r.placedAt),
  }));
  const payload = JSON.stringify({ meta, records: blind, reasons: FAILURE_REASONS }).replace(
    /</g,
    "\\u003c",
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Placement judging</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfbfa; --fg:#1a1a1a; --muted:#6b6b6b; --line:#e0dedb; --card:#fff; --accent:#b4321e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#17181a; --fg:#eceae7; --muted:#9a9894; --line:#2e3033; --card:#1f2124; --accent:#e2654c; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem 5rem; }
  h1 { font-size:1.05rem; font-weight:600; letter-spacing:.01em; margin:0 0 .25rem; }
  .sub { color:var(--muted); font-size:.85rem; margin:0 0 1.75rem; }
  .bar { height:3px; background:var(--line); border-radius:2px; overflow:hidden; margin-bottom:1.5rem; }
  .bar > i { display:block; height:100%; background:var(--accent); width:0; transition:width .2s; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1.5rem; }
  .headline { font-size:1.2rem; font-weight:600; line-height:1.35; margin:0 0 .4rem; }
  .src { color:var(--muted); font-size:.82rem; margin:0 0 1.5rem; }
  .claimlabel { color:var(--muted); font-size:.72rem; text-transform:uppercase; letter-spacing:.09em; margin:0 0 .3rem; }
  .claim { font-size:1.05rem; font-weight:500; padding:.7rem .9rem; border-left:3px solid var(--accent); background:color-mix(in srgb, var(--accent) 7%, transparent); border-radius:0 6px 6px 0; }
  .btns { display:flex; flex-direction:column; gap:.5rem; margin-top:1.5rem; }
  button { font:inherit; text-align:left; padding:.7rem .9rem; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:7px; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  kbd { font:600 .72rem ui-monospace,monospace; color:var(--muted); border:1px solid var(--line); border-radius:4px; padding:.05rem .3rem; margin-right:.5rem; }
  .why { margin-top:1.25rem; padding-top:1.25rem; border-top:1px dashed var(--line); }
  .why p { margin:0 0 .6rem; font-size:.85rem; color:var(--muted); }
  .foot { margin-top:1.25rem; display:flex; justify-content:space-between; align-items:center; font-size:.8rem; color:var(--muted); }
  .foot button { padding:.3rem .6rem; font-size:.8rem; }
  .done { text-align:center; padding:3rem 1rem; }
  .done button { display:inline-block; text-align:center; font-weight:600; border-color:var(--accent); padding:.8rem 1.4rem; }
  .hint { font-size:.8rem; color:var(--muted); background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.9rem 1rem; margin-bottom:1.5rem; }
  .hint b { color:var(--fg); font-weight:600; }
</style>
</head>
<body>
<main>
  <h1>Where should this story sit on a map?</h1>
  <p class="sub">Read the headline. Say whether the place underneath it is where you'd expect that story to be.</p>
  <div class="hint">
    <b>Judge on the headline alone.</b> If it doesn't say enough to tell, that's
    <b>Can't tell</b> — a real answer, not a cop-out, and it's excluded from the score
    rather than counted against it. There's no article link on purpose.
    Your progress saves automatically; you can close the tab and come back.
  </div>
  <div class="bar"><i id="bar"></i></div>
  <div id="app"></div>
</main>
<script id="data" type="application/json">${payload}</script>
<script>
(function () {
  var DATA = JSON.parse(document.getElementById("data").textContent);
  var KEY = "sonder-judge-" + DATA.meta.drawId;
  var answers = {};
  try { answers = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) {}

  var app = document.getElementById("app");
  var bar = document.getElementById("bar");
  var pending = null;   // record awaiting a reason after WRONG

  function save() { try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch (e) {} }
  function nextIndex() {
    for (var i = 0; i < DATA.records.length; i++) if (!answers[DATA.records[i].id]) return i;
    return -1;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function verdict(rec, v) {
    if (v === "WRONG") { pending = rec; render(); return; }
    answers[rec.id] = { verdict: v, reason: "" };
    pending = null; save(); render();
  }
  function reason(code) {
    answers[pending.id] = { verdict: "WRONG", reason: code };
    pending = null; save(); render();
  }

  function render() {
    var done = Object.keys(answers).length;
    bar.style.width = (100 * done / DATA.records.length) + "%";

    var i = nextIndex();
    if (i === -1 && !pending) {
      app.innerHTML = '<div class="done"><p>All ' + DATA.records.length +
        ' judged. Thank you.</p><button id="dl">Download results</button>' +
        '<p style="margin-top:1rem;font-size:.8rem;color:var(--muted)">Send the downloaded file back.</p></div>';
      document.getElementById("dl").onclick = download;
      return;
    }

    var rec = pending || DATA.records[i];
    var html =
      '<div class="card">' +
        '<p class="headline">' + esc(rec.title) + '</p>' +
        '<p class="src">' + esc(rec.domain) + '</p>' +
        '<p class="claimlabel">Placed at</p>' +
        '<div class="claim">' + esc(rec.claim) + '</div>';

    if (pending) {
      html += '<div class="why"><p>What went wrong?</p>';
      for (var r = 0; r < DATA.reasons.length; r++) {
        html += '<button data-reason="' + DATA.reasons[r].code + '"><kbd>' + (r + 1) + '</kbd>' +
                esc(DATA.reasons[r].label) + '</button>';
      }
      html += '</div>';
    } else {
      html += '<div class="btns">' +
        '<button data-v="CORRECT"><kbd>1</kbd>Yes — that\\'s where I\\'d expect it</button>' +
        '<button data-v="WRONG"><kbd>2</kbd>No — that\\'s not where this belongs</button>' +
        '<button data-v="UNJUDGEABLE"><kbd>3</kbd>Can\\'t tell from the headline</button>' +
        '</div>';
    }

    html += '</div><div class="foot"><span>' + (done + 1) + ' of ' + DATA.records.length + '</span>' +
            '<button id="undo">Undo last</button></div>';
    app.innerHTML = html;

    var btns = app.querySelectorAll("button[data-v]");
    for (var b = 0; b < btns.length; b++) {
      btns[b].onclick = (function (v) { return function () { verdict(rec, v); }; })(btns[b].dataset.v);
    }
    var rbtns = app.querySelectorAll("button[data-reason]");
    for (var c = 0; c < rbtns.length; c++) {
      rbtns[c].onclick = (function (code) { return function () { reason(code); }; })(rbtns[c].dataset.reason);
    }
    document.getElementById("undo").onclick = undo;
  }

  function undo() {
    if (pending) { pending = null; render(); return; }
    var i = nextIndex();
    var last = i === -1 ? DATA.records.length - 1 : i - 1;
    if (last < 0) return;
    delete answers[DATA.records[last].id];
    save(); render();
  }

  document.addEventListener("keydown", function (e) {
    var n = Number(e.key);
    if (!n) return;
    var sel = app.querySelectorAll(pending ? "button[data-reason]" : "button[data-v]");
    if (sel[n - 1]) sel[n - 1].click();
  });

  function download() {
    var lines = DATA.records.map(function (r) {
      var a = answers[r.id] || { verdict: "", reason: "" };
      return JSON.stringify({ id: r.id, verdict: a.verdict, reason: a.reason });
    });
    var blob = new Blob([lines.join("\\n") + "\\n"], { type: "application/x-ndjson" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "judged-" + DATA.meta.drawId + ".jsonl";
    a.click();
  }

  render();
})();
</script>
</body>
</html>
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: number) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(args[i + 1]);
  };
  const n = Number(args.find((a) => /^\d+$/.test(a)) ?? DEFAULT_N);
  const bundles = flag("bundles", DEFAULT_BUNDLES);
  const seed = flag("seed", Date.now() % 2 ** 31);

  const data = await loadRefData();
  const excluded = await alreadyDrawn();

  let stamp = await newestStamp();
  const articles: Article[] = [];
  for (let i = 0; i < bundles; i++) {
    const bundle = await fetchBundle(stamp);
    if (bundle) articles.push(...parseBundle(bundle.csv).articles);
    stamp = shiftStamp(stamp, -15);
  }

  // Dedupe by URL before sampling, or a syndicated story is over-represented in
  // the draw exactly the way it is not in the published map (grouping collapses
  // it, §2.5).
  const byUrl = new Map<string, Article>();
  for (const article of filterArticles(articles, data).kept) {
    if (!excluded.has(article.url)) byUrl.set(article.url, article);
  }

  const population: SampleRecord[] = [];
  for (const article of byUrl.values()) {
    const trace = explainPlacement(article, data);
    if (trace.placement.kind === "DROP") continue; // never reaches the map, so never judged
    population.push({
      id: "",
      title: article.title,
      domain: article.domain,
      url: article.url,
      kind: trace.placement.kind,
      placedAt: trace.placement.location.name,
      trace,
    });
  }

  // Fisher-Yates on a seeded PRNG: reproducible from (seed, bundles) alone.
  const rand = mulberry32(seed);
  for (let i = population.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [population[i], population[j]] = [population[j], population[i]];
  }
  const sample = population.slice(0, n);
  sample.forEach((record, i) => {
    record.id = `${seed.toString(36)}-${i}`;
  });

  const drawId = `${seed.toString(36)}-${sample.length}`;
  const meta = {
    drawId,
    seed,
    bundles,
    drawnAt: new Date().toISOString(),
    populationSize: population.length,
    excludedFromPriorDraws: excluded.size,
  };

  await mkdir(path.dirname(SHEET_OUT), { recursive: true });
  await writeFile(SAMPLE_OUT, sample.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await writeFile(SHEET_OUT, sheetHtml(sample, meta));

  const pins = sample.filter((r) => r.kind === "PIN").length;
  console.log(`
  drew ${sample.length} of ${population.length} placed, seed ${seed}
       ${pins} pins, ${sample.length - pins} containers
       ${excluded.size} URLs excluded as already judged

  sample  ${path.relative(REPO_ROOT, SAMPLE_OUT)}   (traces — do NOT send this)
  sheet   ${path.relative(REPO_ROOT, SHEET_OUT)}   (send this)

  Score the returned file with:
    node scripts/score-audit.ts <judged-${drawId}.jsonl>
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
