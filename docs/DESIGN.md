# Sonder — Design

This is the single authoritative design document for Sonder. It replaces
`HANDOFF.md` (archived at `docs/archive/HANDOFF-2026-08.md`), `docs/modes-2-3-handoff.md`
and `docs/ui-refresh-2026-08.md` (both archived at `docs/archive/`) as the place
rationale lives. Two documents remain primary evidence rather than being
absorbed here — `spikes/gdelt/FINDINGS.md` and `spikes/basemap/CASE-STUDY.md` —
because they are measurement logs, not design narrative, and this doc cites
them rather than restating every number.

Headings in this file are **stable slugs**: `docs/DESIGN.md#tiles-budget` will
keep pointing at the tile-budget chapter even if chapters are reordered.
Code comments should reference this file by slug, not by a section number —
the numbering schemes in the archived documents (`HANDOFF.md`'s `§N.M`, an
informal `§4` inside newer work) are exactly the drift this file exists to
end.

Every chapter below ends with **Rejected Alternatives**: what was tried,
what it measured, and why it lost. Nothing in this document is invented —
every number, threshold, and named constant is transcribed from a source
file or from `HANDOFF.md`, `FINDINGS.md`, `CASE-STUDY.md`, or the two
ui-refresh handoffs.

---

## What This Is

A 2D web map of current world news: stories are plotted where they happen,
ranked by how many independent news organizations covered them (wire
services and papers of record given precedence), densifying as the reader
zooms in.

It is a **portfolio project**. The audience is a hiring manager spending
two to three minutes with it, often on a phone, arriving from a résumé
link. Success is a live URL, not an architecture — code that cannot be
clicked does not count for this audience. That reframes every tradeoff in
this document: **stability and responsiveness win over freshness** where
the two conflict, and the project runs on **free tiers everywhere** —
Vercel Hobby, GitHub Actions, MapTiler's free plan, Cloudflare R2 — because a
paid dependency turns a demo link into a bill. It is built solo, evenings
and weekends.

Two consequences that recur throughout this document:

- A failure mode that quietly degrades (a ranking signal going to zero, a
  region panel serving stale data) is worse than one that is loud, because
  the audience will never file a bug report — they will just leave. See
  `#failure`.
- A free-tier constraint is treated as a real design input, not a footnote —
  see `#basemap` and `#operations`.

### Rejected Alternatives

- **A relative freshness/quality bar instead of an absolute one.** Considered
  implicitly throughout — see `#operations`'s count-band history for the
  concrete case where a relative bar was tried, failed twice in one day, and
  was replaced.

---

## Data Reality

Everything here rests on `spikes/gdelt/FINDINGS.md`, a real measurement pass
against live GDELT data (four bundles on 2026-08-07, then twelve bundles
across three separate hours of the clock on 2026-08-08/09) run before any
production code was written.

**GDELT's GKG 2.0 stream is the only viable access path.** GDELT documents
three: raw GKG bundles, the DOC 2.0 search API, and the GEO 2.0 geocoding
API.

| Path | Result |
|---|---|
| Raw GKG 2.0 bundles | Works well: 0.07–0.10s for a `lastupdate.txt` check, 10.1 MB/s bundle download, no rate limiting observed across ~15 requests over two sessions. |
| DOC 2.0 API | Alive but effectively unusable — rate limiting is worse than documented and **not deterministic**: 30-second spacing between requests succeeded *less* often than 15-second spacing (0/3 vs 2/3), which reads as global load shedding, not a per-client token bucket. Successful responses took 8–20 seconds. No theme codes, no coordinates, no character offsets — it cannot substitute for GKG. |
| GEO 2.0 API | **Dead.** GDELT's own documented example URLs return 404. `/api/v2/geo/` (the directory) returns 403 (exists, listing denied); `/api/v2/geo/geo` (the script) returns 404. A removed endpoint with live documentation, not a misconfiguration. |

**`data.gdeltproject.org` does not work over HTTPS.** `SSL:
CERTIFICATE_VERIFY_FAILED` on every path; plain HTTP works fine. Acceptable
because the worker is server-side and the browser never contacts GDELT
directly, but any HTTP client defaulting to HTTPS-only will silently fail —
the worker fetches over HTTP deliberately.

**Measured volume** (one hour, later cross-checked against three hours
spread across the clock):

| Metric | Measured |
|---|---|
| Records per 15-minute bundle | 1,172 → ~112,500/day |
| Has a usable location (`V2EnhancedLocations`) | 79.4% |
| City-level (type 3 or 4) | 57.5% → ~64,700/day |
| Distinct city-pinned stories after title dedup | ~40,700/day |
| Titles present | 99.7% |
| Download | 4.3–5.9 MB zipped/bundle → ~20 MB/hour, ~480 MB/day |

Volume swings roughly 2× by time of day, so any single-hour measurement in
this document (or in `FINDINGS.md`) should be read as an upper-ish bound,
not a constant — this is why the Part 2 measurements in `FINDINGS.md` ran
across three separate hours rather than trusting the first one.

**Two facts about the data itself force downstream design decisions:**

- **GDELT geocodes demonyms.** "British", "Americans", "Danish", "Canadians"
  all resolve to country coordinates. 11.9% of all location mentions in a
  measured window are demonyms. A location whose name is a demonym must be
  dropped before any placement rule runs, or country-level tags are worse
  than an unhelpful centroid — a large share are just an adjective in the
  article's prose. See `#placement`.
- **Two plausible rules for picking a story's primary location disagree on
  48.5% of records.** This single choice moves nearly half of all pins —
  the highest-leverage decision in the pipeline. See `#placement`.

**69.4% of the data volume is one field the project never reads**
(`V2GCAM`) — `worker/parse.ts` index-scans past it rather than materializing
it. See `#pipeline`.

### Rejected Alternatives

- **DOC 2.0 as a title fallback or enrichment step.** Rejected — the
  non-deterministic rate limiting and 8–20s response times make it usable
  for occasional manual spot-checks only.
- **GEO 2.0 as a cross-check.** Removed from the design entirely once
  proven dead against GDELT's own documented examples, tried over both HTTP
  and HTTPS, with and without a trailing slash.
- **Forcing HTTPS on the GDELT fetch client.** Would silently fail; HTTP is
  correct and intentional here, not a fallback.

---

## Pipeline

The worker (`worker/`) runs the whole ingest-to-publish pipeline every four
hours as a GitHub Action, over a rolling 24-hour window:

```
cron (GitHub Action, every 4h)
  -> fetch.ts    watermark -> now, capped at 12 bundles, HTTP only
  -> parse.ts    index-scan tab offsets, materialize 9 of 27 columns,
                 never build V2GCAM, schema canary on column count (>=27
                 else throw)
  -> filter.ts   English + usable location, blocklist FIRST (so a
                 blocked domain can never make a group tier-1-fresh)
  -> place.ts    Rule H placement (#placement)
  -> state.ts    append this run's shards, THEN read the pool, so the
                 24h/48h union includes what just arrived, deduped once
                 by (domain, url)
  -> group.ts    themes + Jaccard + 0.5° cell
  -> rank.ts     tier-1-fresh first, then salience (#ranking)
  -> budget.ts   per-tile top-K -> monotonic minzoom (#tiles-budget)
  -> tiles.ts    tippecanoe, two layers (#tiles-budget)
  -> publish.ts  output invariants, then archive, then the manifest flip
                 (#operations)
  -> prune       only AFTER the flip, and only if it flipped
  -> ping        only after a real publish
  -> Cloudflare R2: stories-<hash>.pmtiles (immutable), boundaries.pmtiles
     (built once), manifest.json (stable key, cache-control max-age=60)
  -> Next.js /api/stories (s-maxage=300, swr=600)
  -> MapLibre GL JS
```

**The watermark comes from the published manifest, not from local state.**
It is the last *successfully* published bundle: a run that fetches, groups,
and then fails its output invariants does not advance it, and the next run
asks for the same span again rather than stepping over a window it never
showed anyone. Re-fetching is free because `state.ts` dedupes by
`(domain, url)` on read.

**Nothing in the pipeline fails silently by design** — see `#failure` for
the two independent alarms wired to "nothing was published."

### The pure/impure split

`worker/run.ts` is orchestration only — the *order* steps run in, nothing
else. Every decision lives in one of the modules it calls, split
deliberately on the pure/impure line:

- **Pure, no network, fully unit-testable:** `parse.ts`, `filter.ts`,
  `place.ts`, `group.ts`, `rank.ts`, `budget.ts`.
- **Impure, does I/O:** `fetch.ts`, `state.ts`, `tiles.ts` (shells out to
  tippecanoe), `publish.ts`.
- **`refdata.ts`** is a single loader-plus-schema-check for the `data/`
  directory (the FIPS crosswalk and overrides — see `#regions`).

The six pure modules hold nearly all the logic and nearly all the risk, and
need no network, no R2 credentials, and no tippecanoe binary to test.
That is the whole reason the split exists — it is what makes `npm test`
meaningful without a live store.

### The `.ts`-extension import rule

