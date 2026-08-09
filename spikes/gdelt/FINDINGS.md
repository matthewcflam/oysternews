# GDELT Spike — Findings

**Run:** 2026-08-07, four consecutive GKG 2.0 bundles covering one hour
(`20260807224500` through `20260807233000`), 4,688 records, 20.1 MB zipped.
**Scripts:** `gkg_probe.py`, `quality_probe.py`, `probe3.py` in this directory.
**Status:** **complete.** Part 1 below covers access paths, volume, titles, location
quality, source concentration and theme distribution. Part 2 (§9-14) adds the
hand-judged geotag audit, the tier-1 crawl check, per-country density, the blocklist
and the maturity-delay comparison. Part 1's own "still open" list is kept as written
at the time: four of its seven items were closed in Part 2, and three went moot with
the features they were sizing (the governance re-score, blindspot signal-to-noise,
and the Natural Earth capitals join — all three existed to serve capital-pinning or
the blindspot flag, and both are dead).

---

## Verdict

**Go, with one feature sent back for redesign.**

Raw GKG delivers what the plan assumed on volume, titles, and city-level
coverage. Two assumptions were wrong, one of them load-bearing:

1. **Governance pinning (Feature 2) does not work as specified.** Theme-based
   detection is far too noisy, and it would confidently pin a dog attack at a
   state capital. Redesign or cut.
2. **GDELT geocodes demonyms.** "British", "Americans", "Canadians", "Danish"
   all resolve to countries. This is the dominant source of bad country-level
   tags and it affects both features. Demonym filtering is now a required
   pipeline step, not a nicety.

---

## 1. Access paths

Tested twice: 2026-08-07 ~23:50 UTC and again 2026-08-08 18:18 UTC. Same result
both runs.

| Path | `HANDOFF.md` §4.1 | Result |
|---|---|---|
| **Raw GKG 2.0 bundles** | C | **Works, and works well.** |
| **DOC 2.0 API** | A | **Alive but effectively unusable.** |
| **GEO 2.0 API** | B | **Dead.** |

### Path C — raw GKG (the only survivor)

- 6 back-to-back `lastupdate.txt` requests: all HTTP 200, **0.07-0.10s**. No rate
  limiting of any kind observed across ~15 requests over two sessions.
- Bundle download: 2.66 MB in 0.26s = **10.1 MB/s**, valid ZIP.
- `lastupdate-translation.txt` returns 200, confirming the English/translingual
  split the design's language filter depends on.

> **Operational finding: `data.gdeltproject.org` does not work over HTTPS.**
> `https://data.gdeltproject.org/gdeltv2/lastupdate.txt` fails with
> `SSL: CERTIFICATE_VERIFY_FAILED`. Plain HTTP works fine. The ingestion worker
> must fetch over HTTP. This is acceptable — the worker is server-side and the
> browser never contacts GDELT (`HANDOFF.md` §2) — but any HTTP client
> configured to force HTTPS or reject plaintext will silently fail. Note it in
> the worker.

> **Volume swings ~2× by time of day.** The 18:15 UTC bundle was 2.66 MB; the
> 22:45-23:30 UTC bundles were 4.3-5.9 MB. Every volume number in section 2 comes
> from a single evening hour and should be treated as an upper-ish bound, not a
> constant.

### Path A — DOC 2.0

Response shape confirmed: `domain`, `language`, `seendate`, `socialimage`,
`sourcecountry`, `title`, `url`, `url_mobile`. **No theme codes, no coordinates,
no character offsets.** It cannot substitute for GKG.

**Rate limiting is worse than documented and is not deterministic.** The 429 body
says *"limit requests to one every 5 seconds."* Measured success rate by spacing:

| Gap between requests | Succeeded |
|---|---|
| 0s | **0 / 3** |
| 5s | 1 / 3 |
| 15s | 2 / 3 |
| 30s | **0 / 3** |

30-second spacing performing worse than 15-second spacing means this is **not a
per-client token bucket** — it reads as global load shedding. There is no backoff
strategy that makes it reliable. Successful responses took **8-20 seconds**.

Also note: DOC 2.0 searches **all languages by default**. An unfiltered query for
the English phrase `"climate change"` returned a Hungarian article from
`borsonline.hu` as its first result. Any use requires an explicit
`sourcelang:english` operator.

