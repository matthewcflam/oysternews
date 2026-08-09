# Sonder — Project Plan

**This file is the single source of truth.** If anything in `spikes/`, a design
doc, or a previous conversation contradicts it, this file wins.

**Status:** pre-build. Phase 1 partly complete.
**Last updated:** 2026-08-08, after `/plan-eng-review`.
**Evidence base:** `spikes/gdelt/FINDINGS.md` — every number in this document is
measured, not assumed.

---

## START HERE

**Next action: finish Phase 1 (§5). Start with the abort criterion.**

Before running the 50-article geotag audit, write down what number kills the
container feature and what number kills the project. Deciding that *after* seeing
the result is how you talk yourself into a bad number. The old spec's rule was
"under 50% accuracy, stop and reconsider" — it got lost across five revisions, so
restore it or replace it deliberately.

Then the rest of Phase 1's checklist, then Phase 2.

**Do not start Phase 3.** It is the largest phase and several of its inputs
(maturity delay, blocklist, per-country density) come out of Phase 1.

**What already exists:** this file, `spikes/gdelt/FINDINGS.md`, and four Python
probe scripts. No application code. No `package.json`.

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

- **`spikes/` is Python; the project is TypeScript.** Deliberate. The spike was
  throwaway exploration and Python was faster for it. The production worker is
  TypeScript per §3.1. The Python scripts stay as reproducible evidence for
  `FINDINGS.md` and as the generator for test fixtures — do not port them, and do
  not treat them as a reference implementation.
- **`spikes/gdelt/samples/` is gitignored.** The raw GKG bundles are 4-6 MB each
  and are not committed. Re-running any probe script re-downloads them.
- **§7 requires a committed test fixture that does not exist yet.** One real GKG
  bundle must be committed under `fixtures/` during Phase 3. Until then, the test
  plan in §7 is a specification, not something you can run.

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

Every story gets a position from a single function, `placeStory()`:

| Input | Output |
|---|---|
| Specific feature (city, park, landmark, valley, sea) | **PIN at its exact coordinates** |
| County / parish / borough | **CONTAINER** |
| Admin-1 (state/province) only | **CONTAINER** |
| Country only | **CONTAINER** |
| Demonym only ("British", "Danish") | **DROP** |
| No usable location | **DROP** |

**A wildfire at "San Gabriel Valley" pins at the valley**, not at the nearest
city. GDELT's location type 3/4 is not "cities" — measured at 70.7% cities,
12.1% natural features, 10.7% counties, 6.5% landmarks — and each carries its own
coordinates.

### 2.2 Containers

A container is a country or admin-1 region, used when a story has no exact
location.

- Rendered as a **pin at the container's center, at every zoom level.**
- Clicking the story **outlines the container in red.**
- The polygon is never a fill. It is a click-reveal only.
- One container feature per region per window, carrying `{region_id, count,
  top_title, top_url}` — not one per story.

### 2.3 UI states

**There is one content model.** Per-tile top-K by salience, everywhere, at every
zoom. The states below are camera positions and a highlight — not different
editorial tiers, not different ranking, not topic classification.

| State | Camera | Red outline | Content |
|---|---|---|---|
| **Default** | free pan and zoom anywhere | **none** | per-tile top-K |
| **Country** | locks onto a country, auto-zooms in | the selected country | per-tile top-K |
| **Global** | a corner button; resets zoom to default | none | per-tile top-K |

**Default** is the base state. The user scrolls freely and zooms wherever they
like; zooming in makes more stories in that area reachable.

**Country** locks focus onto one country, outlines it red, and auto-zooms. The
zoom is what surfaces more of that country's stories — more tiles cover the same
country, so stories that lost the budget at world zoom now win. Nothing about the
*content* logic changes.

**Global** is not a structural state. It is a preset of Default that returns the
camera to whole-planet zoom.

> **Screen density stays roughly constant across zoom levels** — 2-4 visible
> tiles × K, so ~30-60 pins whether you are looking at the planet or at one city.
> Zooming does not add pins to the screen; it changes *which* pins, surfacing
> lower-salience stories as the area narrows. More stories become **reachable**,
> not more visible at once. This is deliberate: it is what keeps the map readable
> on a phone at every zoom.

Clicking any container story outlines its container in red, in any state.

### 2.4 Density

