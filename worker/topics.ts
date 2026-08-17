/**
 * The §2.3 display topic. PURE (HANDOFF.md §3.3).
 *
 * One label per story group, derived from its members' V2EnhancedThemes, for
 * the region panel's chip row. **A display facet and nothing else**: it is not
 * read by `compareGroups`, `assignMinzoom` or `countryTopGroups`, and it must
 * never be. §2.3 is one content model — the moment ranking consults a topic
 * there are as many content models as there are chips, and the panel's claim to
 * show "this region's top stories" stops being true.
 *
 * ## The taxonomy is GDELT's, and GDELT's is not a newsroom's
 *
 * This is the fact that shapes everything below, and it was measured rather
 * than assumed (`scripts/theme-audit.ts`, 25,767 live articles, 6,698 distinct
 * themes):
 *
 * - **There is no sport.** `TAX_FNCACT_ATHLETE` is on 0.1% of articles,
 *   `TAX_FNCACT_FOOTBALLER` and `TAX_FNCACT_SPORTSMAN` on 0.0%. Nothing else in
 *   the vocabulary names a game, a league or a tournament.
 * - **There is almost no entertainment.** `TAX_FNCACT_SINGER` 2.7%,
 *   `TAX_FNCACT_ACTOR` 1.8%, `TAX_FNCACT_MUSICIAN` 0.5%, and they name a person
 *   rather than a subject.
 * - **There is no usable "tech".** The one broad token,
 *   `WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES`, is on 20.9% of
 *   everything, because it fires on any article that mentions a phone or a
 *   website. A chip built on it would say "Tech" over a third of the news.
 *
 * V2EnhancedThemes is a **policy and crisis** vocabulary — World Bank sector
 * codes, CrisisLex disaster codes, EPU policy-uncertainty codes. It was built
 * for conflict and development monitoring. So the chips are the beats this data
 * can actually support, and the mockup's "Tech / Sports" are not among them.
 * Inventing them would produce a chip that is empty, or worse, one that is full
 * of the wrong stories.
 *
 * ## The grouping ceiling is deliberately NOT reused
 *
 * `worker/group.ts` throws away themes above `THEME_CEILING` because a theme on
 * a quarter of the feed cannot tell you *which two articles are the same
 * story*. Classification wants the opposite: `USPEC_POLITICS_GENERAL1` (26.9%)
 * and `GENERAL_HEALTH` (22.7%) are common **because** they name what a large
 * share of news is about, which is exactly the signal a chip needs.
 *
 * Excluding them was the first design here and it was wrong: it left Politics,
 * Health, Conflict and Disaster to be detected by proxy through their rarer
 * neighbours. The two uses have opposite requirements over the same field, and
 * this module reads the full set.
 */

import type { PlacedArticle } from "../lib/types.ts";

/**
 * The chip row.
 *
 * **Order is data, not decoration**: it breaks ties in `topicOf`, so reordering
 * this array reorders the classifier. It runs most specific to least. A flood
 * story also mentions the government that responded to it, and a corruption
 * trial is also politics — in both cases the narrower label is the one a reader
 * would have picked, so it must come first.
 *
 * `Politics` is last for that reason and not because it matters least: it is
 * the widest net here, so it should only win where nothing narrower fired.
 */
export const TOPICS = [
  "Disaster",
  "Conflict",
  "Crime",
  "Health",
  "Environment",
  "Education",
  "Business",
  "Politics",
] as const;

export type Topic = (typeof TOPICS)[number] | "";

/**
 * Theme **prefix** -> topic. Longest matching prefix wins.
 *
 * Prefixes because GDELT's vocabulary is hierarchical and enormous: 6,698
 * distinct themes on one pool, in families (`NATURAL_DISASTER_*`, `WB_###_*`,
 * `TAX_FNCACT_*`, `EPU_*`). One row covers a family, so this table stays
 * readable at ~70 rows instead of unmaintainable at ~6,700 — and a new theme
 * GDELT adds inside a family is classified without an edit.
 *
 * Longest-prefix-wins is what lets a specific leaf override its family:
 * `WB_2432_FRAGILITY_CONFLICT_AND_VIOLENCE` is Conflict even though a shorter
 * `WB_` row could never be written, and `TAX_FNCACT_POLICE` is Crime while the
 * rest of `TAX_FNCACT_` (job titles) is deliberately unmapped.
 *
 * **Percentages in comments are document frequency over the audited pool**, so
 * a reader can see which rows carry the weight and which are long-tail. They
 * will drift; re-run `scripts/theme-audit.ts` before trusting them.
 */
