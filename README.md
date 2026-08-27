# Sonder

A 2D web map of current world news. Stories are plotted where they happen, ranked
by how many independent news organizations covered them — with wire services and
papers of record given precedence over the rest — and they densify as you zoom in.

**[Live here](https://sonder-drab-eta.vercel.app/).** A GitHub Action runs the
ingestion pipeline twice a day over a rolling 24-hour window, publishes a
content-hashed archive to Cloudflare R2, and the browser follows `manifest.json` to
find it. No deploy is involved in a normal publish cycle.

## Local development

```bash
npm install
npm run dev
```

That is the whole loop. **The map reads published data straight from R2**, so
there is no build step between a clone and a working map, and nothing to keep in
sync locally. Without a `NEXT_PUBLIC_MAPTILER_KEY` the app renders on a keyless
OpenFreeMap basemap and says so on screen, so it runs with no account at all.

The rest are for working on the pipeline rather than the map:

```bash
npm run worker         # the full pipeline, once, locally — PUBLISHES, no dry run
npm run boundaries     # rebuild public/boundaries.pmtiles from Natural Earth
npm run typecheck      # tsc --noEmit
npm test               # vitest run
```

> **`npm run worker` is not a dry run.** It writes state shards, flips the live
> manifest, and moves the deployed map to the archive it just built. `BUNDLE_CAP=1`
> limits the *fetch*, not the *publish* — the pool is a rolling 24-hour window, so
> a one-bundle run still publishes the whole window.

Tiling needs tippecanoe, which on Windows means WSL:
`wsl -d Ubuntu -- sudo apt-get install -y tippecanoe`. `npm run tiles:fake` builds
a one-layer smoke-test archive from fixture data into `public/` — it does not feed
the live map.

`predev` and `prebuild` copy MapLibre's worker into `public/`. Do not remove that
step — MapLibre 6 builds its worker from a runtime-computed URL that bundlers
cannot resolve statically, and without a real worker asset the map silently never
loads a tile.

---

## Read this first

**[`docs/DESIGN.md`](docs/DESIGN.md) is the single authoritative design
document.** Product framing, data reality, the placement and ranking rules, the
tile budget, the region/city/continent panels, the basemap and operations
tradeoffs, and the failure philosophy — with every claim traced to a measurement
and a chapter of rejected alternatives.

**[`spikes/gdelt/FINDINGS.md`](spikes/gdelt/FINDINGS.md)** and
**[`spikes/basemap/CASE-STUDY.md`](spikes/basemap/CASE-STUDY.md)** are the primary
measurement evidence `DESIGN.md` cites rather than restates.

Superseded documents live unedited in `docs/archive/` for history: the original
`HANDOFF.md`, `modes-2-3-handoff.md`, and `ui-refresh-2026-08.md`.

---

## Stack

| | |
|---|---|
| Frontend | Next.js + React, MapLibre GL JS (2D) |
| Basemap | MapTiler, with an OpenFreeMap keyless fallback |
| Story data | PMTiles vector tiles on Cloudflare R2 |
| Boundaries | Natural Earth, built once |
| Ingestion | GitHub Actions, TypeScript |
| Database | none — deliberately, see `docs/DESIGN.md#operations` |

---

## Data

News metadata from [GDELT](https://www.gdeltproject.org/). Boundaries from
[Natural Earth](https://www.naturalearthdata.com/) (public domain). Basemap from
[MapTiler](https://www.maptiler.com/) / OpenStreetMap.

English-language sources only. Sonder links out to articles and never reproduces
article text.
