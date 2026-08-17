# Modes 2 & 3 — work in progress (2026-08-16)

Companion to `docs/ui-refresh-2026-08.md`, which covers Section 0, Mode 1 and now
Mode 2. This file covers what is **still outstanding** on Modes 2/3, all of it
uncommitted.

The approved plan is at
`C:\Users\matth\.claude\plans\mode-2-story-selected-lovely-puffin.md`.

---

## Status in one line

**Mode 2's UI is built and measured live (Part E + Part B); the pipeline behind
it is not, and Mode 3 is not started.** Part E's tokens and Part B's card are
written up in `docs/ui-refresh-2026-08.md` under "Mode 2 — Story Selected".

### Done since this file was written

| Step | State |
| --- | --- |
| 3 — Part E, colour tokens | **done.** `:root` tokens; `MARK` drift resolved to `#C05AC4` |
| 4 — Part B, the story card | **done.** Measured at 1482×900 and 390×844; table in the design log |
| Escape / ×  / click-away | **done.** Escape was never wired before; it is now |
| `PanelTab`, `collapsed`, `lib/nearby.*` | **deleted** |
| `.maptiler-logo` positioning | **restored** — it had been commented out in `e84b600` |

Three things found by measuring rather than by review, all now fixed: the place
sphere had no gradient, the coverage rows were at a 26px pitch against the
mockup's 18, and the map's own MapTiler mark had been unpositioned since Mode 1.
See §2C and §2D of the design log.

### What Mode 2 still owes

- **Real coverage links.** "More Reporting" is written, renders from `story.more`,
  and was measured with *injected* data. `worker/group.ts` does not emit the
  field, so live it is always absent — which is also the normal state (87.2% of
  groups). It cannot be judged against real hosts until step 6 lands.
- The `og:image` failure paths were not re-exercised in the new card.

---

## Next steps, in order

Steps 1 and 2 are independent of each other; step 5 assumes both. Steps 3 and 4
are done — the numbering is kept so the design log's references still resolve.

### 1. Validate the topic classifier — do this before writing any chip UI

```
node --env-file=.env.local scripts/theme-audit.ts --top 0
```

Read the `topic share, over articles` block. **Done when** unclassified is under
~35% and no single topic is over ~40%. Version 1 failed this at 44.2% Disaster;
version 2 is unmeasured (§3).

If it still skews, the lever is `THEME_TOPICS` in `worker/topics.ts` — map an
over-firing high-frequency row to `""` (as `MANMADE_DISASTER_IMPLIED` already is)
rather than deleting the family row. Re-run and re-read; do not tune blind.

While there, fix the stale figures in the `scripts/theme-audit.ts` header
docstring (§4).

### 2. Settle the chip set with the user

Blocking for Parts C and D. Sports and Tech cannot be built from GDELT (§2c), so
the mockup's four chips are not deliverable as drawn. Bring them the measured
distribution from step 1 and the current eight-topic set, and get a decision.

### 3. Part E — colour tokens in `app/globals.css` — **DONE**

`:root` carries `--panel-veil`, `--panel-wash`, `--accent`, `--mark`, `--muted`,
`--pill`, `--shadow`. No literal palette hex survives outside `:root` and
comments. There is deliberately **no opaque `--panel`** and no grid purple — see
§2G of the design log for why an unused token is not added.

Open question 3 is closed: **`MARK = #C05AC4`**, the hand-tuned value, applied to
the sphere gradient as well. `lib/layers.ts`'s constant stays the source of truth
because MapLibre cannot read a custom property.

### 4. Part B — Mode 2, the story card — **DONE**

Built and measured; see "Mode 2 — Story Selected" in
`docs/ui-refresh-2026-08.md` for the geometry table and the reversals. The
original brief is kept below for reference.

The first visible work, and the one that proves the card shell Parts C and D
reuse. Full geometry table is in the plan file, Part B.

- `app/globals.css` — `.panel` becomes a floating card: 324×489 at (15, 165) on
  a 1481-wide frame, radius 29, `rgba(55,54,102,0.95)`, with a
  `rgba(0,0,0,0.1)` radius-38 plate 10px behind it. Not `top/bottom: 0`.
- `components/StoryPanel.tsx` — headline becomes an `h2` and stops being the
  link; a **Read The Story** button (`#D24F39`, radius 12) takes that job;
  source and age merge into one italic line; the place line gets the
  radial-gradient sphere; **How does this work?** at the foot links to `/about`.
- Delete `components/PanelTab.tsx` and the `collapsed` state from `MapView.tsx`
  and both panels — a card is not covering anything worth reclaiming. **Keep
  dismissal**: `Escape`, click-away (the existing miss path in `MapView.tsx`
  already clears), and a small ×.
