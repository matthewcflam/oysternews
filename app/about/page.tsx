import Link from "next/link";
import type { Metadata } from "next";

/**
 * Phase 6 — About / methodology.
 *
 * This page exists because §5.2 decision 3 obliges it to. The measured pin
 * accuracy sits in the 50-70% band, and the pre-registered consequence of
 * landing in that band is **"proceed, but the About page and the UI state the
 * measured accuracy and its interval"**. So the number below is not marketing
 * copy that happens to be candid — it is a condition of the project shipping at
 * all, written down before the number was known.
 *
 * The rule the rest of the page follows from that: **every figure here is
 * measured, and anything not yet measured says so in the same sentence.** The
 * project has killed three of its own features on measurements (§5, and the
 * "What was cut" section below); a methodology page that rounded those numbers
 * up would undo the only thing that makes them worth reading.
 *
 * One live caveat that will need editing rather than admiring: the 68.1% was
 * judged against the placement rule as it stood on 2026-08-14, and the rule
 * changed *because of* that judging (the weak-city DROP). A fresh sample is
 * drawn and with the judge. **When it comes back, update the accuracy section
 * and delete the pending note** — do not leave a "being re-measured" line
 * standing after it has been.
 */
export const metadata: Metadata = {
  title: "How Sonder works — method, accuracy and limits",
  description:
    "Where the stories come from, how each one is placed on the map, how accurate that placement was measured to be, and what was cut.",
};

