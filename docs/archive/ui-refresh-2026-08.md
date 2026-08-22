# UI refresh — Oyster (2026-08-14)

`HANDOFF.md` is closed as of this session. This file carries the notes for the UI
state refresh; the map/worker pipeline history stays where it is.

The user is specifying the refresh in four parts. **Section 0 (General), mode 1
(Browse) and mode 2 (Story Selected) are implemented and are what this document
covers.** Mode 3 (Label Selected) is specified — see
`docs/modes-2-3-handoff.md` and the plan it points at — but not built; the region
panel currently wears mode 2's card shell with its old contents inside it.

---

## 0A. The pin vocabulary collapsed to two marks

`lib/layers.ts` used to encode three identities in one shared `circlePaint`:

| Before | Reads as | Drawn as |
| --- | --- | --- |
| Top 5 | best on screen | solid orange, radius × `TOP_SCALE` (1.15), no stroke |
| PIN | an exact place | orange core at radius × 0.68 inside a white ring |
| CONTAINER | somewhere in this region | solid white disc, full footprint |

Three marks for three ideas, on a map whose smallest pin is 3px across.

| After | Reads as | Drawn as |
| --- | --- | --- |
| any story | a story | solid `#D24F39`, full footprint |
| top 5 | best on screen | `#D24F39` core at radius × 0.68 inside a white ring |

**The ring changed sides rather than being rebuilt.** `RING_RATIO = 0.32` was
already measured off the identity sheet and already produced the right geometry;
only the `case` predicate moved from `isContainer`/default to `isTop`. Both
states keep one footprint, so a marked pin is the same size as its neighbours —
MapLibre grows a stroke outward, so the core is inset by exactly the ring it
gains.

**`TOP_SCALE` is deleted.** Size already encodes salience through
`radiusBySalience`; a second size signal made "big" mean two things at once. The
spec was "same orange circle, plus a white border", and a scale knob contradicts
that.

**`circle-color` became a bare literal**, not a `case`. That was the load-bearing
simplification: no per-feature decision about fill, because nothing about a story
is expressed as one. One case came back on 2026-08-15 — the open story's `MARK`
fill, below — and it is about the reader's gesture rather than about the story.

### What did *not* need to change

`lib/top.ts` (`TOP_COUNT = 5`, `topKeys`) and the `compareProperties` comparator
in `lib/spiderfy.ts` were already correct and are untouched. "Top 5 in the
viewport" was a working feature; it only needed a different paint.

## 0A (cont). Containers are off the map

`NOT_CONTAINER` (`["!=", ["get","kind"], "CONTAINER"]`) filters
`stories-pins`, `country-top-pins`, `stories-labels` **and** `topPinLayer`.

- The top-5 layer needs it too: it reads the same source and is drawn *above*
  `stories-pins`, so without the filter a container that ranked would appear
  there and nowhere else.
- `lib/top.ts` and `lib/spiderfy.ts` need no change — both are fed from
  `queryRenderedFeatures`, and an undrawn feature is not returned.
- **Accepted cost, chosen by the user:** the `country-top-pins` floor below z4 is
  one story per country and many of them are containers, so the zoomed-out world
  is visibly sparser than before. Those stories are moving into mode 3.
- `outlineFor` and its tests are kept whole but are **unreachable today** — no
  click can produce a feature they accept. Mode 3 will need exactly that join to
  draw a region outline from the panel. The call site in `MapView.tsx` is left
  wired, with a comment saying so.

Verified on the live map: `queryRenderedFeatures({layers:['stories-pins']})`
returned 54 features, 0 containers, kinds `["PIN"]`.

## 0A (cont). The selection triangle

A 52×34 wedge with a flat top edge and its **point at the bottom**, which is what
lands on the map coordinate. The body hangs above; the story's orange circle stays
visible underneath the tip. It is painted `MARK`, not `ACCENT` — the selection
has to be distinguishable from the orange it is sitting on top of. (This section
read `#B339D2`, the mockup's value; `MARK` was hand-tuned to **`#C05AC4`** and
Part E made that the one purple across the wedge, the disc and the brand sphere.
See §2G.)

- **It replaced a right triangle** whose point was the bottom-right corner. That
  one read as the corner of something rather than as an arrow, and at 40px it was
  hard to tell which of its three corners was doing the pointing. The wedge is the
  same silhouette as a speech bubble's tail, which is the other thing on this map
  that points at a story.
- **`lib/pin.ts` rasterises it in TypeScript.** This repo has no image assets, no
  sprite and no `addImage` anywhere — the only symbol layer it has ever had is
  text. A binary asset would need a build step to stay in sync with the palette,
  and a colour in two files drifts. `MARK` is exported from `lib/layers.ts` and
  imported here, so there is one purple. 4×4 subsample coverage — sampled at
  subpixel *centres*, so a sample on an edge cannot call an empty pixel 25%
  covered — gives 16 alpha levels along each slope.
- **The drawn wedge is asymmetric, and `PIN_LEFT_PAD` is what centres its apex.**
  The point sits about 37% along its own top edge, which is what gives it the
  lean; padding the left 20% of the image with transparent columns puts the apex
  at `W/2` by construction, so `icon-anchor: "bottom"` is correct without an
  `icon-offset`. `icon-offset` would live in `lib/layers.ts`, which `lib/pin.ts`
  already imports from — padding keeps the two modules pointing one way.