- Drop the panel footer's `MapTilerLogo` **only after verifying live** that the
  map's own bottom-left copy is visible past the card, at 1482×900 *and*
  390×844. §2.6 fails silently if it is not.
- "More Reporting" renders from `story.more` when present and the section is
  omitted entirely when absent — which is the state until step 6 lands, and is
  the common state forever (87% of groups have no coverage).

**Done when** `getBoundingClientRect` matches the plan's geometry table at both
breakpoints and the numbers are recorded in `docs/ui-refresh-2026-08.md`, in the
two-column format Sections 0C and 1E already use.

### 5. Parts C and D — region panel, then the all-stories grid

**Part C's data-independent half is done (2026-08-16).** `RegionPanel` now has
Mode 3's layout, built against the `RegionIndex` as it exists today:

| Piece | State |
| --- | --- |
| Breadcrumb `World › India` / `World › USA › Texas` | **done** — `countryName` in `lib/flag.ts`, parent is the id's prefix |
| Name + small flag plate | **done** — the 190px hero is gone |
| Rows: place / headline / source · dot · age | **done** — `placeLine` shared with the story card |
| Headline hover: white underline, links out | **done** |
| MapTiler footer copy | **deleted** — measured clear at 1482×900 and 390×844 |
| Orange corner disc (`.panel__dot`) | **deleted** |
| `248 stories today · 39 sources` | **blocked** — no `total`/`sources` on the index |
| Topic chips | **blocked** — step 2 |
| `See all N stories` | **blocked** — step 6's shards |
| `Zoom to India ›` | **blocked** — no bbox; `region-bbox.json` is step 6 |

Nothing blocked is stubbed. Counting the rows on screen would print a confident
wrong number for the 68 regions that exceed the top-N cap (§2a's measurement
run), which is exactly the kind of silent-plausible failure §3.4 warns about.

Measured live: card 324×489 at (15, 165); head 91 tall; flag 78×50 at (243, 205),
which is where `.panel__close` ends — see the comment on `.panel__head`, the
38px of top padding is that clearance and not a round number. Mobile 390×844:
card 366 wide at (12, 96), no flag on an admin-1, MapTiler mark visible past the
foot.

Part D — the all-stories grid — is not started, and step 2's chip decision still
blocks the chips on both.

### 6. Part A remainder — the pipeline

Now unblocked and no longer on the critical path for anything visible. In the
plan's staged order: `coverage`/`topic` into `buildGroup` → the two tile
properties → the `RegionIndex` envelope with `total`/`sources`/`topics` →
`buildRegionShards` → publish-side upload, manifest fields and retention →
client seams in `lib/regions.ts` and `lib/story.ts` → `bboxOfRings` and
`public/region-bbox.json`.

Use **`COVERAGE_LINKS = 3`**, not the 2 the plan file says in places.

Finish with the `HANDOFF.md` amendments (plan A8 step 8): §6, §2.3 and
`worker/regions.ts`'s own header all currently state that nothing here
classifies by topic, and all three become false.

### 7. Verify and record

`npx tsc --noEmit`, `npm run build`, `npx vitest run`. Then the live gates the
plan lists — a real worker run, the archive size delta against the +7% estimate,
two identical runs producing identical hashes, the pruner backlog draining, and
zoom-to-region on Russia / Fiji / the US.

---

## What is on disk, uncommitted

| File | State | What |
| --- | --- | --- |
| `worker/publish.ts` | modified | the pruner fix (A0) |
| `worker/publish.test.ts` | modified | +1 regression test for it |
| `worker/group.ts` | modified | `documentFrequency` extracted and exported |
| `worker/topics.ts` | **new** | topic taxonomy + classifier |
| `scripts/theme-audit.ts` | **new** | read-only measurement script |
| `lib/layers.ts` | modified | the `MARK` edit, now ratified by Part E |
| `app/globals.css` | modified | Part E tokens + the Mode 2 card |
| `components/StoryPanel.tsx` | modified | the card |
| `components/RegionPanel.tsx` | modified | Mode 3 layout: breadcrumb, flag plate, restacked rows |
| `components/MapTilerLogo.tsx` | modified | `className` prop dropped — there is one copy again |
| `lib/flag.ts`, `lib/flag.test.ts` | modified | `countryName` for the breadcrumb, +5 tests |
| `components/MapView.tsx` | modified | collapse + nearby out, `Escape` in |
| `components/PanelTab.tsx` | **deleted** | no column left to collapse |
| `lib/nearby.ts`, `lib/nearby.test.ts` | **deleted** | orphaned by "More Reporting" |
| `lib/story.ts`, `lib/story.test.ts` | modified | 8th field `more`; `placeLine` |
| `app/about/page.tsx` | modified | carries the placement disclosure now |