export const THEME_TOPICS: Record<string, Topic> = {
  // --- Disaster ------------------------------------------------------------
  NATURAL_DISASTER: "Disaster", //         earthquake 3.6, flooding 2.9, + tail
  MANMADE_DISASTER: "Disaster", //         28.7 (mostly _IMPLIED — see below)
  /**
   * Explicitly unmapped, and the mechanism is worth noting: a longer prefix
   * mapping to "" is how a family row is overridden with "this leaf says
   * nothing". GDELT sets `_IMPLIED` when it *inferred* a disaster rather than
   * read one, and at 28.7% of the feed it is a guess on more than a quarter of
   * all news. The rarity rule would rank it last anyway; this makes it silent,
   * which is the honest state for a code that means "possibly".
   */
  MANMADE_DISASTER_IMPLIED: "",
  DISASTER_FIRE: "Disaster", //            3.9 — the mockup's "Wildfire"
  CRISISLEX_O01_WEATHER: "Disaster", //    6.3
  CRISISLEX_T01_CAUTION_ADVICE: "Disaster", // 15.4
  CRISISLEX_O02_RESPONSEAGENCIESATCRISIS: "Disaster", // 9.0
  CRISISLEX_C04_LOGISTICS_TRANSPORT: "Disaster", // 9.1
  WB_1967_AGRICULTURAL_RISK_AND_SECURITY: "Disaster", // 2.8

  // --- Conflict ------------------------------------------------------------
  ARMEDCONFLICT: "Conflict", //            18.2
  MILITARY: "Conflict", //                 8.0
  UNREST_: "Conflict", //                  belligerent 7.0, + tail
  PROTEST: "Conflict", //                  7.2
  SECURITY_SERVICES: "Conflict", //        17.7
  TAX_TERROR: "Conflict", //               terror groups, long tail
  WB_2432_FRAGILITY_CONFLICT_AND_VIOLENCE: "Conflict", // 20.8
  WB_2433_CONFLICT_AND_VIOLENCE: "Conflict", // 13.6
  WB_2470_PEACE_OPERATIONS_AND_CONFLICT_MANAGEMENT: "Conflict", // 10.2
  WB_2490_NATIONAL_PROTECTION_AND_SECURITY: "Conflict", // 5.9
  EPU_CATS_NATIONAL_SECURITY: "Conflict", // 12.9

  // --- Crime ---------------------------------------------------------------
  ARREST: "Crime", //                      8.6
  TRIAL: "Crime", //                       9.9
  SOC_GENERALCRIME: "Crime", //            8.1
  UNGP_CRIME_VIOLENCE: "Crime", //         10.2
  TAX_FNCACT_POLICE: "Crime", //           15.8 — overrides TAX_FNCACT_*
  WB_840_JUSTICE: "Crime", //              18.1
  WB_1014_CRIMINAL_JUSTICE: "Crime", //    12.8
  WB_2025_INVESTIGATION: "Crime", //       9.4
  WB_832_ANTI_CORRUPTION: "Crime", //      12.0
  WB_2024_ANTI_CORRUPTION_AUTHORITIES: "Crime", // 10.2
  EPU_POLICY_LAW: "Crime", //              9.0

  // --- Health --------------------------------------------------------------
  GENERAL_HEALTH: "Health", //             22.7
  MEDICAL: "Health", //                    22.4
  WB_621_HEALTH_NUTRITION_AND_POPULATION: "Health", // 21.2
  WB_635_PUBLIC_HEALTH: "Health", //       7.6
  WB_1406_DISEASES: "Health", //           11.0
  WB_1427_NON_COMMUNICABLE_DISEASE_AND_INJURY: "Health", // 9.8
  WB_1428_INJURY: "Health", //             5.7
  WB_1331_HEALTH_TECHNOLOGIES: "Health", // 4.3
  CRISISLEX_C03_WELLBEING_HEALTH: "Health", // 15.8
  SOC_POINTSOFINTEREST_HOSPITAL: "Health", // 7.6

  // --- Environment ---------------------------------------------------------
  ENV_: "Environment", //                  climatechange 3.3, + tail
  UNGP_FORESTS_RIVERS_OCEANS: "Environment", // 35.1
  AGRICULTURE: "Environment", //           6.9
  WB_435_AGRICULTURE_AND_FOOD_SECURITY: "Environment", // 7.8
  WB_566_ENVIRONMENT_AND_NATURAL_RESOURCES: "Environment", // 6.6
  WB_137_WATER: "Environment", //          10.7
  WB_507_ENERGY_AND_EXTRACTIVES: "Environment", // 8.5

  // --- Education -----------------------------------------------------------
  EDUCATION: "Education", //               24.4
  WB_470_EDUCATION: "Education", //        14.6
  WB_1467_EDUCATION_FOR_ALL: "Education", // 5.9
  SOC_POINTSOFINTEREST_UNIVERSITY: "Education", // 10.4
  SOC_POINTSOFINTEREST_SCHOOL: "Education", // 7.5
  TAX_FNCACT_STUDENTS: "Education", //     6.7

  // --- Business ------------------------------------------------------------
  ECON_: "Business", //                    stockmarket 3.6, + tail
  EPU_ECONOMY: "Business", //              10.1 (+ _HISTORIC 20.9)
  TAX_ECON_: "Business", //                price 15.3, + tail
  WB_698_TRADE: "Business", //             7.1
  WB_2670_JOBS: "Business", //             14.1
  WB_1921_PRIVATE_SECTOR_DEVELOPMENT: "Business", // 8.7
  WB_1920_FINANCIAL_SECTOR_DEVELOPMENT: "Business", // 5.8
  WB_405_BUSINESS_CLIMATE: "Business", //  3.6
  WB_2530_BUSINESS_ENVIRONMENT: "Business", // 3.5
  WB_697_SOCIAL_PROTECTION_AND_LABOR: "Business", // 6.0

  // --- Politics ------------------------------------------------------------
  USPEC_POLITICS_GENERAL1: "Politics", //  26.9
  GENERAL_GOVERNMENT: "Politics", //       26.8
  ELECTION: "Politics", //                 8.8
  LEGISLATION: "Politics", //              11.6
  TAX_POLITICAL_PARTY: "Politics", //      long tail
  EPU_POLICY_GOVERNMENT: "Politics", //    21.9
  EPU_POLICY_POLITICAL: "Politics", //     10.5
  WB_831_GOVERNANCE: "Politics", //        14.3
  WB_723_PUBLIC_ADMINISTRATION: "Politics", // 9.3
  WB_696_PUBLIC_SECTOR_MANAGEMENT: "Politics", // 29.0
  WB_678_DIGITAL_GOVERNMENT: "Politics", // 19.8
};

