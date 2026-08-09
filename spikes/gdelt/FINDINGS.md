# GDELT Spike — Findings

**Run:** 2026-08-07, four consecutive GKG 2.0 bundles covering one hour
(`20260807224500` through `20260807233000`), 4,688 records, 20.1 MB zipped.
**Scripts:** `gkg_probe.py`, `quality_probe.py`, `probe3.py` in this directory.
**Status:** partial. This covers access paths, volume, titles, location quality,
source concentration, and theme distribution. It does **not** yet cover the
50-article hand-judged geotag audit, the tier-1 crawl check, or the maturity-delay
measurement. Those remain open.

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