**Verdict: usable for occasional manual spot-checks, nothing more.** Not viable
as a title fallback, an enrichment step, or a backfill source.

### Path B — GEO 2.0 is dead, and here is the proof

The first run tried five hand-constructed parameter combinations and got 404 on
all of them. That is weak evidence — it could have been bad parameters. So the
retry scraped **GDELT's own announcement post** for example URLs and called them
verbatim:

| Documented example URL | Result |
|---|---|
| `…/geo/geo?query=trump` | **404** |
| `…/geo/geo?query=trump&mode=country` | **404** |
| `…/geo/geo?query=trump&mode=adm1` | **404** |
| `…/geo/geo?query=trump&mode=sourcecountry` | **404** |
| `…/geo/geo?query=trump&mode=sourcecountry&format=imagehtml` | **404** |

**GDELT's own documented examples 404.** This is not a parameter problem.

Structural probe narrows it further:

| Path | Status | Reading |
|---|---|---|
| `/api/v2/` | **403** | directory exists, listing denied |
| `/api/v2/geo/` | **403** | **directory exists**, listing denied |
| `/api/v2/geo/geo` | **404** | **the script itself is gone** |
| `/api/v2/doc/doc` | 429 | sibling endpoint alive (rate-limited) |

The `geo` directory is still served; the endpoint inside it is not. That is a
removed endpoint with live documentation, not a misconfiguration or an outage.
Tried over both HTTP and HTTPS, with and without trailing slash.

**Implication:** the design doc demoted GEO 2.0 for lacking theme codes and
character offsets. That reasoning is now moot — **remove GEO 2.0 from the design
entirely**, including as a spike cross-check. And treat `HANDOFF.md` §4.1's
three-path evaluation as settled: **of the three access paths, one exists.** The
§4.1 hypothesis — raw GKG as the foundation with DOC as a supplement — is half
right. Raw GKG is the foundation. There is no supplement.

---

## 2. Volume

| Metric | Measured |
|---|---|
| Records per 15-min bundle | **1,172** |
| Extrapolated per day | **112,512** |
| Has `V2EnhancedLocations` | 79.4% |
| **City-level (type 3 or 4)** | **57.5%** → 64,728/day |
| **Distinct city stories after title dedup** | **~40,728/day** |
| Download | 4.3-5.9 MB zipped per bundle → ~20 MB/hour, ~480 MB/day |
| `V2.1SharingImage` present | 86.2% |

**Implication:** the design doc estimated ~15,000 features for a 24-hour window.
The real number is **~40,700 distinct city-pinned stories** — **2.7× the
estimate**. Vector tiles absorb this without complaint, which is exactly why the
tiles decision was right. But **the zoom curve table in Feature 3 needs
recalibration against 40k, not 15k.**

Download volume is fine. 394 MB/day inside GitHub Actions is unremarkable.

---

## 3. Titles — confirmed

| | |
|---|---|
| `<PAGE_TITLE>` tag present | **100.0%** (4,688 / 4,688) |
| Non-empty title | **99.7%** (4,675) |

The 99.8% figure holds. **Feature 1 is buildable.** Titles must be
HTML-entity-unescaped; sub-element order inside `V2EXTRASXML` varies, so parse as
XML/regex rather than by position.

---

## 4. Language

`V2.1TranslationInfo` was populated on **0 of 4,688 records**. The `lastupdate.txt`
stream contains zero machine-translated documents, which confirms the design's
English mechanism: consume this stream, ignore `lastupdate-translation.txt`.

**Caveat:** "untranslated" is not "English." 7.2% of titles contain non-ASCII
characters, though inspection shows most are accented English (`Anže Kopitar`,
`El Niño`) rather than foreign-language text. At least one German-domain
publisher (`wallstreet-online.de`) appears. The residue is small but nonzero.
Publish the honest phrasing on the About page.

---

## 5. Location quality — the most important section

### Distribution

Location **mentions** by type:

| Type | Share of mentions |
|---|---|
| 1 country | 45.1% |
| 2 US state | 18.7% |
| 3 US city | 18.2% |
| 4 world city | 17.5% |
| 5 world state/ADM1 | 0.5% |

**Most specific** type per record — this is what actually pins a story:

| | Share of geo records |
|---|---|
| City → pin at city | **72.4%** |
| ADM1 only → pin at state capital | 16.0% |
| Country only → pin at national capital | 11.6% |

