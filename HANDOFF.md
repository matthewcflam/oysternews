# Sonder — Project Plan

**This file is the single source of truth.** If anything in `spikes/`, a design
doc, or a previous conversation contradicts it, this file wins.

**Status:** pre-build. **Phase 1 complete.** Phase 2 next.
**Last updated:** 2026-08-09, after the Phase 1 geotag audit and the tier-1
ranking reversal (§2.5).
**Evidence base:** `spikes/gdelt/FINDINGS.md` — every number in this document is
measured, not assumed.

---

## START HERE

**Next action: Phase 2 (§5) — public Next.js repo, MapLibre + MapTiler, a
hand-made PMTiles archive with a few fake points, deployed to Vercel. The live URL
exists at the end of it.**

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
five Python probe scripts, a demonym list, and the judged audit samples. No
application code. No `package.json`.

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
- **tippecanoe does not run natively on Windows, and this machine is Windows.**
  Production is unaffected — `tiles.ts` runs in GitHub Actions on Linux — but
  local tile builds need WSL or Docker. This first bites in **Phase 2**, which
  calls for a hand-made PMTiles archive. Two ways out, and the choice is open
  (§6, decision 8): stand up WSL/Docker once and use the real toolchain locally,
  or hand-write the handful of Phase 2 fake points with `geojson-vt` + `vt-pbf`
  in Node and defer tippecanoe entirely to CI. The second is faster now and leaves
  the Phase 3 tile step unexercised on the dev machine. **Both WSL2 and Docker turn
  out to already be installed** — but WSL's Ubuntu has no compiler and `sudo` wants
  a password, and the Docker daemon is stopped, so route A still needs one action
  from the human. Decision 8 has the survey.

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
      otherwise               ->  PIN at the city
  else  adm1 -> CONTAINER,  else country -> CONTAINER,  else DROP
```

| Input | Output |
|---|---|
| Specific feature (city, park, landmark, valley, sea), not dominated | **PIN at its exact coordinates** |
| Specific feature dominated by its region or country | **CONTAINER at that region** |
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
> [62.1, 91.5] on a fresh out-of-sample draw. `FINDINGS.md` §9.

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
tier-1-touched groups and expires at 48h. Tier-1 is 1.05% of the feed, so the
second family costs almost nothing — writing 48h of *all* shards would have
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
   52.7%, not 70%. **Phase 6 must publish 69.7% [52.7, 82.6] and the method**, and
   Phase 4's geotag-confidence treatment is not optional garnish.
4. **Before Phase 4 ships, get an independent judge on a fresh rule-H draw.** The
   same party designed rule H and scored it. That is the weakest link in the
   evidence and it costs one evening.

**Thresholds were not moved at any point.** Only the sample size grew, when the
unstratified 50 turned out to yield 32 judgeable pins rather than 50.

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

The three UI states from §2.3: free pan/zoom by default, country lock-on with a
red outline and auto-zoom, and a corner button that resets to whole-planet. All
three render the same content — only the camera and the highlight differ.

Container pins, red click-outline, symbol layer with `text-allow-overlap: false`
and `symbol-sort-key` from salience. Relative freshness stamp, explicit stale
notice past 2× the cadence. Geotag confidence treatment lands here.

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

### Phase 6 — About / methodology · 3-5 evenings · *now a headline deliverable*
**Promoted, and given Phase 5's budget.** `FINDINGS.md` is the artifact with the
strongest claim on a hiring manager's attention: GEO 2.0 dead with structural
proof, 48.5% heuristic disagreement, the demonym discovery, an abort criterion
written before the data and honoured when it fired, and three features killed by
the builder's own measurements. That reads better than most portfolio maps.

Must state: the English-only mechanism and its residue, **geotag accuracy as
69.7% with a [52.7, 82.6] interval and the method behind it**, how containers
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
| 1 | Zoom ceiling | cap data zoom at **z10** for v1 | GDELT gives city centroids, so all Chicago stories share one coordinate and do not spread on zoom. Revisit with spiderfy if it feels flat |
| 2 | Cadence | **4-hourly** | Cuts Actions minutes and tile builds 4×, imperceptible against a 24h window, serves "stability over freshness" |
| 3 | Cron trigger | **`schedule` only**, plus a monthly calendar reminder | The 60-day auto-disable is repo-*inactivity* based, not elapsed time. Drops a third-party service and a never-rotating `actions: write` PAT |
| 4 | State storage | **append-only per-run shards**, expired by filename | A 25-40 MB read-modify-write JSON is a database without a database's properties. Shards delete three resilience mechanisms |
| 5 | Red-outline precedence in country state | selected country stays outlined; a container click inside it renders **brighter and thicker**, not a second colour | Two red outlines can be on screen at once; they need to be distinguishable without introducing a second colour |
| 6 | Country auto-zoom level | fit the country's bounding box with padding | A fixed zoom is wrong for both Monaco and Russia |
| 7 | Blob transfer allowance | unverified | Ten minutes. The one free-tier limit that could actually bind |
| 8 | Local tile toolchain on Windows | **open — needs a call before Phase 2, and the machine has been surveyed** | tippecanoe has no native Windows build. Measured 2026-08-09: **WSL2 with Ubuntu 24.04.3 is installed but bare** — no `gcc`, `g++`, `make`, `libsqlite3-dev` or `zlib1g-dev`, and `sudo` prompts for a password, so neither `apt install` nor a source build can be automated. **Docker 29.0.1 is installed but the daemon is not running.** So route A (real tippecanoe locally) is one human action away — a password or a Docker Desktop launch — and route B (`geojson-vt` + `vt-pbf` + `pmtiles` from npm, no admin) needs nothing. See the gotchas list above |
| 9 | Tier-1 list membership | keep all **28** domains as-is; review once real data flows in Phase 3 | The list now *grants* precedence instead of measuring coverage (§2.5), so membership is load-bearing. `newsweek.com` and `latimes.com` are 26% of the tier-1 records actually present, and both are more arguable as papers of record than the wires that returned zero. Trimming them would shrink an already 1%-thin signal, so the provisional call is to keep them and look at real placements before editing. Absent domains cost nothing — if GDELT starts crawling Reuters, it just works |
| 10 | Tier-1 freshness clock | **newest** tier-1 article in the group | "Published in the last 48 hours" against the *oldest* would expire a story that a tier-1 outlet is still actively covering. Newest means a follow-up piece renews the 48 hours, which reads as the same story continuing — matching "unless it is replaced by another tier-1 story" |

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
| **2026-08-09** | **Phase 1 fully closed.** Maturity comparison run 19h after its snapshot. The maturation question came back uninformative (0 of 15, [0%, 20.4%]) but the denominator did not: **only 0.29% of story groups are still in the feed 19 hours later**, which makes §3.5's persisted 48-hour shard family the only possible mechanism for §2.5's stickiness. `FINDINGS.md` §14 |
| **2026-08-09** | **Tier-1 reversed from a cut flag into a ranking preference.** Builder's call: the 1% is the signal, not the accusation. §2.5 gains a two-class comparator — tier-1-fresh outranks everything, salience orders within each class — and §3.5 gains a second 48-hour window and a second shard family to make it stick. No timers, no per-area state, and an area with no tier-1 coverage ranks exactly as it did before. Decisions 9 and 10 added |

Superseded, retained as archaeology only:
`~/.gstack/projects/matthewcflam-sonder/matth-main-design-20260807-154947.md`