- `selectedPinLayer()` uses `icon-anchor: "bottom"` — the one anchor that
  puts the point on the story rather than near it — plus
  `icon-allow-overlap` and `icon-ignore-placement`, so it can neither be dropped
  by a symbol collision nor erase the labels around it.
- `MapView` holds it in a one-feature GeoJSON source rather than a `Marker`: a
  marker is a DOM node repositioned per frame and lags the pin under it by a
  frame, which at the tip of a triangle is visible as the point sliding off its
  own dot.
- Set from both gestures — a story click uses the feature's own coordinate (on a
  spider leaf, the displaced position, which is where the story is *drawn*); a
  label click uses `labelAnchor`. Cleared in `clearRegion`, alongside the outline
  filters, because the two are the same statement.

### 0A (cont). The disc under the wedge turns `MARK` (2026-08-15)

The wedge alone read as a triangle that happened to be near a pin. The open
story's own disc is now filled `MARK` as well, so the pair reads as one mark.

- **`circle-color` in `circlePaint` grew a `case`, and that is the whole change.**
  It was a bare literal after the 2026-08-14 collapse, and putting the case back
  is worth naming: fill is otherwise not allowed to say anything about a story
  (salience is the radius, the ring is "top five here"). The selection is the one
  property of a pin the *reader* set, which is why it may be a colour.
- **Feature state, keyed on the url, on both source layers** — the same mechanism
  and the same two-layer write as the top-5 flag, so the fill survives the z4
  handover from the country floor to the stories layer. `markSelected` in
  `MapView` is the only writer, called from `selectStory` and `clearRegion`.
- **A spider leaf carries it as a property**, because feature state does not cross
  sources. `isSelected` reads either, exactly as `isTop` does, and `spiderData`
  takes the selected url alongside the top-5 urls. A displaced story is drawn as
  its leaf, so without this arm the fill would be missing precisely where the map
  is busiest.
- **The overlay is redrawn from `markSelected`**, through a ref the map effect
  fills with its own `drawSpider`. A click moves no camera, so no `idle` or
  `zoom` would rebuild the leaves and the recolour would wait for the reader's
  next gesture.
- The top-5 copy on top reads the same source and the same state, so it recolours
  with the original underneath it and the duplicate stays invisible.

Verified live at z2, z7 and z10: an ordinary pin, a ringed top-5 pin, and a spider
leaf all fill `MARK` under the wedge, and `getFeatureState` returns to `{top:true}`
alone when the panel closes.

**Note for mode 2:** the mockup shows this triangle growing into an orange
callout carrying the headline. Do not over-invest in the bare wedge.

---

## 0B. Panel rows link out

`StoryPanel`'s "Stories Nearby" row was a `<button>` that swapped the panel to
that neighbour. It is now the same anchor `RegionPanel` has always used
(`target="_blank" rel="noopener noreferrer"`).

- `onSelect` is gone from `StoryPanelProps` and from `MapView`.
- `RegionPanel` needed no change, so one edit satisfied "either mode".
- `app/globals.css` loses its `.panel__list button` selectors — the rule existed
  only to make a button and an anchor look identical, and there is one element
  now.

---

## 0C. Chrome — brand block and search bar

Built to the mockup's own coordinates on a ~1482px frame. Measured live against
it (`getBoundingClientRect`):

| Element | Mockup | Rendered |
| --- | --- | --- |
| favicon | 644, 33, 26×26 | 644, 33, 26×26 |
| shine | 656, 34, 10×10 | 656, 34, 10×10 |
| pill | 686, 31, 152×29 | 686, 31, 152×29 |
| placeholder | 703, 35 | 703, 35 |
| search glyph | 809, 35, 19×19 | 809, 36, 19×19 |
| wordmark | 1353, 30, 106×40 | 1353, 30, 105×40 |

The search group is centred (`left: 50%`), which reproduces the mockup's x=741
group centre on a 1482px frame. The brand block is `top: 30px; right: 24px` with
a centre-aligned column.

**The search bar is inert by design** — a `div` with `aria-hidden`, not a
disabled `<input>`. A real field invites typing and swallows it; a disabled one
still announces a control that exists but cannot be used. Neither is true — the
control does not exist yet. When it does, it becomes a `form` and the
`aria-hidden` comes off.

**Instrument Serif** is added as a second typeface for exactly the placeholder.
The search pill is the only white-on-white surface on the page, and Newsreader at
16px on white reads as body copy, which is what a placeholder must not do.

**"About Us" moved out of both panel footers.** It lived there only because the
deleted masthead left it homeless, and the cost was that §5.2 decision 3's
measured accuracy was reachable *only with a story open*. That trade (recorded in
the old `app/page.tsx` header) is now repaid. `MapTilerLogo` stays in both
footers — §2.6 requires the mark to survive the panel covering the map's
bottom-left corner.

### Mobile