Ambiguity is the norm: **50.4% of records carry 6 or more locations.** Only 19.1%
carry exactly one.

### The heuristic disagreement rate

Comparing the two candidate primary-location rules across 165 city-pinned
records:

- **Rule L** — lowest character offset (first mentioned)
- **Rule S** — highest specificity, then most repeated (the design's chosen default)

> **They disagree on 48.5% of records.**

**This is the single highest-leverage decision in the pipeline.** The choice of
rule changes where nearly half of all stories get pinned.

### Why they disagree — and it is not the dateline

The design doc predicted the failure mode would be the **newsroom dateline**
appearing first. That was wrong. The actual "first mentioned" locations when the
two rules disagree:

```
  4  British              3  Americans           2  New York, United States
  4  California           3  Texas               2  India
  3  Canada               2  Washington          2  United States
```

**GDELT geocodes demonyms.** "British" → United Kingdom. "Americans" → United
States. "Danish" → Denmark. "Canadians" → Canada. "Filipino", "Puerto Rican",
"Marylanders" all appear as location names in the sample.

So the earliest location in an article is very often a **nationality adjective in
the prose**, not a place the story is about. The design's decision to abandon
lowest-character-offset was correct; the reasoning recorded for it was not.

**Implication:** demonym filtering becomes a required pipeline step. A location
whose name is a demonym should be heavily discounted or dropped outright before
any primary-location rule runs. This also means **country-level tags are worse
than "an unhelpful centroid"** — a large share are just an adjective in the copy.

---

## 6. Governance pinning (Feature 2) — does not work as specified

The design doc proposed detecting policy stories via `V2EnhancedThemes` codes in
the `EPU_POLICY`, `GENERAL_GOVERNMENT`, `LEGISLATION`, `ELECTION`, `DEMOCRACY`,
`CONSTITUTIONAL`, and `TAX_FNCACT_*` families.

**Measured document frequency of those candidates:**

| Theme | Doc frequency |
|---|---|
| `EPU_POLICY*` | **77.8%** |
| `LEADER` | 21.7% |
| `USPEC_POLICY1` | 20.8% |
| `WB_831_GOVERNANCE` | 17.9% |
| `TRIAL` | 17.4% |
| `GENERAL_GOVERNMENT` | 16.5% |
| `TAX_FNCACT_PRESIDENT` | 14.9% |
| `LEGISLATION` | 14.0% |
| `ELECTION` | 6.2% |
| `TAX_FNCACT_MINISTER` | 5.5% |
| `CONSTITUTIONAL` | 2.5% |
| `DEMOCRACY` | 2.1% |
| `TAX_FNCACT_LEGISLATOR` | 0.5% |
| `TAX_FNCACT_LAWMAKER` | 0.3% |

The proposed list fires on **47.7% of all records**. A tightened list still fires
on **36.9%**. `EPU_POLICY` alone rides on **78% of the entire corpus** — it is an
economic-policy-uncertainty lexicon that triggers on almost anything.

### What it would actually do

Records the rule would "rescue" (governance-themed, no city location), sampled:

| Title | Would pin at |
|---|---|
| Boy, 9, Left Asleep On School Bus Found Wandering Around Bus Yard | New Jersey state capital |
| 74-year-old woman injured in dog attack in Margaret; owner charged | Alabama state capital |
| New Ad Exposes Adam Hamilton for Being a Woke Megachurch Pastor | Kansas state capital |
| AI Used to Create New Viruses | Denmark — from the demonym *"Danish"* |
| Zoot suits and lowriders — OC Fair to celebrate Chicano culture | via *"Filipino"*, *"Puerto Rican"* |

**None of these are policy stories.** The design doc warned that "a wrong pin at
a capital is worse than an honest centroid, because it looks deliberate." That is
exactly what this produces.

### Recommendation

**Send Feature 2 back for redesign. Do not build it as specified.** Three paths,
cheapest first:

1. **Cut it.** Drop country-and-ADM1-only records entirely. Costs 27.6% of geo
   records but they are the least trustworthy 27.6%. Feature 1 and Feature 3 are
   unaffected — they run on the 72.4% that already have city pins.
2. **Require corroboration.** Fire the governance rule only when the country/state
   location is (a) not a demonym, (b) mentioned 3+ times, and (c) the dominant
   location in the article. Needs a fresh measurement to size.
3. **Find a genuinely precise theme set.** `TAX_FNCACT_LAWMAKER` (0.3%) and
   `TAX_FNCACT_LEGISLATOR` (0.5%) are precise enough to be plausible signals.
   Whether they have adequate recall is unmeasured.

Path 1 is honest and ships. Paths 2 and 3 need another measurement pass before
they can be costed.

---

## 7. Source concentration and syndication

| | |
|---|---|
| Distinct domains in one hour | 855 |
| Top-50 domains | 32.2% of records |
| Domains with a single record | 238 (27.8% of domains) |
| **`iheart.com` alone** | **526 records = 11.2% of the entire feed** |

`iheart.com` contributed 35 records to a 400-record sample under only **17
distinct titles** — one story appeared 7 times.

Across all sources, **22.0% of sampled records are duplicate titles.** Overall
syndication multiplier: **1.50×**; for city-pinned records, **1.59×**.

**Implications:**

- Title-level dedup is mandatory before ranking, or one syndicated wire story
  outranks genuinely significant coverage.
- The ranking signal — **distinct domain count** — survives this, because GDELT's
  `SourceCommonName` collapses all iHeart stations to `iheart.com`. That is
  fortunate and worth stating: the plan's chosen ranking metric is robust against
  the single largest syndication source in the feed.
- The blindspot blocklist has an obvious first entry.

---

## 8. Themes — grouping frequency ceiling

3,230 distinct themes in one hour. Top by document frequency:

| Doc freq | Theme |
|---|---|
| 39.4% | `CRISISLEX_CRISISLEXREC` |
| 32.7% | `UNGP_FORESTS_RIVERS_OCEANS` |
| 31.7% | `WB_696_PUBLIC_SECTOR_MANAGEMENT` |
| 25.3% | `USPEC_POLITICS_GENERAL1` |
| 23.4% | `CRISISLEX_C07_SAFETY` |
| 22.8% | `MANMADE_DISASTER_IMPLIED` |
| 21.7% | `LEADER` |
| 21.4% | `WB_621_HEALTH_NUTRITION_AND_POPULATION` |
| 20.8% | `USPEC_POLICY1` |

**9 themes exceed the 20% ceiling** the blindspot grouping rule proposes
excluding; 105 exceed 5%.

**Implication:** the design's grouping rule (≥2 shared themes, excluding those
above ~20% doc frequency) is **validated as necessary**. Without the ceiling,
`CRISISLEX_CRISISLEXREC` alone would join 39% of all articles to each other.
Consider tightening the ceiling to 15%, which would exclude a few more.

