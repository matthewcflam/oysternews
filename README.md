# Sonder

A 2D web map of current world news. Stories are plotted where they happen, ranked
by how many independent news organizations covered them, and they densify as you
zoom in.

**Status: pre-build.** No application code yet. The plan and the data research are
done.

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
Before building anything, one hour of live GDELT data was pulled and measured. It
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

A planned feature — pinning policy stories at capital cities — was **cut by this
research**. Its detection rule fired on 47.7% of all articles and would have
confidently placed a dog attack at a state capital.

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
  FINDINGS.md            measured GDELT research
  gkg_probe.py           volume, titles, locations, sources, themes
  quality_probe.py       geotag quality, syndication, API probes
  probe3.py              theme frequency, dedup math
  retry_all3.py          all three GDELT access paths
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
