# Basemap case study — Google Maps Platform vs MapTiler

**Question asked:** would the Google Maps API work instead of MapTiler, and what
are the tradeoffs?

**Answer:** yes, it would work — and no, it should not be used. But the research
turned up something that matters more than the answer: **`HANDOFF.md` §3.1's
free-tier number was wrong, and wrong in the direction that hurts.**

**Decided 2026-08-10.** Stay on MapLibre GL JS + MapTiler, billed per request.
`HANDOFF.md` §6 decision 11 is the durable record; this file is the evidence.

---

## 1. The correction

§3.1 recorded the basemap as "MapTiler hosted style, **100k loads/mo free**."
That is not what the free plan is, and the difference is a factor of roughly 200.

MapTiler meters two different things, and which one applies depends on a choice
this project already made:

| | Meter | Free allowance |
|---|---|---|
| MapTiler SDK JS | **map sessions** — one page load, unlimited pan/zoom inside it | 5,000 / month |
| **Third-party clients (this project)** | **API requests** — each tile is one | **100,000 / month** |

Sonder imports `maplibre-gl` directly (`components/MapView.tsx`), which is a
third-party client. So the per-request meter is the one that applies, and
MapTiler is explicit that this is not a setting: *"If you built your map app
using MapTiler API combined with 3rd party clients and libraries, then the
traffic is tracked by request. Switching to sessions is not technically possible
in this case."*

The practical consequence is in §3 below: not 100,000 visits, but a few hundred.

---

## 2. Would Google work?

**Technically, yes.** This was worth establishing before arguing about it,
because "Google tiles can't be used outside Google's SDK" is a common and wrong
assumption.

- Google's **Map Tiles API** serves 2D roadmap tiles over a plain
  `{z}/{x}/{y}` URL template that drops straight into a MapLibre `raster` source.
- Third-party renderers are **explicitly contemplated** in the Map Tiles API
  policies, which specify how the Google logo must sit relative to "the
  renderer's logo."
- Roadmap tiles are **custom-stylable** via the `styles` field on
  `createSession`, so a dark theme matching `app/globals.css` is achievable.
- Pricing is generous: SKU `0164-F76D-680A`, **100,000 tiles/month free**, then
  $0.60 per 1,000 — and it *degrades into billing* rather than stopping.

So Google is a real option, not a dead end. It was rejected on fit, not
feasibility.

---

## 3. The measurement

Every cost claim here rests on **tiles per visit**, which was an estimate. §0
rule 7 says measure it rather than reason from a plausible assumption, so it was
measured.