**Per-tile top-K budget.** For each tile at each zoom, keep the top K stories by
salience inside it; the rest get `minzoom = z+1` and reappear on zoom-in.

This is the cap *and* the floor. A sparse tile keeps everything it has, so the map
is never empty. A crowded tile defers its weakest, so it never turns to mush. And
because selection is local, US stories compete only with other US stories — the
Strait of Hormuz is never buried by an American election.

`K ≈ 12-20`, tuned on real data. A phone shows 2-4 tiles, so roughly 30-60 pins.

**Plus a guaranteed floor.** At z0 the whole planet is one tile, so the budget
alone would put 12-20 stories on the entire world map. A separate
**top-1-per-country layer, exempt from the tile budget**, guarantees every country
with news in the window gets at least one pin. That is what keeps the default
world view populated regardless of salience.

Two layers, one ranking function:

```
  stories layer      per-tile top-K by salience      minzoom from the budget
  country-top layer  top 1 per country, always       minzoom 0, no budget
```

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
| Basemap | **MapTiler** hosted style, 100k loads/mo free | Escape hatch: OpenFreeMap, a one-line style swap |
| Story data | **PMTiles** on Vercel Blob | Verified: 206 range requests, `Accept-Ranges`, CORS `*` |
| Boundaries | Static `boundaries.pmtiles`, built once from Natural Earth | Needed only for the red click-outline |
| Database | **None** | Deferred; `lib/types.ts` keeps the migration cheap |
| Worker | GitHub Actions, plain `run()` entry point | Ports off Actions in an afternoon |
| Tiles | tippecanoe, `-Z0 -z12 -r1 --drop-densest-as-needed` | Rank thinning via per-feature `minzoom` |

> **PMTiles is a file format, not a basemap.** It is BSD-licensed, needs no
> account and no service. Using it does not mean using the Protomaps basemap.
> MapTiler draws the world; PMTiles carries your stories. They are separate
> layers in one map.

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
        +--> group.ts    themes + Jaccard + 0.5 cell     (section 2.5)
        +--> rank.ts     salience                        (section 2.5)
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

**Every 4 hours, over a rolling 24-hour window.**

Fetch every 15-minute bundle since the last successful watermark, capped at 12
bundles. A failed run self-heals on the next one.

The 24-hour window is not optional: a 12-hour window leaves most cities empty,
which removes the payoff from zooming in.

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

Still open, and all of it gates later phases:
- [ ] 50-article hand-judged geotag audit, reported **with a confidence interval**
- [ ] **Write down the abort criterion before starting.** `HANDOFF` §4.6's old
      rule: under 50% accuracy means stop and reconsider. Decide now what number
      kills containers and what number kills the project.
- [ ] Tier-1 crawl check (~20 min) — do NYT/BBC/Reuters appear at expected
      volume? If GDELT under-crawls them, *everything* looks like a blindspot and
      Phase 6 produces noise.
- [ ] Per-country pin density (~10 min) — US is 36.9% of location mentions vs
      17.5% for all world cities combined. Most countries will have single-digit
      daily stories. The zoom curve should be designed knowing that.
- [ ] Maturity delay: two pulls 6h apart. Report the **count** of zero-tier-1
      groups in the eligible band, not just their quality.
- [ ] Blocklist: top domains in the zero-tier-1 population.

### Phase 2 — Skeleton and first deploy · 1-2 evenings
Public Next.js repo. MapLibre ≥5.0 + MapTiler rendering a hand-made PMTiles
archive with a few fake points. Push to Vercel.

**The live URL exists at the end of this phase.**

### Phase 2.5 — Ship something real · 1 evening
One GKG bundle. City pins only. No grouping, no containers, no budget. Dumb
GeoJSON straight to tiles.

Phase 3 is the longest stretch in the project with nothing visible at the end of
it. This buys a live, real map for one evening, and every later phase then
improves something that already exists.

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

### Phase 4 — The map · 5-7 evenings
2D Mercator. Two tile layers (stories + country-top) over the MapTiler basemap,
plus boundaries for the red outline.

The three UI states from §2.3: free pan/zoom by default, country lock-on with a
red outline and auto-zoom, and a corner button that resets to whole-planet. All
three render the same content — only the camera and the highlight differ.

Container pins, red click-outline, symbol layer with `text-allow-overlap: false`
and `symbol-sort-key` from salience. Relative freshness stamp, explicit stale
notice past 2× the cadence. Geotag confidence treatment lands here.