---

## Still open

- 50-article hand-judged geotag audit with confidence interval
- The same audit re-scored after any surviving governance rule
- Tier-1 crawl coverage check (do NYT/BBC/Reuters appear at expected volume?)
- Maturity-delay measurement (two pulls 6h apart)
- Blindspot signal-to-noise on the zero-tier-1 population
- Natural Earth capitals join coverage
- Whether a demonym blocklist can be built cheaply enough to be worth it

## Changes this forces in the design doc

1. **Remove GEO 2.0** as a cross-check option — it returns 404.
2. **Feature 2 sent back for redesign**, with the three paths above.
3. **Add demonym filtering** as a required pipeline step in step 3.
4. **Recalibrate the Feature 3 zoom curve** against ~40,700 features, not 15,000.
5. **Add title-level dedup** before ranking in step 3.
6. **Correct the recorded reasoning** for abandoning lowest-character-offset: the
   failure mode is demonyms in prose, not newsroom datelines.
7. **Record the 48.5% heuristic disagreement rate** as the justification for
   running Task 5 properly rather than picking a default.

---

# Part 2 — Phase 1 completion

**Run:** 2026-08-08/09. Twelve GKG bundles over **three separate hours of the
clock** — 14:00-14:45Z, 18:00-18:45Z, 02:00-02:45Z — 7,050 records, 27.9 MB
zipped. Three windows rather than one because Part 1 measured a ~2x volume swing
by time of day and a single evening hour is not a fair sample.
**Script:** `phase1_probe.py`. **Judged samples:** `audit_judged.jsonl` (rule S,
n=110), `audit_judged_ruleh.jsonl` (rule H, n=60).

## Verdict