`worker/` imports use relative paths with an explicit `.ts` extension
(`"./budget.ts"`, `"../lib/types.ts"`), never the `@/` alias `app/` and
`components/` use. `@/` is a TypeScript path mapping that Next.js and
Vitest resolve, but plain Node does not — and `worker/run.ts` runs under
plain Node in GitHub Actions. An `@/` import inside `worker/` would fail at
runtime while passing `tsc`, `vitest`, and `next build` cleanly, because
none of those three checks actually run the worker's entry point the way
the Action does. Node also requires the explicit extension on relative
specifiers at all (`allowImportingTsExtensions` in `tsconfig.json`). A
`import type` line is erased at compile time and would survive either
convention — that is the trap, because the file works fine until someone
imports a *value* from it.

### Rejected Alternatives

- **Using the `@/` alias inside `worker/` for consistency with `app/`.**
  Would build and typecheck cleanly, then fail at 2am in GitHub Actions
  with no local reproduction — rejected in favor of the explicit,
  ugly-but-correct relative-with-extension form.
- **A single undifferentiated pipeline module.** The pure/impure split is
  what makes 400+ unit tests possible without a live R2 bucket or a
  tippecanoe binary in CI for every test run.

---

## Placement

Placement decides where a story's pin lands, and it is the single
highest-leverage decision in the pipeline — `FINDINGS.md` measured that two
plausible primary-location rules disagree on 48.5% of records.

### Rule H, the shipped rule

```
drop every location whose name is a demonym (match the first comma
  segment of FullName — GDELT writes country demonyms bare ("Americans")
  but state demonyms with a suffix ("Texans, United States"); matching the
  whole string silently misses every US-state demonym)

city, adm1, country := most-mentioned location at each level

if a city exists:
    adm1    >= 2x the city mentions  -> CONTAINER at the adm1     (regional)
    country >= 3x the city mentions  -> CONTAINER at the country  (national)
    city mentioned once (< MIN_CITY_MENTIONS = 2) -> DROP          (weak city)
    otherwise                        -> PIN at the city
else fall back adm1 -> country -> DROP
```

Constants: `ADM1_DOMINANCE = 2`, `COUNTRY_DOMINANCE = 3`,
`MIN_CITY_MENTIONS = 2` (`worker/place.ts`).

**The asymmetric margins (2× vs 3×) are not arbitrary.** Countries are
structurally over-mentioned relative to states in ordinary prose (a
domestic article names its own country constantly), so the same threshold
at both levels would send every domestic story to a country pin.

### The abort criterion, and that it fired

Before any accuracy audit ran, `HANDOFF.md §5.1` fixed a kill criterion in
writing: 50 random post-filter, post-placement records, hand-judged
CORRECT/WRONG/UNJUDGEABLE, scored separately for PIN and CONTAINER with 95%
Wilson confidence intervals. Thresholds: PIN ≥70% proceed, 50–70%
proceed-with-disclosure, <50% kill the project; CONTAINER ≥60% ship, <60%
kill containers. At n≈50–110 the interval is wide, so **the decision
follows the lower bound, not the point estimate** — chosen in advance,
before the number was known, as the conservative direction.

**The originally specified rule — pure specificity-first (Rule S: highest
specificity, then most repeated) — was judged and the criterion fired
against it:**

| Stratum | n | Correct | 95% Wilson CI |
|---|---|---|---|
| PIN | 61 | 54.1% | [41.7, 66.0] |
| CONTAINER | 40 | 37.5% | [24.2, 53.0] |

Containers failed outright (upper bound 53.0% is below the 60% floor).
Pins straddled 50%, and the criterion's own tie-break rule follows the
lower bound. **As specified, the criterion said stop.**

Before reporting a dead project, one diagnostic: for the mis-placed pins,
was the correct location present in the record at all? **In 10 of 19, it
was** — the rule preferred the most *specific* location, so a city
mentioned once beat a state mentioned four times (a Minnesota Twins story
pinned to Chicago; a UK-wide Met Office story pinned to London). The data
was fine; the rule was wrong.

**Rule D — dominance only (most-mentioned location regardless of type) —
is worse**: 83 of 110 records collapsed to containers, mostly country-level,
because a domestic article names its own country constantly. "A map of 200
country pins is not a news map."

**Rule H — specificity unless dominated — scored, out-of-sample, on a
fresh disjoint 60-record draw, against the same unchanged thresholds:**

| Stratum | n | Correct | 95% Wilson CI |
|---|---|---|---|
| PIN | 33 | 69.7% | [52.7, 82.6] |
| CONTAINER | 26 | 80.8% | [62.1, 91.5] |

Containers cleared the 60% bar on both bounds; pins cleared the 50% kill
line on the lower bound and sit near the 70% line on the point estimate —
"ship, and state the measured accuracy." An independent judge later scored
a fresh 90-record draw and got PIN 68.1% [53.8, 79.6], CONTAINER 83.3%
[68.1, 92.1] — a Fisher exact test between the two pin draws gives p=0.29,
no detectable judge effect. **Thresholds were not moved at any point.**

Rule H also rebalances the map: PIN 2,915 / CONTAINER 2,562 / DROP 1,572
across the measured window, against 3,075 / 826 under Rule S — containers
go from a fifth of the map to nearly half, which is what the accuracy gain
is bought with.

### The weak-city DROP, added 2026-08-14

A city mentioned exactly once scored 36.4% correct (n=11) versus 77.8%
(n=36) for cities mentioned 2+ times — Fisher p=0.023. Three scoping
decisions, each checked against real records rather than assumed:

1. **It fires last, after both dominance margins.** A dominated weak city
   is still a container, not a drop — dominance is the stronger signal.
2. **Cities only.** The identical pathology at container level scored
   85.7% (n=7) — *better* than containers overall — so this is a
   pin-specific defect, not a general "mentioned once is unreliable" rule.
3. **DROP, not fall-through to country.** Fall-through was checked against
   real dropped records (e.g. "Dublin → United Kingdom x2") and a country
   mentioned twice under a one-mention city is the same kind of noise one
   level up, not a rescue.

Costs 14.7% of all filtered records, 30.2% of what would have been pins
(205 of 473 in the measured sample). Projected resulting pin accuracy:
77.8% [61.9, 88.3] — stated as a **projection**, not a fresh measured
result, pending an independent judged draw against the rule as it now
stands.

### The ~88% error ceiling

Hand-classifying the 15 wrong Rule-H placements from the out-of-sample
audit into five failure mechanisms found that two of them are structurally
unreachable from this pipeline: GDELT geocoding a non-place (e.g. a
proper noun it mistook for a location), and a headline's real location
never being extracted by GDELT at all. **4 of 10 pin failures in that
breakdown are upstream of anything this project's placement rule could
fix — the ceiling is roughly 88%, not 100%.** The other failure classes
are addressable; fixing class 1 alone (before the weak-city DROP existed)
was projected to move pins from 69.7% toward ~79%.

### No per-pin confidence signal

The only per-pin quantity available at render time is how many times the
placed location was mentioned in its article. It looked like a strong
candidate out-of-sample (33.3% n=6 vs 77.8% n=27, p=0.053) but flattened on
transfer to a second sample (58.3% n=12 vs 64.3% n=28, p=0.736); pooled,
50.0% n=18 vs 70.9% n=55, p=0.152. **It does not replicate.** The lesson
recorded is narrower than "measure it": a six-record sub-stratum of a
sample sized for a go/no-go decision is not evidence for a finer decision,
however clean its numbers look in isolation.

**Decision: the disclosure is uniform, not graded.** A uniform *visual*
treatment (a halo, a dashed ring) would carry no information — it has
nothing to contrast against — while costing a third circle layer of
overdraw on a phone. The disclosure is textual instead: the panel names the
place the rule chose and says a rule chose it, identically on every story.

### Rejected Alternatives

- **Rule S (specificity-first)** — the original spec. Killed by its own
  pre-registered abort criterion; containers failed outright.
- **Rule D (dominance-only)** — collapses the map to mostly-country
  containers; rejected on inspection before formal scoring.
- **A graded per-pin confidence signal (mention count).** Measured, looked
  promising on one sample, failed to replicate on a second. Uniform textual
  disclosure shipped instead.
