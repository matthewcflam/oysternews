# Sonder — Project Plan

**This file is the single source of truth.** If anything in `spikes/`, a design
doc, or a previous conversation contradicts it, this file wins.

**Status:** **Phases 1, 2, 2.5 and 3 are complete**, and the 4-hourly worker has
now run green in CI. **Phase 4 is in progress**: both layers are styled, the
§2.2 outline works, **§2.3 is complete on both sides** — the index is published
and the label gesture, the outline, the panel and the Global button are built and
verified in a browser — and the **geotag-confidence treatment is complete in both
halves**. **Its shipping gate, §5.2 decision 4, is discharged as of 2026-08-14.**
What is left is the phone profile, one missing outline, and one payload number to
read. Live: https://sonder-drab-eta.vercel.app/ .
**Last updated:** 2026-08-14 (late), when **§5.2 decision 4 came back and the
placement rule changed because of it.** An independent judge scored a fresh
90-record draw: **pins 68.1% [53.8, 79.6], containers 83.3% [68.1, 92.1]**, no
abort threshold fires, and the pins' lower bound rose against the 50% kill line
rather than falling. That draw also paid for the first rule this project has
changed on independent evidence — **§2.1 now DROPs a city mentioned once**
(`weak-city`, 30.2% of former pins, measured 36.4% correct against 77.8%). And it
surfaced a live trap in the audit tooling: **the same judged sheet scored against
a stale sample returns KILL CONTAINERS**, silently, because draw ids came from
the seed. Draws are fingerprinted now. All three are written up below; start at
"The independent judge came back".

**Then the three inherited items were worked and two were closed, same night.**
The count band's first production test **passed** (05:46 UTC, 33,778 groups, no
relax `WARN`). **The weak-city rule was settled by decision** — dropping a city
mentioned once is final, not on trial, and the re-measurement that was owed
against it is now **optional rather than a gate** (the draw is taken and on disk
either way). §2.4's overflow was **re-read at 57.3% but is still a pre-weak-city
number** — the rule landed after that run, so the trigger has not been read on
the code that is live.

**Then the density budget turned out never to have run.** §2.4's per-tile top-K
is implemented correctly in `budget.ts` and was **thrown away at the tiles
boundary**: `worker/tiles.ts` wrote tippecanoe's per-feature directive *inside*
`properties`, where tippecanoe does not look for it. Every `minzoom` was ignored
on every archive this project has ever published. World zoom served **1,714 pins
on a 390px phone against §9's target of 30-60**. Fixed, tested and proved against
real tippecanoe — see "The density budget never ran" below, and **re-read any
overflow number taken before 2026-08-14 with it in mind**.

**Two things were then deferred by decision, and both are deferred rather than
cancelled:** the **phone profile** (§9's 4G target stays unverified on real
hardware, and `K` must not move until it is done) and an accuracy number
measured against the current rule. **Phase 6 was started ahead of Phase 4
finishing** because of those deferrals — `/about` is live. Details in each
section; the queue below is current.

**The three things a fresh session should know they are inheriting:**

1. ~~**A fresh judged draw is owed.**~~ **Closed 2026-08-14 by decision, not by
   measurement — and the difference matters.** Dropping a city mentioned once is
   **settled**: `judged-c29ce-90` funded it, §2.1 enforces it, and it is not on
   trial pending further evidence. What is *not* settled is an accuracy number
   for the rule as it now stands — **68.1% [53.8, 79.6] was measured on the
   pipeline before weak-city existed**, so it describes a map that included the
   least accurate group of pins. That is the honest reading and the About page
   states it in those words.

   > **Do not quietly promote 77.8% to a measurement.** It is the old draw with a
   > subset removed — a projection — and §5.1 reads bands off measurements. If a
   > number for the current rule is ever wanted, draw `zcbaks-d7b665-90` is
   > already taken and disjoint (90 records, 41 pins / 49 containers, sheet at
   > `build/judge.html`, score with `node scripts/score-audit.ts`). It is
   > **optional**, not owed.
2. ~~**The absolute count band's first production test was never confirmed.**~~
   **Done, 2026-08-14.** The 05:46 UTC run published 33,778 groups with **no
   relax `WARN`** — the band passed on its own bounds. See the count band section.
3. **§2.4's overflow trigger fired again, at 57.3%** (19,344 of 33,778, 05:46
   UTC) and is still unaddressed, as is the phone profile that gates it. **That
   reading is pre-weak-city**, so it does not yet answer the open question — see
   below.

The earlier part of the same day covered seven other things: a bad Blob token failed the
first two scheduled runs, the count band was caught one run from wedging the
pipeline shut for good and then **rebuilt as two absolute constants after it
refused runs a second time**, §2.3 was redesigned around clicking place labels,
its per-region index was built and verified published, its client half was built
against the live archive, and the pin half of the geotag-confidence treatment was
built after a measurement refused the graded version of it.