**Profile against the performance targets on a real mid-tier phone**, not a
desktop throttle.

### Phase 5 — Blindspot · 2-3 evenings
Grouping already exists from Phase 3, so this is only the tier-1 comparison and
the maturity delay.

**Acceptance bar:** ≥10 flagged dots at any moment, the toggle filters to them,
and you have read 10 and judged ≥6 to be genuinely underreported. Evaluated after
≥24 hours of continuous ingestion. If it fails, it ships behind an honest label or
not at all.

### Phase 6 — About / methodology · 1-2 evenings
Consider pulling this earlier. `FINDINGS.md` — GEO 2.0 dead with structural proof,
48.5% heuristic disagreement, the demonym discovery, killing your own feature with
measurements — may be a stronger artifact for a hiring manager than the map is,
and it is currently the first thing that gets cut if evenings run out.

Must state: the English-only mechanism and its residue, geotag accuracy with its
interval, how containers work and where admin-1 coverage has gaps, the 24-hour
window and cadence, what blindspot does *not* claim, and that raw GKG is a single
point of failure. **Credit GDELT and MapTiler.**

### Timeline

```
  wk 1   Phase 0, 1, 2        -> LIVE URL exists
  wk 2   Phase 2.5            -> real data on a real map
  wk 3-6 Phase 3              -> the pipeline
  wk 7-9 Phase 4              -> the product
  wk 10  Phase 5              -> the differentiator
  wk 11  Phase 6              -> the story
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
| 1 | Zoom ceiling | cap data zoom at **z10** for v1 | GDELT gives city centroids, so all Chicago stories share one coordinate and do not spread on zoom. Revisit with spiderfy if it feels flat |
| 2 | Cadence | **4-hourly** | Cuts Actions minutes and tile builds 4×, imperceptible against a 24h window, serves "stability over freshness" |
| 3 | Cron trigger | **`schedule` only**, plus a monthly calendar reminder | The 60-day auto-disable is repo-*inactivity* based, not elapsed time. Drops a third-party service and a never-rotating `actions: write` PAT |
| 4 | State storage | **append-only per-run shards**, expired by filename | A 25-40 MB read-modify-write JSON is a database without a database's properties. Shards delete three resilience mechanisms |
| 5 | Red-outline precedence in country state | selected country stays outlined; a container click inside it renders **brighter and thicker**, not a second colour | Two red outlines can be on screen at once; they need to be distinguishable without introducing a second colour |
| 6 | Country auto-zoom level | fit the country's bounding box with padding | A fixed zoom is wrong for both Monaco and Russia |
| 7 | Blob transfer allowance | unverified | Ten minutes. The one free-tier limit that could actually bind |

---

## 7. Tests

**Vitest** for units, **Playwright** for E2E. **48 paths identified, 3 critical.**

Fixtures: one real 5 MB GKG bundle (entity-escaped titles, 6+ locations per
record, demonyms, FIPS `RS`/`CH`/`IS`/`AS`, iheart syndication) plus small
synthetic files for schema drift, missing title, unknown FIPS, ocean-only, and
single-location.

**Three critical gaps — no test, no error handling, silent if they break:**
1. **`publish.ts` failure path.** A partial publish points the manifest at a
   half-written archive and breaks the map for everyone.
2. **Article body never rendered.** A test must assert the popup contains title,
   source, and link and *nothing else*. This failure mode is legal, not visual.
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

The dead-man switch matters because the likeliest long-run failure is silent: if
the trigger dies, no run happens, so no run fails, so no email is sent.

---

## 9. Performance targets

- First meaningful map paint **< 2.5s** on simulated 4G, mid-tier Android
- Tile fetch **p95 < 250 ms**
- Pan/zoom **≥30 fps mobile, ≥55 fps desktop**
- Published archive within the Blob free tier after retention
- **Screen density stays ~30-60 pins at every zoom** — not more, not empty
- Zooming into a country **surfaces stories that were not visible at world zoom**,
  and no zoom level between 0 and the ceiling is empty
- Every country with news in the window has at least one pin at world zoom
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
| **2026-08-08** | **Views reframed as camera states over one content model. Topic classification removed from the project entirely; the last blocking decision dissolved** |

Superseded, retained as archaeology only:
`~/.gstack/projects/matthewcflam-sonder/matth-main-design-20260807-154947.md`
