/**
 * Does anything the pipeline already knows predict whether a PIN is right?
 *
 * Run: `node spikes/gdelt/pin-confidence.mjs` from the repo root. FINDINGS §9.1
 * carries the result and HANDOFF §5.2 decision 3 carries what it decided.
 *
 * The only per-pin quantity available at render time that could carry a signal
 * is how many times the placed location was mentioned in the article. This asks
 * whether it separates correct pins from wrong ones, on the two judged samples.
 *
 * The rule-S sample (n=110) did not judge rule H's placements, so its verdicts
 * are transferred ONLY where rule H picks the same location as rule S did — for
 * those records the judge scored exactly the pin rule H would draw.
 *
 * **This one probe is JavaScript, in a directory that is otherwise Python on
 * purpose.** The reason is narrow: it has to replay rule H itself, and the rule
 * lives in `worker/place.ts`. A Python reimplementation would be a *second*
 * transcription of the one function this project has already been burned by
 * getting subtly wrong, and a drift between the two would look exactly like a
 * finding. Keeping it in the same language as the implementation is what makes
 * `ruleH()` below checkable against `placeStory()` by reading them side by side.
 */
import fs from "node:fs";

const demonyms = new Set(
  fs.readFileSync("data/demonyms.txt", "utf8").split(/\r?\n/)
    .map((d) => d.trim().toLowerCase()).filter(Boolean),
);
const isDemonym = (name) => demonyms.has(name.split(",")[0].trim().toLowerCase());

const CITY = new Set(["US-CITY", "WORLD-CITY"]);
const ADM1 = new Set(["US-STATE", "ADM1"]);

/** Rule H over a per-mention location list. Returns {kind, name} or null. */
function ruleH(locs) {
  const kept = locs.filter((l) => !isDemonym(l.name));
  if (!kept.length) return null;
  const counts = new Map();
  kept.forEach((l) => counts.set(l.name, (counts.get(l.name) ?? 0) + 1));
  const best = (pred) => {
    const c = kept.filter(pred);
    if (!c.length) return null;
    return c.reduce((w, x) =>
      (counts.get(x.name) !== counts.get(w.name)
        ? (counts.get(x.name) > counts.get(w.name) ? x : w)
        : (x.offset < w.offset ? x : w)));
  };
  const city = best((l) => CITY.has(l.type));
  const adm1 = best((l) => ADM1.has(l.type));
  const country = best((l) => l.type === "COUNTRY");
  const n = (l) => counts.get(l.name) ?? 0;
  if (city) {
    if (adm1 && n(adm1) >= 2 * n(city)) return { kind: "CONTAINER", name: adm1.name, count: n(adm1) };
    if (country && n(country) >= 3 * n(city)) return { kind: "CONTAINER", name: country.name, count: n(country) };
    return { kind: "PIN", name: city.name, count: n(city) };
  }
  if (adm1) return { kind: "CONTAINER", name: adm1.name, count: n(adm1) };
  if (country) return { kind: "CONTAINER", name: country.name, count: n(country) };
  return null;
}

const read = (f) => fs.readFileSync(f, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));

/** {count, correct} for every judged pin rule H would actually draw. */
const pins = [];

// Out-of-sample draw: counts are recorded directly.
for (const r of read("spikes/gdelt/audit_judged_ruleh.jsonl")) {
  if (r.kind !== "PIN" || r.verdict === "UNJUDGEABLE") continue;
  pins.push({
    src: "ruleH60",
    count: Math.max(...Object.values(r.counts ?? { x: 0 })),
    correct: r.verdict === "CORRECT",
  });
}

// Rule-S draw: replay rule H and keep only the records where it agrees.
let agreed = 0, disagreed = 0;
for (const r of read("spikes/gdelt/audit_judged.jsonl")) {
  if (r.verdict === "UNJUDGEABLE") continue;
  const locs = (r.all_locs ?? []).map((s, offset) => {
    const i = s.indexOf(":");
    return { type: s.slice(0, i), name: s.slice(i + 1), offset };
  });
  const h = ruleH(locs);
  if (!h || h.kind !== "PIN") continue;
  if (r.kind === "PIN" && h.name === r.placed_at) {
    agreed++;
    pins.push({ src: "ruleS110", count: h.count, correct: r.verdict === "CORRECT" });
  } else {
    disagreed++;
  }
}

function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [((c - m) / d) * 100, ((c + m) / d) * 100];
}
function fisher(a, b, c, d) {
  const lg = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const p = (a, b, c, d) => Math.exp(
    lg(a + b) + lg(c + d) + lg(a + c) + lg(b + d)
    - lg(a) - lg(b) - lg(c) - lg(d) - lg(a + b + c + d));
  const obs = p(a, b, c, d), n = a + b + c + d;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const A = i, B = a + b - i, C = a + c - i, D = d - a + i;
    if (B < 0 || C < 0 || D < 0) continue;
    const q = p(A, B, C, D);
    if (q <= obs * 1.0000001) sum += q;
  }
  return sum;
}

const report = (label, set) => {
  const n = set.length, k = set.filter((p) => p.correct).length;
  const [lo, hi] = wilson(k, n);
  console.log(`  ${label.padEnd(22)} n=${String(n).padStart(3)}  ${((100 * k) / n || 0).toFixed(1).padStart(5)}%  [${lo.toFixed(1)}, ${hi.toFixed(1)}]`);
};

console.log(`rule-S records replayed under rule H: ${agreed} same pin, ${disagreed} different placement (verdict does not transfer)\n`);

for (const [name, set] of [
  ["out-of-sample (60)", pins.filter((p) => p.src === "ruleH60")],
  ["transferred (110)", pins.filter((p) => p.src === "ruleS110")],
  ["pooled", pins],
]) {
  console.log(`${name}:`);
  report("all pins", set);
  report("mentioned once", set.filter((p) => p.count === 1));
  report("mentioned 2+", set.filter((p) => p.count >= 2));
  report("mentioned 3+", set.filter((p) => p.count >= 3));
  const s = set.filter((p) => p.count === 1), m = set.filter((p) => p.count >= 2);
  const a = s.filter((p) => p.correct).length, b = s.length - a;
  const c = m.filter((p) => p.correct).length, d = m.length - c;
  console.log(`  once vs 2+: [${a} ${b} / ${c} ${d}]  fisher p = ${fisher(a, b, c, d).toFixed(4)}\n`);
}