export default function About() {
  return (
    <main className="about">
      <article>
        <p className="about__back">
          <Link href="/">← Back to the map</Link>
        </p>

        <h1>How this works</h1>
        <p className="about__lede">
          Sonder plots current news stories where they happen. Everything below
          is measured against real data rather than assumed, including the parts
          that do not flatter it.
        </p>

        <h2>Where the stories come from</h2>
        <p>
          Every story comes from{" "}
          <a href="https://www.gdeltproject.org/" rel="noreferrer">
            GDELT
          </a>
          &apos;s Global Knowledge Graph, which publishes a fresh batch of news
          articles every 15 minutes with the places each one mentions already
          extracted. Sonder reads a rolling <strong>24-hour window</strong> of
          that feed and republishes the map <strong>every four hours</strong>.
          The timestamp under the title on the map says when the current data was
          built, because a claim of freshness you cannot check is not one.
        </p>
        <p>
          <strong>GDELT is a single point of failure and there is no fallback.</strong>{" "}
          If it stops publishing, or changes its format, the map stops updating —
          it does not fail over to another source, because there is no second
          source with the same shape. The map would go stale rather than go
          wrong, and the timestamp is what would tell you.
        </p>

        <h2>English only, approximately</h2>
        <p>
          GDELT publishes two streams: original-language articles and
          machine-translated ones. Sonder consumes only the first, which is the
          entire language mechanism — there is no language detection anywhere in
          the pipeline.
        </p>
        <p>
          <strong>&quot;Untranslated&quot; is not the same as &quot;English,&quot;
          and the difference is measurable.</strong> 7.2% of headlines contain
          non-ASCII characters. Inspection says most of those are accented
          English — <em>Anže Kopitar</em>, <em>El Niño</em> — but at least one
          German-language publisher makes it through. The residue is small and it
          is not zero.
        </p>

        <h2>How a story gets its place</h2>
        <p>
          One rule decides every placement. Words like <em>British</em> or{" "}
          <em>Danish</em> are discarded first, because GDELT resolves them to the
          country and they would otherwise drag every story about a nationality
          to a capital city. Then the most specific place wins, unless a broader
          one dominates it:
        </p>
        <ul>
          <li>
            A city, park, landmark or valley mentioned more than once, and not
            overshadowed, becomes a <strong>pin</strong> at its exact
            coordinates.
          </li>
          <li>
            If the surrounding region is mentioned twice as often, or the country
            three times as often, the story is regional or national rather than
            local, and becomes a <strong>container</strong> instead.
          </li>
          <li>
            A story whose only location is a country or a state is a{" "}
            <strong>container</strong> from the start.
          </li>
          <li>
            A city mentioned exactly <strong>once</strong> is{" "}
            <strong>dropped</strong>, and so is a story with no usable location.
            Neither reaches the map.
          </li>
        </ul>
        <p>
          A <strong>container</strong> is the honest form of &quot;somewhere in
          here.&quot; It draws at the middle of a country or region, and clicking
          it outlines that region in red rather than pretending to a street
          address. The popup says which it is: a pin names the place, a container
          says <em>somewhere in</em> it, and both say the placement was made
          automatically.
        </p>
        <p>
          That last rule — dropping a city mentioned once — is the one change
          this project has made on independent evidence rather than its own. Such
          placements were judged <strong>36.4%</strong> correct against{" "}
          <strong>77.8%</strong> for everything else (Fisher exact,{" "}
          <em>p</em> = 0.023). Dropping them costs about 30% of the pins that used
          to be published.
        </p>

        <h2>Region outlines have known gaps</h2>
        <p>
          Region boundaries come from Natural Earth, joined to GDELT&apos;s
          regions by FIPS code — and that code is <strong>not unique</strong>.
          187 codes are carried by more than one region. Most are harmless, but{" "}
          <strong>16 cross an international border</strong>, 15 of them in the
          Balkans where Natural Earth&apos;s codes are stale about Kosovo,
          Serbia, Montenegro and North Macedonia. Only one of the 16 is reachable
          from real data. They are logged loudly and left alone, because
          &quot;fixing&quot; a border on one side&apos;s evidence is how you
          introduce a worse bug than the one you started with.
        </p>

        <h2>How accurate the placement is</h2>
        <p>
          An abort criterion was written <em>before</em> any of this was measured:
          below 50% correct, the project stops rather than ships. Placements were
          then sampled at random from what the pipeline actually publishes and
          judged by reading each headline against the place it was given, with{" "}
          <strong>can&apos;t tell</strong> as a real verdict, excluded from the
          denominator rather than counted as a win.
        </p>
        <p>
          The most recent numbers were produced by an{" "}
          <strong>independent judge</strong> — someone other than the person who
          designed the rule — scoring a blind sheet with no trace, no expected
          answer, and no link to the article:
        </p>
        <table className="about__table">
          <thead>
            <tr>
              <th>Placement</th>
              <th>Judged correct</th>
              <th>95% interval</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pins</td>
              <td>68.1%</td>
              <td>[53.8, 79.6]</td>
            </tr>
            <tr>
              <td>Containers</td>
              <td>83.3%</td>
              <td>[68.1, 92.1]</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>Read the interval, not the headline number.</strong> On a
          sample this size the pin figure is consistent with anything from about
          54% to about 80%, and decisions here follow the lower bound rather than
          the point estimate. About one placement in three is wrong. The most
          common way it is wrong is a <em>near miss</em> — the right country, the
          wrong city — which was 52% of the errors.
        </p>
        <p className="about__pending">
          <strong>Currently being re-measured.</strong> That judging is what
          justified the drop-a-single-mention rule above, which means the numbers
          were produced by a pipeline that no longer exists. A fresh sample has
          been drawn against the current rule and is with the judge. Until it
          comes back, the figures above are the ones on record — they are not
          adjusted upward on the strength of a change that has not been measured
          yet.
        </p>

        <h2>Which stories get shown</h2>
        <p>
          Far more stories exist than can be drawn legibly, so each area of the
          map carries only its top few, ranked by how many outlets are covering
          the story. At the moment roughly <strong>57%</strong> of stories are
          held back at any given zoom by that budget.
        </p>
        <p>
          <strong>There is one editorial choice in the ranking, and it is
          mine.</strong> Around 128 established outlets are treated as{" "}
          <em>tier-1</em>: their stories get ranking priority, and a{" "}
          <strong>48-hour</strong> window instead of the usual 24, so a major
          story stays visible for an extra day. Nothing in the data implied this
          — it is a judgement about what a reader wants to see, and it is stated
          here because leaving it out would be the dishonest option. There is no
          tier-1 badge and no toggle; the preference is invisible in the UI, which
          is exactly why it is written down.
        </p>

        <h2>What was cut, and why</h2>
        <p>
          The original plan had a <strong>&quot;blindspot&quot; feature</strong>{" "}
          flagging stories the major outlets were ignoring. It was measured and
          killed: established outlets are <strong>1.05%</strong> of GDELT&apos;s
          stream, and the wire services are absent entirely, so the flag fired on{" "}
          <strong>98.6%</strong> of stories. A flag that fires on almost
          everything is not a signal. The outlet list survived and now does the
          opposite job — granting priority to that 1% rather than accusing the
          other 99%.
        </p>
        <p>
          Two more went the same way. Pinning stories to capital cities fired on
          47.7% of records and would have put a dog attack at a state capital. A
          graded confidence treatment on pins was refused because the measurement
          found no per-pin signal to grade on — so the popup says the same honest
          thing on every story instead.
        </p>

        <h2>Credits</h2>
        <p>
          News data from the{" "}
          <a href="https://www.gdeltproject.org/" rel="noreferrer">
            GDELT Project
          </a>
          . Basemap tiles from{" "}
          <a href="https://www.maptiler.com/" rel="noreferrer">
            MapTiler
          </a>{" "}
          and{" "}
          <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">
            OpenStreetMap contributors
          </a>
          , rendered with{" "}
          <a href="https://maplibre.org/" rel="noreferrer">
            MapLibre GL JS
          </a>
          . Region boundaries from{" "}
          <a href="https://www.naturalearthdata.com/" rel="noreferrer">
            Natural Earth
          </a>
          .
        </p>

        <p className="about__back about__back--foot">
          <Link href="/">← Back to the map</Link>
        </p>
      </article>
    </main>
  );
}
