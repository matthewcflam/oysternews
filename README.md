# Sonder

A 2D web map of current world news. Stories are plotted where they happen, ranked
by how many independent news organizations covered them — with wire services and
papers of record given precedence over the rest — and they densify as you zoom in.

**Status: Phase 2 complete — [live here](https://sonder-drab-eta.vercel.app/).** The
data research is done, including a hand-judged accuracy audit that **failed its own
pre-registered abort criterion**, and what was changed in response. What is on screen
today is the skeleton: eight fake points on a real PMTiles archive. Real GDELT data
lands in Phase 2.5.

## Local development

```bash
npm install
npm run tiles:fake     # tippecanoe -> public/stories.pmtiles (needs WSL on Windows)
npm run dev
```

The committed archive means `tiles:fake` is optional — run it only to regenerate.
It needs tippecanoe, which on Windows means WSL:
`wsl -d Ubuntu -- sudo apt-get install -y tippecanoe`.

Without a `NEXT_PUBLIC_MAPTILER_KEY` the app renders on a keyless OpenFreeMap
basemap and says so on screen, so it runs with no account at all.

`predev` and `prebuild` copy MapLibre's worker into `public/`. Do not remove that
step — MapLibre 6 builds its worker from a runtime-computed URL that Turbopack
cannot resolve, and without a real worker asset the map silently never loads a
tile: no error, no console warning, just an empty map.

---

## Read this first

**[`HANDOFF.md`](HANDOFF.md) is the single source of truth.** Product spec,
architecture, build plan, open decisions, timeline. If anything anywhere
contradicts it, that file wins.

**[`spikes/gdelt/FINDINGS.md`](spikes/gdelt/FINDINGS.md)** is the evidence it
rests on — a real measurement pass over GDELT's data before any code was written.

---

## Why the research came first

The whole product depends on GDELT, a public firehose of global news metadata.
Before building anything, live GDELT data was pulled and measured — first one
hour, then twelve bundles spread across three separate hours of the clock. It
changed the design substantially:

- **Two of GDELT's three documented access paths are unusable.** The GEO 2.0 API
  returns 404 on GDELT's own documented example URLs. DOC 2.0 is rate-limited
  non-deterministically. Raw GKG files are the only viable path, with no fallback.
- **GDELT uses FIPS 10-4 country codes, not ISO 3166.** Four collide with
  entirely different countries: `RS` is Russia (ISO: Serbia), `CH` is China (ISO:
  Switzerland), `IS` is Israel (ISO: Iceland), `AS` is Australia (ISO: American
  Samoa). A naive join puts Russian news in the Balkans, silently.
- **GDELT geocodes demonyms.** "British", "Americans", and "Danish" all resolve to
  country coordinates, so a large share of country-level tags are adjectives in
  prose rather than places the story is about.
- **Two plausible ways to pick a story's primary location disagree 48.5% of the
  time.** That single choice moves nearly half of all pins.
- **69.4% of the data volume is one field the project never reads.**

- **Tier-1 outlets are 1.05% of GDELT's stream**, and Reuters, AP, the New York
  Times, the Washington Post and the WSJ returned **zero records across three
  hours**. That killed one feature and created another: a signal that thin cannot
  accuse the other 99% of a blindspot, but it is precisely why those stories need
  protecting from the ranking. They now take precedence in their own area and hold
  it for 48 hours.

### The audit that nearly ended the project

An abort criterion was written down **before** the accuracy audit ran — what
number kills the container feature, what number kills the project — so the result
could not be rationalised after the fact.

It fired. Hand-judging 110 placements put the specified rule at **54.1%** on pins
and **37.5%** on containers, and the criterion's own tie-break said stop.

Before accepting that, one diagnostic: for the mis-placed pins, was the correct
location in the record at all? **In 10 of 19, it was.** The rule preferred the most
*specific* location, so a city mentioned once beat a state mentioned four times —
a Minnesota Twins story pinned to Chicago, a UK-wide Met Office story pinned to
London. The data was fine; the rule was wrong.

The replacement — specificity wins *unless* it is dominated — scores **69.7%** on
pins and **80.8%** on containers on a fresh out-of-sample draw, against the same
unchanged thresholds. Measured accuracy and its confidence interval will be
published in the app, not just in the repo.

### Two features cut by measurement

- **Pinning policy stories at capital cities.** Its detection rule fired on 47.7%
  of all articles and would have confidently placed a dog attack at a state
  capital.
- **Flagging stories no major outlet covered.** The flag fired on **98.6%** of
  stories, because GDELT barely crawls the wires. A signal that fires on almost
  everything is not a signal. The outlet list it was built on was kept and
  inverted — it now grants ranking priority instead of withholding it.

---

## Stack

| | |
|---|---|
| Frontend | Next.js + React, MapLibre GL JS (2D) |
| Basemap | MapTiler |
| Story data | PMTiles vector tiles on Vercel Blob |
| Boundaries | Natural Earth, built once |
| Ingestion | GitHub Actions, TypeScript |
| Database | none — deliberately |

No database. Tiles are static files, so the browser fetches only the viewport,
and the map stays fast on a phone. See `HANDOFF.md` §3 for the reasoning and the
migration path if that stops being true.

---

## Repo layout

```
HANDOFF.md               the plan — read this
README.md                you are here
spikes/gdelt/
  FINDINGS.md            measured GDELT research — part 1 and part 2
  gkg_probe.py           volume, titles, locations, sources, themes
  quality_probe.py       geotag quality, syndication, API probes
  probe3.py              theme frequency, dedup math
  retry_all3.py          all three GDELT access paths
  phase1_probe.py        placement rules, geotag audit, tier-1, density
  demonyms.txt           the demonym blocklist the audit made necessary
  audit_judged*.jsonl    the hand-judged samples, verdict by verdict
```

The spike scripts are Python and throwaway by design; the production pipeline is
TypeScript. They are kept as reproducible evidence, not as a reference
implementation.

---

## Data

News metadata from [GDELT](https://www.gdeltproject.org/). Boundaries from
[Natural Earth](https://www.naturalearthdata.com/) (public domain). Basemap from
[MapTiler](https://www.maptiler.com/) / OpenStreetMap.

English-language sources only. Sonder links out to articles and never reproduces
article text.