**Everything above is now deployed and verified in production** (`df214d0`),
including the placement line — clicking a pin on the live site reads
*"Chippewa Falls, Wisconsin, United States · placed automatically"*. Three
decisions closed the same day against real data (§6 decisions 7, 9 and 11's
trigger, plus §2.4's overflow), and `IN25` turned out to be a mislabel rather
than a gap and took a silent second bug with it.

**The count band refused runs twice on 2026-08-13, once on each bound, and is
now fixed at the design level: it is two absolute constants and reads no history
at all.** See the count band section below for the measurements behind the
numbers and for the one number that would have made it a permanent outage.
**The map is live again** — the 02:46 UTC run published 30,316 groups via the
relax valve, confirming the diagnosis — and **the fix is now on `main`**
(`2501d21`, pushed 02:51 UTC, five minutes after that run). So the 02:46 run is
the last one on the old code, and the **next scheduled run (~06:46 UTC) is the
first test of the absolute band in production**.

**Two things fired on that same run and both want attention before new work:**
§2.4's overflow passed the ~50% line this document had set as its revisit
trigger (**56%**, 16,951 of 30,316), and a second unknown FIPS code appeared
(`WQ`, 6 stories). Both are written up where the rule that governs them lives.
**Evidence base:** `spikes/gdelt/FINDINGS.md` — every number in this document is
measured, not assumed.

---

## START HERE

**Phase 6 has started ahead of Phase 4 finishing, deliberately.** Phase 4's
remaining items were **deferred by decision on 2026-08-14** — the phone profile
needs hardware, and the accuracy re-measurement was closed as optional once the
weak-city rule was settled. **`/about` is live.** The one Phase 4 item still
genuinely open and unblocked is **§2.4's overflow re-read**, below.

**Next action: finish Phase 4.** The pipeline is closed end to end — `worker/run.ts`
runs the §3.2 flow 4-hourly under `.github/workflows/worker.yml` and publishes a
content-hashed archive to Blob; `components/MapView.tsx` reads `manifest.json` to
find it. **Nothing in the repo pins the story data any more** —
`public/stories.pmtiles` is deleted and `*.pmtiles` is ignored, so the map moves
without a deploy.

**Phase 4, done so far:**

- **Both layers styled** (`lib/layers.ts`). Radius reads salience; the stops are
  where the measured distribution actually varies (p50 0.693, max 4.357 — half
  of all stories sit at exactly one domain), not evenly spaced. Containers draw
  as hollow rings, pins solid. Headlines are a symbol layer from z4 with
  `text-allow-overlap: false` and `symbol-sort-key` from salience, added
  **below the basemap's place labels** — see the collision measurement below
  before moving it.
- **The §2.2 red click-outline**, with `scripts/build-boundaries.ts` and a
  committed `public/boundaries.pmtiles`. Read that script's header before
  touching it: the FIPS join is the only hard part and it is §3.4 all over again.
- **A dev-only `window.__sonderMap` seam**, stripped from production builds
  (verified: 0 occurrences in `.next/static`).
- **The geotag-confidence treatment** (§5.2 decision 3), in both halves: the
  hollow container ring above, and the popup's placement line (`lib/popup.ts`).
  The pin half is uniform because grading it was measured and refused — see
  below, and do not re-derive the graded version from the out-of-sample numbers
  alone.

**§2.3 was redesigned 2026-08-13 and both halves are built.** Clicking a
**country or state label on the basemap** outlines that region red and opens a
left-side panel of its top stories. The camera does not move — that is a change
from the original §2.3, made deliberately. See §2.3 for the rule and for the
three measurements that shaped it.

The panel's data is a **published per-region index**, `archives/regions-<hash>.json`,
written by `worker/regions.ts` and pointed at by the manifest's `regionsUrl`.
**It could not be queried from the tiles**: the §2.4 budget bakes deferred
stories into higher-zoom tiles, so a country's tile at world zoom does not
contain them, and a panel built on `queryRenderedFeatures` would call one floor
pin "Pakistan's top stories".

**Verified published, 2026-08-13 10:08 UTC**, by a full local run:

```
  panel        449 regions indexed, 1685 rows
  449 keys = 163 countries + 286 adm1,  465 KB raw / 151 KB gzipped
  282 bytes per row;  USCA carries its 10
```

> **The payload is going to grow, and it is worth watching.** Those 286 admin-1
> keys come from **one run's** articles — every shard written before `adm1`
> existed contributes none. As the window turns over, adm1 coverage rises to the
> whole pool, and 24 hours of it could plausibly reach ~1,500 keys and ~5,000
> rows, which at 282 bytes/row is roughly **500 KB gzipped**. That is a lot to
> hand a phone (§1) for a panel.
>
> Do not pre-optimise it — **read the `panel` line on a full-window run first.**
> If it does need trimming, the cheapest cut is `place`: it is the longest field
> and it is nearly redundant in a state panel, where the user just clicked the
> state. Lowering `REGION_TOP_N` for adm1 keys only is the next cheapest.

**§2.3's client half is built, 2026-08-13**, and verified in a browser against
the live archive before it was committed. `lib/labels.ts` decides which rendered
feature is a place label and at what level; `lib/regions.ts` fetches the index;
`components/RegionPanel.tsx` renders it; `MapView.tsx` wires the gesture. What
was verified, by driving the real map:

```
  country label -> KZ outlined, panel lists its real stories, camera unmoved
  state label   -> USTN outlined, Tennessee's stories, at z5
  pin click     -> wins the tap, closes the panel, draws its own outline
  ocean click   -> clears outline, panel and popup
  Global        -> [0,20] z2, nothing selected
  390x844       -> panel and outline both usable on a phone
```

Four things that only appeared once it was running, all of them now decided:

- **Our headlines were deleting the basemap's place labels — up to two thirds of
  them.** MapLibre resolves symbol collisions from the TOP layer down, so the
  headline layer, appended last, claimed its space before MapTiler's
  `state_label` and `country_label` and they simply did not draw. Measured over
  the US at z5: **2 place labels with the headline layer visible, 6 with it
  hidden**; z6 3 against 4; India z5 7 against 9. That is §2.3's clickable
  target disappearing *worst where the news is densest*. Fixed by inserting the
  headline layer **below** the basemap's first place-label layer
  (`firstPlaceLabelLayerId`), which re-measured at 6/6, 4/4 and 9/9 — zero
  suppression — while the headlines still draw. **The two circle layers stay on
  top**: a pin is the data, and circles do not participate in symbol collision
  anyway. A place name may now draw over a headline, which is the price.
- **A container click clears a region lock**, which is the question step 3 left
  open. One outline, one panel: a container outline drawn while a region outline
  was still up leaves the user unable to say what is selected.
- **The panel heading reads `name:en`, not `name`.** MapTiler writes `name` in
  the local script, so Kazakhstan headed the panel as "Қазақстан". Nothing joins
  on either — the id still comes from the boundary hit-test — this is display
  only.
- **`lib/layers.ts` contained a literal NUL byte** in `MATCH_NOTHING`, which made
  **git treat the whole file as binary and show no diff for it**, in a repo whose
  history is supposed to read as the build log (§0). Replaced with the empty
  string, which `build-boundaries.ts` can never emit (`if (!id) continue`).

**The geotag-confidence treatment is complete, 2026-08-13**, and the measurement
that shaped it is the interesting half. §5.2 decision 3 asks for a treatment
because pins measured 69.7% [52.7, 82.6]; the container half was already the
hollow ring. Before building the pin half, the question was whether it could be
**graded** — whether anything the pipeline knows separates a shaky pin from a
sound one. The only candidate available at render time is how many times the
placed location was mentioned, and **it does not survive a second sample**:

```
                       mentioned once        mentioned 2+        Fisher
  out-of-sample (60)   n= 6  33.3%           n=27  77.8%         p=0.053
  transferred  (110)   n=12  58.3%           n=28  64.3%         p=0.736
  pooled               n=18  50.0%           n=55  70.9%         p=0.152
```

The first row is a signal worth building on and it rests on **six pins**. The
second row is the same comparison on a larger sample and it is flat. FINDINGS
§9.1 has the method — the rule-S draw contributes the 40 records where rule H
picks the identical pin, so the judge's verdict transfers — and
`spikes/gdelt/pin-confidence.mjs` re-runs it.

**So the treatment is uniform, and textual.** A uniform *visual* treatment
carries no information: the container ring reads as a lesser claim only because
it contrasts with pins, and a halo on every pin has nothing to contrast with,
while costing a third circle layer of overdraw on a phone (§1). The popup instead
**names the place the rule picked and says a rule picked it** — "Somewhere in
Wyoming, United States · placed automatically" for a container, the place name
alone for a pin. `place` was already in the tile properties and unused in the
browser, so the payload was already paid for. It makes the claim falsifiable at a
glance, which is the point: verifying this in a browser turned up a Brilliant
Earth earnings story pinned at "Beverly Hills, Texas" and an American
Conservative piece about the NYT sitting in Wyoming, both now visibly labelled as
guesses rather than silently presented as facts.

That work moved the popup's HTML out of `MapView.tsx` into **`lib/popup.ts`**,
where §2.6 (title, source, link, never article text) is asserted by
`popup.test.ts` instead of reviewed — which closes **§7 critical gap 2**. The
number itself stays Phase 6's job: §5.2 decision 3 puts "publish the accuracy and
the method" on the About page — now **68.1% [53.8, 79.6]**, the independently
judged figure — and an interval repeated in every popup would be noise.

**Phase 4, remaining:**

1. ~~**Push the count band fix.**~~ **Done 2026-08-14 02:51 UTC** (`2501d21`,
   `c81f047`). The relax cycle is broken; the 8-hourly valve is no longer the
   only path to publication. **Watch the ~06:46 UTC run** — it is the first one
   the absolute band `[2000, 60000]` actually gates, and the thing to confirm is
   that it publishes *without* a relax `WARN` in the log. A `WARN` there would
   mean the band is still refusing and the diagnosis was incomplete.
2. **Profile on a real mid-tier phone** — **deferred 2026-08-14, by decision.**
   It needs hardware nothing in this repo can stand in for, and it was blocking
   work that does not actually depend on it. It is still the thing that gates
   raising `K` (below), so **the overflow revisit may look at the number but must
   not change `K` until this is done.** Deferred is not cancelled: §9's
   <2.5s-on-4G target is unverified on real hardware until someone runs it.
3. **Revisit §2.4's overflow**, whose ~50% trigger fired at 56% and read **57.3%
   again on 2026-08-14 05:46 UTC** (19,344 of 33,778) on a nearly-full window.
   Some of the rise from 14% -> 34% -> 56% -> 57.3% is the pool filling, which is
   the budget working, and the flattening across the last two readings is the
   first sign of that.

   > **The weak-city DROP moved this number and nobody has re-read it.** ~30% of
   > pins stop being published, so the pool the budget defers from is smaller and
   > the overflow share should fall on its own. **Both readings so far are
   > pre-rule** — the rule landed ~08:14 UTC — so the first informative run is
   > ~09:46 UTC. Read the *share*, not the count, before deciding anything about
   > `K`: the count falls either way.
4. ~~**Draw a fresh judged sample against the new placement rule.**~~ **Closed
   2026-08-14 — the rule is settled and this is no longer a gate.** The draw was
   taken and is on disk if it is ever wanted (`zcbaks-d7b665-90`: 90 records,
   41 pins / 49 containers, disjoint from the 260 already judged, sheet at
   `build/judge.html`). It verified the rule is live in the published population:
   **0 lone-mention pins**, and tie-broken pins down to 9.8% (4 of 41) from the
   15.5% that motivated the rule. §5.1's bands and the About page stand on 68.1%,
   labelled as measured before the rule.

   > The previous draw is archived as `audit_sample_judge_c29ce.jsonl` rather
   > than overwritten, because `draw-judge-sample.ts` writes a fixed filename and
   > reads every `audit_*.jsonl` to build its exclusion set. Overwriting it would
   > have silently let a later draw re-sample the 90 URLs already judged. It is
   > still re-scorable — `--sample` reproduces 68.1% / 83.3% exactly.

~~**Then §5.2 decision 4 — the independent judge.**~~ **Done 2026-08-14**
(`judged-c29ce-90`). It held: pins 68.1% [53.8, 79.6], containers 83.3%
[68.1, 92.1], no threshold fires, and the pins' lower bound went *up* on the
bigger sample — 52.7% on n=33 to 53.8% on n=47. Phase 4's gate is open. The
draw also paid for the weak-city DROP; both are written up below.

**`IN25` is fixed, 2026-08-13, and it was not a missing polygon.** Natural Earth
writes `fips: IN22` on **Tamil Nadu** — and on **Puducherry**, which is the code
FIPS 10-4 actually assigns to Puducherry. GDELT emits **`IN25` for Tamil Nadu, 80
mentions across the 12 committed GKG bundles**, never `IN22`. So NE contradicts
itself and GDELT is unambiguous, which is what made this a correction rather than
the §3.4 guess the plan was right to refuse.

It was costing **two** bugs. `IN25` drew nothing — the known one — and a
**Puducherry** container silently outlined *the whole of Tamil Nadu* along with
it, because both polygons answered to `IN22`. Fixed by `ADM1_FIPS_OVERRIDES` in
`scripts/build-boundaries.ts`; both verified in a browser afterwards.

> **Natural Earth's `fips` is not a unique key, and the build now says so.**
> 187 codes are carried by more than one admin-1 feature. Most are harmless — NE
> splits a region into provinces that each carry the parent's code and together
> compose it, which is what you want. The ones that are not harmless **cross a
> border**, and `regionOutlines` now logs those loudly: **16 of them, 15 in the
> Balkans** where NE's fips column is stale about Kosovo, Serbia, Montenegro and
> North Macedonia, plus `ID28` (Indonesian Maluku against Timorese Lautém).
> **Only one is reachable from real data** — `AE02`, Ajman against two Omani
> governorates — so this is a warning, not a fix. Do not "fix" the other 15
> without evidence from both sides, which is the rule that made `IN-TN` legal.

**The `panel` payload is measured, 2026-08-13, against the live archive** — the
item that was waiting on a full-window run. It has more than doubled:

```
  was  (10:08)   449 keys = 163 countries + 286 adm1   465 KB raw / 151 KB gz
  now  (13:48)   903 keys = 191 countries + 712 adm1  1069 KB raw / 328 KB gz
                 3,817 rows, 287 bytes per row
```

That is squarely on the projected trajectory toward ~500 KB, and adm1 coverage is
still filling. **The two cheap cuts the plan proposed are now measured, and both
are too small to matter**: capping adm1 at 5 rows instead of 10 saves 60 KB
(328 → 268), and dropping `place` entirely saves 27 KB (328 → 301). The cost
structure is 287 bytes × 3,817 rows, and the rows are title, source and url —
the three things §2.6 says a row *is*.

> **So the cut order is settled and it is not `place`.** Trim `REGION_TOP_N` for
> adm1 keys first; `place` last, and reluctantly, because since 2026-08-13 naming
> the place is the geotag-confidence treatment (§5.2 decision 3) and the panel
> would be saying less than the popup for 8% of the payload.
>
> **The real lever, when it binds, is architectural**: the panel needs *one*
> region and downloads all 903. A per-region key would make it a ~3 KB fetch, at
> the cost of many small Blob writes per run instead of one. **Do not build it
> yet** — the index is lazy, fetched on first panel open and not at load, so it
> costs nothing against §9's first-paint target. Revisit when it clears ~500 KB
> or when a phone profile says the panel is slow to open.

~~**Still outstanding and only the human can do it:** §5.2 decision 4.~~
**Discharged 2026-08-14** — see "The independent judge came back" below. The
weakest link in the evidence is now the strongest: an independent judge, on a
fresh draw, disjoint from every previously judged URL, reproduced the numbers
this project has been quoting.

**The accuracy percentage is a gate, not the product. `explainPlacement()` is
the part that makes the map better** — added 2026-08-14. `placeStory()` is eight
branches over a handful of mention counts, so every placement it has ever made is
explainable from its inputs; it just did not say so. `{kind, location}` cannot
distinguish a story with a real dominant place from one where GDELT scattered
single mentions and the rule confidently picked whichever came first.

**The trace is the implementation and `placeStory()` reads its answer off it.**
A separate explainer walking the same logic is a second implementation that
drifts, and it would drift silently because nothing downstream compares them.
A test asserts they agree on every case in the file.

**Why it was built: the 15 wrong rule-H placements are five mechanisms, not
two.** The judged files record `failure` as `region` or `noplace`, which is too
coarse to act on. Read by hand:

```
  class                                        pins   fixable in place.ts
  1  story has no place; all locations x1        3    yes — no weak-winner DROP exists
  2  most-mentioned != what it is about          3    yes — Knockhill lost 4-2 to Thruxton
  4  GDELT geocoded a non-place                  3    no  — "Dharma", "Black Sea, Oceans"
  5  headline's location never extracted         1    no
```

Classes 4 and 5 are upstream of this project and **cap what any rule can reach:
4 of 10 pin failures are unreachable, so the ceiling is ~88%, not 100%.** The
other 6 are addressable, and class 1 alone would move pins 69.7% -> ~79% if every
one of them is genuinely a story with no place.

**`npm run place:audit` sizes each class against the whole feed.** First reading,
2 bundles / 1,173 filtered articles:

```
  branch              share      suspicious shape        of pins
  city-survives       51.2%      lone-mention             29.5%
  country-dominates   14.7%      tie-broken               15.5%
  country-only        11.9%      narrow-win               15.5%
  adm1-dominates      10.8%      margin-near-miss          5.8%
  adm1-only            8.8%      runaway-country           0.0% (containers only, 4.9%)
```

> **Frequency is not accuracy, and conflating them is a mistake this project has
> already made.** The script measures *mechanism* — nothing in it knows whether a
> placement is right, which only a human reading the headline does (§5.1). Mention
> count looked like it graded pin confidence on six records (p=0.053) and went
> flat on 110 (p=0.736), and `lone-mention` is the same signal wearing a
> different hat. **Do not turn a shape into a DROP rule without a judged sample.**
>
> What the two halves do together is size the prize: if `lone-mention` pins really
> are ~40% correct against ~82% for the rest — the hand-audit reading, on **ten
> records**, so barely evidence — then a shape carrying **29.5% of all pins** is
> most of the error budget. That is worth measuring properly and is not worth
> acting on yet.

**So the independent judge sample should do double duty.** Add one field: when
the judge marks WRONG, they pick a reason from a fixed list. One extra click,
and 90 records yield ~35 classified failures against the 15 self-classified ones
above — enough to say whether class 1 is real before anyone writes the rule.

> **It did, and the prediction held: 36.4% against 77.8%**, versus the ~40%/~82%
> guessed above on ten records. `lone-mention` pins are now DROPped (see below).
> The table above is the last reading of the old rule; `city-survives` 51.2%
> splits into 33.9% pins and 14.7% `weak-city` drops under the new one.

### The judging sheet is built, 2026-08-14 — §5.2 decision 4 is now unblocked

```
  npm run judge:draw  -- 90 --bundles 6      -> build/judge.html   (send this)
  npm run judge:score -- judged-<draw>.jsonl -> accuracy + §5.1 verdict
```

A first draw is committed: **90 records, 50 pins / 40 containers, seed 20260814**,
drawn from 3,379 placed and disjoint from all 170 previously judged URLs.
`build/judge.html` is a single self-contained file — no server, no install, works
offline, autosaves to `localStorage`, and downloads a JSONL at the end.

**Four things about the sheet are methodological, not cosmetic.** Undo any of
them and the draw stops being comparable with the one it is checking:

1. **It shows the headline, the source and the placement. Nothing else.** No
   trace, no branch, no mention counts, and above all **not the 69.7%**.
   Anchoring is the exact failure a second judge exists to rule out, and it is
   free to prevent here. Verified mechanically: the generated file contains four
   fields per record and none of the trace.
2. **There is no link to the article.** §5.1's method is *"judged by reading the
   headline against the placement"*, and UNJUDGEABLE is a real verdict for
   headlines that do not say enough — it was 1 of 34 pins last time. A judge who
   can open the article never marks UNJUDGEABLE, which silently changes the
   denominator. The URL is in the JSONL and deliberately not on screen.
3. **Containers are put as "Somewhere in X"**, mirroring `lib/popup.ts`. Judging
   a container as though it claimed an exact spot scores it against a claim the
   map never made (§2.2).
4. **The reason is only asked after the verdict is already WRONG**, so it cannot
   move the accuracy number.

**The scorer hardcodes §5.1's thresholds and reads them off the lower bound.**
That looks stricter than §5.1's tables, which are stated on the point estimate,
and is exactly equivalent: the lower bound is never above the point estimate, so
the only case they land in different bands is the straddle — where §5.1 already
mandates the lower bound. **Do not edit those constants to fit a result.**

> **Its Wilson implementation reproduces all four published intervals exactly**
> — rule-H pins 23/33 → [52.7, 82.6], containers 21/26 → [62.1, 91.5], rule-S
> 33/61 → [41.7, 66.0] and 15/40 → [24.2, 53.0]. That is the check worth having:
> the arithmetic that will decide whether this project ships is the same
> arithmetic that produced the numbers already in this document.

**What is still yours and cannot be automated:** find the judge, and settle the
pre-registration *before* they start. The recommendation on record is that the
judge's number is the number — not pooled with the existing one, not averaged,
and no adjudication round afterwards. 90 records was chosen so that a held point
estimate moves the lower bound from 52.7% to ~56%; the current margin above the
50% kill line is **one record**.

**Also worth knowing:** `no-locations` and `no-usable-level` never appear in the
audit output because `filterArticles` removes those articles first. `all-demonyms`
runs at 2.6%, which is the demonym filter's visible cost and looks right against
§2.1's measured 11.9% of *mentions*.

---

## THE INDEPENDENT JUDGE CAME BACK — 2026-08-14, §5.2 decision 4 discharged

**Rule H holds, judged by someone who did not design it, on a draw disjoint from
every record ever used to build it.** `judged-c29ce-90`, scored by
`npm run judge:score`:

| level | judgeable | correct | accuracy | 95% Wilson | §5.1 says |
|---|---|---|---|---|---|
| **PIN** | 47 | 32 | **68.1%** | [53.8, 79.6] | proceed, About page states the number |
| **CONTAINER** | 36 | 30 | **83.3%** | [68.1, 92.1] | containers ship as specified (§2.2) |

7 of 90 were UNJUDGEABLE (6 pins, 1 container), excluded from the denominators
and reported here per §5.1. Nothing fires. Containers clear their 60% line on the
*lower* bound, so `FINDINGS` §6 path 1 — the container amputation — is off the
table.

**The number that matters is not 68.1%, it is 53.8%.** §5.1's tie-break is the
lower bound, the kill line is 50%, and the margin was 2.7 points on n=33 — one
record either way. On n=47, judged independently, the margin went **up** to 3.8
points. The margin widening on a bigger sample judged by a different person is
the outcome that was never guaranteed and is the whole reason decision 4 existed.

**There is no detectable judge effect.** Self-scored was 69.7% / 80.8%;
independent is 68.1% / 83.3%. Fisher exact on the pins gives p=0.29 — the two
draws are indistinguishable. The weakest link in the evidence chain, that the
same party designed rule H and scored it, is now closed.

**The disclosure stays.** 68.1% is in §5.1's 50-70% band, so the About page still
carries the measured accuracy and its interval (§5.2 decision 3). The weak-city
rule below projects 77.8% but a projection is not a measurement, and the number
on the page must be one that was judged.

### The weak-city DROP — the first rule this project bought with a judged sample

**A city mentioned once is not a place, it is noise that arrived first.** The
judged draw split pins on exactly that:

| pins | n | correct | accuracy |
|---|---|---|---|
| city mentioned **once** | 11 | 4 | **36.4%** |
| city mentioned 2+ | 36 | 28 | **77.8%** [61.9, 88.3] |

Fisher exact **p=0.023**. The hand audit had guessed ~40% against ~82% off ten
records; this is that prediction confirmed out of sample, which is a thing this
document has not been able to say before.

`place.ts` now DROPs them, with reason `weak-city`. **Three scoping decisions,
each measured rather than preferred:**

1. **It fires last, after both dominance margins.** A weak city beside a
   dominant region or country is still a container, exactly as before. Those
   placements were judged and liked; a drop rule may only take away pins it has
   evidence about.
2. **Cities only.** The identical shape at container level scored **85.7%
   (n=7)** — *better* than containers overall. `winnerMentions === 1` is a pin
   pathology, not a general one, and this is the reason the naive version of this
   rule (drop every lone-mention placement) would have destroyed good data.
3. **DROP, not fall through to the container.** Fall-through preserves volume and
   was the obvious alternative, so it was checked against the actual records:
   it would have produced `Praia, Cape Verde -> Germany x2`,
   `Dublin -> United Kingdom x2`, `Canberra -> Singapore x2`. A country mentioned
   twice under a one-mention city is the same noise one level up. Fall-through
   moves the error from the pin number into the container number rather than
   removing it, and it would have done so invisibly.

**Measured cost, on 1,397 filtered articles after the change:**

```
  branch              share        suspicious shape        of pins
  city-survives       33.9%        lone-mention             0.0%  (was 29.5%)
  country-dominates   20.7%        tie-broken               3.6%  (was 15.5%)
  country-only        15.2%        narrow-win              26.4%
  weak-city           14.7%  <--   margin-near-miss        11.8%
  adm1-dominates       7.2%        runaway-country          0.0%
  adm1-only            5.7%
```

`weak-city` at 14.7% of records is **30.2% of what used to be pins** (205 dropped
against 473 kept) — the 29.5% `place:audit` predicted before the rule existed.
Steady state ~40,700 groups/day becomes roughly 34,700, far inside the count
band's `[2000, 60000]`, so no invariant fires and nothing about this is
self-concealing.

**`lone-mention`'s pins column must read 0.0% for ever.** The shape is kept in
`place:audit` as a standing regression check rather than deleted: if it comes
back, the rule was reordered or bypassed, and that is the cheapest possible
signal. Its remaining 11.6% are containers, where the shape is fine.

**`tie-broken` was not implemented and mostly evaporated anyway.** It looked
similar on the same draw (44.4%, n=9) but n=9 is what §5.2 decision 3 looked like
immediately before it went flat on 110. It also fell from 15.5% of pins to 3.6%
when weak-city landed — a tie at one mention was the same population seen twice.
What remains is 17 pins in 1,397 records and it needs its own draw, not a rule.

### The draw ids were a trap, and it very nearly fired — fixed the same day

**Scoring the real verdicts against the stale sample returns KILL CONTAINERS.**
`audit_sample_judge.jsonl` was committed in `98fac58` and then **re-drawn** before
the sheet was sent. Record ids were `<seed36>-<index>`, so both draws produced
`c29ce-0` … `c29ce-89` — identical ids over completely different articles.
`score-audit.ts` joins on id, matched all 90, warned about nothing, and returns:

| sample | PIN | CONTAINER | verdict |
|---|---|---|---|
| stale (committed in `98fac58`) | 82.2% [68.7, 90.7] | 65.8% [49.9, 78.8] | **KILL CONTAINERS** |
| real (the one judged) | 68.1% [53.8, 79.6] | 83.3% [68.1, 92.1] | ship as specified |

One stale file and this project amputates a feature on a verdict that is pure
noise — and it would have looked exactly like a clean run.

**The defect: the id was derived from the seed, and the draw is not a function of
the seed.** `draw-judge-sample.ts` walks back from the newest GDELT bundle, so
`--seed 12345` means a different population every time it runs. "Reproducible
from (seed, bundles) alone" was true of the shuffle and false of the thing being
shuffled.

**The fix is `scripts/judge-draw-id.ts`**: record ids are now
`<seed36>-<fingerprint>-<index>`, where the fingerprint is a hash of the drawn
URLs in draw order, and the scorer recomputes it from the sample it was handed.
Different articles, different id, **hard refusal**. Ids from before today have no
fingerprint and cannot be verified at all, so they score with a loud WARN rather
than being rejected — the archived evidence has to stay re-scorable.

> **`judged-c29ce-90` is one of those unverifiable legacy sheets, so here is the
> provenance by hand.** `build/judge.html` — the file actually sent — is
> timestamped 2026-08-13 21:26, identical to the working-tree sample, and
> contains the Sydney Airport headline while containing no trace of the stale
> draw's `Melbourne, Victoria, Australia`. The verdicts came back at 00:39. The
> sheet was built from the sample now committed, and 68.1% / 83.3% is the real
> reading. **`spikes/gdelt/judged-c29ce-90.jsonl` is committed beside it** so the
> pair can never drift apart again.

**What is owed next: a fresh draw against the new rule.** 77.8% is the old draw
with a subset removed, not a measurement of the pipeline as it now stands, and
§5.1's bands are read off measurements. `npm run judge:draw` is built and the
thresholds are unchanged — this is the same loop, run again, and the
pre-registration that governs it is already on the page.

---

## THE COUNT BAND IS NO LONGER SELF-REFERENTIAL — fixed 2026-08-14

**The band is now two absolute constants, `[2000, 60000]` group counts, and
reads no history at all.** That is the durable fix to a guard that refused runs
twice in one day, once on each bound. The incident that forced it, and then the
fix:

```
  publish history   6718, 7145, 8095, 14360      median 7620
  old count band    [3048, 19050]                 = [0.4x, 2.5x] of the median
  growth rate       8095 (10:15) -> 14360 (13:45) = ~1,790 groups/hour
  projected 17:13   14360 + ~6,200  =  ~20,500    > 19,050, so the band refused
```

Two scheduled runs failed on that (17:13 and 21:03 UTC) and the map stopped at
13:48 UTC. `run.ts` sets `process.exitCode = 1` when nothing is published, which
is the shape of both failures.

**It was the morning's trap wearing its other face.** That one was the *lower*
bound — a median from two 1-bundle smoke runs (846, 1467) refusing a real 6,718.
This was the *upper* bound. Same defect: **a median is a lagging statistic and
the 24-hour pool has a trend in it**, so the reference set described a past that
was not comparable to the present. And a refused run does not append to history
(`publish` returns before the history write), so the median that refused a run
never moves and the next run is refused identically. **Fail-closed becomes
fail-forever.**

**Why absolute rather than a better relative statistic.** Banding against the
most recent successful run instead of the median was the obvious repair and it
was rejected: it tracks growth, but it is still a feedback loop, and it would
*still* have refused the morning's 6,718 against a 1,467 smoke run. Absolute
bounds have no feedback loop to reason about at all, and they arm on the **first
run of a fresh store**, where the old band was inert for want of
`BAND_MIN_HISTORY` entries — the exact moment a bootstrap mistake ships
unguarded.

> **Both ends are measured, and the interval between them is narrow on purpose.**
>
> ```
>   1,467   a 1-bundle smoke run (2026-08-12, BUNDLE_CAP=1)
>   2,000   FLOOR
>  40,700   steady state: §4's distinct city stories after dedup, per day
>  60,000   CEILING              = 1.47x steady state
>  75,000   grouping stops merging: ~112,500 records/day (§4)
>                                  x ~67% placed (measured: 1411 rows -> 949)
> ```
>
> The floor sits above a single-bundle run and 20x below steady state, so it
> catches a collapse and an accidental `BUNDLE_CAP` and can never false-fire.
> **The ceiling has to sit between steady state and total grouping failure or it
> is not informative**: above ~75,000 it stops catching the one failure it exists
> for, below ~50,000 it refuses ordinary days. That leaves very little room, which
> is why 60,000 rather than a rounder, safer-feeling number.
>
> **25,000 was proposed and would have been a permanent outage.** It is *below*
> steady state, and a hardcoded ceiling under steady state has no self-healing
> path whatsoever — every run refused for ever, with the 8-hour relax valve
> publishing three times a day as the only sign of life. The number that made it
> look reasonable was 14,360, which is a **mid-fill reading**, not steady state.
> Anchoring a constant on a partial window is the same mistake as banding on a
> lagging median, just frozen in place.

**The relax valve stays, and its job changed.** It was built for a
self-poisoning median. Absolute bounds cannot poison themselves, so what it now
guards is a **stale constant**: if real volume outgrows `COUNT_BAND_MAX`, nothing
self-corrects and every run is refused until a human intervenes. Same wedge,
slower fuse. So `BAND_RELAX_AFTER_MS` is the only thing between that and a dead
map, and the `WARN` it prints now says *re-derive the constants against a fresh
§4 measurement* rather than merely reporting itself.

> **These are calibration constants with a shelf life, and nothing in the
> pipeline can tell you they have expired.** A looser grouping key, GDELT raising
> its crawl rate, or widening the window past 24 hours all invalidate them
> silently. The relax `WARN` is the only tripwire. **Re-derive; do not nudge the
> ceiling up until runs pass** — that converts a guard into a formality, and
> `publish.test.ts` asserts the exact values to make the nudge visible in a diff.

**One trap found while making the change, and it was invisible.** `staleness()`
returns `Infinity` on an empty history — correct on its own terms, "nothing has
published, so nothing is protecting anything". Handed straight to the relax valve
that reads as *blocked for over 8 hours*, so **the first run of a fresh store
would have stood the band down and published any count at all.** The old
`BAND_MIN_HISTORY >= 3` gate had been covering this by accident. `publish` now
gates on `history.length > 0` and a test holds it there.

**The diagnosis was confirmed by the 02:46 UTC run, on the old code.** It
published 30,316 groups and logged exactly the predicted line:

```
  WARN   count band stood down — publication had been blocked past 2× cadence
  published archives/stories-ca70b455.pmtiles, pruned 1 archives and 3 shards
```

30,316 is far outside the old band's [3048, 19050], so nothing but the relax
valve could have let it through — the prediction was falsifiable and it held.
Worth keeping as evidence that the reasoning about this guard was sound, not
lucky. **The 00:20 UTC run never fired at all**, which is its own finding:
GitHub drops scheduled runs under load, so §6 decision 3's 4-hourly cadence is
**best-effort, not guaranteed**, and a missing run looks nothing like a failing
one in the Actions list.

> **The loop was one run from repeating, and the push is what broke it.** That
> run appended 30,316 to history, moving the old median to 11,227 and the band to
> [4490, 28068] — so the *next* run, at ~34,000, would have been refused again
> and the map would have waited another 8 hours. The fix landed on `main` at
> **02:51 UTC**, five minutes after that run and ~4 hours before the next one, so
> the ~34,000 reading is gated by `[2000, 60000]` instead and should pass
> outright. **That is a falsifiable prediction; check the 06:46 run's log for the
> absence of the relax `WARN`.**

**The prediction held. Read 2026-08-14, and this is the band's first production
test.** The scheduled run was 05:46 UTC, not the 06:46 this document guessed —
cadence is best-effort, as above — and it published clean:

```
  groups       33778 groups, 615 tier-1, 220 country-top, 19344 overflow
  published    archives/stories-c27562b8.pmtiles, pruned 1 archives and 0 shards
```

No relax `WARN`, so **the band passed the count on its own bounds rather than
standing down** — which is the whole claim, since a relax line would have meant
it was still refusing. 33,778 also lands between the 30,316 reading and the
~38-41k projection, so the deceleration curve above is holding too. The only
`WARN` in that run is the known `WQ` FIPS code, now down to 1 story.

> **This run is still on the old placement code.** Weak-city landed on `main` at
> ~08:14 UTC, after it. So 33,778 is a pre-rule count, and the first post-rule
> run is the next one (~09:46 UTC). Expect the group count to *fall* — do not
> read that fall as the band drifting.

**The 30,316 reading validates the ceiling.** It is the first measurement taken
against the new constants and it lands where the calibration said it would:

```
  14,360  (13:45)  ->  30,316  (02:45)   = ~1,227 groups/hour
  decelerating from ~1,790/hour earlier, as the oldest shards begin expiring
  window fills ~09:11 UTC  ->  projects to ~38,000
  §4's independent measurement            ~40,700
  COUNT_BAND_MAX                           60,000   = ~1.5x steady state
```

Two independent routes to ~38-41k against a 60,000 ceiling. **That is the margin
the constant was chosen for, and it is now measured rather than projected.**
Re-check on the first genuinely full-window run (after ~09:11 UTC): if it reads
above ~50,000 the ceiling wants re-deriving, not nudging.

**3G, verified in a browser on 2026-08-12.** Four checks, all against the live
Blob archive rather than a build:

- Real pins render from the remote archive, and are **unchanged after deleting
  `public/stories.pmtiles`** — which is what proves the local file was not what
  was drawing.
- Clicking a pin opens the §2.6 link-out popup with real GDELT content.
- The freshness stamp reads the manifest ("Updated 40 minutes ago").
- A 404 manifest shows one notice and no map, instead of an empty world
  (§7 critical gap 3). `FreshnessStamp` stays silent on that path on purpose:
  two notices for one failure is worse than one.

**A silent-failure trap found while verifying 3G, worth keeping.** MapLibre
**does not error on an unknown `source-layer`.** A layer pointed at
`"country-topXX"` produced no error event, no console error and no notice — it
just quietly drew nothing. So "the console is clean" is NOT evidence that a layer
is wired to real data, and this is the §11 failure mode wearing a new hat. What
actually proved it was isolating each layer (breaking the other's name) and
counting: `country-top` alone drew exactly one pin per country and vanished above
z4. Use that method, not the console, when a layer looks empty.

The two layers **overlap** by design — a group can be in both — so `country-top`
carries `maxzoom: 4` and is added *first*, so `stories` paints over it. Remove
either half and the low-zoom double-draw comes back.

**How to drive the map from a headless browser, which is what verified §2.3.**
Guessing pixel coordinates does not work — a label is wherever the collision
solver put it. Ask the map instead, through the dev-only `window.__sonderMap`
seam, and synthesize the click at the feature's own projected position:

```js
const label = map.queryRenderedFeatures().find(
  (f) => f.sourceLayer === "country_label" && f.properties["name:en"] === "Kazakhstan");
const p = map.project(label.geometry.coordinates);
const rect = map.getCanvas().getBoundingClientRect();
const opts = { bubbles: true, clientX: rect.left + p.x, clientY: rect.top + p.y, button: 0 };
for (const t of ["mousedown", "mouseup", "click"]) map.getCanvas().dispatchEvent(new MouseEvent(t, opts));
```

MapLibre listens on the canvas, so a synthetic event drives the real handler.
Then read the *result* out of the map rather than off a screenshot —
`map.getFilter("country-outline")` says exactly which region is outlined, and
`document.querySelector(".panel h2")` says what the panel thinks it is showing.
Three things this needs to be usable: **wait ~4s after any `jumpTo`** before
querying, because labels are placed asynchronously and an immediate query
returns `undefined`; the seam is **dev-only** (`NODE_ENV`), so this works
against `next dev` and not against a production build; and `queryRenderedFeatures`
with no arguments returns the basemap's features too, which is the whole reason
the gesture is possible.

**Toggling a layer's `visibility` is how you measure what it costs.** Counting
place labels with `stories-labels` visible and then hidden is what turned "the
labels look sparse" into "2 of 6, and here is the fix" — the same isolate-and-count
method as the `country-top` trap above.

**Verify in a browser before claiming it works.** §11 is unambiguous: this
project has been committed green and rendered nothing, twice. `npm run build`
passing is not evidence.

**The first real end-to-end run, 2026-08-12** (one bundle, `BUNDLE_CAP=1`), is
the number to compare future runs against:

```
  1411 rows -> 159 blocklisted, 274 unplaceable -> 949 placed, 29 dropped
  pool 1993 from 6 shards -> 1467 groups, 17 tier-1, 91 country-top
  published archives/stories-<hash>.pmtiles, 91 countries
```

Two things that run surfaced, neither a bug:

- **`overflow` was 204 of 1467.** Those are groups whose `minzoom` landed above
  z12, so they are in the pipeline and not on the map. That is the §2.4 budget
  doing its job, but it is worth watching: if it climbs toward a majority, `k`
  or the zoom ceiling (§6 decision 1) wants revisiting rather than the budget.

  > **It climbed. Measured 2026-08-13 on a full window: 2,453 of 7,145 — 34%,
  > up from 14%.** The window filling is exactly when this was expected to grow,
  > so it is not yet a fault, but it is a third of the feed unreachable at any
  > zoom and it is heading toward the majority that §6 decision 1 says to act
  > on. §2.3's region panel now reaches those stories, which softens the symptom
  > and does nothing about the cause — do not let it become the reason this is
  > never revisited.
  >
  > **DECIDED 2026-08-13: accept it. Overflow is the budget working, not a
  > defect, and the panel is the reachability mechanism.** Two things settle it.
  > First, **the zoom ceiling cannot help**: GDELT gives city centroids, so every
  > Chicago story shares one coordinate (§6 decision 1) and deferred stories at
  > the same point do not separate however far you zoom. Raising z12 buys
  > nothing. That leaves `K` as the only lever that puts these on the *map*, and
  > `K` is exactly what sets the ~30-60 pins §9 requires — so surfacing them
  > costs the readability the budget exists to protect.
  >
  > Second, and this is the product answer rather than the mechanical one:
  > **the map is meant to show the most salient stories, not all of them.** A
  > feed of 42,000 groups a day was never going to be a map. Exclusion is the
  > feature. The warning above still stands as written — do not let the panel
  > excuse a *broken* budget — but "a third of the feed is not on the map" is
  > not by itself evidence of one. **Revisit if overflow passes ~50%**, which
  > would mean the budget is deferring stories a reader would call top-of-mind.
  >
  > > **IT PASSED 50%, 2026-08-14 02:46 UTC: 16,951 of 30,316 — 56%.** The
  > > trigger this document set one day earlier has fired, and the rule (§0 rule
  > > 8) is that a fired criterion gets honoured rather than reasoned away. **This
  > > is the next thing to look at after the band fix lands.**
  > >
  > > **Every reading below predates the density fix and none of them measured
  > > the map.** The budget's `minzoom` was never applied to a published archive
  > > until 2026-08-14 (see §2.4), so "overflow" counted stories the budget meant
  > > to defer while every one of them stayed on screen. **Do not act on these
  > > numbers.** The first archive built after the fix is the first real reading,
  > > and it is also the first run on the weak-city rule — two changes at once, so
  > > attribute carefully.
  > >
  > > **Second reading, 05:46 UTC: 19,344 of 33,778 — 57.3%.** Still over the
  > > line, and now on a nearly-full window, so this is not simply the pool
  > > filling. But it is **still pre-weak-city** — the rule landed at ~08:14 UTC,
  > > after this run — so it does not answer the question below. The first
  > > post-rule run is ~09:46 UTC, and the number to read there is the *share*,
  > > not the count: fewer published pins shrinks both sides of the fraction, and
  > > only a falling share means the rule bought the budget any room.
  > >
  > > Read the trend before acting on it: 14% -> 34% -> 56% -> 57.3% over four
  > > measurements, while the 24-hour pool went from a third full to nearly full.
  > > **The flattening between the last two is the signal to watch** — it is the
  > > first evidence that the rise was the window filling rather than a defect,
  > > but two readings four hours apart are not a steady state.
  > > **Some of that rise is the window filling and is not a defect** — more
  > > stories competing for the same K slots is the budget working. The question
  > > the revisit has to answer is whether it *keeps* climbing once the pool is
  > > genuinely steady (after ~09:11 UTC), because a majority-deferred feed at
  > > steady state is what the 50% line was drawn to catch.
  > >
  > > **The lever is `K`, and the ceiling still cannot help** — that half of the
  > > decision was settled by measurement and does not need redoing: GDELT gives
  > > city centroids, so deferred stories at one coordinate do not separate at any
  > > zoom. Raising `K` costs the ~30-60 pins §9 requires and the readability the
  > > budget exists to protect, so this is a real trade and not a bug fix. **Do
  > > not raise `K` before a phone profile** (the other outstanding Phase 4 item),
  > > because the profile is what says how much room there is.
- **`unknown FIPS code TL on 1 stories`.** §8's loud-log path, working. It is
  deliberately NOT fixed: FIPS 10-4 `TL` is **Tokelau**, while ISO `TL` is
  **Timor-Leste**, and guessing which one GDELT meant is exactly the §3.4 trap
  that put Russian news in Serbia. One story is not worth a wrong override;
  check a real GDELT record before adding one to `data/fips-overrides.json`.

  > **A second one appeared on 2026-08-14: `unknown FIPS code WQ on 6 stories`.**
  > Same treatment, same reasoning — FIPS 10-4 `WQ` is **Wake Island**, which
  > plausibly has no news at all, so six stories pointing at it is more likely a
  > GDELT quirk than a missing polygon. **Do not add an override without checking
  > a real record**, which is the rule that made `IN-TN` legal and kept `TL` out.
  > That two of these have now surfaced from live data is the loud-log path
  > earning its keep, not a backlog to clear.
  >
  > > **Checked, 2026-08-14, and the rule paid for itself: do NOT add an
  > > override.** 60 bundles (67,837 articles, ~15 hours) contain **14 locations
  > > tagged `WQ`**, all one place — `Wake Island, type 1, country WQ`. The
  > > stories are the finding:
  > >
  > > ```
  > >   12 of 14   "Battlefield 6 Suits Up ... Official Top Gun Collaboration
  > >               Trailer"  — one syndicated piece across 12 Australian
  > >               radio domains (5au, 4cc, chillifm, river949, 4bu, lafm, ...)
  > >    2 of 14   USGS Volcano Notice
  > > ```
  > >
  > > **`Wake Island` is a Battlefield map name.** GDELT's geocoder is resolving
  > > a video-game level to a real atoll — the code is a *false positive*, not a
  > > gap, and no FIPS table can fix a story that was never about a place. An
  > > override would have pinned a games-trailer story to the Pacific and called
  > > it correct. This is the §3.4 trap the rule exists to catch, and it is the
  > > first time the rule has caught one rather than merely deferred it.
  > >
  > > **A second defect fell out of the same probe: the coordinates are wrong
  > > even for Wake Island.** GDELT gives `6.27435, -162.554`; Wake Island is at
  > > roughly `19.28, 166.65`. So the degraded pin does not land on the atoll it
  > > names either. Nothing here is worth code — it is 14 mentions collapsing to
  > > ~1 group — but **do not "fix" `WQ` later on the strength of the name
  > > alone**, and note that syndication is why the count reads 6 stories one run
  > > and 1 the next.
  > >
  > > Reproduce with the scratch probe pattern: fetch N bundles, print every
  > > location whose `countryCode` or `adm1Code` matches the code, grouped by
  > > name and coordinates. The count is ~1 in 4,800 articles, so 12 bundles
  > > finds nothing and is not evidence of absence.

Phase 2.5 left three things Phase 3 inherited rather than reinvented:
`scripts/build-real-geojson.ts` (fetch, parse, placement in miniature),
`data/demonyms.txt` in its permanent home, and a `stories.pmtiles` built from
real data by the production tippecanoe flags. **That committed archive is gone as
of 3G** — the map now serves the worker's published archive, and the commit that
deleted it is the same one that verified the replacement in a browser first.

**The MapTiler key now appears to be domain-restricted** (§2.6), which was the
long-standing open item. Evidence, 2026-08-12: fetching the style URL with `curl`
— no `Origin`, no `Referer` — is refused with *"Key usage restricted"*, while the
same URL loads normally from the browser at `localhost:3000`. That is the
signature of a referer allowlist that includes localhost.

**Confirmed 2026-08-13: the allowlist contains the Vercel domain.** Loaded
`https://sonder-drab-eta.vercel.app/` in a browser: the style, `tiles.json`, all
three sprite pairs and the glyph ranges return **200**, the basemap draws, and
the pins draw over it. This was the last unverified item in §2.6's basemap chain.

**Done 2026-08-12:** the Blob store exists and is **public** (`BLOB_READ_WRITE_TOKEN`
in `.env.local` and in the Action secrets), and the dead-man switch is a
healthchecks.io check on a 4h period + 4h grace, so silence alerts at 2× cadence
per §8 — its ping URL is the `HEALTHCHECK_URL` Action secret. `HEALTHCHECK_URL`
is deliberately **not** in `.env.local`: a local run pinging it would tell the
switch the worker ran when it did not, which is the exact false negative the
switch exists to catch.

**The first two scheduled runs both failed, 2026-08-13, and the cause is a third
Blob trap: the Action secret held a token the store could not parse.**
`{"code":"forbidden","message":"Cannot get store id from token or header"}` on the
first shard write. The token *is* the store's identity — `vercel_blob_rw_<storeId>_<secret>`
— so a stale, truncated, or **quoted** value is a different store, not a weaker
permission. `.env.local` writes the value in quotes and `node --env-file` strips
them; GitHub stores a secret literally, so the same token works locally and 403s
in Actions. Fixed by re-pasting the value alone.

**What made that expensive is worth more than the fix.** Every read in the
pipeline swallows its own errors, and each one is right to — `lastWatermark` and
`readHistory` both have to read "not written yet" as normal on a first run. So a
dead credential sailed past the manifest read, made the run believe it had no
watermark, refetched the whole window, and died four steps later inside
`state.ts` with a bare 403 that named nothing. `assertStoreReachable()` now runs
one authenticated `list` at the top of `main()` and turns that into one line. It
is billed as an advanced operation, so it must stay **one call per run** — that
is why it is a named assertion at the entry point rather than a check folded into
`get`.

**Two Vercel Blob traps, both measured on 2026-08-12** and both recorded in
`worker/publish.ts`'s header:

1. **A Blob store's access mode is chosen at creation and cannot be changed**,
   and a *private* store delivers blobs through a Function rather than by direct
   URL. That breaks §3.2 outright — the browser range-requests the PMTiles
   archive itself. The first store was created private and had to be destroyed
   and rebuilt. If the store is ever recreated: **public, or the map does not
   work.** Region is likewise permanent.
2. **`put()` throwing on an existing pathname is an SDK-side guard, not an API
   one.** A bare REST PUT over an existing key returns 200. So the REST transport
   overwrites `manifest.json` happily, but **anyone swapping in `@vercel/blob`
   must pass `allowOverwrite: true`** or every run after the first dies at the
   manifest write, having already uploaded its archive.

**The count band nearly wedged the pipeline shut, permanently.** The first
full-window run (2026-08-13 09:11 UTC, 12 bundles) published **6,718 groups, 161
countries, 107 tier-1** — and that third history entry armed the band for the
first time, against a median of two **1-bundle smoke runs** (846, 1,467). Band
[586, 3,668]; every steady-state run from then on is several times that and
climbs further as the 24-hour pool fills.

That would have refused the next run, and **a refused run does not append to
history** — so the median never moves and the refusal repeats for ever.
Fail-closed becomes fail-forever, with the dead-man switch as the only symptom.
Two fixes landed that day, and **the first is now obsolete**:

1. **The history was reset** to the single full-window entry, so the band
   re-bootstraps from comparable runs. **Never seed the band with a smoke run**:
   a 1-bundle run and a 12-bundle run are not the same measurement, and the band
   could not tell them apart. *(Superseded 2026-08-14 — the band no longer reads
   history, so a smoke run cannot poison it and there is nothing to reset. Kept
   because the reasoning returns the moment anyone proposes a relative band
   again: the reference set has to be runs comparable to this one, and nothing in
   the pipeline knows which runs those are.)*
2. **`BAND_RELAX_AFTER_MS`** — past 8 hours (§8's 2× cadence) without a
   successful publish, the count band stands down and the run publishes, logging
   a loud `WARN`. **Only the count band relaxes.** `MIN_GROUPS`, the country
   floor and the title rate stay armed, and they are the ones that catch real
   garbage. *(Still live, guarding a different failure — see the count band
   section above.)*

**Both of that day's refusals came from the same design mistake**, and it took
two outages in twelve hours to see it: the band's reference point was the
pipeline's own history, which made it the only invariant that could poison
itself. It is now two constants. See the count band section above.

**A third Blob trap, measured while doing that: the CDN serves a stale copy of a
key you just overwrote, even at `max-age=0, s-maxage=0`.** An overwrite of
`state/publish-history.json` read back as the *old* body with
`X-Vercel-Cache: HIT, Age: 6`. At the 4-hourly cadence this never bites — the
cache is long gone. It bites the moment two runs happen minutes apart, which is
exactly what smoke-testing looks like: the second run can read the first's
pre-write manifest and history, and then reason about a watermark and a band that
are one run out of date. Add a cache-busting query when verifying a write by
hand, and do not trust a back-to-back run's view of state.

The rest of `vercelBlobStore` is now verified against the live store rather than
against the docs: stable keys, text and binary round-trips, `cache-control`
honoring `x-cache-control-max-age`, delete, and — the ones the map rests on —
`206` range responses with a correct `content-range` and `access-control-allow-origin: *`.

The MapTiler key is `NEXT_PUBLIC_`, so it ships inside the browser bundle where anyone can
read it. Domain restriction is the only thing protecting the quota, and the quota
is thinner than it looks — see the §3.1 warning.

> **Two traps, both paid for in this project already.** *Never trust a clean
> `npm run build` as evidence that the map works* — Phase 2 was committed green
> and rendered nothing, twice over (§11, 2026-08-10). And **`NEXT_PUBLIC_*` is
> inlined at build time**, so adding an env var in Vercel does nothing until the
> next build; a deploy that predates the variable must be rebuilt without the
> cache.

**Read §5.2 first.** Phase 1 ran the abort criterion and **it fired**. The project
survived because the audit found the cause — the placement rule in the spec was
the wrong rule — and the replacement clears the same thresholds. §2.1 has been
rewritten accordingly. Do not implement the old specificity-first rule; it is
recorded only as the thing that failed.

**Phase 5 (blindspot) is cut, but tier-1 is not.** The *flag* died on measurement —
tier-1 outlets are 1.05% of GDELT's stream and the wires are absent entirely, so it
fired on 98.6% of stories (§5, `FINDINGS.md` §11). The same 1% is now used the
other way round: **tier-1 stories outrank everything else in their area and stay on
the map for 48 hours.** §2.5 is the rule; do not implement tier-1 as a filter, a
badge, or a toggle.

**Do not start Phase 3** before Phase 2 and 2.5. It is the largest phase and the
point of 2.5 is to have something real on screen before disappearing into it.

**What already exists:** this file, `spikes/gdelt/FINDINGS.md` (two parts),
five Python probe scripts, the judged audit samples, the Next.js app (`app/`,
`components/MapView.tsx`, `lib/basemap.ts`), `data/demonyms.txt`, and the Phase
2.5 pipeline (`scripts/build-real-geojson.ts`, `scripts/build-tiles.sh`).
`fixtures/fake-stories.geojson` and `npm run tiles:fake` still work and are worth
keeping: they rebuild the map from eight known points with no network, which is
how you tell a rendering bug from a data bug.

---

## 0. How to work on this project

1. **This file is authoritative.** Update it when a decision changes. Do not let
   a second plan document grow somewhere else.
2. **Phase-gated.** One phase at a time. Do not scaffold future phases.
3. **Report findings, do not paper over them.** If the data is worse than
   expected, that is a finding worth surfacing loudly, not a bug to hide behind a
   fallback. *(This rule has already earned its keep twice: it killed the
   governance-pinning feature and it caught an unsourced accuracy statistic.)*
4. **Measure before building.** Every architectural claim in this file that could
   be checked, was. Keep that standard.
5. **Ask before adding dependencies.** The tree is small and justified.
6. **Commit at each verified checkpoint.** The git history should read as the
   build log.

### When you hit something this file does not cover

7. **Measure it, do not guess it.** This project has been wrong three times by
   reasoning from plausible assumptions — an unsourced accuracy statistic, a
   Natural Earth column that does not exist, and a tippecanoe flag that does not
   do what its name suggests. Each took ten minutes to check and would have cost
   days to discover in the build. If a claim can be tested against real data or a
   live endpoint, test it before writing code on top of it.
8. **A provisional decision in §6 is actionable.** Implement it as written unless
   the human says otherwise. It is marked provisional because the reasoning is
   worth revisiting, not because it is unresolved.
9. **If a decision is genuinely open and blocks you, stop and ask.** Do not pick
   a default and proceed silently. State the options and the tradeoff.
10. **Record what you learn back into this file.** A finding that only lives in a
    conversation is lost the moment that conversation ends.

### Things a fresh reader will find confusing

- **`worker/` imports use relative paths WITH a `.ts` extension**, not the `@/`
  alias the `app/` side uses. This is not a style preference. `@/` is a
  TypeScript path mapping that Next and Vitest resolve and **plain `node` does
  not**, and the worker runs under plain `node` in GitHub Actions — so an `@/`
  import anywhere in `worker/` fails at runtime while passing `tsc`, `vitest`
  and `next build`. Node also requires the explicit extension on relative
  specifiers, which is why `tsconfig.json` sets `allowImportingTsExtensions`.
  A type-only `import type` is erased and would survive either way; that is the
  trap, because the file works until someone imports a value from it.
- **`spikes/` is Python; the project is TypeScript.** Deliberate. The spike was
  throwaway exploration and Python was faster for it. The production worker is
  TypeScript per §3.1. The Python scripts stay as reproducible evidence for
  `FINDINGS.md` and as the generator for test fixtures — do not port them, and do
  not treat them as a reference implementation.
- **`spikes/gdelt/samples/` is gitignored.** The raw GKG bundles are 4-6 MB each
  and are not committed. Re-running any probe script re-downloads them.
- **§7 requires a committed test fixture that does not exist yet.** One real GKG
  bundle must be committed under `fixtures/` during Phase 3. `fixtures/` now exists
  but holds only Phase 2's eight fake points. Until the real bundle lands, the test
  plan in §7 is a specification, not something you can run — there is no test runner
  installed yet either.
- **On Windows, `bash` is WSL's bash, not Git Bash** — `C:\WINDOWS\system32\bash.exe`.
  So `spawn("bash", ...)` from `worker/tiles.ts` lands *inside Linux*, where
  `command -v tippecanoe` succeeds and `scripts/run-tippecanoe.sh` took its
  native branch — the one that skipped path translation, on the reasonable-
  sounding grounds that native tippecanoe implies native paths. It does not: the
  caller is still Windows Node, so the arguments are still `C:/…`. The symptom is
  `unable to open database file` on a path that reads perfectly well in the error
  message. Fixed 2026-08-13 by translating in **both** branches, which is a no-op
  on a Linux runner. Two smaller Windows-only traps sat behind it, both in
  `tiles.ts`: an argument to `bash` must be built with **forward slashes**, never
  `path.join`, or the backslash is eaten before bash sees it — first the script's
  own name (`scriptsrun-tippecanoe.sh: No such file or directory`), then every
  `-L` and `-o` path. None of this affects CI, which is why `worker/run.ts` had
  never once run on the dev machine.
- **tippecanoe does not run natively on Windows, and this machine is Windows.**
  Production is unaffected — `tiles.ts` runs in GitHub Actions on Linux — but
  local tile builds need WSL or Docker. This first bites in **Phase 2**, which
  calls for a hand-made PMTiles archive. Two ways out, and the choice is open
  (§6, decision 8): stand up WSL/Docker once and use the real toolchain locally,
  or hand-write the handful of Phase 2 fake points with `geojson-vt` + `vt-pbf`
  in Node and defer tippecanoe entirely to CI. The second is faster now and leaves
  the Phase 3 tile step unexercised on the dev machine. **Resolved 2026-08-09 in
  favour of route A** — Ubuntu 24.04 has tippecanoe in apt, so it is one command
  rather than a source build, and `scripts/build-fake-tiles.sh` handles the
  Windows→WSL path translation. Decision 8 has the detail. **Installed and used
  2026-08-10**; the Phase 2 archive was built with it and is committed.
- **A green `npm run build` says nothing about whether the map renders.** Phase 2
  passed `build` and `tsc --noEmit` while drawing a completely blank map, for two
  independent reasons (§11, 2026-08-10). Both were invisible to every check that
  does not open a browser, and one of them — MapLibre's worker failing to load —
  produces **no error event and no console warning**. Verify map changes in a
  browser, not in the type checker.

---

## 1. What this is

A 2D web map of current world news. Portfolio project.

**Audience:** hiring managers. Two to three minutes, often on a phone, arriving
from a link on a résumé.

**Success is a live URL**, not an architecture. Code that cannot be clicked does
not count for this audience.

**Priority: stability and responsiveness over freshness.** More real-time data
makes the app slower. Where they conflict, responsiveness wins.

**Builder:** solo, evenings and weekends. All estimates below are calendar weeks
of evenings, not full-time days.

---

## 2. Product spec

### 2.1 Placement — one rule

Every story gets a position from a single function, `placeStory()`. Demonyms are
stripped first; then **specificity wins unless it is dominated**:

```
  drop every location whose name is a demonym          (see the trap below)
  city, adm1, country := most-mentioned location of each level
  if a city exists:
      adm1    >= 2x the city  ->  CONTAINER at the adm1      story is regional
      country >= 3x the city  ->  CONTAINER at the country   story is national
      city mentioned once     ->  DROP                       story has no place
      otherwise               ->  PIN at the city
  else  adm1 -> CONTAINER,  else country -> CONTAINER,  else DROP
```

| Input | Output |
|---|---|
| Specific feature (city, park, landmark, valley, sea), not dominated, mentioned 2+ times | **PIN at its exact coordinates** |
| Specific feature dominated by its region or country | **CONTAINER at that region** |
| Specific feature mentioned once, undominated | **DROP** |
| Admin-1 / county / country only | **CONTAINER** |
| Demonym only ("British", "Danish") | **DROP** |
| No usable location | **DROP** |

**A wildfire at "San Gabriel Valley" pins at the valley**, not at the nearest
city. GDELT's location type 3/4 is not "cities" — measured at 70.7% cities,
12.1% natural features, 10.7% counties, 6.5% landmarks — and each carries its own
coordinates.

> **Why the margins, and why they differ.** The first version of this rule was
> plain specificity-first. Hand-judged, it placed **54.1%** of pins correctly
> [41.7, 66.0] and **37.5%** of containers [24.2, 53.0] — it failed §5.1's abort
> criterion outright. The audit found the cause: a city mentioned **once** was
> beating a state mentioned **four** times (Chicago x1 over Minnesota x4 for a
> Minnesota Twins story; London x4 over United Kingdom x14 for a UK-wide Met
> Office story). Pure dominance overcorrects — it sends 75% of stories to country
> containers, because a domestic article names its own country constantly. Hence
> two different margins: countries are structurally over-mentioned, states are not.
> Rule H scores **69.7%** of pins [52.7, 82.6] and **80.8%** of containers
> [62.1, 91.5] on a fresh out-of-sample draw, and **68.1%** [53.8, 79.6] /
> **83.3%** [68.1, 92.1] when independently judged on a second one.
> `FINDINGS.md` §9.

> **Why a city mentioned once is dropped, added 2026-08-14.** One mention is not
> evidence that the story is about that city — it is evidence that GDELT
> scattered single mentions and the rule took whichever came first. The
> independent draw measured those pins at **36.4% correct (n=11) against 77.8%
> (n=36) for the rest**, Fisher exact p=0.023, confirming a prediction the hand
> audit had made on ten records. It costs **30.2% of pins** and it is deliberately
> narrow: it fires *after* both margins, so a dominated weak city is still a
> container; it does not apply to containers, where the same shape scored 85.7%;
> and it drops rather than falling through to the country, because a country
> mentioned twice under a one-mention city is the same noise one level up
> (`Dublin -> United Kingdom x2`). See the decision-4 write-up.

> **The demonym trap.** GDELT writes country demonyms bare (`Americans`) but state
> demonyms with a suffix (`Texans, United States`). Matching the whole `FullName`
> against a demonym list — the obvious implementation — **silently misses every US
> state**. Match the **first comma segment**. 11.9% of all location mentions are
> demonyms. `FINDINGS.md` §10.

### 2.2 Containers

A container is a country or admin-1 region, used when a story has no exact
location.

- Rendered as a **pin at the container's center, at every zoom level.**
- Clicking the story **outlines the container in red.**
- The polygon is never a fill. It is a click-reveal only.
  - **Amended 2026-08-13:** §2.3's label gesture needs an **unpainted** `fill`
    layer over the same polygons, purely as a hit target, to turn a clicked
    label into a region id without matching names (§3.4). Nothing is painted, so
    the rule above is untouched as a *visual* rule — but it said "never a fill"
    flatly, and this is the exception, written down rather than reasoned around.
    If a fill ever acquires a visible colour, that is a violation.
- One container feature per region per window, carrying `{region_id, count,
  top_title, top_url}` — not one per story.
- `top_title` / `top_url` are picked by the §2.5 comparator, so a region's
  container shows its tier-1 story when it has one. `count` is the count over the
  general 24-hour window and is not inflated by the 48-hour tier-1 carry-over.

### 2.3 UI states

**There is one content model.** Per-tile top-K by the §2.5 comparator, everywhere,
at every zoom. The states below are camera positions and a highlight — not
different editorial tiers, not different ranking, not topic classification.

Tier-1 priority (§2.5) is part of that single comparator, not a fourth state and
not a filter. There is no tier-1 toggle and no tier-1 badge; the preference is
invisible except in *which* stories are on screen.

| State | Camera | Red outline | Panel | Map content |
|---|---|---|---|---|
| **Default** | free pan and zoom anywhere | **none** | closed | per-tile top-K |
| **Region** | **unchanged** | the clicked country or state | that region's top stories | per-tile top-K |
| **Global** | a corner button; resets zoom to default | none | closed | per-tile top-K |

**Default** is the base state. The user scrolls freely and zooms wherever they
like; zooming in makes more stories in that area reachable.

**Region** is entered by **clicking a country or state label on the basemap**.
That region outlines red and a left-side panel opens listing its top stories.
The camera does not move.

**Global** is not a structural state. It is a preset of Default that returns the
camera to whole-planet zoom and closes the panel.

> **This replaced the original "Country" state on 2026-08-13, and two things
> changed.** The old rule locked onto a country and auto-zoomed, on the theory
> that the zoom is what surfaces more of that country's stories. The panel does
> that directly, so the zoom stopped being the mechanism and became merely a
> camera move the user did not ask for.
>
> **The label is what makes the gesture unambiguous.** Clicking a landmass cannot
> tell "California" from "the United States"; clicking the *word* California can.
> That is the whole reason the gesture is label-based.
>
> **The panel is still one content model.** Its ordering is `compareGroups` —
> the same comparator the tile budget and the country floor use. It does not
> re-rank, does not filter by tier-1, and carries no badge. §2.6 applies as hard
> as in the popup: title, source, link, never article text, enforced by the
> `RegionStory` type being the whole of what a panel row can hold.
>
> **It does reach stories the map cannot.** A group whose `minzoom` landed above
> the z12 ceiling is in the pipeline and not on the map — 34% of the feed as of
> 2026-08-13, see §2.4. The panel lists it, because it is genuinely one of that
> region's top stories. This is the one place the panel shows something the map
> does not, and it is deliberate.

> **Three measurements shaped this — two before it was built, one after.**
>
> 1. **The two basemaps do not share a label schema.** MapTiler's `planet_v4`
>    uses separate source-layers (`country_label`, `state_label`); OpenFreeMap
>    uses OpenMapTiles' single `place` layer discriminated by `class`. A hit-test
>    must accept both, and **MapTiler has already changed schemas once** — if
>    they do it again the gesture stops working with no error and no console
>    warning, which is §11's failure shape. It needs a test, not a comment.
> 2. **Label zoom ranges differ, and one bites on arrival.** Country labels are
>    z2-12 on MapTiler and z0-9 on OpenFreeMap; state labels z2-11 and **z5-8**
>    respectively. The default camera was z1.5, so **on the production basemap
>    there were no country labels on screen when the map first loaded.** The
>    default zoom is now z2 (`lib/basemap.ts`), forced rather than chosen.
> 3. **Our own headlines were deleting those labels, measured after the gesture
>    was built.** MapLibre resolves symbol collisions from the top layer down, so
>    the headline layer appended last outranked `state_label` and
>    `country_label`: over the US at z5, **2 place labels drew instead of 6**.
>    The headline layer is therefore inserted *below* the basemap's place labels
>    (`firstPlaceLabelLayerId`), and re-measured at zero suppression. **The place
>    label is load-bearing UI now, not basemap decoration** — anything that
>    competes with it for space loses.
>
> **State labels carry no region code on either provider** — MapTiler has
> `iso_a2` + `admin_level`, OpenFreeMap has only a name. Joining "California" to
> `USCA` by name is §3.4's join trap wearing a new hat. So the label supplies
> only the *level* (country or state); the region id comes from hit-testing our
> own `boundaries.pmtiles` at the label's anchor. **No name matching anywhere**,
> and the id is by construction one the outline archive can draw.

> **Screen density stays roughly constant across zoom levels** — 2-4 visible
> tiles × K, so ~30-60 pins whether you are looking at the planet or at one city.
> Zooming does not add pins to the screen; it changes *which* pins, surfacing
> lower-salience stories as the area narrows. More stories become **reachable**,
> not more visible at once. This is deliberate: it is what keeps the map readable
> on a phone at every zoom.

Clicking any container story outlines its container in red, in any state.

### 2.4 Density

**Per-tile top-K budget.** For each tile at each zoom, keep the top K stories
inside it by the §2.5 comparator — tier-1-fresh first, then salience; the rest get
`minzoom = z+1` and reappear on zoom-in.

This is the cap *and* the floor. A sparse tile keeps everything it has, so the map
is never empty. A crowded tile defers its weakest, so it never turns to mush. And
because selection is local, US stories compete only with other US stories — the
Strait of Hormuz is never buried by an American election.

`K ≈ 12-20`, tuned on real data. A phone shows 2-4 tiles, so roughly 30-60 pins.

> **Measured: the budget binds in four countries and is a no-op in ninety.** Of
> 124 countries with news in a 24-hour window, four clear 1,000 stories/day (US
> 11,800, India 4,900, UK 2,700, Canada 1,750), 67 sit between 10 and 99, and 28
> get fewer than ten. Tune K against the US and India; everywhere else the floor is
> what does the work. `FINDINGS.md` §12.

> ### The density budget never ran, 2026-08-14
>
> **Everything above was computed correctly and then discarded.**
> `worker/tiles.ts` wrote tippecanoe's per-feature directive **inside
> `properties`**:
>
> ```ts
>   properties: { ..., tippecanoe: { minzoom: group.minzoom } }   // ignored
> ```
>
> tippecanoe reads a `tippecanoe` object that is a **sibling of `geometry` and
> `properties`**. Nested one level deeper it is just an attribute, so it rode
> into the tiles as data and **every `minzoom` this project ever computed was
> ignored, on every archive it ever published.**
>
> **Measured on the live archive at 390x844, world zoom:**
>
> ```
>   1,714 story pins rendered at z2      §9's target is 30-60
>      25 of them declared minzoom <= 2  the other 1,689 should have been deferred
>       7 declared minzoom 13            budget.ts's "never render" sentinel
>   1,714 of 1,714 still carried `tippecanoe` as a visible attribute
> ```
>
> That last line is the proof it was never consumed: tippecanoe strips the
> directive when it reads it.
>
> **Confirmed end to end against real tippecanoe v2.49.0**, both shapes, same
> flags as §3.1 (`-Z0 -z12 -r1 --drop-densest-as-needed`), 14 features declaring
> minzoom 0-13:
>
> ```
>   directive inside properties   every feature renders at z0, minzoom 13 included
>   directive as a sibling        only minzoom 0 renders at z0; minzoom 13 never renders
> ```
>
> The sibling form drops the `MAX_BUDGET_ZOOM + 1` sentinel exactly as the design
> says it should. (Individual first-render zooms in that probe are approximate —
> `tippecanoe-decode` interleaves its tile headers, so attributing a feature to
> the right tile is unreliable at row level. The two conclusions above do not
> depend on that.)
>
> **Nothing failed while this was wrong, and that is the lesson.** `budget.ts`
> produced a sensible minzoom histogram, tippecanoe exited 0, the archive
> published, §8's invariants passed, and the map looked busy rather than broken.
> The one module without a test was the one that was wrong: **`tiles.ts` had no
> test file at all.** It has `worker/tiles.test.ts` now, and the first two cases
> are the nesting, stated in both directions.
>
> **What this invalidates.** Every §2.4 overflow reading before 2026-08-14
> measured what the budget *intended* to defer, not what the map did — nothing
> was deferred, so those stories were all still on screen. **The 56% and 57.3%
> figures are counts of an intention.** Re-read the trigger on the first archive
> built after this fix before drawing any conclusion about `K`.
>
> **It also nearly cost the phone profile twice over.** Profiling would have run
> against ~28x the intended feature count, almost certainly missed §9's 30fps and
> 2.5s targets, and the natural reading of that failure — "no headroom, lower
> `K`" — is the exact opposite of the fix. Deferring the phone was luckier than it
> looked.

**Plus a guaranteed floor.** At z0 the whole planet is one tile, so the budget
alone would put 12-20 stories on the entire world map. A separate
**top-1-per-country layer, exempt from the tile budget**, guarantees every country
with news in the window gets at least one pin. That is what keeps the default
world view populated regardless of salience.

Two layers, one ranking function:

```
  stories layer      per-tile top-K by the §2.5 comparator     minzoom from the budget
  country-top layer  top 1 per country, same comparator        minzoom 0, no budget
```

Both layers rank on `(tier-1-fresh, salience)` — §2.5. So a country whose only
tier-1 story of the last 48 hours is low-salience still shows *that* story as its
representative pin. That is the intended effect, not a side effect.

### 2.5 Ranking

```
salience = log1p(distinct_domains) + 0.5 * log1p(distinct_source_countries)
```

Log because both distributions are heavy-tailed. Domains weighted 2:1 over
countries.

Source-country count is a **ranking** signal, not a tier separator — it says a
story crossed borders, which is a reasonable proxy for significance. It never
routes a story to a different view, because there is only one content model.

**This requires real story grouping, not title dedup.** Title dedup alone inverts
the signal: wire copy republished verbatim under one headline merges into a
high-domain story, while NYT, BBC, and the Guardian each writing their own
headline split into three 1-domain stories. Grouping therefore lives in Phase 3,
not Phase 6.

**Grouping key:** `≥2 shared V2EnhancedThemes` (excluding themes above ~15-20%
document frequency) + a title-token Jaccard floor + 0.5° location cell. Then title
dedup on top, to collapse exact syndication.

Source country is inferred from ccTLD plus an override map for major `.com`
outlets (top 50 domains are 32% of volume, so ~200 entries covers most).

**Tier-1 priority — two classes, one comparator.**

A story is **tier-1-fresh** if any article in its group comes from a tier-1 outlet
(`data/tier1-domains`, 28 entries) published within the last **48 hours**.
Selection sorts lexicographically on:

```
  (tier1_fresh DESC, salience DESC, newest_tier1_article DESC)
```

Every tier-1-fresh story in a selection unit outranks every non-tier-1 story in
it, whatever their salience. Inside each class, the salience ranking above is
untouched.

That one comparator produces all three behaviours the rule asks for, with **no
timers and no per-area state**:

- **A tier-1 story keeps its slot.** It stays tier-1-fresh for 48 hours after its
  newest tier-1 article, so every run re-selects it ahead of the ordinary feed.
- **Only another tier-1 story can take it.** Displacement needs a higher-salience
  tier-1 story in the same area. The non-tier-1 population cannot reach it at all.
- **After 48 quiet hours the ordinary rule returns.** The class empties by itself
  and top-K fills from salience alone. An area that *never* had tier-1 coverage
  starts with an empty class — so "fall back after 48 hours" and "there was never
  any tier-1 here" are the same code path, and neither is special-cased.

**"Geographic area" is the selection unit, which already exists**: the tile for
the stories layer, the country for the country-top floor layer (§2.4). Priority is
therefore per-tile-per-zoom for free — a tier-1 story sticks in every tile that
contains it, and a US tier-1 story never crowds out a Kenyan one, because they
were never in the same competition.

**Eligibility window: 24 hours, extended to 48 for tier-1 groups** (§3.5). A
carried-over group's salience is computed over its eligible articles — the full 48
hours. The asymmetry distorts nothing, because the two classes never compete on
salience; cross-class order is settled by the first key.

> **Measured: this bites in the US and UK and is a no-op nearly everywhere else.**
> 71 of 5,252 title-groups in the three-hour sample carried tier-1 coverage — 1.4%,
> so ~570 groups/day and ~1,100 in a 48-hour pool, against ~42,000 groups/day. And
> **91% of tier-1 records are US or UK outlets**: cnn 21, bbc 15, newsweek 11,
> latimes 8, cbsnews 5, nbcnews 3, theguardian 3, independent 1 — with scmp 4 and
> dw 3 the only others in three hours. Those are the same few countries where the
> top-K budget actually binds (§2.4), so the rule changes the map exactly where
> crowding happens and does nothing in the ninety countries the floor already
> carries. `FINDINGS.md` §11.

> **What it costs, stated plainly.** In a crowded US or UK tile a Newsweek or LA
> Times story now outranks a genuinely bigger story from a lower-tier domain. That
> is the trade being bought on purpose — 1% of the feed carries most of the
> editorial signal in this data — but it makes **tier-1 list membership
> load-bearing rather than descriptive.** The list was built to *measure* coverage
> and now *grants* precedence. §6 decision 9.

> **2026-08-13 — the list was expanded from 28 domains to 128.** The passage
> above describes the old list, which was 91% US/UK outlets: under it, "tier-1
> outranks everything in its tile" meant a US or UK byline beat local reporting
> anywhere on Earth. The expansion adds papers of record, independent outlets and
> investigative consortia for every region — Latin America, Africa, South and
> East Asia, Eastern Europe, the Middle East, the Pacific — so a tile can be won
> by an outlet from that place. Measured on the Phase 2.5 maturity sample, this
> moves tier-1 from 1.04% to 3.62% of article slots and from 1.35% to 4.74% of
> groups. Precedence is only meaningful while it is scarce; **re-measure after
> Phase 3, and if group-level tier-1 clears ~15%, demote the flat first-key
> override to a salience bonus.** Also watch `thehindu.com`: it alone is a third
> of the tier-1 article slots in that sample. `data/tier1-domains.txt` carries
> the full rationale.

### 2.6 Constraints

- **Link-out only.** Title, source, link. **Never reproduce article text.** This
  is a copyright constraint, and the UI is built early, so it is load-bearing.
- **Public repo.** This is what makes GitHub Actions free.
- **English-only**, achieved by consuming `lastupdate.txt` and **not**
  `lastupdate-translation.txt`. Approximately English, not exactly.
- **MapTiler attribution and logo stay visible.** API key must be
  domain-restricted.
- **`prefers-reduced-motion: reduce`** honored.
- **The browser never calls GDELT.**
- Free tier everywhere: Vercel Hobby, GitHub Actions, MapTiler, Vercel Blob.

---

## 3. Architecture

### 3.1 Locked decisions

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Shared types; the container join is a code lookup, not geometry, so no spatial library is needed |
| Repo | Single Next.js app, **not** a monorepo | Extract to `apps/web` when a worker package earns its own boundary |
| Frontend | Next.js App Router + React | Vercel-native |
| Map | MapLibre GL JS, **2D Mercator** | No globe projection |
| Basemap | **MapTiler** hosted style, **100k API requests/mo free — not "loads"** | Escape hatch: OpenFreeMap, a one-line style swap. See the warning below |
| Story data | **PMTiles** on Vercel Blob | Verified: 206 range requests, `Accept-Ranges`, CORS `*` |
| Boundaries | Static `boundaries.pmtiles`, built once from Natural Earth | Needed only for the red click-outline |
| Database | **None** | Deferred; `lib/types.ts` keeps the migration cheap |
| Worker | GitHub Actions, plain `run()` entry point | Ports off Actions in an afternoon |
| Tiles | tippecanoe, `-Z0 -z12 -r1 --drop-densest-as-needed` | Rank thinning via per-feature `minzoom` |

> **PMTiles is a file format, not a basemap.** It is BSD-licensed, needs no
> account and no service. Using it does not mean using the Protomaps basemap.
> MapTiler draws the world; PMTiles carries your stories. They are separate
> layers in one map.

> **The basemap free tier is ~330-520 visits/month, not 100,000.** This row said
> "100k loads/mo free" until 2026-08-10 and that was wrong by roughly 200×.
> MapTiler bills **per session** only for apps built on MapTiler SDK JS, and
> **per request** for "3rd party clients and libraries" — which is what raw
> `maplibre-gl` is. Every tile is one request, and MapTiler documents that
> switching to sessions "is not technically possible in this case." **Measured**:
> one 2-3 minute visit costs 193 requests on a phone and 304 on desktop, so
> 100,000 buys a few hundred visits. On the free plan the map **pauses until the
> next month** rather than billing. Sufficient at portfolio traffic; revisit above
> ~200 visits/month (§6 decision 11). `spikes/basemap/CASE-STUDY.md`.

### 3.2 Data flow

```
  external cron / schedule
        |
        v
  GitHub Action  (every 4h)
        |
        +--> fetch.ts    last watermark -> now, cap 12 bundles
        |                HTTP only (https cert fails on data.gdeltproject.org)
        |
        +--> parse.ts    index-scan tab offsets
        |                materialize 9 of 27 columns
        |                NEVER build V2GCAM (69.4% of bytes)
        |                schema canary: >=27 cols, else throw
        |
        +--> filter.ts   English stream, has usable location
        +--> place.ts    -> Pin | Container | Drop      (section 2.1)
        |
        +--> state.ts    read shards, assemble the candidate pool:
        |                  run-<ts>.jsonl  all stories, expire at 24h
        |                  t1-<ts>.jsonl   tier-1 groups only, expire at 48h
        |                dedupe by (domain, url); append this run's shards
        |
        +--> group.ts    themes + Jaccard + 0.5 cell     (section 2.5)
        +--> rank.ts     tier-1-fresh, then salience     (section 2.5)
        +--> budget.ts   per-tile top-K -> minzoom       (section 2.4)
        |
        +--> tiles.ts    tippecanoe -> stories.pmtiles
        +--> publish.ts  content-hashed archive + manifest.json
                         output invariants, else publish NOTHING
                         retention: keep last 3, prune after flip
                         ping the dead-man switch
        |
        v
  Vercel Blob
        |
        +-- stories-<hash>.pmtiles   immutable, cache forever
        +-- boundaries.pmtiles       built once
        +-- manifest.json            stable key, cacheControlMaxAge: 60
        |
        v
  Next.js  /api/stories  ->  s-maxage=300, stale-while-revalidate=600
        |
        v
  MapLibre  basemap (MapTiler) + stories + boundaries
```

### 3.3 Module boundaries

Split on the **pure/impure line** — the seam that makes tests possible.

```
worker/
  run.ts        orchestration only
  fetch.ts      I/O
  tiles.ts      I/O   tippecanoe subprocess
  publish.ts    I/O   Blob write, manifest, retention
  state.ts      I/O   per-run shards: read pool, append, expire by filename
  parse.ts      PURE
  filter.ts     PURE
  place.ts      PURE
  group.ts      PURE
  rank.ts       PURE
  budget.ts     PURE
  refdata.ts    one loader + schema check for all of data/
lib/types.ts    record shape, 1:1 with the eventual articles table
data/           crosswalk, fips-overrides, non-countries,
                tier1-domains, blocklist, demonyms
```

The six pure modules hold nearly all the logic and nearly all the risk, and need
no network to test.

### 3.4 The FIPS trap

**GDELT uses FIPS 10-4 country codes, not ISO 3166.** Four collide with entirely
different countries:

| GDELT (FIPS) | means | ISO 3166 same code |
|---|---|---|
| `RS` | Russia | **Serbia** |
| `CH` | China | **Switzerland** |
| `IS` | Israel | **Iceland** |
| `AS` | Australia | **American Samoa** |
| `UK` | United Kingdom | *(unassigned — fails loudly)* |

A naive two-letter join puts Russian news in the Balkans, silently, with
correct-looking output. GDELT codes Serbia as `RB`.

**Crosswalk:** Natural Earth `ne_10m_admin_0_countries` carries a **`FIPS_10`**
column (note: `FIPS_10`, not `FIPS_10_`), populated on 236/258 features. Nine of
168 observed GDELT codes need a committed override — Israel, Norway, West Bank,
Serbia, Réunion, Svalbard, South Sudan. Oceans (`OS`, `OC`) are known
non-countries and render as plain pins. Anything else: plain pin + loud log.

Coverage after overrides: **~99.95% of volume.**

### 3.5 Cadence

**Every 4 hours, over a rolling 24-hour window — 48 hours for tier-1 stories.**

Fetch every 15-minute bundle since the last successful watermark, capped at 12
bundles. A failed run self-heals on the next one.

The 24-hour window is not optional: a 12-hour window leaves most cities empty,
which removes the payoff from zooming in.

**The window is two windows.** §2.5 requires a tier-1 story to stay on the map for
48 hours, which is longer than the general window, so the candidate pool is:

```
  every story with an article in the last 24h
    UNION
  every group with a tier-1 article in the last 48h
```

Implemented as **two shard families**, both expired by filename per §6 decision 4:
`run-<ts>.jsonl` holds everything and expires at 24h; `t1-<ts>.jsonl` holds only
tier-1-touched groups and expires at 48h. Tier-1 is 3.62% of the feed after the
2026-08-13 list expansion (1.05% before), so the
second family still costs almost nothing — writing 48h of *all* shards would have
doubled state storage against the Blob free tier for no benefit. Groups appear in
both families during their first 24 hours, so `state.ts` **dedupes by
`(domain, url)`** on load; without that, a carried-over group double-counts its own
domains and inflates its salience.

Consequence for the UI: **a pin can be up to 48 hours old.** The relative
freshness stamp is per story and already handles this. The stale notice at 2× the
cadence is about *run* age, not story age, and is unchanged.

---

## 4. Data reality

Measured on a real 1-hour GKG sample, 4,688 records. Full detail in
`spikes/gdelt/FINDINGS.md`.

| | |
|---|---|
| Records per 15-min bundle | 1,172 → ~112,500/day |
| Have a location | 79.4% |
| City-level | 57.5% |
| **Distinct city stories after dedup** | **~40,700/day** |
| Titles present (`V2EXTRASXML` → `PAGE_TITLE`) | **99.7%** |
| Most-specific type: city / adm1 / country | 72.4% / 16.0% / 11.6% |
| Records with 6+ locations | **50.4%** |
| Two primary-location rules disagree | **48.5%** |
| `iheart.com` share of the feed | **11.2%** |
| Duplicate titles | 22%, syndication 1.59× |
| `V2GCAM` share of parsed bytes | **69.4%**, never used |
| Download | ~20 MB/hour, ~480 MB/day |

**Access paths — one of three survives.** GEO 2.0 returns **404 on GDELT's own
documented example URLs**; the `/api/v2/geo/` directory exists but the endpoint
inside it is gone. DOC 2.0 is rate-limited non-deterministically (30s spacing did
worse than 15s) with 8-20s responses and no theme codes. **Raw GKG is the only
path, and there is no fallback.** State this on the About page.

**Known hazards:**
- GDELT geocodes **demonyms** — "British", "Americans", "Danish" all become
  country locations. Filter before placement.
- Volume swings **~2× by time of day.**
- `https://data.gdeltproject.org` fails certificate verification. Use HTTP.
- GKG is ASCII-only; titles are HTML-entity-escaped and must be unescaped.
- GKG has **no** title column, **no** story grouping, **no** geocoding confidence.

---

## 5. Build plan

**Total: 9-13 calendar weeks of evenings.**

### Phase 0 — Reconcile the spec · 15 min
Done when this file replaces the old one and nothing else claims to be the plan.

### Phase 1 — Finish the spike · 2-3 evenings · *partly done*
Already measured: access paths, volume, titles, location quality, source
concentration, theme distribution, FIPS coverage.

**Phase 1 is complete.** Results in `FINDINGS.md` Part 2. What each one changed is
in §5.2.

- [x] **Abort criterion written down before measuring** — §5.1
- [x] Hand-judged geotag audit with confidence intervals — n=110 on the specified
      rule, n=60 on its replacement. **The criterion fired.** §5.2
- [x] Tier-1 crawl check — **1.05% of the feed; zero Reuters/AP/NYT/WaPo/WSJ in
      three hours.** Kills Phase 5 as specified
- [x] Per-country pin density — 124 countries, 28 of them under 10 stories/day
- [x] Blocklist — first entries identified; the population is finance spam and
      listicles, not under-covered news
- [x] Maturity delay — **run 19h after the snapshot. 0 of 15 observable groups
      matured, a [0%, 20.4%] interval that proves nothing** — but the denominator
      does: **only 0.29% of story groups are still in the feed 19 hours later.**
      GDELT turns over almost completely inside a day. `FINDINGS.md` §14

**Phase 1 is now closed.** The turnover number above is the one to carry forward:
it means §3.5's 48-hour tier-1 shard family is the *only* mechanism that can make
§2.5's stickiness work. A re-fetch strategy would lose essentially every tier-1
story long before its 48 hours were up.

### 5.1 Abort criterion — written 2026-08-08, before the audit ran

**Restores the old §4.6 rule and makes it specific.** Fixed in advance so the
result cannot be rationalised after the fact.

**What is measured.** 50 records sampled at random from the population the
pipeline would actually publish — post-language-filter, post-demonym-filter,
after `placeStory()` returns PIN or CONTAINER. Each is judged by reading the
headline against the placement:

| Verdict | Meaning |
|---|---|
| **CORRECT** | the placement is where a reader would expect the story to sit |
| **WRONG** | the placement is somewhere else, or the story has no real place |
| **UNJUDGEABLE** | the headline does not say enough to tell — excluded from the denominator, and reported |

Accuracy is scored **separately for PINs and for CONTAINERs**, because they fail
differently and only one of them is load-bearing for the project. Both are
reported as a proportion with a **95% Wilson interval**.

Containers are only ~28% of that population, so a 50-record draw yields n≈14 for
them — an interval too wide to decide anything. A **supplementary random sample of
30 container placements** is therefore drawn and scored identically. The headline
50 stays unstratified so the PIN number is an honest population estimate; the
container number comes from the stratified draw and is labelled as such.

**Thresholds.**

| Outcome | PIN accuracy (point estimate) |
|---|---|
| Proceed as planned | **≥ 70%** |
| Proceed, but the About page and the UI state the measured accuracy and its interval | **50-70%** |
| **Kill the project** — reconsider the data source before writing pipeline code | **< 50%** |

| Outcome | CONTAINER accuracy (point estimate) |
|---|---|
| Containers ship as specified (§2.2) | **≥ 60%** |
| **Kill containers** — drop country-and-ADM1-only records entirely, per `FINDINGS.md` §6 path 1 | **< 60%** |

**If containers are killed**, the country-floor layer of §2.4 does not die with
them: it is rebuilt from the *countries of city-pinned stories*, so every country
with news still gets its pin. Only the "story whose only location is a country"
population is dropped — 27.6% of geo records, and the least trustworthy 27.6%.

**Small-n honesty.** At n=50 the 95% interval is roughly ±13 points. A point
estimate of 55% therefore does not distinguish "ship with a caveat" from "kill".
Where the interval straddles a threshold, **the decision follows the lower bound,
not the point estimate** — that is the conservative direction and it is chosen
here, before the number is known.

### 5.2 Abort criterion — result

**It fired against the rule in the spec, and it does not fire against the rule
that replaced it.** Full evidence in `FINDINGS.md` §9.

| | PIN | CONTAINER |
|---|---|---|
| **Rule S**, specificity-first, as originally specified | 54.1% [41.7, 66.0] | 37.5% [24.2, 53.0] |
| **Rule H**, specificity unless dominated — now §2.1 | **69.7% [52.7, 82.6]** | **80.8% [62.1, 91.5]** |
| **Rule H**, independently judged, 2026-08-14 (decision 4) | **68.1% [53.8, 79.6]** | **83.3% [68.1, 92.1]** |

Under rule S: containers fail on the *upper* bound (53.0% < 60%), and pins straddle
the 50% kill line, which §5.1's lower-bound tie-break resolves as **stop the
project**. Under rule H, evaluated on a fresh disjoint draw against the **same
thresholds**, both clear.

**Decisions this forces:**

1. **§2.1 is rewritten to rule H.** The rule change is what saves the project, and
   it came out of the audit rather than from reasoning ahead of it.
2. **Containers ship** (§2.2 unchanged), but only because of the rule change. Under
   the spec's own rule they were dead.
3. **Pins ship in the "state the measured accuracy" band.** The lower bound is
   53.8%, not 70%. **Phase 6 must publish 68.1% [53.8, 79.6] and the method** —
   the independently judged figures, superseding 69.7% [52.7, 82.6] — and
   Phase 4's geotag-confidence treatment is not optional garnish.

   > **Built 2026-08-13, and it is uniform because grading it was measured and
   > refused.** Mention count — the only per-pin signal available at render time
   > — looked strong on the out-of-sample draw (33% against 78%, p=0.053, on six
   > pins) and went flat on the larger sample (58% against 64%, p=0.74). FINDINGS
   > §9.1. So the popup names the place the rule chose and says a rule chose it,
   > identically on every story; `lib/popup.ts` holds both the rule and the
   > table. **Phase 6 still owes the interval and the method** — this line does
   > not discharge that, it just stops the map from making a silent claim in the
   > meantime.
4. ~~**Before Phase 4 ships, get an independent judge on a fresh rule-H draw.**~~
   **Done 2026-08-14**, `judged-c29ce-90`, 90 records disjoint from all 170
   previously judged URLs. Both thresholds clear again and the pins' lower bound
   rose from 52.7% to 53.8%; Fisher exact on the two pin draws is p=0.29, so no
   judge effect is detectable. Write-up above under "The independent judge came
   back". **It also bought a rule**: `lone-mention` pins measured 36.4% (n=11)
   against 77.8% (n=36), p=0.023, and `place.ts` now DROPs them as `weak-city`.
   That is the first mechanism this project has changed on the strength of an
   independent judged sample rather than on a reading of its own output.

   > **Decision 3's disclosure is unchanged by it.** The projected 77.8% is the
   > same draw with a subset removed, not a measurement, and §5.1's bands are read
   > off measurements. The About page carries 68.1% [53.8, 79.6] until a fresh
   > draw against the new rule says otherwise.

**Thresholds were not moved at any point.** Only the sample size grew, when the
unstratified 50 turned out to yield 32 judgeable pins rather than 50, and again
when decision 4's independent draw was set at 90.

### Phase 2 — Skeleton and first deploy · 1-2 evenings · *in progress*
Public Next.js repo. MapLibre ≥5.0 + MapTiler rendering a hand-made PMTiles
archive with a few fake points. Push to Vercel.

**The live URL exists at the end of this phase.**

Built 2026-08-09: Next 16 App Router + React 19 + **MapLibre 6.2** + `pmtiles` 4.4,
`lib/basemap.ts`, `components/MapView.tsx`, eight fake points in
`fixtures/fake-stories.geojson`, and `scripts/build-fake-tiles.sh` running the
production tippecanoe flags from §3.1. `npm run build` and `tsc --noEmit` are clean
and the built server returns 200.

Three notes for whoever picks this up:
- **MapLibre 6 has no default export**, and it aliases its `Map` class to avoid
  shadowing the global. Import `{ MapLibreMap, Popup, addProtocol, ... }` by name.
  The plan says "≥5.0"; 6.2 is what npm resolves to and it works.
- **Never route a Windows path through `wslpath` via `wsl.exe`** — the backslashes
  are stripped before `wslpath` sees them and you get `C:Usersmatth...`. Convert
  `/c/…` to `/mnt/c/…` in the shell instead. Cost twenty minutes; the fix is in
  `scripts/build-fake-tiles.sh`.
- **The keyless basemap is visible, not silent.** With no `NEXT_PUBLIC_MAPTILER_KEY`
  the app falls back to the §3.1 OpenFreeMap escape hatch *and says so on screen*,
  so a keyless deploy cannot be mistaken for a configured one.

**Closed 2026-08-10. The live URL is https://sonder-drab-eta.vercel.app/** —
verified in a browser: MapTiler streets-v2, worker and shared chunk served, six
basemap tiles, five PMTiles range requests answered `206 Partial Content`, all
eight pins drawn, popup returning title + source + link only, no HTTP or console
errors.

- [x] tippecanoe via WSL, then `npm run tiles:fake`
- [x] MapTiler key → `NEXT_PUBLIC_MAPTILER_KEY`
- [x] Vercel project + deploy → the live URL
- [x] Client-side render **verified** — and it was broken. Two bugs, neither
      catchable by `build` or `tsc`; see §11, 2026-08-10
- [x] MapTiler logo rendered (§2.6 required it; MapLibre draws text credits only)
- [x] **Domain-restrict the key** (§2.6) — see START HERE: refused to `curl`, works in the browser. Confirm the Vercel domain is on the allowlist by loading the deployed site

Two things Phase 2 changed structurally:

- **`public/stories.pmtiles` was committed**, deliberately and temporarily. Vercel
  has no tippecanoe and cannot generate it, so an ignored archive ships a live map
  with zero pins. **Phase 3G reversed this**, as planned: the file is deleted and
  `*.pmtiles` is ignored. `public/boundaries.pmtiles` is the one committed archive
  now, and for the same Vercel-has-no-tippecanoe reason.
- **`predev`/`prebuild` copy MapLibre's worker into `public/`**
  (`scripts/copy-maplibre-worker.mjs`). Do not remove this: without it the map
  silently never loads a tile.

### Phase 2.5 — Ship something real · 1 evening · *closed 2026-08-11*
One GKG bundle. City pins only. No grouping, no containers, no budget. Dumb
GeoJSON straight to tiles.

Phase 3 is the longest stretch in the project with nothing visible at the end of
it. This buys a live, real map for one evening, and every later phase then
improves something that already exists.

Built as `scripts/build-real-geojson.ts` — `npm run gkg && npm run tiles:real`.
One file, no `worker/`, no state, no publish gate. It shares with Phase 3 only
the parts that are a bug when they are wrong: the `>= 27` schema canary, a
tab-offset scan that never materializes `V2GCAM`, the demonym filter running
before placement, and Rule H with its 2×/3× margins.

- [x] `data/demonyms.txt` moved out of `spikes/` — its §3.3 home, and the first
      non-spike consumer needed it
- [x] fetch + parse + place one bundle, in TypeScript, no new dependencies
- [x] `npm run tiles:real` — same tippecanoe flags, real input
- [x] Verified in a browser: pins drawn, `stories.pmtiles` answering `206`,
      popup showing a real title/source/link, no console errors
- [x] Masthead no longer claims fake points, and says the map is frozen

**Measured, on two consecutive bundles.** The placement mix is stable:

| | bundle 04:45 | bundle 05:00 |
|---|---|---|
| Rows | 744 | 887 |
| Below the 27-column canary | 0 | 0 |
| No title | 1.9% | 1.9% |
| **PIN** | **33.5%** | **33.5%** |
| CONTAINER (held for Phase 3) | 40.6% | 40.1% |
| DROP | 24.1% | 24.5% |
| Pins after title dedupe | 219 | 261 |

Four things worth carrying into Phase 3:

- **Row count is roughly two-thirds of §4's 1,172/bundle.** Both bundles were
  drawn near 05:00 UTC, and §4 already records that volume swings ~2× by time of
  day. Nothing is wrong; the number in §4 is a daytime sample.
- **Rule H sends 40% of stories to containers**, so a city-pins-only map shows
  about a third of the feed. This is the first confirmation on live data that the
  rule behaves as §2.1's audit predicted rather than collapsing to countries.
- **The archive is 626 KB for 261 features** against 21 KB for Phase 2's eight,
  and it is committed. Fine at this size, and Phase 3 deletes it from the repo
  when `publish.ts` writes to Blob — but a full 24-hour window is ~40,700 pins,
  so the committed-archive arrangement expires with this phase, not later.
- **`iheart.com` is still in the feed** at ~2% of these two bundles, well under
  §4's 11.2%. The blocklist is deliberately *not* wired here — Phase 3 owns it —
  and it is worth seeing what an unfiltered map looks like before filtering it.

Not done, on purpose: no dedupe beyond normalized title, no ranking, no budget,
no freshness stamp, and the map does not update itself. The masthead says so.

### Phase 3 — Ingestion + grouping · 7-9 evenings · *the big one*
Build `worker/` per §3.3. Everything in the §3.2 data flow.

Critical details, each of which is a real bug avoided:
- Index-scan the parse; never materialize `V2GCAM`
- Schema canary uses **`>= 27`**, indexed from the left — a strict `!= 27` fails
  closed on a benign additive GDELT column
- Demonym filter runs **before** placement
- FIPS crosswalk + overrides + build-time coverage check
- **Blob retention: keep last 3, prune after the manifest flips.** Without this,
  Hobby storage fills in 48-72 hours
- **Output invariants** at the publish gate: feature count within a band of the
  trailing median, ≥N distinct countries, ≥N% non-empty titles. Fail → publish
  nothing
- `minzoom` must be **monotonic upward** — a feature can win its z5 tile and lose
  its z6 tile
- Per-tile top-K iterates **features, not tiles** (16.7M tiles at z12, ~40k
  features)
- Wire the blocklist. `iheart.com` is 11.2% of the feed and nothing consumes it
  yet
- **Two shard families, two expiries** (§3.5). The 48-hour tier-1 pool is what
  makes §2.5's stickiness work; with a single 24-hour pool the priority comparator
  still runs but tier-1 stories silently drop off the map after one day
- **Dedupe the candidate pool by `(domain, url)`.** A group present in both shard
  families otherwise counts its domains twice and out-ranks its own peers
- **Blocklist runs before the tier-1 check**, so a blocklisted domain can never
  make a group tier-1-fresh. No overlap today; it is a one-line ordering guarantee
  against a future list edit

### Phase 4 — The map · 5-7 evenings
2D Mercator. Two tile layers (stories + country-top) over the MapTiler basemap,
plus boundaries for the red outline.

The states from §2.3: free pan/zoom by default; clicking a country or state
label outlines that region and opens a panel of its top stories, camera
unchanged; and a corner button that resets to whole-planet. All render the same
content — only the highlight, the panel and (for Global) the camera differ.

> **Rewritten 2026-08-13.** This paragraph described country lock-on with
> auto-zoom until then. §2.3 carries the new rule and why it changed; the only
> camera move left in the feature is the Global button.

Container pins, red click-outline, symbol layer with `text-allow-overlap: false`
and `symbol-sort-key` from salience. Relative freshness stamp, explicit stale
notice past 2× the cadence. Geotag confidence treatment lands here — **done
2026-08-13**, in both halves: the hollow container ring (`lib/layers.ts`) and the
popup's placement line (`lib/popup.ts`), the second of which is uniform across
pins because §5.2 decision 3's note says grading was measured and refused.

**Profile against the performance targets on a real mid-tier phone**, not a
desktop throttle.

### Phase 5 — Blindspot · **CUT** · killed 2026-08-09 by measurement

The feature flagged stories that no tier-1 outlet had covered. Measured across
three separate hours of the clock, 7,050 records:

- Tier-1 outlets are **1.05% of the entire GDELT stream**
- **Reuters, AP, NYT, Washington Post, WSJ, NPR, Bloomberg, Al Jazeera and FT
  returned zero records** — not one, in three hours
- **98.6% of story groups have zero tier-1 coverage**

A flag that fires on 98.6% of the map is not a signal, and the acceptance bar
below could never have been met by it. Not a tuning problem: GDELT does not crawl
the wires at meaningful volume in this stream. `FINDINGS.md` §11.

*Original acceptance bar, kept as the record of what was being tested:* ≥10
flagged dots at any moment, the toggle filters to them, and you have read 10 and
judged ≥6 to be genuinely underreported.

**The 2-3 evenings go to Phase 6**, which was already the phase most likely to be
cut for time and is probably the stronger portfolio artifact anyway.

### Phase 6 — About / methodology · 3-5 evenings · *started 2026-08-14*
**The page is built and live at `/about`** (`app/about/page.tsx`), reachable from
the map by a "How this works" link in the masthead — §5.2 decision 3 asks for the
accuracy to be *reachable from the product*, not merely to exist. Every item on
the "must state" list below is on the page. It is a static prerender, so it costs
nothing per visit.

**Two things about it are load-bearing and easy to undo by accident:**

1. **The accuracy section is a pre-registered obligation, not copy.** Landing in
   §5.1's 50-70% band *requires* the About page to state the measured figure and
   its interval. Editing that section down to a rounder, friendlier number
   silently breaks the condition the project shipped under.
2. **It carries a `.about__pending` note saying what the number covers** — that
   68.1% was judged against the rule the same judging then changed, so it
   describes the map *before* the least accurate pins were dropped. **Dated, not
   wrong**, and the note says which. It deliberately does not promise a
   re-measurement, because that decision is closed (item 1 up top). If a fresh
   draw is ever judged, **replace the table and the note together** — updating
   one without the other is how the page starts lying.

> **The masthead link cost a measurement, and the next line added there will
> too.** `.panel` is opaque at z-index 3 and positioned by a hardcoded `top`, so
> it had been sitting *over* the new link at both widths — the link stayed
> present and clickable and invisible, which is the failure shape this project
> keeps finding. The offsets are now 108px / 126px at ≤520px against a masthead
> bottom of 96px / 114px, measured in a browser. Re-measure on any masthead
> change.

**Closed 2026-08-14: the page can no longer disagree with the judge in silence.**
The figures were hand-copied out of this document, so a re-judged draw would have
updated the map and the plan while the page kept quoting a measurement of a
pipeline nobody was running any more — with nothing going red. Now:

- **`lib/accuracy.ts`** is the single source of truth (point, interval, n, draw
  id, and which rule the figures describe). `app/about/page.tsx` renders from it;
  the table and the "about 54% to about 80%" sentence are both derived, so
  neither can drift from the other.
- **`lib/accuracy.test.ts` re-scores the committed judge files on every run** and
  fails if the published numbers do not reproduce. It also asserts both lower
  bounds stay above §5.1's kill lines, and that the pin figure is still inside
  the **50-70% band that makes the disclosure mandatory** — because rising out of
  that band silently would leave the page justifying itself by a rule that no
  longer applies.
- **Verified by breaking it on purpose**: editing the pin figure to 74.0 fails
  two tests, the re-score and the band check. A guard nobody has seen fail is not
  known to work.
- Wilson moved to **`lib/audit-score.ts`** so `scripts/score-audit.ts` and the
  test share one implementation. Two copies would let the page agree with a bug
  instead of with the verdicts.

**If a fresh draw is ever judged**, update `lib/accuracy.ts` and its
`judgedFile` / `sampleFile` in one commit — the test will say if you got it
wrong. **Do not relax an assertion to make it pass**; a failure there is a
decision for a human, and in the case of the 50% line it is §5.1's stop-the-
project decision.

**Promoted, and given Phase 5's budget.** `FINDINGS.md` is the artifact with the
strongest claim on a hiring manager's attention: GEO 2.0 dead with structural
proof, 48.5% heuristic disagreement, the demonym discovery, an abort criterion
written before the data and honoured when it fired, and three features killed by
the builder's own measurements. That reads better than most portfolio maps.

Must state: the English-only mechanism and its residue, **geotag accuracy with
its interval and the method behind it** — now the independently judged **68.1%
[53.8, 79.6]**, not the 69.7% [52.7, 82.6] this line carried until 2026-08-14 —
how containers
work and where admin-1 coverage has gaps, the 24-hour window and cadence,
**that tier-1 outlets get ranking priority and a 48-hour window while everything
else gets 24** (§2.5 — this is an editorial choice made by the builder, not
something the data implied, and hiding it would be the dishonest option), **that
the blindspot feature was cut and why**, and that raw GKG is a single point of
failure with no fallback. **Credit GDELT and MapTiler.**

### Timeline

```
  wk 1   Phase 0, 1, 2        -> LIVE URL exists
  wk 2   Phase 2.5            -> real data on a real map
  wk 3-6 Phase 3              -> the pipeline
  wk 7-9 Phase 4              -> the product
  wk 10-11  Phase 6           -> the story  (absorbs the cut Phase 5)
  wk 12-13  slack
```

---

## 6. Open decisions

Provisional calls are marked. Override any of them; they are written in so the
plan is actionable, not because they are settled.

**Nothing is blocking.** The former blocker — a topic signal for View 2 — was
dissolved on 2026-08-08 when the views were reframed as camera states over one
content model. No topic classification is needed anywhere in this project.

| # | Decision | Provisional | Why |
|---|---|---|---|
| 1 | Zoom ceiling | **z12 as built**, not the z10 this row proposed | GDELT gives city centroids, so all Chicago stories share one coordinate and do not spread on zoom. Revisit with spiderfy if it feels flat. **Correction 2026-08-13:** this row said z10 while §3.1's locked flags say `-z12` and `worker/tiles.ts` has always passed `-z12`. The build is the truth; the row was never updated. Every overflow figure in this document is against z12 |
| 2 | Cadence | **4-hourly** | Cuts Actions minutes and tile builds 4×, imperceptible against a 24h window, serves "stability over freshness" |
| 3 | Cron trigger | **`schedule` only**, plus a monthly calendar reminder | The 60-day auto-disable is repo-*inactivity* based, not elapsed time. Drops a third-party service and a never-rotating `actions: write` PAT |
| 4 | State storage | **append-only per-run shards**, expired by filename | A 25-40 MB read-modify-write JSON is a database without a database's properties. Shards delete three resilience mechanisms |
| 5 | ~~Red-outline precedence when two are lit~~ | **RESOLVED 2026-08-13 — there is never more than one.** Every click clears both outlines and the panel before it establishes anything, so a container click inside a locked region *replaces* the region outline rather than joining it | The row assumed a region lock and a §2.2 container click-reveal could be lit together and proposed distinguishing them by weight. Building it made the simpler answer obvious: one red outline and one panel, or the user cannot say which of the two the map claims is selected. Two lit outlines with a weight difference asks the reader to decode a legend that is not on screen. If two ever do need to co-exist, the brighter-and-thicker treatment is still the right shape — do not introduce a second colour |
| 6 | ~~Country auto-zoom level~~ | **SUPERSEDED 2026-08-13** | §2.3 no longer moves the camera when a region is selected, so there is no country fit to compute. The Global button is the only camera move left, and its target is fixed (whole planet). Kept as a row because the reasoning — a fixed zoom is wrong for both Monaco and Russia — returns the moment anyone re-proposes auto-zoom |
| 7 | Blob transfer allowance | **RESOLVED 2026-08-13 by arithmetic — it is not the binding limit, and the exact allowance does not need to be known.** MapTiler binds first, by more than an order of magnitude | Measured on the deployed site: an arrival at world zoom costs **~440 KB from Blob** — `manifest.json` 824 B plus six `206` range requests into the 21.9 MB archive (196 KB, 167 KB, 41 KB, 17 KB, 9.5 KB, 7 KB). Opening a region panel adds the index, 328 KB. So a generous visit is ~0.8 MB. **MapTiler pauses the map at ~330-520 visits/month** (§3.1), and 500 visits × 0.8 MB is **~400 MB** — so Blob transfer would have to be capped below that to bind first, which no Vercel plan is. The dashboard number was never the thing worth knowing; the ratio was. Recheck if the archive grows several-fold or if the basemap moves to OpenFreeMap, which removes the ceiling that is currently doing the limiting |
| 8 | Local tile toolchain on Windows | **RESOLVED 2026-08-09 — route A, real tippecanoe via WSL** | tippecanoe has no native Windows build, but **Ubuntu 24.04 ships `tippecanoe 2.49.0` in apt**, so this is one command and not a source build: `wsl -d Ubuntu -- sudo apt-get install -y tippecanoe`. Builder's call: the Phase 3 `minzoom` / top-K work is the riskiest code in the project and wants the real toolchain locally, not a `geojson-vt` stand-in. `scripts/build-fake-tiles.sh` detects native tippecanoe first and shells into WSL otherwise, so the same script works locally and in CI. **Installed and in use since 2026-08-10.** `wsl -d Ubuntu -- which tippecanoe` answers `/usr/bin/tippecanoe`, and it built both the Phase 2 archive and the 2026-08-13 boundaries rebuild. This row read *"still pending the one `sudo` password"* until 2026-08-13, three days after it stopped being true — §0 rule 1. Docker 29.0.1 is installed with its daemon stopped and is the unused fallback |
| 9 | Tier-1 list membership | **RESOLVED 2026-08-13 — keep all 28, unchanged.** The concern that forced this row does not survive real data | The row was provisional because `newsweek.com` and `latimes.com` — the two members most arguable as papers of record — were **26% of the tier-1 records in the three-hour spike**, so the thinnest part of the list was carrying a quarter of a privileged class. **Measured on the live 24-hour index, they are 4% and 5%.** The class is now led by `independent.co.uk` 16%, `scmp.com` 16%, `theguardian.com` 16%, `bbc.co.uk` 15%, with `aljazeera.com` present at 6% after returning **zero** in the spike. The spike's ranking was a small-sample artifact, and the list now looks like what it was built to be. 15 of 28 domains still return nothing (Reuters, AP, NYT, WaPo, WSJ…) and still cost nothing. Also measured: tier-1 is **1.9% of groups but 6.2% of panel rows** — the §2.5 comparator promoting them roughly threefold, which is the rule working, visible for the first time |
| 10 | Tier-1 freshness clock | **newest** tier-1 article in the group | "Published in the last 48 hours" against the *oldest* would expire a story that a tier-1 outlet is still actively covering. Newest means a follow-up piece renews the 48 hours, which reads as the same story continuing — matching "unless it is replaced by another tier-1 story" |
| 11 | Basemap provider and billing unit | **RESOLVED 2026-08-10 — MapLibre GL JS + MapTiler, per-request billing.** Google Maps was investigated and rejected | **Google would work**: the Map Tiles API serves 2D tiles over a `{z}/{x}/{y}` template that drops into a MapLibre `raster` source, third-party renderers are explicitly contemplated in its policies, roadmap tiles are custom-stylable, and it is 100k tiles/mo free then $0.60/1k with *graceful* overflow instead of a pause. Rejected anyway: the tiles are **raster**, which fights §9's <2.5s-on-4G target and needs `scaleFactor2x` for retina (halving the free tier), it requires a **credit card** against §2.6's "free tier everywhere," its logo rules cost real phone screen, and `createSession` turns `basemap()` from a pure function into an async stateful one — losing §3.1's one-line escape hatch. **MapTiler SDK** (per-session, 5,000/mo, ~10-15× the headroom) is the stronger economic option and was also declined: the headroom is theoretical at portfolio traffic, and the SDK is MapTiler-specific, which kills the OpenFreeMap swap that made this whole investigation possible without a key. Deferring is cheap — the SDK wraps MapLibre, so switching stays small. **Revisit above ~200 visits/month.** Evidence and measurements: `spikes/basemap/CASE-STUDY.md`. **2026-08-13: that trigger now has a trigger.** Nothing in the repo measured visits, so "revisit above ~200/month" could only ever fire by accident; `@vercel/analytics` is in `app/layout.tsx` (free on Hobby, one script, no consent banner, §2.6 intact). **Stay on MapTiler until it reads above ~200**, and treat the OpenFreeMap swap as the escape hatch already owned rather than a pre-emptive move: OpenFreeMap draws **state labels only at z5-8** against MapTiler's z2-11, so switching now would quietly cost most of §2.3's state gesture at the zooms visitors arrive at |

---

## 7. Tests

**Vitest** for units, **Playwright** for E2E. **53 paths identified, 3 critical.**

Fixtures: one real 5 MB GKG bundle (entity-escaped titles, 6+ locations per
record, demonyms, FIPS `RS`/`CH`/`IS`/`AS`, iheart syndication) plus small
synthetic files for schema drift, missing title, unknown FIPS, ocean-only, and
single-location.

**Tier-1 priority (§2.5) needs five of those paths, all pure and all cheap:**
1. A low-salience tier-1 story beats a high-salience non-tier-1 story in the same
   tile — the whole point of the rule
2. It **survives across runs**: the same story is still selected from a pool where
   its own articles are 30 hours old and the general window has moved past them
3. At **49 hours** with no new tier-1 article it drops out, and the top-K is filled
   by salience alone
4. A tile that never had tier-1 coverage ranks **identically** to the pre-change
   comparator — the fallback path is the original path
5. A group appearing in both shard families is **counted once**; its salience must
   equal the same group assembled from one family

**Three critical gaps — no test, no error handling, silent if they break:**
1. **`publish.ts` failure path.** A partial publish points the manifest at a
   half-written archive and breaks the map for everyone.
2. **Article body never rendered.** A test must assert the popup contains title,
   source, and link and *nothing else*. This failure mode is legal, not visual.
   **There are two such surfaces since 2026-08-13**: the §2.6 popup and §2.3's
   region panel. The panel is the safer of the two — `RegionStory` (`lib/types.ts`)
   has no field an article body could arrive in, so the constraint is enforced by
   the type rather than by a rendering choice.

   > **Closed for the popup, 2026-08-13.** Its HTML now comes from one pure
   > function, `storyPopupHtml` in `lib/popup.ts`, and `popup.test.ts` strips the
   > tags and asserts the rendered text is **exactly** title, source, placement
   > line and "Read at source" — so a feature that started carrying prose fails a
   > test rather than shipping. The same test pins the other rule the popup could
   > break: no field but those four may reach it, `tier1` least of all, because
   > §2.3 says the preference is invisible and a badge is what that forbids. The
   > panel still has no DOM assertion; its type is doing the work.
3. **Tile fetch failure is undefined.** A 404 or timeout currently produces a
   blank region with no explanation.

---

## 8. Monitoring

| Failure | Detected by |
|---|---|
| Run throws | GitHub emails on workflow failure |
| Run never happens | **Dead-man switch** — ping on success, alert if none in 2× cadence |
| Run succeeds, publishes garbage | **Output invariants** at the publish gate |
| Data is stale | Relative freshness stamp, explicit notice past 2× cadence |
| GDELT schema drift | Schema canary on column count |
| New FIPS code | Loud log + degraded pin, counted in the run summary |
| **Tier-1 priority quietly stops working** | **Tier-1 group count in the run summary.** If GDELT stops crawling CNN and the BBC the way it already fails to crawl the wires, the count goes to zero, §2.5 degrades to plain salience, and *nothing else fails* — the graceful degradation is exactly what hides it |

The dead-man switch matters because the likeliest long-run failure is silent: if
the trigger dies, no run happens, so no run fails, so no email is sent.

---

## 9. Performance targets

- First meaningful map paint **< 2.5s** on simulated 4G, mid-tier Android
- Tile fetch **p95 < 250 ms**
- Pan/zoom **≥30 fps mobile, ≥55 fps desktop**
- Published archive within the Blob free tier after retention
- **Screen density stays ~30-60 pins at every zoom** — not more, not empty
- **Basemap tile count is a cost budget, not only a latency one.** Billing is per
  request (§3.1), and a measured 2-3 minute visit spends 193 requests on a phone
  and 304 on desktop against 100,000/month. Anything that increases tiles fetched
  per visit shortens the runway before the map pauses. `spikes/basemap/CASE-STUDY.md`
- Zooming into a country **surfaces stories that were not visible at world zoom**,
  and no zoom level between 0 and the ceiling is empty
- Every country with news in the window has at least one pin at world zoom
- **A tier-1 story stays on the map across every run inside its 48 hours** and
  leaves only to another tier-1 story or to the clock — never to the ordinary feed
- Headlines readable, labels do not flicker

---

## 10. Not in scope

| Deferred | Why |
|---|---|
| Postgres / Supabase / PostGIS | A flat file plus tiles serves all three features. `lib/types.ts` keeps the migration cheap |
| Search, accounts, saved topics | Need Postgres |
| Embedding-based clustering | Heuristic grouping first; revisit if it demonstrably fails |
| Full 100-article audit | 50 with a published confidence interval instead. n=100 cuts the interval by a third, not half; n=200 would halve it |
| Globe projection, replay animation, idle rotation | Killed by the 2D spec |
| Governance / capital pinning | Killed by measurement — fired on 47.7% of records and would have pinned a dog attack at a state capital |
| **Blindspot / under-covered flag** | **Killed by measurement** — tier-1 outlets are 1.05% of GDELT's stream and the wires are absent entirely, so the flag fired on 98.6% of stories. `FINDINGS.md` §11. The *flag* is dead; the **tier-1 domain list survives and is now load-bearing in §2.5**, where the same 1% is used to grant ranking priority rather than to accuse the other 99% of a blindspot |
| Self-hosted basemap | 120 GB planet file; MapTiler's free tier is not a constraint at this traffic |

---

## 11. Document history

| Date | Event |
|---|---|
| 2026-08-05 | Original `HANDOFF.md` written. Globe, monorepo, Supabase, 9 phases |
| 2026-08-06 | `/office-hours` — portfolio framing, living-globe direction |
| 2026-08-07 | Design doc rev 1-3, two adversarial reviews (6/10 → 8/10) |
| 2026-08-07 | GDELT spike run against live data. `FINDINGS.md` |
| 2026-08-07 | Rev 4 — builder redirect: 2D, stability over freshness, three features |
| 2026-08-08 | `/plan-eng-review` — 12 findings resolved, 8 corrections accepted |
| 2026-08-08 | Outside voice, 6/10, 20 findings. Ranking inversion caught |
| 2026-08-08 | This file becomes the single source of truth |
| 2026-08-08 | Views reframed as camera states over one content model. Topic classification removed from the project entirely; the last blocking decision dissolved |
| **2026-08-09** | **Phase 1 closed. Abort criterion written, then fired: the specified placement rule scored 54.1% on pins and 37.5% on containers. Rule replaced with "specificity unless dominated" — 69.7% / 80.8% out-of-sample — and §2.1 rewritten. Blindspot cut: tier-1 outlets are 1.05% of the feed** |
| **2026-08-09** | **Phase 2 skeleton built.** Next 16 + React 19 + MapLibre 6.2 + pmtiles 4.4, clean `build` and `typecheck`, server returns 200. Decision 8 resolved to route A (real tippecanoe via WSL; Ubuntu 24.04 has it in apt). Two gotchas recorded: MapLibre 6 has no default export, and `wslpath` via `wsl.exe` silently eats backslashes. Tile archive, MapTiler key and deploy remain human-gated |
| **2026-08-09** | **Phase 1 fully closed.** Maturity comparison run 19h after its snapshot. The maturation question came back uninformative (0 of 15, [0%, 20.4%]) but the denominator did not: **only 0.29% of story groups are still in the feed 19 hours later**, which makes §3.5's persisted 48-hour shard family the only possible mechanism for §2.5's stickiness. `FINDINGS.md` §14 |
| **2026-08-09** | **Tier-1 reversed from a cut flag into a ranking preference.** Builder's call: the 1% is the signal, not the accusation. §2.5 gains a two-class comparator — tier-1-fresh outranks everything, salience orders within each class — and §3.5 gains a second 48-hour window and a second shard family to make it stick. No timers, no per-area state, and an area with no tier-1 coverage ranks exactly as it did before. Decisions 9 and 10 added |

| **2026-08-10** | **Phase 2 closed — the live URL exists**: https://sonder-drab-eta.vercel.app/ . Getting there required fixing two render bugs that the build could never have caught, because *nothing had ever been checked in a browser*. (1) MapLibre stamps `maplibregl-map` onto the story container, and `maplibre-gl.css` is bundled after `globals.css`, so `.maplibregl-map { position: relative }` beat `.map { position: absolute }` at equal specificity and collapsed the container to height 0. (2) The far worse one: **MapLibre 6 builds its worker from a Blob containing `import "<url computed at runtime>"`, which Turbopack cannot resolve**, so the worker 404'd, the map painted the basemap background and then never loaded a source, requested a tile, or fired `load` — **with no error event and no console warning**. `transpilePackages` only converts the silence into a hard build error. Fixed with `setWorkerUrl()` plus `scripts/copy-maplibre-worker.mjs` on `predev`/`prebuild`. Phase 2's fake archive is now committed, because Vercel has no tippecanoe and an ignored archive means a live map with zero pins |
| **2026-08-10** | **Basemap decision re-examined and §3.1's free-tier number corrected.** Google Maps was investigated properly — it *would* work with MapLibre — and rejected on raster-vs-vector, a required credit card, and the loss of the one-line escape hatch. The larger finding: **§3.1 said "100k loads/mo free" and the real figure is ~330-520 visits**, because raw `maplibre-gl` is billed per *request*, not per session, and MapTiler documents that switching to sessions is impossible for third-party clients. Measured: 193 requests per phone visit, 304 per desktop visit. Decision 11 added. Also closed a compliance gap — §2.6 requires the MapTiler logo and only the text credit was rendered. `spikes/basemap/CASE-STUDY.md` |

| **2026-08-11** | **Phase 2.5 closed — the live map shows real news.** One GKG bundle through `scripts/build-real-geojson.ts` (fetch, parse, demonym filter, Rule H, city pins only) into the same tippecanoe flags. **Rule H on live data sends 33.5% of rows to pins and 40% to containers, identical across two consecutive bundles**, which is the first out-of-audit confirmation that it neither collapses to countries nor reverts to specificity-first. `data/demonyms.txt` moved to its §3.3 home. No new dependencies: the ZIP reader is thirty lines of `inflateRawSync` and Node runs the TypeScript directly. Two smaller things: the masthead was still advertising fake points, and its longer replacement ran underneath the zoom control at 390px |

| **2026-08-14** | **§5.2 decision 4 discharged — rule H survived an independent judge.** 90 records, disjoint from all 170 previously judged URLs, scored by someone who did not design the rule: **pins 68.1% [53.8, 79.6], containers 83.3% [68.1, 92.1]**, no threshold fires, and the pins' lower bound *rose* from 52.7% (n=33) to 53.8% (n=47) with no detectable judge effect (Fisher p=0.29). The draw also bought the project's first evidence-paid rule change: `lone-mention` pins measured **36.4% (n=11) against 77.8% (n=36)**, p=0.023 — the ~40%/~82% the hand audit had predicted off ten records — and §2.1 gains a **weak-city DROP**, costing 30.2% of pins. Scoped narrowly on measurement rather than taste: after both margins, cities only (the same shape scores 85.7% on containers), and DROP rather than fall-through, which would have moved the error into the container number instead of removing it. `tie-broken` was left alone at n=9 and then fell from 15.5% of pins to 3.6% on its own. **The About page still carries 68.1%**: 77.8% is a projection, and §5.1's bands are read off measurements |

Superseded, retained as archaeology only:
`~/.gstack/projects/matthewcflam-sonder/matth-main-design-20260807-154947.md`