**Go — but the placement rule in the spec is the wrong rule, and the blindspot
feature is dead.**

The abort criterion written in `HANDOFF.md` section 5.1 *before* the audit ran
fires against the specified rule. It does not fire against a rule the audit itself
identified. Two features changed status: containers were saved by the rule change,
blindspot was killed by an unrelated measurement.

## 9. The geotag audit — the abort criterion fired

Judged by hand against the criterion fixed in advance in `HANDOFF.md` section 5.1.
`CORRECT` = the placement is the region the story is actually about;
`WRONG` = a different region, **or** the story has no real place at all;
`UNJUDGEABLE` = the headline does not say enough. Wrong is broken out by cause, so
a reader who disagrees with counting "no real place" as wrong can re-derive.

### Rule S — the rule as specified (highest specificity, then most repeated)

| Stratum | n | Correct | 95% Wilson CI | wrong: region | wrong: no-place |
|---|---|---|---|---|---|
| **PIN** | 61 | **54.1%** | **[41.7, 66.0]** | 19 | 9 |
| **CONTAINER** | 40 | **37.5%** | **[24.2, 53.0]** | 12 | 13 |
| all | 101 | 47.5% | [38.1, 57.2] | 31 | 22 |

Against section 5.1: containers fail outright — the **upper** bound, 53.0%, is
below the 60% container threshold, so no reading of the interval saves them. Pins
land in the 50-70% "ship with a caveat" band on the point estimate, but the
interval straddles 50%, and section 5.1's tie-break rule follows the lower bound.
**As specified, the criterion says stop.**

### The diagnostic that changed the answer

Before reporting a dead project, one question: for the 19 pins placed in the wrong
region, was the correct location present in the record at all?

> **In 10 of 19, it was.** The record contained the right location and the rule
> picked a different one.

The pattern is not subtle. Rule S takes the most *specific* location, so a city
mentioned once beats a state mentioned four times:

| Story | Rule S picked | Also in the record |
|---|---|---|
| Twins' 2027 plans | Chicago **x1** | Minnesota **x4** |
| 250 dogs found on Kentucky property | Dogwood, TN **x1** | Kentucky **x4** |
| Met Office UK eclipse map | London **x4** | United Kingdom **x14** |
| Trump's pick in Graham race | Washington DC **x1** | South Carolina **x2** |
| Most-booked Herefordshire restaurants | Upper Sapey **x1** | Herefordshire **x3** |

**Specificity-first is the defect.** Part 1 established that the choice of
primary-location rule moves 48.5% of placements; this is the first time that
choice has been scored against ground truth, and the specified rule loses.

### Rule D — dominance only — is worse

Taking the most-mentioned location regardless of type fixes those cases and
destroys the product: **83 of 110 records collapse to containers**, most of them
country-level, because a domestic article names its own country constantly
(`Canada x19` against `Ottawa x4`). A map of 200 country pins is not a news map.

### Rule H — specificity unless dominated

```
  city, adm1, country := most-mentioned location of each level
  if a city exists:
      adm1    >= 2x the city  -> CONTAINER at the adm1     (story is regional)
      country >= 3x the city  -> CONTAINER at the country  (story is national)
      otherwise               -> PIN at the city
  else fall back adm1 -> country -> DROP
```

The asymmetric margins are not arbitrary: countries are structurally
over-mentioned relative to states, so the same threshold at both levels would send
every domestic story to a country pin.

**Scored on a fresh, disjoint 60-record draw** — not the records the rule was
designed against — against the same thresholds, unchanged:

| Stratum | n | Correct | 95% Wilson CI | wrong: region | wrong: no-place |
|---|---|---|---|---|---|
| **PIN** | 33 | **69.7%** | **[52.7, 82.6]** | 5 | 5 |
| **CONTAINER** | 26 | **80.8%** | **[62.1, 91.5]** | 4 | 1 |
| all | 59 | **74.6%** | [62.2, 83.9] | 9 | 6 |

Against section 5.1: **containers clear the 60% bar on both bounds. Pins clear the
50% kill line on the lower bound and sit at the 70% line on the point estimate** —
the "ship, and state the measured accuracy" outcome.

Rule H also rebalances the map: **PIN 2,915 / CONTAINER 2,562 / DROP 1,572** across
the window, against 3,075 / 826 under rule S. Containers go from a fifth of the map
to a little under half, which is what the accuracy gain is bought with.

