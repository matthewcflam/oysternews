/**
 * What the topic table and the coverage cap have to be built against.
 *
 *   read the live pool -> group -> tabulate themes, coverage and topics
 *
 * **Why this exists.** Two constants in the Modes 2/3 work are worth more than
 * an opinion each, and neither can be answered by reading code:
 *
 * 1. **`COVERAGE_LINKS`** — the story panel's "More Reporting" list rides the
 *    tile feature, and a tile property is replicated into every tile from the
 *    feature's `minzoom` to z12. The `image` change measured that multiplier at
 *    ~3.2x, so the cost of the field is (share of groups with any coverage) x
 *    (bytes per url) x 3.2. The share is the term nobody has measured.
 * 2. **`THEME_TOPICS`** — GDELT's vocabulary is ~3,200 distinct themes on a
 *    single hour, hierarchical, and wildly uneven. A table written from memory
 *    of what GDELT themes look like will key on the wrong tokens; the ones a
 *    Disaster row would reach for first (`CRISISLEX_CRISISLEXREC` at 39.4%,
 *    `UNGP_FORESTS_RIVERS_OCEANS` at 32.7%) are exactly the ones the grouping
 *    ceiling already throws away.
 *
 * **This measures frequency, not fitness.** It says how much of the feed a
 * prefix would capture. Whether "Politics" is the right label for what it
 * captured is a judgement, and the `--examples` output is there so it can be
 * made by reading headlines rather than by trusting a percentage. The project
 * has already been burned once by promoting a frequency to a rule (§5.2
 * decision 3, mention count: p=0.053 on six records, p=0.736 on 110).
 *
 * **Read-only.** It writes nothing, publishes nothing and touches no state. It
 * costs two `list` calls and one `get` per live shard.
 *
 * Run:  node --env-file=.env.local scripts/theme-audit.ts [--top N] [--examples N]
 */

import { THEME_CEILING, documentFrequency, groupArticles, overCommonThemes } from "../worker/group.ts";
import { r2Store } from "../worker/store.ts";
import { readPool } from "../worker/state.ts";
import { TOPICS, topicOf, topicOfTheme } from "../worker/topics.ts";
import type { PlacedArticle, StoryGroup } from "../lib/types.ts";

/** How many rows the theme table prints by default. */
const DEFAULT_TOP = 40;