- **Governance/capital-city pinning (a separate feature, killed by
  `FINDINGS.md`'s theme-frequency measurement, not by the placement audit)**
  — `EPU_POLICY*` alone fires on 77.8% of the entire corpus; the proposed
  detection rule would have pinned a dog-attack story at a state capital.
  Cut, not redesigned.
- **A flat blocklist by source volume** to fix "no real place" stories.
  Rejected — it would delete legitimate high-volume outlets like
  `indiatimes.com` and `thehindu.com` from the map. The blocklist targets
  algorithmic finance spam and syndication-only sources instead.

---

## Tiles Budget

`worker/tiles.ts` and `worker/budget.ts` decide how many pins a tile carries
and at what zoom the rest reappear.

### Per-tile top-K as cap and floor

For each tile at each zoom, `budget.ts` keeps the top `K` stories by the
`#ranking` comparator and assigns the rest `minzoom = z+1`, so they
reappear on zoom-in. **This is the cap and the floor at once**: a sparse
tile keeps everything it has (the map is never emptier than the data), and
a crowded tile defers its weakest story rather than turning to visual mush.
Selection is local, so US election coverage never buries the Strait of
Hormuz — they are never in the same tile's competition.

`DEFAULT_K = 15`, `MAX_BUDGET_ZOOM = 12`, `NOT_RENDERED = 13` (the sentinel
minzoom for permanently-overflowed stories, above tippecanoe's own zoom
ceiling for this archive). Measured: the budget binds in exactly four
countries (US ~11,800/day, India ~4,900, UK ~2,700, Canada ~1,750) and is a
no-op in roughly 90 of the 124 countries that have any news at all — K is a
cap on four countries and nowhere else.

**The country-floor layer** is a separate top-1-per-country layer, exempt
from the tile budget, guaranteeing every country with news gets at least
one pin at world zoom. Without it, z0's single world tile would cap the
*entire* world map at K stories — for the roughly 28 countries with fewer
than ten stories a day (`FINDINGS.md §12`), the floor layer is the only
thing that puts them on the map at all.

### The tippecanoe 2.49.0 post-mortem

This is the project's worst silent-failure story, and the reason
`worker/tiles.test.ts` exists at all.

**Bug 1 — the directive was nested wrong.** `worker/tiles.ts` originally
wrote the per-feature `tippecanoe: { minzoom }` object *inside* the GeoJSON
`properties` object. Tippecanoe requires that object as a **sibling** of
`geometry`/`properties`, not nested inside either. Every `minzoom` the
budget ever computed was silently ignored on every archive ever published.
Measured on the live archive: 1,714 story pins served at world zoom on a
phone frame, against a 30–60 target; every one of them still carried a
visible `tippecanoe` property (proof it was never consumed — tippecanoe
strips the directive when it actually reads it).

**Bug 2 — fixing the nesting emptied the map.** Moving the directive to
the correct, spec-compliant location made world/London/New York/Delhi
tiles collapse from thousands of stories to exactly one each; the archive
shrank from 46 MB to 8.4 MB. The fix was reverted within 40 minutes,
pending diagnosis.

**Root cause — an upstream tippecanoe bug, not a Sonder bug.** tippecanoe
2.49.0 (the version `apt-get install tippecanoe` installs on Ubuntu 24.04,
present on both the dev machine and CI) has a missing `else` in
`tile.cpp`'s minzoom-drop path: `if (sf.tippecanoe_minzoom == -1) { ... }`
with no corresponding `else` branch — so *any* feature declaring an
explicit minzoom never gets `sf.dropped` assigned, keeps the struct's
default `FEATURE_DROPPED`, and is discarded outright, except that "the
first feature of the tile is always kept" as a separate guard — which is
exactly why the symptom was one feature per tile, tracking raw tile count
(1, 4, 16, 51, 135 at z0–z4) rather than any density rule. Fixed upstream
in `felt/tippecanoe` commit `bd48ba8` ("Fix accidental loss (at all zooms)
of features with an explicit minzoom"), 2024-03-22, a two-line fix, first
released in **tippecanoe 2.52.0**.

Verified with a three-way build (2.49.0 / 2.52.0 / 2.79.0) over the same
218-point input:

| Input | z0 features, 2.49.0 | z0 features, 2.52.0 | z0 features, 2.79.0 |
|---|---|---|---|
| No minzoom directive | 218 | 218 | 218 |
| `minzoom: 0` on every point | **1** | 218 | 218 |
| `minzoom = i % 13` | **1** | 17 | 17 |

The last row is the budget actually working on a fixed binary: 17 of 218
points declare minzoom 0, and a patched tippecanoe serves exactly those 17.
Also caught: the **string form** `{"minzoom": "0"}` is silently ignored on
every tested version — a live hazard, now covered by a test.

**"The two known states were 'too many pins' and 'no pins', and both were
the same missing `else`. Every unit test and tippecanoe's own exit code
passed in both states. The only place either failure was visible was a
decoded tile or a browser."** The module without a test was the module that
was wrong — `worker/tiles.ts` had no test file at all before this incident.

**Three coupled fixes, and none of them works alone:**

1. `worker/tiles.ts` writes the `tippecanoe` object at Feature level, not
   nested in `properties`.
2. `scripts/tippecanoe-min-version.sh` refuses to run below tippecanoe
   2.52.0, on both the native and WSL paths.
3. CI builds tippecanoe 2.79.0 from source rather than `apt-get install
   tippecanoe`, because apt's shipped version is below the floor — this
   deliberately reverses an earlier decision ("it is one command rather
   than a source build") once that earlier decision was shown to ship a
   silent data-loss bug.

Build flags locked: `-Z0 -z12 -r1 --drop-densest-as-needed`. `-r1` disables
tippecanoe's own density thinning — `budget.ts`'s per-feature minzoom does
that job instead, and letting both run would double-apply the cut.

Layers: `stories` (per-tile top-K) and `country-top` (top-1-per-country,
minzoom 0, exempt from budget). Corrected build measured, not predicted:
15–18 stories per tile at world/London/US/NY/Delhi; archive size 14.5 MB →
7.2 MB; country floor 1 → 162 of 163 countries represented.

### Overflow-as-feature at ~57%

The overflow trigger (~50% target) measured at 56%, then 57.3%
(19,344/33,778) on a full window, then re-read across four post-weak-city
runs at 57.4/57.4/58.8/56.8% — flattened at roughly 57±1% of the pool on a
full run. Every overflow reading taken before the tippecanoe fix landed
"counted an intention nothing acted on," because nothing was actually
being deferred at render time before that date — those historical numbers
are not comparable to the post-fix ones. What is left as an open lever is
`K` itself, which is gated on a phone-hardware profiling pass that has
never been run — see `#open-items`.

### Rejected Alternatives

- **Trusting `man tippecanoe`'s documented directive placement without
  testing against the exact shipped binary version.** The documented
  behavior was correct for the spec but not for the buggy 2.49.0 build
  that both the dev machine and CI actually ran — the fix had to be
  verified by decoding real tiles at real coordinates, not by reading the
  man page.
- **Letting tippecanoe's own `--drop-densest-as-needed` do the density
  cut instead of a per-feature minzoom.** Rejected — the budget needs to
  be tile-local and rank-aware (the `#ranking` comparator), which a global
  density flag cannot express; `-r1` disables it explicitly.
- **A relative/global overflow trigger.** The ~50% target is a tripwire
  for investigation, not a live control input — see `#operations` for the
  broader pattern of relative-vs-absolute thresholds and why absolute won.

---

## Ranking

```
salience = log1p(distinct_domains) + 0.5 * log1p(distinct_source_countries)
```

(`worker/rank.ts`, `SOURCE_COUNTRY_WEIGHT = 0.5`.) Both terms are
log-scaled because both distributions are heavy-tailed; domain count is
weighted 2:1 over source-country count. Source-country count says a story
crossed borders; it is a ranking signal only and never routes a story
anywhere in the UI — there is one content model (`#frontend`).

**This requires real story grouping, not title dedup.** Title dedup alone
*inverts* the signal: wire copy republished verbatim under one headline
merges into a single high-domain story, while the New York Times, the BBC,
and the Guardian each writing their own distinct headline about the same
event split into three separate one-domain stories — exactly backwards.
`FINDINGS.md` measured the syndication problem this guards against:
overall duplicate-title rate 22.0%, syndication multiplier 1.50× overall
and 1.59× for city-pinned records; `iheart.com` alone contributed 11.2% of
an entire hour's feed under only 17 distinct titles for 35+ sampled
records — one story republished across dozens of radio-station domains
that GDELT's `SourceCommonName` field happens to collapse back into one
name, which is exactly what makes distinct-domain-count survive as a
robust ranking signal despite that syndication source.

Real grouping (`worker/group.ts`) uses: ≥2 shared `V2EnhancedThemes`,
excluding themes above `THEME_CEILING = 0.15` document frequency (a theme
on 15%+ of the feed cannot tell you which two articles are the same
story), a title-token Jaccard floor (`JACCARD_FLOOR = 0.25` — flagged in
the code itself as "the one constant here without a measurement behind
it," tuned by eye rather than fitted, worth revisiting once real
placements can be judged against it), and a 0.5° location cell. Title
dedup then runs on top of grouping to catch exact syndication within an
already-formed group.

### The tier-1 comparator

Selection sorts lexicographically on:

```
(tier1_fresh DESC, salience DESC, newest_tier1_article DESC)
```

`tier1Fresh` means any article in the group came from a tier-1 outlet
(originally 28 domains, expanded 2026-08-13 to 128 domains covering every
region) within `TIER1_WINDOW_HOURS = 48`; everything else uses
`GENERAL_WINDOW_HOURS = 24`. That single comparator produces all three
behaviors the design wants, with no timers and no per-area state: a
tier-1 story keeps its slot because it re-qualifies every run for 48 hours
after its newest tier-1 article; only another tier-1 story can displace it,
because the non-tier-1 population cannot reach the first sort key at all;
and after 48 quiet hours the class empties itself and top-K falls back to
plain salience — the *same code path* as an area that never had tier-1
coverage in the first place. "Fall back" and "never had any" are not
special-cased.

**The cost, stated plainly:** in a crowded US or UK tile, a Newsweek or LA
Times story can now outrank a genuinely bigger story from a lower-tier
domain. That is the trade being bought on purpose — tier-1 coverage is
about 1% of the feed but concentrates in the same countries where
`#tiles-budget`'s per-tile cap actually binds, so protecting it there is
affordable. It does make tier-1 list membership *load-bearing rather than
descriptive*: the list was built to measure coverage (`FINDINGS.md §11`)
and now grants precedence instead. Measured after the 128-domain
expansion, tier-1 share moved from 1.04%→3.62% of article slots and
1.35%→4.74% of groups; `thehindu.com` alone holds roughly a third of
tier-1 slots — worth re-measuring, with a plan to demote tier-1 to a
salience bonus rather than a hard sort key if group-level tier-1 share
ever clears ~15%.

### Rejected Alternatives

- **Title dedup as the sole grouping mechanism.** Measured to invert the
  ranking signal on syndicated wire copy — rejected in favor of
  theme+Jaccard+location grouping, with title dedup layered on top.
- **A tier-1 flag as a UI badge or a separate filter, rather than part of
  the sort comparator.** Rejected — folding it into the comparator's first
  sort key produces "keeps its slot / only tier-1 displaces it / fades
  after 48h with no special-casing" for free, with no per-area state to
  maintain.
- **The blindspot flag** ("no major outlet has this story") — the inverse
  use of the same tier-1 outlet list. Measured to fire on 98.6% of
  stories, because GDELT barely crawls the wires (`FINDINGS.md §11`:
  Reuters, AP, NYT, WaPo, WSJ, NPR, Bloomberg, Al Jazeera, FT, Politico,
  USA Today, Time, Telegraph, France24, Economist, AFP, and ABC News
  combined for **zero records** across three hours spread across the
  clock). A flag that fires on 98.6% of stories is not a signal. Killed;
  the outlet list was kept and inverted into the priority rule above
  instead of discarded.

---

## Regions

Clicking a country or state label opens a panel of that region's top
stories. It cannot be built from the tiles.

**Why the panel cannot be queried from tiles:** `#tiles-budget`'s
per-tile top-K bakes deferred stories into higher-zoom tiles, so a
country's tile at world zoom does not contain most of its stories — a
panel built on `queryRenderedFeatures` at world zoom would call one floor
pin "Pakistan's top stories." Measured 2026-08-21: London holds 136 pins
in the full ranked pool; only 13 are ever rendered at z10.

**The published region index** (`archives/regions-<hash>.json`, written by
`worker/regions.ts`, referenced by the manifest's `regionsUrl`) is a
separate, independently-published artifact: `REGION_TOP_N = 10` rows per
region, but `total`/`sources` are counted over the **whole** ranked pool,
not the capped rows — in one measured run 68 of 163 regions exceeded the
10-row cap (the largest held 977 stories), and nothing blocked is stubbed:
counting the rows actually on screen would print a confident wrong number
for those 68 regions, which is exactly the kind of silent-plausible
failure `#method` warns against.

First measured 2026-08-13 10:08 UTC: 449 keys (163 countries + 286 adm1),
1,685 rows, 465 KB raw / 151 KB gzipped, 282 bytes/row. Re-measured 13:48
UTC on a full window: 903 keys (191 countries + 712 adm1), 3,817 rows,
1,069 KB raw / 328 KB gzipped, 287 bytes/row — trending toward roughly
500 KB / 5,000 rows as adm1 coverage fills in. Cheap cuts were measured
and found too small to matter (capping adm1 at 5 saves 60 KB; dropping the
`place` field saves 27 KB); the real lever is architectural — per-region
keys instead of one flat file — but deliberately not built, since the
index is lazy-fetched on first panel open rather than at page load, which
already keeps it off the critical path.

The manifest's `regionsUrl` is optional: a manifest published before the
region index existed is still a valid manifest, and the browser keeps
rendering the map from it rather than failing over a panel it cannot open
yet. `regionsVersion` (see `#cities-continents`) exists for the same
reason at a finer grain.

### The label-based gesture, and no name matching, ever

Clicking a landmass on the map cannot distinguish "California" from "the
United States" — clicking the *word* "California" can. Three measurements
shaped this:

1. MapTiler and OpenFreeMap use different label schemas — MapTiler splits
   labels across `country_label`/`state_label`/`city_label`/`continent_label`
   source-layers; OpenFreeMap uses a single `place` layer discriminated by a
   `class` property. MapTiler has already changed its own schema once.
   `lib/labels.ts` discriminates by provider.
2. Label zoom ranges differ by provider (country z2–12 on MapTiler, z0–9 on
   OpenFreeMap; state z2–11 vs z5–8) — the default camera zoom was
   originally 1.5, at which no country labels render on either provider, so
   `DEFAULT_ZOOM` was forced to 2 specifically so the click gesture has
   something visible to click on arrival.
3. The headline symbol layer, if simply appended last, wins MapLibre's
   symbol-collision resolution against the basemap's own place labels and
   deletes them. Measured over the US at z5: 2 place labels drew with the
   headline layer visible versus 6 with it hidden — the headline layer is
   now inserted **below `firstPlaceLabelLayerId`** in the style stack,
   re-measured at zero suppression afterward. Place labels are load-bearing
   UI now, not basemap decoration, and the layer order says so.

**State labels carry no region code on either provider.** Joining
"California" to `USCA` by name would be the FIPS join trap (below) wearing
a new hat. So the label supplies only the *level* (country vs. state); the
region id itself comes from hit-testing the app's own `boundaries.pmtiles`
at the label's **anchor point**, never the raw click point (a click can
land off-coastline or on a neighboring landmass). No name matching happens
anywhere in this path. City and continent labels need a different
mechanism entirely — see `#cities-continents`.

### The FIPS trap

GDELT uses FIPS 10-4 country codes, not ISO 3166. Four collide with
entirely different countries under a naive two-letter join: `RS` is Russia
(ISO: Serbia), `CH` is China (ISO: Switzerland), `IS` is Israel (ISO:
Iceland), `AS` is Australia (ISO: American Samoa); `UK` is unassigned in
ISO and fails loudly rather than silently. **A naive join puts Russian
news in the Balkans, silently, with correct-looking output** — the
dangerous kind of bug, because nothing about the result looks wrong.

The crosswalk (`scripts/build-crosswalk.ts`, `data/crosswalk.json`) is
built from Natural Earth's `FIPS_10` column, populated on 236 of 258
features; 9 of 168 observed codes needed committed manual overrides
(`data/fips-overrides.json`) — Israel, Norway, West Bank, Serbia, Réunion,
Svalbard, South Sudan among them, since Natural Earth has no `FIPS_10`
value for Israel at all. `worker/refdata.ts` asserts the crosswalk at load
time (`assertUsable`) rather than trusting it silently; coverage after
overrides is ~99.95% of volume.

A related incident inside the same trap: Natural Earth wrongly writes
`IN22` for both Tamil Nadu and Puducherry, but `IN22` is FIPS 10-4's actual
code for Puducherry — GDELT unambiguously emits `IN25` for Tamil Nadu. Fixed
via an `ADM1_FIPS_OVERRIDES` entry, found and fixed rather than assumed
correct because the two sides (Natural Earth's column and GDELT's own
codes) were checked against each other directly. Separately, Natural
Earth's `fips` column is not a unique key at all — 187 codes are shared
across multiple features, 16 of which cross real borders (15 in the
Balkans, stale about Kosovo/Serbia/Montenegro/North Macedonia, plus one in
Indonesia/Timor-Leste) — logged loudly at load time rather than "fixed"
without evidence from both sides of a genuinely disputed or ambiguous
boundary.

`lib/flag.ts` independently guards against a related slicing bug: a
`CONT:EU` continent id being mis-sliced as if it were a two-letter country
code and read as `"CO"` → Colombia in the region-panel breadcrumb. Caught
and fixed with an explicit `FIPS_SHAPE` regex rather than assumed safe by
construction.

### Rejected Alternatives

- **Querying rendered tiles for a region's top stories.** Cannot work —
  the per-tile budget means most of a region's stories are not in the
  tile at the zoom the panel opens at.
- **Matching label text to region id by name.** The FIPS trap under
  another name; the resolver hit-tests boundary geometry instead.
- **Trusting Natural Earth's `fips` column as a unique join key.** It
  isn't — 187 codes are shared, 16 across real disputed or stale borders;
  the crosswalk is asserted and overridden rather than trusted.
- **Eagerly loading the full region index at page load.** Rejected in
  favor of lazy-fetch on first panel open — the index is optional on the
  manifest for exactly this reason.

---

## Cities, Continents

Work from 2026-08-21, previously undocumented anywhere. Clicking a city or
continent label needs a different mechanism than the boundary hit-test
`#regions` uses, because neither label carries a stable region id on
either basemap provider — verified live against the MapTiler style: a
`city_label` feature carries `{name, iso_a2, rank, capital}` and a
`continent_label` feature carries only `{name}`. Neither has an id.

### Cities

`worker/cities.ts` builds one shard per country: **PINs only** — container
stories are already counted by the region index, so filing them under a
city too would double-publish the same story. Clustered by
`(admin area, lowercased city name)`; the cluster key is never sent to the
browser, so name collisions across genuinely different cities (many
countries have a "Springfield") are safe — the browser only ever gets
coordinates and a country-scoped shard. `CITY_TOP_N = 5` (half of
`REGION_TOP_N`), chosen because the long tail of distinct cities is what
drives shard size — the US shard alone clusters roughly 500 distinct
cities — while the shard header still reports true uncapped totals rather
than the capped row count, for the same reason `#regions`' `total` field
counts the whole pool. Each cluster's coordinate is the median lat/lon of
its members, which is robust to one mis-geocoded outlier pulling a
centroid off.

Uploaded with `CITY_UPLOAD_CONCURRENCY = 8` — 121+ country shards uploaded
sequentially would add 12–36 seconds to every run; pooled concurrency plus
one content-hashed directory prefix means retention only has to track one
string, not one per country.

**Browser side** (`lib/cities.ts`): a country's city shard is fetched
lazily on first city-label click in that country and memoized. **A 404 is
explicitly normal**, not an error — a country with no clustered cities
simply has no shard published at all (`worker/cities.ts` skips writing
empty indices), so the browser must not surface a 404 as a failure. Only a
5xx or a network failure is treated as real, and it clears the memo cache
so a retry is possible — a 404 clearing the cache would just refetch and
404 again forever for a country that genuinely has no city shard. Once
fetched, the nearest cluster to the click is chosen by haversine distance,
capped at `CITY_SNAP_KM = 25`, fixed regardless of zoom level "so the same
click answers the same way at every zoom." Village- and suburb-level
labels (`town_label`, `place_label` in MapTiler's schema) are deliberately
refused as a click target — they would sit inside a city's own 25 km snap
radius and print the parent city's stories under a suburb's name, a
silent misattribution rather than an honest "no data here."

### Continents

`lib/continents.ts` resolves a `continent_label` click through a **closed,
seven-entry table** (`CONT:AF`, `CONT:AN`, `CONT:AS`, `CONT:EU`, `CONT:NA`,
`CONT:OC`, `CONT:SA`), not a geometry hit-test — there is no continent
boundary layer in `boundaries.pmtiles` to hit-test against. The join trap
here is a naming mismatch between the basemap and the reference data: on
the live MapTiler style, the `continent_label` feature covering Oceania
carries `name:en = "Australia"`, while Natural Earth's own `CONTINENT`
column for the same landmass calls it `"Oceania"`. Both spellings are
mapped into the single `CONT:OC` id inside `NAME_TO_ID`, found by checking
the actual label text against the actual reference data rather than
assuming the two would agree.

`worker/publish.ts` bumped `REGIONS_VERSION` (`lib/types.ts` `Manifest`)
from 1 to 2 specifically for the arrival of `CONT:*` keys in the region
index. A manifest at version 1 (or with the field absent) must be read by
the browser as "this index has not been extended to continents yet" —
`unavailable` — rather than a fetch that succeeds and returns an empty
entry, which would print "no stories" over a continent that simply has not
been indexed, a silent-plausible failure of exactly the shape
`#regions`' uncapped-total design already guards against.

### Rejected Alternatives

- **A polygon hit-test for continents, matching the country/state
  mechanism.** No continent boundary geometry exists in
  `boundaries.pmtiles`; the closed seven-name table is a deliberately
  small, fully-enumerable substitute rather than a partial geometry build.
- **Trusting a fetch failure uniformly as "no data."** Splitting 404
  (normal, a country with no cities) from 5xx/network error (a real
  failure worth retrying) was necessary — a uniform treatment would either
  hide real outages or retry-loop on every cityless country forever.
- **Filing container stories under their city too**, for city-panel
  completeness. Rejected — it would double-publish the same story under
  two different panels with no way for a reader to know they were the same
  count.

---

## Frontend

### Layer stack and z-order

Bottom to top: unpainted hit layers (`fill-opacity: 0`, present purely for
`queryRenderedFeatures` to have something to hit-test) → boundary outline
layers (line only, never filled — a filled country would read as a data
layer rather than a UI affordance) → the country-top circle layer
(maxzoom 4) → the stories circle layer → the headline symbol layer,
inserted **below the basemap's own place-label layers** via
`firstPlaceLabelLayerId` (see `#regions` for the measurement that forced
this) → a duplicate top-5 circle layer drawn on top of the stories layer
(needed because MapLibre's `circle-sort-key` is a layout property, and the
top-5 highlight is feature state resolved only at paint time — sort order
can't respond to it, so the duplicate exists purely to guarantee paint
order) → spider legs and leaves (see below) → the selection triangle
symbol layer, topmost, with forced overlap and placement so it can never
be dropped by collision or hide the labels under it.

### The two-mark pin vocabulary

Collapsed 2026-08-14 from three marks to two. Before: a top-5 story was a
solid orange disc scaled 1.15× larger (`TOP_SCALE`, since deleted); a PIN
was an orange core inset inside a white ring; a CONTAINER was a solid
white disc at full footprint — three visual identities on a map whose
smallest pin is 3px across. After: any story is a solid `#D24F39`
(`ACCENT`) disc at full footprint; the top five on screen are the same
disc with a white ring around it (`RING_RATIO = 0.32`, inset so both
states share one footprint — MapLibre grows a stroke outward, so the ring
version's core is inset by exactly the ring it gains, and a ringed pin is
never larger than its neighbors). `circle-color` became a bare literal
rather than a `case` expression in the same pass — no story's fill
depends on a per-feature decision, because nothing about a story's
identity is expressed through fill color, only through radius
(`radiusBySalience`) and the ring.

**Containers are no longer drawn on the map at all** — filtered out of
every pin layer by a shared `NOT_CONTAINER` predicate. Their existence is
communicated in words ("somewhere in Texas") in the region panel instead
of as a mark, an accepted cost: the zoomed-out world view is visibly
sparser than before this change, because the country-floor layer below z4
is one story per country and many of those floor stories are containers.

**One `case` came back deliberately**, for the reader's own gesture rather
than a story property: the open (selected) story's disc fills `MARK`
(`#C05AC4`, hand-tuned against the live map, twin of a CSS custom property
that MapLibre paint expressions cannot read — the TypeScript constant is
the source of truth and the CSS token carries a comment saying so). This is
the one property of a pin the *reader* set by clicking, which is why it is
allowed to be a color when nothing else about a story is.

### Spiderfy

Below `SPIDERFY_ZOOM = 9`, the budget admits one story per exact
coordinate — GDELT places every story in a given city at that city's
identical centroid, so before this existed, stacks were common: measured
before the fix, the US at z5 showed 52 stories at 25 distinct rendered
locations (the biggest stack held 11), and Chicago at z9 showed 33 at 15
locations (biggest stack 14) — roughly two-thirds of every visible story
was drawn directly underneath another one, invisible. At or above
`SPIDERFY_ZOOM` the cap lifts and the client spreads a stack into legs and
leaves, computed from rendered features with pixel offsets through the
live camera, as a GeoJSON overlay rather than individual map layers per
leg.

### The selection triangle and the opening-card bubbles

The selection wedge (`lib/pin.ts`) is rasterized in TypeScript rather than
shipped as an image asset — this repo has no binary image assets by
policy, so a colour used in two places (the map's paint palette and a
sprite file) cannot drift, because there is only one file. `MARK` is
imported from `lib/layers.ts` into `lib/pin.ts` for exactly this reason.

The five bubbles that greet a reader on load (`components/StoryBubbles.tsx`,
`lib/bubble.ts`) are **an opening card, not a live caption** — a deliberate
reversal of the original design, which re-ranked and re-projected bubbles
on every camera `idle`. They are now captured once, at the map's first
`idle` on the default world view, and taken down for good on the reader's
first camera move of any kind (drag, wheel, keyboard, or a search-driven
`flyTo`) — `dismissBubbles` arms only after the capture, so a startup
camera animation cannot dismiss bubbles that were never drawn. The ring
that marks the current top-5 keeps recomputing live at every `idle`
regardless — "which stories matter *here*" stays a live question even
though the opening sentence, once said, is not repeated. `lib/bubble.ts`'s
placement rule is pure and deliberately tested against a **constant** box
size (135×131) rather than a real measured DOM height, because a bubble
that renders shorter than its reservation only ever has more clearance
than it was promised — measuring `offsetHeight` would put a DOM dependency
inside the one rule worth unit-testing, to buy clearance nobody asked for.

### `PanelStory`, the §2.6 allowlist

`lib/story.ts`'s `PanelStory` type is the entire content model the UI is
allowed to show, enforced as a literal allowlist — exactly **eight**
fields: `title`, `source`, `url`, `place`, `kind`, `date`, `image`,
`more`. `story.test.ts` pins that exact list and asserts that `salience`,
`domains`, `tier1`, `region`, `country`, and an injected `body` string are
all dropped by the constructor, `panelStory()`. This exists because the
project links out to articles and never reproduces article text — a
copyright constraint that is load-bearing, not a nicety — and because the
tier-1 preference (`#ranking`) must stay invisible in the UI even though it
is very visible in the ranking. "Widening this list to make a test pass
is the failure mode" is written directly into the source as the thing not
to do.

**`topic` is on the list by decision, not by omission.** `worker/topics.ts`
exists and computes a topic per story, but the card shows no topic label —
chips that would filter a region's rows are a region-panel feature, not a
story-card one — and `story.test.ts` asserts the field is dropped, so if
the card ever grows a topic display, the assertion fails and the decision
has to be taken again explicitly rather than drifting in silently. See
`#open-items` for `worker/topics.ts`'s own unshipped status.

### Rejected Alternatives

- **Three distinct pin marks (top-5 / pin / container).** Collapsed to two
  — a third visual identity on a 3px-wide mark was unreadable, and the
  container mark's own affordance moved into the region panel instead.
- **A `circle-color` `case` expression for ordinary story state.** Removed
  — nothing about a story's identity should be expressed through fill,
  only through radius and ring; the one exception (selection) is the
  reader's own gesture, not a story property.
- **Bubbles that track the live viewport, re-ranking on every camera
  move.** Reverted to a one-shot opening card — it removed most of the
  event wiring (`render`/`idle` subscriptions, a ref-based ranking pass
  needed to dodge a real ordering bug where the overlay's handler saw a
  React value not yet committed) and matches what the bubbles are
  actually for: an opening sentence, not a live caption.
- **Rendering, then measuring `offsetHeight` for bubble collision.**
  Rejected in favor of a constant reservation box, to keep the collision
  rule pure and unit-testable without a DOM.
- **Widening `PanelStory` to include `topic` now that the classifier
  exists.** Explicitly deferred — the allowlist test enforces that the
  omission is a decision, re-visitable, not a silent gap.

---

## Basemap

`lib/basemap.ts` returns a MapTiler hosted style
(`streets-v2`) when `NEXT_PUBLIC_MAPTILER_KEY` is set, and falls back to a
keyless OpenFreeMap positron style with no account and no key at all when
it is not — `provider` is surfaced in the UI so a keyless deploy is
visibly different, never silently degraded. `DEFAULT_ZOOM = 2` rather than
the more natural-looking 1.5, specifically because MapTiler's
`country_label` layer does not render below z2 — at 1.5 the `#regions`
click gesture would land on a world view with nothing labeled to click.

**The billing correction.** `HANDOFF.md §3.1` originally recorded the
basemap as "MapTiler hosted style, 100k loads/mo free." `spikes/basemap/CASE-STUDY.md`
found that wrong by roughly a factor of 200: MapTiler meters *sessions*
(one page load, unlimited pan/zoom inside it — 5,000/month free) only for
its own SDK; a **third-party client importing `maplibre-gl` directly**, which
is what Sonder does, is metered by **request** instead (each tile is one
request), with a 100,000-request/month free allowance — and MapTiler is
explicit that switching from request-metering to session-metering is "not
technically possible" for a third-party client. A standalone measurement
harness — same `maplibre-gl` build, same style URL, same initial camera as
`MapView.tsx`, requests counted via `transformRequest` — measured a
scripted 2–3 minute visit (world view → country → pan → city → second
city → back to global) at **193 requests on a phone viewport, 304 on
desktop**. That puts the real free-tier ceiling at roughly 330–520 visits
a month, not 100,000, and the cost scales with exactly the interaction the
product is designed to encourage — one "jump to a second city" cost more
requests than the entire initial page load. Vector tile count also proved
DPR-independent (149 tiles at 2× vs. 152 at 1×), which is the strongest
argument against a raster alternative on a retina phone.

**Decided 2026-08-10 (`HANDOFF.md §6` decision 11): stay on MapLibre GL JS
+ MapTiler, billed per request.** See `spikes/basemap/CASE-STUDY.md` for
the full option comparison and sourcing; the load-bearing reasons,
restated:

- **Not Google Maps 2D Tiles**, despite being technically usable via a
  plain `{z}/{x}/{y}` template MapLibre can consume: raster rather than
  vector (no fractional zoom, more bytes, retina needs `scaleFactor2x`
  which halves the effective free tier), requires a credit card on file
  (which directly contradicts "free tier everywhere" — the failure mode
  changes from "map pauses" to "a bill arrives," on a public repo whose
  key ships to the browser), a heavier attribution requirement (a visible
  logo image plus full data attributions, real screen budget on a phone
  already carrying other UI), an async stateful token flow replacing
  `lib/basemap.ts`'s pure synchronous zero-I/O function, and it breaks the
  one-line style-URL escape hatch this design deliberately bought.
- **Not the MapTiler SDK JS** (session-metered, 5,000/month, roughly
  10–15× the request-metered headroom on paper). Rejected because the
  headroom is theoretical at portfolio traffic (a résumé link draws tens
  of visits a month; the request-metered floor of ~330 already covers
  that with room, and neither option survives a genuine traffic spike —
  both hard-pause on their free tier regardless), because the SDK is
  MapTiler-specific and would either kill or fork the OpenFreeMap escape
  hatch, and because deferring the switch is nearly free — the SDK wraps
  MapLibre GL JS closely enough that switching later stays a small change,
  so there is no lock-in penalty for waiting. Revisit trigger: sustained
  traffic above ~200 visits/month.
- **The OpenFreeMap escape hatch** is not merely a fallback — it is what
  the app actually ran on throughout the CASE-STUDY investigation itself
  (no key existed yet), and it is the only reason the tile-count
  measurements above and two real Phase-2 render bugs could be found at
  all. It stays wired up as a one-line style swap.

### Rejected Alternatives

- **Google Maps 2D Tiles API.** Technically usable, rejected on
  raster-vs-2.5s-mobile-target, the credit-card requirement, attribution
  weight, and breaking the escape-hatch property.
- **MapTiler SDK JS (session billing).** Rejected — theoretical headroom
  at this traffic level, MapTiler lock-in, and no cost to deferring.
- **OpenFreeMap as the primary basemap** instead of the escape hatch.
  Noted, not adopted: it removes the quota question entirely and is what
  the app ran on during the very investigation that measured MapTiler's
  real ceiling, but MapTiler's free tier is sufficient at this project's
  actual traffic, and the OpenFreeMap path stays one line away regardless.

---

## Operations

### The count band

`publish.ts` validates each run's output against an **absolute** band,
`COUNT_BAND_MIN = 2000`, `COUNT_BAND_MAX = 60000`, before publishing
anything. Calibration ladder, each rung a measured or derived number:

| Value | What it is |
|---|---|
| 1,467 | A one-bundle smoke run (`BUNDLE_CAP=1`) |
| **2,000** | **Floor** — roughly 20× below steady state; catches a real collapse or an accidental `BUNDLE_CAP` left set, and can never false-fire against real traffic |
| 40,700 | Steady state — `#data-reality`'s measured distinct city stories/day |
| **60,000** | **Ceiling** — 1.47× steady state |
| ~75,000 | Where grouping stops merging entirely (~112,500 records/day × ~67% placed) |

"The ceiling has to sit between steady state and the point grouping stops
functioning, or it is not informative" — a rounder, more conservative-
looking number like 25,000 was proposed and rejected specifically because
it sits *below* steady state, which would have made it a permanent outage
with no self-healing path rather than a real tripwire.

**Why only the count band relaxes, and only when gated on non-empty
history.** The band was originally *relative* — a trailing median of
publish history, `[0.4×, 2.5×]` — and it failed twice in one day, once at
each bound, because a refused run never appends to history, so the median
that refused it never moves: "fail-closed becomes fail-forever." It was
rewritten to the two absolute constants above, which read no history at
all. `BAND_RELAX_AFTER_MS = 8h` (the monitoring cadence's 2× threshold,
`#failure`) lets **only the count band** stand down after being blocked
that long, logging a loud WARN; `MIN_GROUPS`, `MIN_COUNTRIES = 15`, and
`MIN_TITLE_RATE = 0.95` stay armed unconditionally — "they are the ones
that catch real garbage." The relax valve is gated on `history.length > 0`
specifically because `staleness()` returns `Infinity` on an empty history,
which the relax logic would otherwise read as "blocked past 8h" on the
very first run of a fresh store — publishing any count at all rather than
validating the first real run properly. `BAND_MIN_HISTORY >= 3` had been
covering this accidentally before the absolute-band rewrite; it is now an
explicit, named guard.

### Publication order

Validate output invariants against pre-upload stats, then: upload the
content-hashed archive, upload the region index, upload city shards, then
**flip the manifest last** — the manifest is the only mutation of a stable
key in the whole sequence, and it happens after everything it could
possibly reference already exists. Pruning runs only *after* the flip, and
only if the flip actually happened, sweeping the whole `archives/`
directory rather than a narrower prefix.

**The pruner bug, fixed 2026-08-14/15:** `archivesToPrune` filtered
listings on `ARCHIVE_DIR` (`archives/`), but the call site that actually
deleted files passed the narrower `ARCHIVE_PREFIX` (`archives/stories-`) —
a filter cannot delete what the listing it's filtering never returned, so
no `archives/regions-*.json` file had ever been pruned since the region
index shipped: one ~1.24 MB orphan every four hours, invisible from the
outside because archive retention itself worked, `pruned` reported a
plausible-looking number, and the map never noticed — it showed up only as
accumulating storage. The existing test only ever asserted the *retained*
half of pruning; the regression test publishes a fourth generation
specifically so the first generation ages out, and it fails in exactly the
right place — the `stories-gen1` assertion passes, the `regions-gen1`
assertion fails — localizing the leak to the index alone.

### R2 traps

Migrated from Vercel Blob 2026-08-23 — see `i-want-you-to-eager-stardust.md`
for the full plan. Two of the three traps previously recorded here were
Blob-specific and are dropped rather than kept as history: public-or-nothing
access mode (Blob's access setting; R2 has no such fixed-at-creation
distinction) and the REST/SDK overwrite split (an artefact of `@vercel/blob`
specifically). The third — stale CDN reads — is not merely gone, it is
*solved*, and worth recording because it shaped `worker/store.ts`'s design:

1. **Stale-CDN reads, solved by routing off the CDN.** The Blob
   implementation's `get()`/`remove()` fetched the public CDN URL, because
   the Blob REST API offered no authenticated GET — measured directly: an
   overwrite of `state/publish-history.json` read back as the *previous*
   body, `X-Vercel-Cache: HIT, Age: 6`. R2's S3 `GetObject`/`DeleteObject`
   are authenticated and hit the origin directly, so `worker/store.ts`
   routes `get()` and `remove()` through the S3 endpoint instead of
   `urlOf()`'s public URL, eliminating the entire stale-read class.
   `urlOf()` still returns the public custom-domain URL — that value is
   what goes into the manifest for the browser.
2. **Range-compression under Cloudflare's CDN.** Cloudflare compresses
   objects by default, which corrupts HTTP Range responses — wrong total in
   `Content-Range`, weak ETags, truncated bodies. This is the documented
   cause of maplibre/demotiles#35, where PMTiles broke behind Cloudflare.
   The fix is `Cache-Control: no-transform` from the origin on `PutObject`,
   which `store.ts`'s `putBinary` sets unconditionally — the only artefact
   it ever writes is the range-requested archive. `putText` (the manifest,
   regions index, city shards — all JSON) deliberately does NOT set it:
   those are fetched whole, never by range, and compression is a win there.
   If the city shards ever become a range-addressed pack (see the
   write-reduction follow-up), they move to `no-transform` too.
3. **CORS, including the error path.** Vercel Blob sent
   `Access-Control-Allow-Origin: *` for free; R2 does not — it has to be
   set explicitly in the dashboard (R2 exposes no `PutBucketCors` API).
   `AllowedOrigins` is `["*"]`, deliberately: it is not access control (a
   `curl` ignores CORS entirely) and R2 egress is free, so a narrow list
   would only break the per-branch Vercel preview deploys this project
   relies on, for no security benefit. The subtler half: a *missing*
   object's 404 needs `Access-Control-Allow-Origin` too, or the browser
   fetch rejects with a CORS `TypeError` before the response status is ever
   read — `lib/cities.ts:23-25` treats 404 as "this country publishes no
   shard", and that branch never runs if the error response lacks the
   header. The status code is the easy half of getting a 404 right; the
   header on it is the half that actually breaks silently.
4. **The `ListObjectsV2` XML parse has to guard against `<Prefix>`, and
   against not being a listing at all.** The response body carries a
   top-level `<Prefix>archives/</Prefix>` alongside the `<Key>` elements a
   loose regex would also match, injecting the prefix itself into
   `archivesToPrune`'s input, which passes it straight to `store.remove`.
   `parseListPage` matches `<Key>` only. It also refuses to parse anything
   that isn't a `<ListBucketResult>` — an `<Error>` document or an HTML
   proxy page returned with a 200 would otherwise parse as "zero keys
   stored", meaning `assertStoreReachable` passes while retention silently
   prunes nothing, forever. That is the same shape of invisible failure as
   the regions-index pruner leak below.

A fifth trap carries over unchanged from Blob: a GitHub Actions secret
holding a quoted value that `node --env-file` strips locally but GitHub
Actions stores literally, so the same credential can work locally and fail
in CI. `assertStoreReachable()` — one authenticated `list` call at the very
top of `main()` — exists to catch exactly this class of credential problem
before any real work happens, deliberately kept to one call per run since
`ListObjectsV2` is a billed R2 Class A operation. It cannot catch a
read-only R2 token, though: `list` succeeds on read-only access, and a run
using one dies later, inside `appendShards`.

### Two shard families

`state.ts` maintains `run-<ts>.jsonl` (every article, expires 24h) and
`t1-<ts>.jsonl` (tier-1-touched groups only, expires 48h). This split is
forced, not a convenience: `FINDINGS.md`'s maturity-delay measurement found
only **0.29%** of story groups are still present in the feed 19 hours
after first appearing — GDELT's stream turns over almost completely inside
a day. A pure 24-hour re-fetch strategy would lose essentially every
tier-1 story long before its 48-hour freshness window (`#ranking`)
elapsed, so persisted state is what makes the tier-1 rule possible at all,
and the split into two families is what makes it cheap: tier-1 is roughly
3.6% of the feed, so writing 48 hours of *every* shard (doubling total
state storage) for no benefit was rejected in favor of writing 48 hours of
only the tier-1-touched subset. Groups appear in both families during
their first 24 hours, so `state.ts` dedupes the assembled pool by
`(domain, url)` on read — without that, a carried-over group would
double-count its own domain set and inflate its own salience.

### The manifest and `REGIONS_VERSION`

`Manifest` (`lib/types.ts`): `archive` (content-hashed key), `url`,
`regionsUrl?` (optional — a manifest published before the region index
existed must stay valid), `regionsVersion?` (bumped to `2` when the index
gained `CONT:*` continent keys — see `#cities-continents` — so an old
manifest reads as "not yet indexed" rather than "confidently empty"),
`citiesBase?` (URL prefix for per-country city shards, optional for the
same reason), `generatedAt`, `watermark`, and a `stats` object
(`groups`, `countries`, `tier1Groups`) that `#failure`'s monitoring reads
directly. `KEEP_ARCHIVES = 3`, `HISTORY_LIMIT = 24`.

### Rejected Alternatives

- **A relative, trailing-median count band.** Failed twice in one day —
  "fail-closed becomes fail-forever" when a refused run cannot move the
  history that refused it. Replaced with two absolute constants.
- **Relaxing every output-invariant guard after 8 stale hours, not just
  the count band.** Rejected — `MIN_GROUPS`, `MIN_COUNTRIES`, and
  `MIN_TITLE_RATE` stay armed unconditionally because they catch real
  garbage rather than a volume swing.
- **A narrower prune-listing prefix scoped to just the story archive.**
  This was the actual bug, not a design choice — fixed to sweep the whole
  `archives/` directory the filter already claimed to cover.
- **Doubling the general 24h shard retention to 48h for every article**,
  to simplify away the two-family split. Rejected on measured cost — it
  would double state storage for a freshness guarantee only the ~3.6%
  tier-1 slice needs.
- **Trusting the SDK's default overwrite-refusal behavior at the REST
  layer.** The REST API does not share that guard; explicit
  `allowOverwrite` headers are required and documented as a trap for
  future maintainers.

---

## Failure

`worker/run.ts`'s own header states the design intent directly: **"Nothing
here is silent."** A run that publishes nothing sets `process.exitCode = 1`
so the GitHub Action fails and the platform's own "run throws" email
fires — that is one alarm. Separately, that same run does not call
`pingHealthcheck`, so a dead-man switch (a healthcheck ping expected every
run, alerting after `#operations`' 2× cadence with no ping) fires too —
**"Those are two independent alarms on the same event, which is the
intent: the failure this project is most afraid of is the one nobody
notices."** A count-band incident is the concrete case both alarms were
built for: two scheduled runs failed back to back and the map itself
simply stopped updating at a fixed point in time, with no visible error on
the map itself.

`formatSummary()` is described in its own doc comment as "the only
interface §8 has to five of its seven failure modes," and it is called
**unconditionally, including on the failure path** — a run that publishes
nothing still prints its full summary before setting the exit code, so the
Action log always shows what happened rather than just that something
failed. Four WARN tripwires are built into it:

- **`shortRows > 0`** — a nonzero short-row count means the schema canary
  tripped; GDELT may have changed its column layout.
- **`tier1Groups === 0` while `groups > 0`** — the silent-degradation
  case: nothing else in the pipeline fails when tier-1 coverage goes to
  zero, `#ranking` quietly falls back to plain salience everywhere, and the
  map keeps looking normal. "Nothing else fails when it happens, which is
  exactly why it is called out" here specifically.
- **Any unknown FIPS code**, logged with its affected story count — a code
  the crosswalk (`#regions`) doesn't recognize, needing a
  `data/fips-overrides.json` entry.
- **`bandRelaxed`** — the count band stood down past its 8-hour gate
  (`#operations`). This line carries an explicit instruction in the source
  itself: since 2026-08-14 the band is two absolute constants with nothing
  self-correcting behind them — if real volume ever genuinely outgrows
  `COUNT_BAND_MAX`, every run is refused until a human re-derives the
  constants against a fresh `#data-reality` volume measurement. The
  comment says plainly not to nudge them blind.

The full monitoring table this pipeline is built against (`HANDOFF.md
§8`): a run that throws is caught by GitHub's own failure email; a run
that never happens at all is caught by the dead-man switch; a run that
succeeds but publishes garbage is caught by the output invariants at the
publish gate (`#operations`); stale data is caught by the freshness stamp
in the UI plus an explicit notice past 2× cadence; a GDELT schema change
is caught by the column-count schema canary; a new, unrecognized FIPS code
degrades one pin rather than the run, logged and counted; and the tier-1
priority rule quietly stopping working is caught only by watching its own
count go to zero in the run summary — "if GDELT stops crawling CNN and the
BBC... the count goes to zero, `#ranking` degrades to plain salience, and
*nothing else fails* — the graceful degradation is exactly what hides it."

### Rejected Alternatives

- **A single alarm (Action failure email only) for a silent stop.**
  Rejected — a dead system that never runs never throws, so a
  throw-only alarm cannot catch its own most-feared failure mode. The
  dead-man switch is the second, independent alarm built specifically for
  that gap.
- **Printing the run summary only on success.** Rejected — `formatSummary`
  runs on every path, because the failure path is exactly when its detail
  is most needed in the Action log.
- **Silencing WARN lines that "usually don't mean anything"** (e.g. one
  unknown FIPS code on a handful of stories). Kept loud and itemized —
  the tier-1-zero case in particular exists precisely because a quiet
  degradation is invisible everywhere else in the system.

---

## Method

Four working rules, evidenced repeatedly across every chapter above rather
than argued abstractly here:

**Measure it, do not guess it.** Stated directly in the project's own
notes: "This project has been wrong three times by reasoning from
plausible assumptions — an unsourced accuracy statistic, a Natural Earth
column that does not exist, and a tippecanoe flag that does not do what
its name suggests. Each took ten minutes to check and would have cost
days to discover in the build." The MapTiler billing correction
(`#basemap`), the FIPS crosswalk (`#regions`), and the tippecanoe
post-mortem (`#tiles-budget`) are all this same pattern playing out at
real cost.

**A green build says nothing about whether the map renders.** Two Mode-2
UI bugs shipped past a clean `tsc`, a clean build, and a full green test
suite: `.panel__sphere`'s gradient rule was written but never actually
added to the shared selector list, so the place-indicator dot rendered as
an invisible box; and the "More Reporting" coverage rows sat at a 26px
pitch against the mockup's intended 18px because a font-size was set on
the wrong element for the browser's own line-box math to shrink around it.
Both were caught only by measuring the rendered DOM directly, not by
reading the diff. See `#open-items` for the current, larger instance of
this same class of bug (the malformed `globals.css` comment).

**Isolate and count.** The tippecanoe diagnosis explicitly rejected a
first, plausible-sounding guess about which flag was misbehaving and
insisted on decoding real output tiles at real coordinates before
concluding anything — "that was predicted here once, wrongly, and then
predicted again, rightly — the difference is which one got measured." The
three-version, 218-point tippecanoe test in `#tiles-budget` is this rule
applied literally: one variable changed per row, every version built and
run, nothing inferred from documentation alone.

**A fired criterion is honoured.** The placement-rule abort criterion
(`#placement`) was written down and thresholded *before* the accuracy
audit ran, specifically so the result could not be rationalized after the
fact — and when it fired against the originally specified rule, the
response was not to move the threshold but to find the actual mechanism
behind the failure (specificity-vs-dominance) and re-test the replacement
against the same, unmoved numbers. "Thresholds were not moved at any
point."

---

## Open Items

- **MapTiler Free-plan logo is not rendered.** `components/MapView.tsx`
  currently carries an **uncommitted** local change at its
  `<MapTilerLogo />` render site: `git diff components/MapView.tsx` shows
  the single line changed from `<MapTilerLogo />` to
  `{/*<MapTilerLogo />*/}`, disabling it. The comment directly above that
  line in the file explicitly warns against disabling it "without saying
  where the mark went" — this diff does exactly that, with no note
  attached. Attribution is currently unmet in the working tree as checked
  out right now. This is flagged as open, not fixed, and should be
  resolved (either restored with a stated reason, or committed with one)
  before this state ships.
- **`globals.css` — a malformed comment breaks the brand mark.** Confirmed
  present, `app/globals.css` lines 301–311. The selector list
  `.search__mark, .brand__dot, /*.panel__sphere { border-radius: 50%;
  background: radial-gradient(...); transform: matrix(...); }*/` has its
  entire declaration block — the `{ ... }` meant to be shared by all three
  selectors — swallowed inside a comment that was only meant to disable
  `.panel__sphere`. The practical effect is worse than cosmetic drift:
  `.search__mark` and `.brand__dot` now get **no border-radius and no
  gradient at all** from any rule (their own individual rules, at lines
  413 and 321 respectively, set only size and position) — a live rendering
  bug in the search sphere and the wordmark's bead, not merely a missing
  highlight. `.panel__sphere` itself (line 957) is a separate, intact,
  working rule.
- **Phone profile never run on real hardware.** `worker/budget.ts`'s
  `DEFAULT_K = 15` is a desktop-tuned guess ("K ~ 12–20, tuned on real
  data. A phone shows 2-4 tiles, so roughly 30-60 pins") — it is the only
  lever on the ~57% overflow rate (`#tiles-budget`), and no measurement
  against actual phone hardware has been taken. Deferred by explicit
  decision on 2026-08-14, still open.
- **`worker/topics.ts` is written but unshipped.** Confirmed: `worker/run.ts`
  never calls it; `StoryGroup` (`lib/types.ts`) has no `topic` field;
  `worker/tiles.ts`'s `featureOf` emits nothing topic-related; no
  `worker/topics.test.ts` exists. Its only real importer is
  `scripts/theme-audit.ts` (a separate mention inside `lib/story.ts` is a
  comment referencing it by name, not an import). Version 1 of the
  classifier (vote-counting, ties broken by declaration order) put 44.2%
  of the feed in a Disaster bucket, because 75.3% of classified articles
  matched more than one topic — for three-quarters of the feed,
  declaration order alone was the classifier. Version 2 (current — scores
  each article by its rarest matched theme, using the pool's own live
  document frequency) is implemented and typechecks, but **its own
  distribution has never been measured** — the code comment says so
  directly, and `docs/archive/modes-2-3-handoff.md` corroborates this was
  still true as of its own last edit.
- **`run()`'s stage ordering is untested.** Confirmed: `worker/run.test.ts`
  only imports and tests three standalone exported helpers —
  `stampOfDate`, `toPlaced`, and `formatSummary`. No test imports or
  invokes `run()` itself, so the documented stage order in `#pipeline`
  (fetch → parse → filter → place → state → group → rank → budget → tiles
  → publish → prune → ping) is enforced only by the source code's own
  structure, not by any assertion.
- **No component tests exist.** Confirmed: `vitest.config.ts`'s `include`
  is `["worker/**/*.test.ts", "lib/**/*.test.ts", "scripts/**/*.test.ts"]`
  — `components/` is excluded entirely, with a comment explaining
  `scripts/` is included only for the tippecanoe version guard. Everything
  under `#frontend` is verified live, by eye and DOM query, not by suite.
- **No test asserts `worker/tiles.ts`'s layer names match
  `lib/layers.ts`'s `source-layer` values.** Correction to an earlier
  assumption: `lib/layers.test.ts` *does* assert source-layer values
  against constants — but those constants (`STORIES_SOURCE_LAYER`,
  `COUNTRY_SOURCE_LAYER`, etc.) are defined independently inside
  `lib/layers.ts` itself. `worker/tiles.ts` defines its own separate
  string literals (`STORIES_LAYER = "stories"`, `COUNTRY_LAYER =
  "country-top"`), with a comment on the `layers.ts` side saying "Must
  match `worker/tiles.ts`'s exports exactly" — but nothing imports or
  cross-checks the two against each other. The open item is real: two
  independently declared constants, hand-synced, never tested against one
  another.
- **`JACCARD_FLOOR = 0.25`**, `worker/group.ts` line 41, is flagged in its
  own comment: "0.25 is a starting point tuned by eye on real bundles
  rather than fitted — it is the one constant here without a measurement
  behind it, and it is worth revisiting once real placements can be judged."
- **`scripts/tippecanoe-min-version.test.ts` status.** A fresh `npx vitest
  run` in this session passed **432 tests across 29 files with zero
  failures**, including this test file (7/7 passing on its own). Prior
  project notes (`docs/archive/ui-refresh-2026-08.md`,
  `docs/archive/modes-2-3-handoff.md`) recorded it failing 6/7 "on this
  machine" because its bash script could not be spawned from a Windows
  path — that specific failure is **not reproducing right now**, in this
  environment/session. Current reality is green; note the discrepancy
  rather than assume either the old or the new observation is permanently
  correct — it may be environment-dependent.
- **`scripts/build-real-geojson.ts`** currently exists: a standalone
  Phase-2.5 script that fetches one GKG bundle, parses it, applies the
  demonym filter, places city pins only, and writes `build/stories.geojson`
  for `npm run tiles:real` — deliberately not the real Phase 3 worker (no
  state, shards, grouping, ranking, budget, or publish gate). It is
  planned for deletion in a later phase, not this one. If the offline
  single-bundle rebuild capability is wanted back afterward, it should be
  rebuilt as a thin script that imports `worker/fetch.ts`,
  `worker/parse.ts`, and `worker/place.ts` directly, rather than forking
  their logic a second time the way this script currently does.
</content>