**Three caveats, stated because they are real:**

1. The two constants (2x, 3x) were fitted on the 110 rule-S records, so they are
   in-sample; only the 60-record evaluation is out-of-sample.
2. n=33 judged pins is a wide interval. It decides the go/no-go and nothing finer.
3. The same party designed the rule and judged the sample. An independent judge on
   a fresh draw would be worth an evening before Phase 4 ships.

## 10. The demonym filter has a trap in it

Part 1 made demonym filtering a required step. Implementing it the obvious way —
compare the location's `FullName` to a demonym list — **silently misses every
US-state demonym**, because GDELT writes country demonyms bare (`Americans`) but
state demonyms with a suffix (`Texans, United States`, `Minnesotans, United
States`). Match the **first comma segment**, not the whole string.

**11.9% of all 71,731 location mentions in the window are demonyms.** The fix
itself is worth only 0.2pp of mentions, but it moved 5 of 80 sampled placements —
a per-mention statistic hides a per-story effect.

## 11. Tier-1 crawl coverage — this kills the blindspot feature

`HANDOFF.md` Phase 5 compares each story group against tier-1 outlet coverage.
Measured over 28 wire services and papers of record, across all three windows:

| | |
|---|---|
| Tier-1 records | **74 of 7,050 = 1.05% of the feed** |
| **Reuters, AP, NYT, Washington Post, WSJ, NPR, Bloomberg, Al Jazeera, FT, Politico, USA Today, Time, Telegraph, France24, Economist, AFP, ABC News** | **zero records. Not one, in three hours spread across the clock** |
| Present at all | cnn.com 21, bbc.co.uk 11, newsweek.com 11, latimes.com 8, cbsnews.com 5, bbc.com 4, scmp.com 4, dw.com 3, nbcnews.com 3, theguardian.com 3, independent.co.uk 1 |
| **Title-groups with zero tier-1 coverage** | **5,181 of 5,252 = 98.6%** |

Checked for the obvious explanation first: these are not domain-string mismatches.
A substring sweep for `reuters`, `nytimes`, `apnews`, `washingtonpost`, `wsj`,
`guardian` finds nothing but unrelated local papers (`warringtonguardian.co.uk`).
GDELT is not crawling the wires at meaningful volume in this stream.

**A flag that fires on 98.6% of stories is not a signal.** Phase 5 as specified
would ship a toggle that filters almost nothing out. The acceptance bar in
`HANDOFF.md` Phase 5 — "at least 10 flagged dots, and you judge at least 6 of 10
genuinely underreported" — cannot be met by a rule whose flagged population is the
whole map.

This is the third feature this spike has killed or sent back, and the second killed
by a measurement that took under twenty minutes.

**Postscript, 2026-08-09 — the same numbers were later read the other way.** The
measurement above kills *the blindspot flag* and nothing else. `HANDOFF.md` §2.5 now
uses this outlet list to grant ranking **priority**: a tier-1-covered story outranks
everything else in its tile or country and holds that slot for 48 hours. The numbers
here are what makes that affordable rather than what makes it unwise — 71 of 5,252
title-groups, ~570/day, ~1,100 in a 48-hour pool against ~42,000 groups/day, so the
privileged class is far smaller than the per-tile budget almost everywhere.

Two derivations from the table above that the new rule depends on:

| | |
|---|---|
| Title-groups **with** tier-1 coverage | 71 of 5,252 = **1.4%** |
| Tier-1 records from US or UK outlets | 67 of 74 = **90.5%** (`scmp` 4 and `dw` 3 are the only others) |
| `newsweek.com` + `latimes.com` share of tier-1 records present | 19 of 74 = **25.7%** |

The second line is why the rule is well-targeted: tier-1 coverage concentrates in
the same handful of countries where §12 shows the density budget actually binding.
The third is its main risk — a quarter of the privileged population comes from the
two least wire-like names on the list. `HANDOFF.md` §6 decision 9.

## 12. Per-country pin density

Placed stories over the three-hour window, extrapolated to 24 hours (rule S; rule H
gives 126 countries on the same data):

| | |
|---|---|
| Placed stories per 24h | **~31,200** |
| Distinct countries with any news | **124** |
| US share | **37.7%** |