function arg(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const value = Number(process.argv[at + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "  0.0%";
  return `${((100 * part) / whole).toFixed(1).padStart(5)}%`;
}

/**
 * The pool's document frequency, descending.
 *
 * The counting is `worker/group.ts`'s `documentFrequency` rather than a local
 * copy — this script exists to report what the pipeline sees, and a second
 * implementation of "distinct per article" could report something the pipeline
 * does not do.
 */
function rankedThemes(articles: PlacedArticle[]): [string, number][] {
  return [...documentFrequency(articles)].sort((a, b) => b[1] - a[1]);
}

/**
 * The coverage histogram.
 *
 * `distinctDomains` is the number of outlets in the group INCLUDING the
 * representative, so a group can supply `distinctDomains - 1` coverage links.
 * That off-by-one is the whole point of measuring it here rather than reasoning
 * about it: a feed where most groups are one article supplies no links at all,
 * and the field would be bytes spent on empty strings.
 */
function coverage(groups: StoryGroup[]): { links: number; groups: number }[] {
  const buckets = new Map<number, number>();
  for (const group of groups) {
    const available = Math.max(0, group.distinctDomains - 1);
    buckets.set(available, (buckets.get(available) ?? 0) + 1);
  }
  return [...buckets]
    .sort((a, b) => a[0] - b[0])
    .map(([links, count]) => ({ links, groups: count }));
}

async function main(): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set");
  }

  const top = arg("--top", DEFAULT_TOP);
  const examples = arg("--examples", 0);
  const now = Date.now();

  const pool = await readPool(r2Store({ accountId, accessKeyId, secretAccessKey }), now);
  const articles = pool.articles;
  console.log(
    `pool: ${articles.length} articles from ${pool.shardsRead} live shards ` +
      `(${pool.shardsExpired} expired, ${pool.duplicatesDropped} duplicates dropped)`,
  );
  if (articles.length === 0) return;

  const groups = groupArticles(articles, { now });
  console.log(`groups: ${groups.length}\n`);

  // --- themes --------------------------------------------------------------
  const frequencyMap = documentFrequency(articles);
  const frequency = rankedThemes(articles);
  const common = overCommonThemes(articles);
  console.log(
    `themes: ${frequency.length} distinct, ${common.size} over the ` +
      `${(THEME_CEILING * 100).toFixed(0)}% grouping ceiling\n`,
  );

  console.log(`top ${top} themes by document frequency`);
  console.log("  excluded  share  theme");
  for (const [theme, count] of frequency.slice(0, top)) {
    // The `x` column is what makes this table usable: an excluded theme is
    // invisible to grouping and must be invisible to the topic vote too, so a
    // row marked `x` is one the table may NOT key on.
    console.log(`  ${common.has(theme) ? "x" : " ".repeat(1)}        ${pct(count, articles.length)}  ${theme}`);
  }

  // --- coverage ------------------------------------------------------------
  console.log("\ncoverage available per group (distinctDomains - 1)");
  const histogram = coverage(groups);
  for (const { links, groups: count } of histogram.slice(0, 8)) {
    console.log(`  ${String(links).padStart(3)} links  ${pct(count, groups.length)}  ${count}`);
  }
  const withAny = groups.filter((g) => g.distinctDomains > 1).length;
  console.log(`\n  groups with ANY coverage: ${pct(withAny, groups.length)}  <- this is f`);

  /**
   * Measured, not assumed — and it is the term the estimate is most sensitive
   * to after `f`. `image` urls averaged 115 bytes; article urls are their own
   * population and there is no reason for the two to agree.
   */
  const meanUrl = articles.reduce((total, a) => total + a.url.length, 0) / articles.length;

  for (const cap of [2, 3, 5]) {
    // Mean links actually EMITTED at each cap, which is what the byte estimate
    // multiplies — not the cap itself, which only the biggest groups reach.
    // With 87% of groups supplying nothing, these diverge by an order of
    // magnitude, and using the cap would overstate the cost roughly 20x.
    const emitted = groups.reduce(
      (total, g) => total + Math.min(cap, Math.max(0, g.distinctDomains - 1)),
      0,
    );
    const raw = emitted * (meanUrl + 1); // +1 for the "\n" delimiter
    console.log(
      `  cap ${cap}: ${(emitted / groups.length).toFixed(2)} links/group, ` +
        `~${(raw / 1e6).toFixed(2)} MB raw, ` +
        `~${((raw * 3.2) / 1e6).toFixed(2)} MB archive`,
    );
  }
  console.log(`\n  measured mean url length: ${meanUrl.toFixed(1)} bytes`);

  // --- topics --------------------------------------------------------------
  /**
   * Article-level, not group-level, and that is a deliberate approximation:
   * `groupArticles` does not hand back its clusters, and the alternative — a
   * second clustering pass here — would measure a copy of the rule rather than
   * the rule. An article's topic is the vote of a one-member group, so this
   * reads the distribution the classifier sees; the group-level figure differs
   * only where a group's members disagree, which the `mixed` row sizes.
   */
  console.log("\ntopic share, over articles");
  const topicCounts = new Map<string, number>();
  for (const article of articles) {
    const topic = topicOf([article], frequencyMap);
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }
  for (const topic of [...TOPICS, ""]) {
    const count = topicCounts.get(topic) ?? 0;
    console.log(`  ${(topic || "(unclassified)").padEnd(14)} ${pct(count, articles.length)}  ${count}`);
  }

  // How often a group's members disagree — the cost of classifying per group
  // rather than per article, and the number that says whether the vote is doing
  // any work at all.
  let mixed = 0;
  let multi = 0;
  for (const article of articles) {
    const seen = new Set<string>();
    for (const theme of article.themes) {
      const topic = topicOfTheme(theme);
      if (topic) seen.add(topic);
    }
    if (seen.size > 1) mixed++;
    if (seen.size > 0) multi++;
  }
  console.log(`\n  articles matching >1 topic: ${pct(mixed, articles.length)} (of ${pct(multi, articles.length)} classified)`);

  // --- examples ------------------------------------------------------------
  if (examples > 0) {
    console.log("\nbiggest groups, for reading the coverage by eye");
    for (const group of [...groups].sort((a, b) => b.distinctDomains - a.distinctDomains).slice(0, examples)) {
      console.log(`  ${String(group.distinctDomains).padStart(4)} domains  ${group.domain}  ${group.title}`);
    }
  }
}

await main();