The mockup is a desktop frame. At 390px the centred search group runs to x=292
and the brand block starts at x=260, so the wordmark printed through the pill.
Under the existing `max-width: 520px` query the search goes hard left
(`left: 12px; transform: none`) and `.freshness` is capped at 150px so the stale
sentence cannot wrap into the search bar. Dropping the brand to a second row was
the alternative and costs a row of map for a control that does not work yet.

**The wordmark is hidden entirely below 520px** (user's call). It is 106px of a
390px width, and it is the one thing in that corner a reader does not need — the
stamp answers "is this current" and About Us answers "how does this work".
`display: none` rather than a smaller size: shrunk to fit, it read as a third
caption stacked on two captions, which is worse than absent. What is left is
`.freshness` at x=276 and `.brand__about` at x=292, clear of a search pill that
ends at x=206.

The search bar stays left-aligned rather than returning to centre now that the
wordmark is gone: centred it would span 98–292 and the stamp begins at 276.

Both blocks sit at `z-index: 2` — under the panels (3). Below 520px the story
panel is 100vw and covers them, which is correct: they are still there when it
closes.

---

## Rename

Oyster in user-facing copy only: `app/layout.tsx` metadata and four strings in
`app/about/page.tsx`. Package name, repo, directory and code comments still say
sonder.

---

# Mode 1 — Browse (2026-08-15)

The top five on screen already wore a white ring. At z2 the headline layer is off
entirely (`LABEL_MINZOOM = 4`), so the five best stories in the world view were
five identical dots: the ring said "read this" and nothing said what it was. Each
of the five now grows an orange speech bubble carrying its headline, tail pointing
back at its own pin.

**The ring stays.** A bubble is additive, and a story that loses its bubble to a
collision still reads as top-5.

**The bubbles are the map's first sentence and only that** (revised 2026-08-15):
they are captured at the first `idle` on the world view and taken down for good on
the reader's first camera move. The ring goes on tracking the viewport; see §1C.

## 1A. The geometry, and why nothing measures it

Decomposed from the mockup's own CSS. `Rectangle 11` is 135×79 at (437, 450);
`Polygon 3` is 36.81×76.24 at (535.18, 505), rotated 172.71° about its centre.
Rotating the polygon's apex vector (0, −38.12) by that angle puts the point at
(558.4, 580.9) and the base *inside* the body, from (530.5, 507.6) to (567, 503).
Cross-checked against the screenshot: the tip is +118.5px right of and +131px
below the body's top-left corner, against +121.4 / +130.9 computed.

Expressed from the body's **corner nearest the pin**, so it survives a changing
height: apex at `(near − TAIL_INSET, edge + TAIL_DROP)`, base from
`(near − 5, edge − 26)` to `(near − 42, edge − 21)`. `TAIL_DROP` is 52 and
`TAIL_INSET` is 12 — the inset was 14 off the decomposition and was tuned down by
eye; the CSS lagged behind `lib/bubble.ts` for a day, and they are back in step.
**They have to be kept in step by hand**: one is the reservation, the other is the
drawing, and nothing checks them against each other.

Two consequences fall out of that, and both are the whole of the implementation:

- **The tail is a fixed 26×52 wedge.** Past the body's near border the polygon's
  fill merges with the body's, so only the part beyond it is ever visible;
  clipping its two straight edges at that border leaves the same shape at one line
  and at four. `M0 0 L25.9 0 L19.9 52 Z`, mirrored about its own centre by CSS.
- **Nothing in JavaScript knows how tall a bubble is.** The anchor is a zero-size
  div translated to the pin; the body hangs off it by `bottom`/`top: 52px` and
  `right`/`left: −12px`, and CSS resolves the height. Truncation is
  `-webkit-line-clamp: 4`, so the browser breaks the lines and places the ellipsis
  — measuring the text in JS would get the break wrong on every headline whose
  glyphs are not all the same width.

### 1A (cont). Four orientations, from two flags (2026-08-15)

A bubble's body can now sit **below** its pin as well as above it, tail climbing
rather than falling. In CSS that is two custom properties and nothing else:

```css
.bubble--right { left: -12px; --flip-x: -1 }
.bubble--down  { top:   52px; --flip-y: -1 }
.bubble__tail  { transform: scale(var(--flip-x, 1), var(--flip-y, 1)) }
```

Two flags give four orientations and a fifth is unrepresentable, which is correct.
`transform-origin` defaults to the centre, so each mirror moves the shape without
moving the box it sits in.

## 1B. The layout rule is pure, and it uses one dumb constant

`lib/bubble.ts`, tested in `lib/bubble.test.ts` — the same split `lib/top.ts` and
`lib/spiderfy.ts` already make, and the only part of mode 1 a node-environment
suite can reach.

**Collision is tested against a constant box: always 135 × 131**, never the real
height. A bubble that renders shorter only ever has more clearance than it was
promised. The alternative — render, read `offsetHeight`, re-lay-out — puts a DOM
dependency in the middle of the one rule worth testing, to buy clearance nobody
asked for.

It also handles the phone with no phone-specific rule: at 390px a 135×131 box is a
third of the screen, so the pass keeps one or two and drops the rest. Verified at
390×844 — one bubble, clear of the search pill, `scrollWidth` still 390.

**Balance, then edges, then drops.** Five bubbles split 3/2 (`sideCap`); a bubble
whose body would run off the canvas has one legal option and keeps it even where
that leaves the count 4/1, because a headline sliced by the window is worse than
an uneven split. Placement then walks the ranking and drops any candidate whose
box overlaps one already kept — **the loser is dropped, not shrunk or moved** —
and a final pass re-evens the split among the survivors, which is only decidable
once the kept set exists.

### 1B (cont). Two axes, one function (2026-08-15)

Up/down is balanced exactly like left/right, and the two are computed by the same
`chooseAxis` called twice. That is not code golf: **the preference is the same
sentence on both axes** — *put the body where there is more room* — so a second
copy of the loop would be a second place for the rule to drift.

The axes are independent because the box is. Its horizontal span depends only on
the side and its vertical span only on the lift, so "does this side fit the
canvas" and "does this lift fit the canvas" are separate questions.

```
side  left    x + TAIL_INSET − WIDTH  …  x + TAIL_INSET
      right   x − TAIL_INSET          …  x − TAIL_INSET + WIDTH
lift  up      y − TAIL_DROP − HEIGHT  …  y
      down    y                       …  y + TAIL_DROP + HEIGHT
```

**A blocked candidate tries the other lift first, then the other side.** Both lifts
on the assigned side are exhausted before the side is touched, so a bubble with
anywhere to go on its own side stays there. Flipping sides on a collision was
offered when mode 1 was specified and declined — see the correction below, which
is where that decision ended up.

### What the vertical axis actually bought, and what it did not

Measured at z5 over the US, five ranked pins at (49,98), (866,142), (1237,184),
(1417,371), (1120,350):

- **Two of them are in the top strip and were dropped outright before.** A box
  above a pin at y=98 has its top at −33, under the search pill. Both now hang
  downward. Four of five placed, 2/2 on each axis.
- The same is true on the phone: the one bubble at 390×844 is a `down`, and its
  pin at y≈190 could not have carried an `up`.

**It does not rescue the tightest clusters, and should not.** An up bubble's tail
climbs through the space a down bubble's is falling through, so the reservation
refuses a pair of pins sitting on each other, and two lines converging on two dots
17px apart would not be a picture anyway. The drops keep their rings.

### 1B (cont). The side flip, and the gap that gates it (2026-08-15)

The default world view drew **two** bubbles out of five, and the one it dropped was
the one with the most room. Ranked, the top five sit at (742,217), (320,312),
(303,326), (748,221), (185,379): two tight pairs, and one story alone over North
America with the entire left half of the canvas empty beside it.

That loner opened **right**, because `prefer` reads the viewport's centre and 185 is
left of it. Its box ran to x=328 and the next anchor's column starts at 320 — an 8px
graze, on both lifts, and the side was not retried. A story with half a screen free
beside it lost its headline to eight pixels.

So the side is now retried, last, after both lifts. Ungated that went too far in the
other direction: it rescued the pair-mates too, and drew five bubbles of which two
opened on opposite sides of a pair of dots 6px apart, both tails landing on the same
smudge. More headlines, less information — exactly the picture the original decision
was protecting against.

**`TAIL_TIP_GAP = 32` is the gate: a candidate may reach for its far side only where
its own pin stands clear of every pin already drawing a bubble.** 32 is the width of
the tail's base, which is the mark a reader follows back to a dot. The measured
spread leaves daylight on both sides of the line — the two pair-mates that must be
refused sit 6px and 21px out, the loner that must be rescued sits 118px out — so a
dumb constant does better here than a rule that tried to compute the distance per
view.

The world view now draws three, each tail on its own dot; the phone still draws one.
`lib/bubble.test.ts` carries the live five as a regression case, the boundary at
`TAIL_TIP_GAP` and `TAIL_TIP_GAP - 1`, and the tight cluster that is still refused.

## 1C. A DOM overlay, drawn once (2026-08-15, revised)

`components/StoryBubbles.tsx`, a sibling of the map container rather than a child
— MapLibre owns its container's children.

A MapLibre layer was not an option: Newsreader is not in the basemap's glyph set
(`LABEL_FONT` is pinned to Noto for exactly that reason) and per-feature
truncation is not expressible in a style expression.

Longitudes are normalised to the copy of the world nearest the camera before
projecting (`pointFor`). With `renderWorldCopies` on, a story exists at `lng` and
at `lng ± 360`, and `map.project` answers for whichever one it was handed.

### The bubbles are an opening card, not a live caption

**Originally the bubbles tracked the viewport**: `refresh` re-ranked on every
`idle`, `StoryBubbles` re-laid-out on the same event and re-projected every
anchor on every `render`. Whatever the reader navigated to, five headlines
followed them there and rearranged themselves each time the camera settled.

They are now **captured once and retired for good**:

- `refresh` builds the `TopStory[]` behind a `bubblesCaptured` flag, so the
  ranking that reaches the overlay is the one taken at the first `idle` — the
  default world view, which makes these the top five stories *in the world*
  rather than the top five of the current screen. An idle that ranks nothing
  leaves the capture open: that is a loaded style with no tiles in yet, not the
  opening view.
- `dismissBubbles` runs on the first `movestart` and empties the list
  permanently. **Any** move counts — drag, wheel, keyboard, or a `flyTo` from the
  search bar. It arms only after the capture, so a startup camera animation
  cannot dismiss bubbles that were never drawn.
- The ring is untouched. `topKeys`, `applyTop` and the `top` feature state go on
  recomputing at every idle, because "which stories matter *here*" is still a
  live question — it is the headline that was the opening sentence.

That one-shot life is what removed most of the wiring. The camera cannot move
while a bubble is on screen, so:

- the `map.on("render", position)` subscription is gone — anchors are positioned
  once per layout, in a `useLayoutEffect` before paint;
- the `map.on("idle", relayout)` subscription is gone, and with it the reason the
  ranking had to be passed as a **ref**. `MapView` and `StoryBubbles` both
  listened for `idle` with MapView registered first, so the overlay's handler saw
  a value React had not committed yet (measured: a `jumpTo` into London left the
  ring correct and the bubbles a viewport behind). With one capture and a plain
  prop, the ordering does not exist;
- `samePlacement` is gone from `lib/bubble.ts`. It guarded `setPlaced` against
  idle churn, and there is no churn left;
- `anchorBubbles` is gone. It moved a bubbled story onto its spider leaf, and
  spiderfy starts at `SPIDERFY_ZOOM` — a zoom the reader can only reach by moving
  the camera, which is now the gesture that takes every bubble down.

The layout still re-runs on a selection: the open story's bubble is withheld and
the other four re-place around the gap.

## 1D. What else moved

- **The selected story gets no bubble.** The triangle already hangs up and to the
  left of that same pin, inside where the body would be, and the panel is carrying
  the headline in full.
- **`bubbleLabelFilter` takes the bubbled stories out of `stories-labels`**, which
  was still drawing the same `title` in 11px Noto underneath them from z4 up. It
  is keyed on the captured bubble list, not on which bubbles were actually placed:
  the alternative is a style filter that depends on a React render, which repaints
  the map, which produces another idle. A dropped bubble takes its small label with
  it, and keeps its ring. `dismissBubbles` sets the filter back to `[]` itself
  rather than leaving it to `applyTop`, whose `sameKeys` guard returns early when
  the ranking has not changed — without that the frozen five would lose their 11px
  caption for the rest of the session.
- **The click path is now one function.** `selectStory(story, at, point)` is
  called by both the map's click handler and a bubble, with `at` for the triangle
  and `point` for the neighbour query — a bubble click lands ~100px from its own
  pin, and "stories near this story" must not mean "stories near the corner of a
  box".

## 1E. Three chrome corrections from the same mockup

| Rule | Was | Now |
| --- | --- | --- |
| `.brand__word` | inherited weight 400 | `font-weight: 700` |
| `.search__field` | `#ffffff` | `#4e4d8f` |
| `.search__placeholder` | `#afafaf`, Instrument Serif | `#ffffff`, Newsreader 400 |
| `.search__mark` | 26×26 `#d24f39`, white ring | 32×31, purple radial gradient, no ring |
| `.search__shine` | white dot on the sphere | deleted; reborn as `.brand__dot` |

Two of those overturn a Section 0 decision, and both reasons are gone rather than
wrong:

- **Instrument Serif was chosen because "the search pill is the only
  white-on-white surface on the page".** The pill is `#4e4d8f` now and the text is
  white, so that surface does not exist. The face is still imported — modes 2 and
  3 are unwritten and next/font has it cached.
- **The mark stopped being the pin.** It was the map's own orange disc, ringed
  like a top-5 story. Mode 1 now draws real stories in that exact orange with
  headlines attached, an inch below it, so a decorative copy read as a sixth story
  that would not open.
- **The highlight moved into the wordmark.** `Ellipse 13` is 7.86×7.61 at
  (1361.99, 40.85) against a wordmark box at (1350, 30) — inside the letter, not
  next to the pill at x=637 — and the mockup screenshot shows a bead in the
  counter of the "O". `.brand__dot`, offset (12, 11) from the glyph. It is
  positioned against the letter rather than drawn into it because this project has
  no image assets by policy (`lib/pin.ts`).

### 1E (cont). One mark at two sizes (2026-08-15)

The bead was the map's orange with a white highlight, which made it **a shrunken
story pin sitting inside the product's name** — next to a map drawing real
stories in that exact colour, the one thing the brand is not. It is the search
sphere now, at a fifth of the size.

`.search__mark` and `.brand__dot` share one declaration: the gradient's stops and
its centre are percentages of the element box, so the small copy is the large one
to scale **by construction**, which is what "a minimised version" has to mean if
the two are not to drift apart the first time either is touched. Only size and
position stay per-element.

Its offsets moved to `em` (0.3 / 0.275 / 0.2 — the same 12/40, 11/40, 8/40
measured against Newsreader Bold at 40px) because they had already drifted once:
the type grew to 50px and the bead stayed put, sliding off the counter. In `em` it
tracks the wordmark, and the ratio is the thing that was measured anyway.

Measured live at 1482×900 the day the mockup was built (`getBoundingClientRect`,
so the transformed box — the sphere and the bead both carry Figma's rotation
matrix, which inflates it). **The sizes have since been tuned by hand** — the
pill, the sphere and the wordmark are all larger now — so this table is a record
of the mockup pass, not of current values:

| Element | Mockup | Rendered |
| --- | --- | --- |
| sphere | 637, 27, 32×31 | 637, 27, 39×38 (32×31 untransformed) |
| pill | 686, 31, 152×29 | 690, 32, 152×29 |
| wordmark | 1350, 30, 117×40 | 1343, 30, 115×40 |
| bead | 1362, 41, 7.9×7.6 | 1354, 40, 10×9 |

The pill is 4px right of the mockup and the wordmark 7px left, and neither is
chased. The sphere grew without the search group being re-centred, so the mockup's
own group centre is 737.5 on a 1482 frame — 3.5px off centre — and the brand block
keeps Section 0's `right: 24px` rather than the mockup's implied 15px, because
that column is centre-aligned and moving it would drag "About Us" with it.

## Verification performed

- `npx tsc --noEmit` clean; `npm run build` clean.
- `npx vitest run` — **384 passing, 26 files** (`lib/pin.test.ts`, rewritten for the
  wedge: apex column, flat top edge, both slopes, the transparent left pad; the two
  side-flip cases in `lib/bubble.test.ts`; the three selection-fill cases in
  `lib/layers.test.ts` / `lib/spiderfy.test.ts`. The count is net of the
  `samePlacement` case, deleted with the function when the bubbles became a
  one-shot.)
- `scripts/tippecanoe-min-version.test.ts` fails 6/7 **on a clean tree too** —
  its bash script cannot be spawned with a Windows path from this environment.
  Pre-existing and unrelated; confirmed by stashing.
- Live map at 1482×900 and 390×844: browse mode, story click, label click,
  close-clears-both. `console --errors` shows only WebGL perf warnings and a
  pre-existing MapTiler `Sea labels` style warning.
- `getSource('selected')` verified empty on load, one feature after either
  gesture, empty again after close; both outline filters back to `MATCH_NOTHING`.

### Gap

Mode 1 adds `lib/bubble.test.ts` (18 cases) and was checked live at 1482×900 and
390×844: bubble counts against the ranking, both axes' splits, tail tips landing on
their pins in all four orientations, the 4-line clamp, a bubble click opening the
panel and withdrawing its own bubble, and the chrome geometry table above.
`console --errors` shows only the WebGL perf warnings, the pre-existing MapTiler
`Sea labels` warning and a MapTiler `transportation:road_` sprite warning that
appears at high zoom on a clean tree.

(The per-frame pan tracking and the spider-leaf re-anchor were verified when the
bubbles followed the viewport. Both code paths are gone; see the one-shot
verification below.)

### One-shot bubbles — verified 2026-08-15

Live, at 1482×900:

| Step | Result |
| --- | --- |
| Load, first `idle` | 3 bubbles on the ringed pins — 5 captured, 2 dropped by `TAIL_TIP_GAP` |
| One zoom click | 0 bubbles **synchronously**, still 0 after the idle |
| Three more zooms | still 0 |
| Bubble click, before any move | panel opens, that bubble withdraws, the freed room is taken by a candidate the first pass had dropped |
| Pan + zoom to Europe | ring re-ranks to the new viewport (UK / Gibraltar / Sicily), no bubble returns |
| z≈7 over Cambridge | *"UK PM Burnham reacts to death of former Cambridge professor"* — one of the frozen five — draws as a ringed pin **with** its 11px label |

That last row is the real assertion. Before this change a top-5 story was always
label-suppressed; a captured story showing its small label is the only proof from
outside the map that `bubbleLabelFilter` was released rather than left holding the
frozen five for the rest of the session.

At 390×844: 1 bubble on load (the phone frame has room for one), 0 after a move.

React's commit lands before the first moved frame is painted, so the count is
already 0 in the same tick as the `movestart` — no smear, and no `render`
subscription needed to prevent one.

There are still **no component tests** — vitest runs `environment: "node"` and
`include` is `worker|lib|scripts` only. Everything in 0B and 0C is verified by
eye and by live DOM queries, not by suite. That is unchanged from before this
work, but it is now covering more surface.

---

# Mode 2 â€” Story Selected (2026-08-16)

The full plan is at `.claude/plans/mode-2-story-selected-lovely-puffin.md`; the
pipeline half of it (`coverage`, `topic`, per-region counts, full-list shards) is
**not built**, and `docs/modes-2-3-handoff.md` carries its state. This section is
the UI half, which was deliberately built first â€” see "Why the order changed"
there.

## 2A. The panel became a floating card, reversing Section 0

`globals.css` recorded, at length, why the panel was full-bleed:

> **Full-bleed, not a floating card.** `bottom: 0` and `left: 0` rather than a
> margin and a max-height: [â€¦] A card that shrink-wrapped its content left the
> accent colour ending mid-screen with a strip of map below it, which read as the
> panel having failed to load the rest.

That argument was right about the card it described, and the mockup's card is not
that card. It answers the objection three ways rather than ignoring it:

1. **The height is fixed, not shrink-wrapped.** 489px, with the story list
   scrolling inside. The colour stops where the design says it stops, not
   wherever the content ran out â€” which is the thing that read as a failed load.
2. **A soft shadow replaces a hard edge.** The old card's ~1px dark border is
   what made it read as a cut-out of the map. The mockup's `Rectangle 26` â€” 10px
   of `rgba(0,0,0,0.1)` at radius 38, biased 20px downward â€” reads as a card
   lifted off the map instead. It is drawn as a `::before` element, not a
   `box-shadow`, so `getBoundingClientRect` can check it.
3. **The fill is 0.95, not 1.** The map showing faintly through is what says the
   card is *over* the map rather than replacing part of it. A full-bleed column
   cannot say that at any alpha.

**The cost is accepted, not hidden:** on a card with no "More Reporting" â€” 87.2%
of stories, measured â€” there is ~75px of empty card between the button and the
foot link. That is what "fixed height" buys, and shrink-wrapping it is the thing
Section 0 already rejected.

## 2B. Geometry, measured live

Mockup frame 1481Ã—832; the card's own origin is (15, 165). Measured with
`getBoundingClientRect` at **1482Ã—900** on a real story
(*"At least six people dead from days of stormsâ€¦"*, theguardian.com), with three
injected coverage links so the "More Reporting" rows could be measured at all.

| Element | Mockup | Rendered | |
| --- | --- | --- | --- |
| shadow plate | 5, 161, 344Ã—513, r38 | âˆ’10/âˆ’4/âˆ’10/âˆ’20 inset, r38 | âœ“ |
| card | 15, 165, 324Ã—489, r29 | 15, 165, 324Ã—489, r29 | âœ“ |
| hero | 15, 160, 322Ã—190 | 15, 165, 324Ã—190 | +5y, +2w |
| source Â· age | 35, 361 | 33, 361 | âˆ’2x |
| headline | 36, 383, 286w | 33, 383, 288w | âˆ’3x |
| place sphere | 41, 448, 11.45px | 33, 474, 11px (13 transformed) | see below |
| place text | 53, 451 | 50, 472 | see below |
| Read The Story | 33, 476, 289Ã—35, r12 | 33, 501, 288Ã—35, r12 | see below |
| More Reporting | 33, 528 | 33, 553 | see below |
| coverage rows | y 562, 580 | y 593, 611, 629 | 18px pitch âœ“ |
| How does this work? | 211, 624 | 127, 624, centred | see below |

**The x deviations are the mockup's slop, not a layout bug.** It measures 18, 20,
21, 26 and 33 for elements that plainly line up; Figma text boxes carry their own
leading whitespace and the button was drawn as a rectangle. The card uses **one
18px body padding** for all of it, which is why nothing is more than 3px off and
why there is one number to change rather than five.

**Everything below the headline is shifted +25y because this story's headline
runs to three lines and the mockup's runs to two.** 218 + 3Ã—24 + 17 = 307 against
the mockup's 283. Content-driven, so it is not chased.

**"How does this work?" is centred on the card** (127 + 101/2 = 177.5 against the
card's centre of 177), where the mockup puts it at x=211 â€” which is centred on
nothing. The plan called for centred and centred is what shipped.

At **390Ã—844** the card is `left/right: 12px` (366 wide) at `top: 96px`, which is
the same 489 height against a shorter chrome. Card bottom 585; the map's own
MapTiler mark measured at (10, 791, 126Ã—43), clear by 206px.

## 2C. Two things measurement caught that review would not have

**The place sphere had no gradient.** `.panel__sphere` was written with a comment
saying it shares one declaration with `.search__mark` and `.brand__dot` â€” and it
was never added to that selector list. It rendered as an invisible 11px box.
`getComputedStyle(...).backgroundImage` returned `"none"`; by eye, on a
translucent purple card, a missing 11px dot is not something you notice.

**The coverage rows were at a 26px pitch against the mockup's 18.** The type size
was on the `<a>`, so each `<li>` kept the body's inherited 15px/1.45 line box and
a 10px link floated inside a 22px row. An inline child cannot shrink the line box
its parent computed. Moving `font-size` to the `li` fixed it to exactly 18.

Both are Â§11 failures â€” green tests, clean build, wrong pixels.

## 2D. What the card deletes

**`PanelTab` and the `collapsed` state, from both panels and from `MapView`.**
They existed to slide a full-height column off the left edge so the reader could
see the map. A card covering a twelfth of the viewport is not covering anything
worth reclaiming.

**Dismissal did not go with it**, which is the part that would have been easy to
lose: the tab and the Ã— answered different questions and only the tab's question
expired. Three ways out, all verified live â€” `Escape` (**newly wired; it had
never existed**), a click on the map background, and the Ã— on the hero.

**The panel footer's MapTiler logo, for `StoryPanel` only.** Â§2.6 requires the
mark stay visible and fails silently when it does not, so this was checked rather
than reasoned: the map's own copy measures (10, 847) at 1482Ã—900 and (10, 791) at
390Ã—844, against card bottoms of 654 and 585. `RegionPanel` keeps its copy until
Mode 3 is drawn and the same check is done for it.

**`.maptiler-logo`'s positioning block turned out to be commented out**, disabled
in `e84b600` (Mode 1) with no note in this document or in the commit message.
Without it the anchor fell into normal flow at the top of `main` â€” the required
mark drawn in the wrong corner, over the map, with no plate. It is restored, and
the comment now says so. This is exactly the silent failure the two-copy
arrangement was built to prevent, and it had been live since Mode 1 shipped.

**`lib/nearby.ts`, its test, and the second `queryRenderedFeatures`.** "Stories
Nearby" is replaced by "More Reporting" â€” other outlets on *this* story rather
than other stories near this one. The first was a geographic accident of what the
map had rendered; the second is a fact about the story. Same treatment
`samePlacement` and `anchorBubbles` got when they were orphaned.

## 2E. `PanelStory` grew to eight fields, and one field was kept out on purpose

`lib/story.ts` warns that the allowlist is the Â§2.6 enforcement point and that "a
list that grows quietly enforces nothing". It grew from six to seven for `image`;
it is eight now, for `more`. The defence is the same one sentence: **a list of
urls is more link-out, not article text â€” the same class of thing as `url`.**
`story.test.ts` pins the eight names and adds the `javascript:`/`data:` filter.

**`topic` is on the leak list, by decision rather than by omission.** The
classifier exists in `worker/topics.ts`, but the story card shows no topic label
â€” chips filter a region's rows, which is Mode 3. The test asserts it is dropped,
so if the card ever grows a topic the assertion fails and the decision gets taken
again rather than drifting.

## 2F. `placementLine` was absorbed, not deleted

The line read *"Anaheim, California, USA Â· placed automatically"*. The card no
longer says that: "How does this work?" at its foot routes to `/about`, which
carries the rule, the measured accuracy and the interval â€” more than four words
ever said. Â§5.2 decision 3 is a **measured disclosure** (pooled n=73, 50.0%
against 70.9%, Fisher p=0.152), so moving it needed the destination checked; the
About page's placement section now states it outright rather than describing what
the panel says.

**The other half of that function had to survive, and nearly did not.** Â§2.1's
"Somewhere in" is what a container *is* â€” the placement rule chose one precisely
because the story had no usable exact location â€” so it moved into `placeLine`
rather than going with the wording around it. `placeLine` also replaced
`placeHeading`, which kept only the two ends of a name for the 34px hero heading
that Mode 2 deletes; at 12px in a 288px column all three parts fit, and the
admin-1 is what separates one Springfield from the next.

## 2G. Part E â€” colour tokens

`app/globals.css` had no custom properties: `#373666` appeared five times and
`#d24f39` three. The tokens went in **before** the new surfaces, which is the
only moment at which that stops a sixth and seventh copy being typed. Purely
mechanical, and no rendered colour changed except the one below.

`--panel-veil`, `--panel-wash`, `--accent`, `--mark`, `--muted`, `--pill`,
`--shadow`. **No opaque `--panel`**: after Mode 2 nothing paints the purple at
full strength â€” the card is the veil and the hero, list and footer inherit it
rather than each painting their own ground â€” and a token with no use site is a
colour nobody can see. Mode 3b's `#3A3867` is not here for the same reason.

**One drift resolved.** The mark sphere's gradient ended at the mockup's
`#B339D2` while `lib/layers.ts` had been hand-tuned to `MARK = "#C05AC4"` against
the live map. The tuned value wins â€” it was picked on the surface it appears on â€”
so the wedge, the selected disc and the sphere are one purple again. Measured
after: `rgb(192, 90, 196)`. **`--mark` and `lib/layers.ts`'s `MARK` are twins and
must move together**; MapLibre paint expressions cannot read a custom property,
so the constant stays the source of truth and the token carries a comment saying
so.

## Verification performed â€” Mode 2

- `npx tsc --noEmit` clean; `npx next build` clean, 4 routes prerendered.
- `npx vitest run`: **372 passing, 24 files.** Down from 385/26 by exactly the 7
  cases in the deleted `lib/nearby.test.ts` and the net change in `story.test.ts`.
  `scripts/tippecanoe-min-version.test.ts` fails 6/7 â€” pre-existing on this
  machine, its bash script cannot be spawned with a Windows path.
- Live at **1482Ã—900** and **390Ã—844**: the geometry table above; card open from a
  bubble click; `Escape`, Ã—, and click-away each verified to unmount the panel;
  "More Reporting" rendered with three injected links (host labels, `www.`
  stripped, underlined, 18px pitch, section scrolls with `scrollHeight` 1197 in a
  228px box); the section **absent** on a real story, which is the normal state.
- Region panel opened on India: same card, 10 rows, list scrolling inside
  (`scrollHeight` 1197 > `clientHeight` 228 â€” no clipped-without-scroll
  regression), flag hero intact, its MapTiler copy still rendered, no tab.
- `console --errors` shows only the WebGL perf warnings and the pre-existing
  MapTiler `Sea labels` / `transportation:road_` warnings.

### Not verified

- **A story whose `og:image` fails or is a beacon** â€” the `onError` and
  `MIN_IMAGE_WIDTH` paths are unchanged but were not re-exercised in the card.
- **Real coverage links.** Everything measured for "More Reporting" used injected
  data, because `worker/group.ts` does not emit the field yet. The layout is
  proven at three entries; it is not proven against real hosts.
- **A container story.** `placeLine`'s "Somewhere in" branch is unit-tested but
  unreachable live â€” containers are filtered off the map (`NOT_CONTAINER`).