**Method.** A standalone harness (not the app) using the same `maplibre-gl` build
from this repo's `node_modules`, the same style URL and the same initial camera
as `MapView.tsx`. A `transformRequest` hook counted every request MapLibre
issued, bucketed by kind. The camera then ran a scripted session standing in for
the 2-3 minute visit of §1: world view → fly to a country → pan one screen → zoom
to a city → jump to a second city → return to global (§2.3's Global button). Each
step waited for the map's `idle` event before recording.

**Results.**

| Viewport | Tiles | Style/sprite/glyph | Total requests |
|---|---|---|---|
| Phone, 390×844 | 152 | 41 | **193** |
| Desktop, 1280×800 | 254 | 50 | **304** |
| Phone @2× DPR | 149 | 43 | 192 |

Per-step, on the phone: **4 tiles for the initial world view with no interaction**,
then +14 to a country, +4 to pan, +28 to a city, +59 to a second city, +43
returning to global.

**Three things this shows.**

1. **The free tier is ~330–520 visits/month, not 100,000.** 100,000 ÷ 193 ≈ 518
   phone sessions; ÷ 304 ≈ 329 desktop. A passive visitor who never touches the
   map costs about 45, so the real ceiling depends heavily on engagement.
2. **Cost scales with exactly the behaviour the product is designed to
   encourage.** §2.3's camera states and §2.4's "zooming surfaces more stories"
   mean interaction *is* the feature. Under a per-request meter, the core
   interaction loop is what spends the budget. One "jump to a second city" cost
   more than the entire initial page load.
3. **Vector tile count is DPR-independent.** 149 tiles at 2× versus 152 at 1× is
   noise. This is the hard number against Google: raster tiles need
   `scaleFactor2x` for a retina display, which doubles tile count and halves the
   effective free tier. Vector tiles are resolution-independent by construction.

**Caveats, stated because they qualify the number.** The harness ran against
**OpenFreeMap positron**, not MapTiler streets-v2, because no key existed yet.
Both are vector tilesets on the same scheme so the counts should be close, but
glyph counts depend on the style's fonts — treat 193/304 as the right order of
magnitude, not exact. Separately, MapTiler's docs say "Tile API Requests" are
what third-party SDKs bill; whether the 41–50 style/sprite/glyph requests also
meter was **not** confirmed. If they don't, the ceiling rises to about 650, which
does not change any conclusion here.

---

## 4. The three options

| | Meter | Free allowance | On overage | Card required |
|---|---|---|---|---|
| **A. MapLibre + MapTiler** *(chosen)* | per request | 100k requests | **map pauses until next month** | no |
| **B. MapTiler SDK JS** | per session | 5,000 sessions | map pauses until next month | no |
| **C. MapLibre + Google 2D Tiles** | per tile | 100k tiles | **$0.60 / 1,000** | **yes** |

---

## 5. Why not Google

- **Raster, not vector.** No smooth fractional zoom, no runtime restyling, and
  materially more bytes — against §9's "first meaningful map paint < 2.5s on
  simulated 4G, mid-tier Android." Retina needs `scaleFactor2x`, halving the free
  tier (§3).
- **A credit card contradicts §2.6's "free tier everywhere."** Domain restriction
  is real protection, but the failure mode changes from "map pauses" to "bill
  arrives," on a public repo where the key ships to the browser.
- **Heavier attribution burden.** The Google logo must be a visible image at
  16–19dp, unobscured, with a buffer from other logos, *plus* full data
  attributions — "only including 'Google Maps' or the Google logo is not proper
  attribution." That is real screen budget on a phone already carrying a masthead
  and notices.
- **A new moving part.** 2D tiles need a `createSession` token before any tile can
  be fetched. `lib/basemap.ts` is a pure, synchronous, zero-I/O function; Google
  makes it async and stateful, needing a route handler and a cached token.
  *(Google's one genuine advantage here: that flow keeps the key server-side,
  which is better hygiene than MapTiler's key-in-URL.)*
- **It breaks the escape hatch.** §3.1's design is that the basemap is a style URL
  and the fallback is a one-line swap. Google is a raster source plus a custom
  attribution control, so `basemap()` would stop returning one shape.
- **No-caching clause.** Pre-fetching, storing and caching tiles are prohibited.
  It does not bite today; it forecloses a tile proxy or an offline demo.

Google's honest advantages, recorded so the decision is not one-sided: graceful
paid overflow instead of a hard stop, recognisable cartography with strong label
coverage in under-mapped regions, and satellite/terrain included.

None outweigh raster-versus-vector against a mobile performance target.

---

## 6. Why A over B

B wins on paper — roughly 10–15× the headroom, and it meters the one thing this
product wants users to do. It was still rejected, for three reasons:

1. **The headroom is theoretical at this traffic.** A résumé link draws tens of
   visits a month. A's floor of ~330 covers that with room, and neither option
   survives a genuine spike: both hard-pause on the free tier.
2. **B costs the property §3.1 deliberately bought.** A basemap that is a plain
   style URL, swappable in one line, is not decoration — it paid for itself
   during this very investigation. With no key and no account, the app still
   rendered on OpenFreeMap, which is the only reason the tile counts above could
   be measured and the two Phase 2 render bugs found at all. `@maptiler/sdk` is
   MapTiler-specific, so the escape hatch either dies or becomes a second code
   path.
3. **Deferring is nearly free.** The SDK wraps MapLibre GL JS, so the API is close
   to identical and switching later stays small. There is no lock-in penalty for
   waiting, which is the usual reason to decide early.

**Revisit trigger:** sustained traffic above ~200 visits/month, or deliberately
promoting the link somewhere with reach. Then take B.

---

## 7. A fourth option, noted not taken

**OpenFreeMap as the primary**, not the escape hatch. No key, no account, no
meter, no pause — it removes the quota question entirely, and it is what the app
actually ran on throughout this investigation. What it gives up is an SLA,
support, and style choice, and it means depending on a donation-funded service
for a portfolio piece. That may still beat a commercial free tier whose failure
mode is a blank map on the one link that matters.

Recorded because the measurement made it a live option rather than a fallback.
Not adopted: MapTiler's free tier is sufficient at this traffic, and the
OpenFreeMap path stays wired up and one line away regardless.

---

## 8. What this changed

1. **§3.1 corrected** — the basemap row now states the per-request meter and the
   measured ceiling instead of "100k loads/mo free."
2. **§6 decision 11 added** — basemap provider and billing unit, resolved to A.
3. **§9 gains a cost dimension** — tile count is now a budget as well as a latency
   figure. The per-tile work in §2.4 is what moves it.
4. **A compliance gap found and closed.** §2.6 requires the MapTiler logo and only
   the text credit was rendered; MapLibre's `AttributionControl` does text only,
   and the MapTiler SDK is what normally supplies the logo. Fixed in
   `MapView.tsx`. Their `logo.svg` has a `fill="white"` wordmark with no dark
   variant published, so it needs a dark backdrop to stay visible on the light
   streets-v2 basemap.

---

## Sources

- [MapTiler — sessions vs requests](https://docs.maptiler.com/guides/account/sessions-vs-requests/)
- [MapTiler Cloud pricing](https://www.maptiler.com/cloud/pricing/)
- [MapTiler — how to add attribution](https://docs.maptiler.com/guides/map-design/how-to-add-maptiler-attribution-to-a-map/)
- [Google Map Tiles API — overview](https://developers.google.com/maps/documentation/tile/overview)
- [Google Map Tiles API — policies](https://developers.google.com/maps/documentation/tile/policies)
- [Google Map Tiles API — session tokens](https://developers.google.com/maps/documentation/tile/session_tokens)
- [Google Maps Platform — pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