`lib/layers.ts` was already modified when this work started (`MARK` changed from
`#B339D2` to `#C05AC4`). Part E adopted that value deliberately rather than
leaving it stranded, so it is no longer a loose edit.

Gates: `npx tsc --noEmit` clean, `npx next build` clean, `npx vitest run`
**383 passing, 25 files**. `scripts/tippecanoe-min-version.test.ts` fails
6/7 on this machine, pre-existing.

---

## 1. The pruner bug (plan A0) — done, verified

`worker/publish.ts` listed with `ARCHIVE_PREFIX` (`archives/stories-`) while
`archivesToPrune` filtered on `ARCHIVE_DIR` (`archives/`). **A filter cannot
delete what the listing never returned**, so no `archives/regions-*.json` had
ever been pruned — one ~1.24 MB orphan per run, every four hours, since the
region index shipped on 2026-08-13.

It was invisible from outside: archive retention worked, `pruned` reported a
plausible number, and the map never noticed. It shows up only as storage.

The fix is `store.list(ARCHIVE_DIR)` at the prune site. `assertStoreReachable`
deliberately keeps the narrow prefix — it is a reachability probe billed as an
advanced operation, not a sweep.

**Why the existing test did not catch it:** `"retains an archive and its index
together, and prunes both when they age out"` only ever asserted the *retained*
half. The new test, `"prunes a region index left by a generation that has aged
out"`, publishes a fourth generation so the first falls outside `KEEP_ARCHIVES`.
Confirmed failing on the unfixed code, and failing in exactly the right place —
the `stories-gen1` assertion passed and the `regions-gen1` one failed, which
localises the leak to the index alone.

**Not yet done:** confirming the backlog actually drains against the live store.

---

## 2. Measured findings — these overturned three plan assumptions

All from `scripts/theme-audit.ts` against the live pool (25,767–26,091 articles,
20–21 live shards, 14,313 groups, 6,698 distinct themes).

### 2a. The coverage estimate was wrong by ~20×

The plan sized "More Reporting" assuming most groups carry a list of other
outlets. They do not: **87.2% of groups are a single article** and supply no
links at all.

| Cap | links/group emitted | archive delta |
| --- | --- | --- |
| 2 | 0.19 | +0.93 MB (+5.8%) |
| 3 | 0.23 | +1.13 MB (+7.1%) |
| 5 | 0.29 | +1.40 MB (+8.8%) |

Measured mean article url = 107.5 bytes; tile replication factor 3.2× (calibrated
from the `image` change: ~1.20 MB of properties → +3.81 MB of archive).

The original estimate of +22 MB for five links multiplied by the *cap* rather
than by the mean **emitted**, which differs by an order of magnitude when 87% of
groups emit zero.

**Decision: `COVERAGE_LINKS = 3`** (user's call, taken with the corrected
numbers). The plan file still says 2 in places — the corrected figure is 3.

### 2b. The grouping theme ceiling must NOT be reused for topics

The plan said topics should exclude what grouping excludes. That is wrong, and
the reason is that the two uses have **opposite requirements over the same
field**.

Grouping discards themes above 15% document frequency because a theme on a
quarter of the feed cannot tell you *which two articles are the same story*.
Classification wants exactly those themes: `USPEC_POLITICS_GENERAL1` (26.9%) and
`GENERAL_HEALTH` (22.7%) are common *because* they name what a lot of news is
about.

35 themes exceed the ceiling and they include nearly every useful label —
`GENERAL_GOVERNMENT` 26.8, `KILL` 23.3, `MEDICAL` 22.4, `ARMEDCONFLICT` 18.2,
`CRISISLEX_T03_DEAD` 20.8. Reusing the set left Politics, Health, Conflict and
Disaster detectable only by proxy.

**`worker/topics.ts` reads the full theme set.** `staleTopicThemes`, which the
plan specified as a guard on that exclusion, is therefore not needed and was not
written.

### 2c. GDELT cannot support the mockup's chip set

V2EnhancedThemes is a **policy and crisis** vocabulary — World Bank sector codes,
CrisisLex, EPU. Not newsroom beats.

- **Sports does not exist.** `TAX_FNCACT_ATHLETE` 0.1%, `TAX_FNCACT_FOOTBALLER`
  0.0%, `TAX_FNCACT_SPORTSMAN` 0.0%. Nothing names a game, league or tournament.
- **Entertainment is marginal.** `SINGER` 2.7%, `ACTOR` 1.8%, `MUSICIAN` 0.5% —
  and they name a person, not a subject.
- **Tech is unusable.** The only broad token,
  `WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES`, is on 20.9% of everything
  because it fires on any mention of a phone or a website.