/**
 * Prefixes longest-first, so the first hit is the longest match.
 *
 * Precomputed at module load rather than per call: `topicOf` runs once per
 * group per run and the table never changes, so sorting 70 strings inside the
 * loop would be ~14,000 needless sorts.
 */
const PREFIXES = Object.keys(THEME_TOPICS).sort((a, b) => b.length - a.length);

/** The topic a single theme votes for, or "" — longest prefix wins. */
export function topicOfTheme(theme: string): Topic {
  for (const prefix of PREFIXES) {
    if (theme.startsWith(prefix)) return THEME_TOPICS[prefix];
  }
  return "";
}

/**
 * What ONE article is about: the topic of its rarest matched theme.
 *
 * **Specificity decides, not how many themes matched, and that is the whole
 * classifier.** Measured on the live pool, 75.3% of classified articles match
 * more than one topic — GDELT tags a school-shooting story as Crime *and*
 * Education *and* Disaster, all truthfully. So "how many themes voted for this
 * topic" is nearly uninformative; what separates them is that
 * `NATURAL_DISASTER_EARTHQUAKE` (3.6% of the feed) says far more about an
 * article than `MANMADE_DISASTER_IMPLIED` (28.7%) does.
 *
 * The first version counted matches and broke ties on `TOPICS` order, and it
 * put 44.2% of the feed in Disaster — because with three-quarters of articles
 * tied, whatever was declared first won almost everything. Declaration order
 * was silently acting as the classifier.
 *
 * `frequency` is the pool's own document-frequency map from
 * `worker/group.ts`, so "rare" means rare *in this window* rather than in a
 * constant someone tuned once. A theme absent from the map (impossible for a
 * member of the pool, but cheap to defend) is treated as maximally rare.
 */
function topicOfArticle(article: PlacedArticle, frequency: Map<string, number>): Topic {
  let best: Topic = "";
  let rarest = Number.POSITIVE_INFINITY;

  for (const theme of article.themes) {
    const topic = topicOfTheme(theme);
    if (!topic) continue;
    const count = frequency.get(theme) ?? 0;
    if (count < rarest) {
      best = topic;
      rarest = count;
    } else if (count === rarest && TOPICS.indexOf(topic) < TOPICS.indexOf(best as (typeof TOPICS)[number])) {
      // A genuine tie on rarity falls back to the declared order, which is the
      // only remaining signal. This is now a rare path rather than the norm.
      best = topic;
    }
  }
  return best;
}

/**
 * The group's topic, by vote across its members.
 *
 * **One vote per member**, cast for that member's own most specific topic.
 * GDELT tags an article with dozens of themes and they cluster, so counting
 * themes lets a single heavily-tagged article outvote three others; the
 * question a chip answers is "what do the articles about this story agree it is
 * about", and that is a count of articles.
 *
 * Ties break on `TOPICS` order — most specific first, so a story that is
 * equally Disaster and Politics is filed as Disaster.
 *
 * Returns "" when nothing matched, which is a normal answer and is rendered as
 * no chip rather than as an "Other" chip: an Other bucket collects whatever the
 * table has not learned yet and invites a reader to click it expecting a
 * subject.
 */
export function topicOf(members: PlacedArticle[], frequency: Map<string, number>): Topic {
  const votes = new Map<Topic, number>();

  for (const member of members) {
    const topic = topicOfArticle(member, frequency);
    if (topic) votes.set(topic, (votes.get(topic) ?? 0) + 1);
  }

  let best: Topic = "";
  let bestCount = 0;
  // Walk TOPICS rather than the map, so the declared order IS the tie-break and
  // does not depend on Map insertion order (which is member order, i.e. random).
  for (const topic of TOPICS) {
    const count = votes.get(topic) ?? 0;
    if (count > bestCount) {
      best = topic;
      bestCount = count;
    }
  }
  return best;
}