| Daily story count | Countries |
|---|---|
| 1000+/day | **4** (US 11,800 · India 4,900 · UK 2,700 · Canada 1,750) |
| 100-999/day | 25 |
| 10-99/day | **67** |
| 1-9/day | **28** |

**Half the countries on the map get fewer than 100 stories a day and a quarter get
fewer than ten.** Two consequences for section 2.4: the per-tile top-K budget will
almost never bind outside the top 30 countries, so K is a cap on four countries and
a no-op on ninety; and the country-floor layer is not a nicety — for 28 countries
it is the only thing that puts them on the map at all.

## 13. Blocklist — the zero-tier-1 population is mostly not news

Top domains, in order: `indiatimes.com` 173, `yahoo.com` 123,
**`themarketsdaily.com` 106**, **`dailypolitical.com` 93**, `thehindu.com` 82,
**`iheart.com` 77**, `el-balad.com` 49, `hindustantimes.com` 48,
`bignewsnetwork.com` 43, `indiagazette.com` 41.

Two distinct populations are mixed together here, and only one is a blocklist:

- **Algorithmic finance spam** — `themarketsdaily.com`, `dailypolitical.com`,
  `tickerreport.com`. Generated stock-move copy. Geocodes to whatever city the
  company's HQ is in and produces a pin about nothing.
- **Entertainment listicles** — `boredpanda.com`, `gamerant.com`, `collider.com`,
  `slashgear.com`, `movieweb.com`.
- **Legitimate high-volume outlets** — `indiatimes.com`, `thehindu.com`,
  `hindustantimes.com`. These are *not* blocklist candidates; they are simply where
  the news is. Blocking by volume would delete India from the map.

The audit gives this an independent number: **15 of 101 rule-S placements (14.9%)
were "no real place" stories**, and they concentrate in exactly these domains. Rule
H cuts it to **6 of 59 (10.2%)** without a blocklist, because spam articles have
few location mentions and rule H's margins push them to containers.

**First blocklist entries:** `themarketsdaily.com`, `dailypolitical.com`,
`tickerreport.com`, `iheart.com` (11.2% of feed, syndication only).

## 14. Maturity delay — run, and it found something better than it was looking for

Snapshot 2026-08-09T02:47Z, comparison 2026-08-09T21:48Z, **19 hours apart** against
a fresh 1-hour pull:

| | |
|---|---|
| Title-groups at t0 | 5,252 |
| Zero-tier-1 at t0 | 5,181 |
| **Of those, still being republished 19h later** | **15 = 0.29%** |
| Picked up a tier-1 outlet since | **0 of 15** |

**The maturation question came back uninformative, and the turnover number came back
load-bearing.**

On maturation: 0 of 15 is a 95% Wilson interval of **[0%, 20.4%]**. That rules out
almost nothing, and the script's own caveat applies — only groups *republished* in
the later window are observable, so a group that matured and then stopped being
republished is invisible. Read it as consistent with section 11 rather than as
independent confirmation of it. Either way the feature it was sized for is dead.

The unlooked-for result is the denominator. **Only 0.29% of story groups are still
in the feed 19 hours after first appearing.** GDELT's stream turns over almost
completely inside a day; groups do not linger and get re-fetched. That is a fact
about the source, not about the blindspot feature, and it directly validates a
design decision made independently of it:

> **`HANDOFF.md` §3.5's second shard family is not an optimisation, it is the only
> mechanism.** §2.5 requires a tier-1 story to stay on the map for 48 hours. If
> that were left to the live feed, the story would be gone within hours — a 0.29%
> republication rate at 19h means a re-fetch strategy would lose essentially every
> tier-1 story long before its 48 hours elapsed. Persisted state is load-bearing
> for the tier-1 rule, and the 24h/48h split is what makes it cheap.

Second, smaller consequence for §2.5: since nothing observed here matured, the
48-hour clock in practice starts when a story first appears and is rarely renewed.
`HANDOFF.md` §6 decision 10 (newest tier-1 article renews the window) is therefore a
correct but rarely-exercised path — worth keeping, not worth optimising, and not
worth trusting this measurement to have proven either way.

## Still open after Part 2

- Independent judge on a fresh rule-H draw, before Phase 4 ships
- Blob transfer allowance (`HANDOFF.md` section 6, decision 7)

*Dropped rather than answered:* Natural Earth capitals join coverage. It existed only
to serve capital-pinning, which section 6 killed.