So the mockup's `Politics / Wildfire / Tech / Sports` cannot be built as drawn.
Two of the four have no data. "Wildfire" does work — `DISASTER_FIRE` at 3.9%.

**The set currently in `TOPICS`**, ordered most-specific-first because that order
breaks ties: `Disaster, Conflict, Crime, Health, Environment, Education,
Business, Politics`.

**This is an open design decision for the user**, not a settled one.

---

## 3. `worker/topics.ts` — written, NOT yet validated

Pure module. `TOPICS`, a `THEME_TOPICS` prefix table (~70 rows, longest prefix
wins, so one row covers a GDELT family and a `""` mapping can silence a leaf),
`topicOfTheme`, and `topicOf(members, frequency)`.

### The classifier was rewritten once and the rewrite is unmeasured

**Version 1** counted how many themes voted for each topic and broke ties on
`TOPICS` order. Measured result: **44.2% of the feed in Disaster**, because
**75.3% of classified articles match more than one topic** — with three quarters
of articles tied, declaration order *was* the classifier.

**Version 2 (current)** scores each article by its **rarest matched theme**,
using the pool's own document frequency: `NATURAL_DISASTER_EARTHQUAKE` (3.6%)
says far more than `MANMADE_DISASTER_IMPLIED` (28.7%). One vote per member, cast
for that member's most specific topic; ties fall back to `TOPICS` order, which is
now a rare path rather than the norm. `MANMADE_DISASTER_IMPLIED` is additionally
mapped to `""` — GDELT sets it when it *inferred* a disaster, on more than a
quarter of all news.

> **The version 2 distribution has never been measured.** `npx tsc --noEmit` is
> clean and that is all that is known. The next action on this file is to re-run
> the audit and read the topic table. Targets from the plan: unclassified under
> ~35%, no single topic over ~40%.

`documentFrequency` was extracted from `overCommonThemes` in `worker/group.ts`
and exported so the classifier and the grouping ceiling share one counting rule.

---

## 4. `scripts/theme-audit.ts` — read-only

```
node --env-file=.env.local scripts/theme-audit.ts [--top N] [--examples N]
```

Reads the live pool from Blob (needs `BLOB_READ_WRITE_TOKEN`, present in
`.env.local`), groups it, and prints: theme document frequency with the grouping
ceiling flagged, the coverage histogram and per-cap byte costs, the topic
distribution, and the biggest groups for reading coverage by eye. Writes nothing.

A full run takes several minutes. `--top 4000` dumps the whole vocabulary, which
is the useful form for writing table rows against real tokens.

**Known stale text:** the header docstring still quotes pre-measurement figures
(39.4%, ~3,200 themes) superseded by the real run (46.3%, 6,698). Correct it on
the next edit.

---

## 5. What has NOT been started

- **Part A remaining** — the pipeline, all of it bar the pruner fix. This is what
  makes "More Reporting", the region counts, the chips and the full lists real
  rather than gracefully absent.
- **Parts C and D** — the Mode 3 region panel and the all-stories grid. Not
  started; `RegionPanel` inherits Mode 2's shell but none of Mode 3's content.

Parts B and E are done — see the status table at the top.

### Why the order changed

The plan put Part A first, reasoning that panels should not be built against
fields that do not exist. **The user pushed back on that** — they want to see the
UI, and they are right. Most of Mode 2 needs no new data (card shell, hero,
headline, source·age, place line, the button, the About link), and the parts
that do — "More Reporting", counts, chips, the full list — must degrade
gracefully when absent regardless, exactly as `regionsUrl` already does.

So the pipeline moved behind the UI rather than in front of it, and the only
thing that had to stay first was the pruner fix, which is a live bug.

---

## 6. Decisions taken with the user so far

| Question | Answer |
| --- | --- |
| Scope | All three surfaces, one plan |
| Missing data | Extend the pipeline; nothing on screen is fictional |
| "More Reporting" | Carry group members through as real links |
| Grid tiles | Flat ranked list flowed into columns |
| Topic chips | Curated theme → topic table |
| Coverage cap | **3** (revised from 2 once the real cost was measured) |

## 7. Open questions

1. **The chip set**, given Sports and Tech cannot be built (§2c). Still open, and
   still blocking Parts C and D.
2. ~~**Whether `topic` belongs in `PanelStory`.**~~ **Closed: leak list.** The
   card shows no topic label, so `story.test.ts` asserts the field is dropped —
   which means growing the card a topic later fails a test rather than drifting.
3. ~~**`MARK`: `#B339D2` or `#C05AC4`.**~~ **Closed: `#C05AC4`**, applied to the
   token, the sphere gradient, the wedge and the selected disc, with the design
   log corrected.
