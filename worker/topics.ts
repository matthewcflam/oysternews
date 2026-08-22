/**
 * Display topic classifier. PURE, and currently UNSHIPPED — `run.ts` never
 * calls this, `StoryGroup` has no `topic` field, `tiles.ts` emits nothing
 * topic-related. Its only real importer is `scripts/theme-audit.ts`. See
 * docs/DESIGN.md#open-items ("`worker/topics.ts` is written but unshipped").
 *
 * A display facet only — must never be read by `compareGroups`,
 * `assignMinzoom`, or `countryTopGroups`, or the panel's "this region's top
 * stories" claim stops being true for one content model.
 *
 * The taxonomy is GDELT's V2EnhancedThemes — a policy/crisis vocabulary
 * (World Bank sectors, CrisisLex, EPU codes), not a newsroom's: essentially
 * no sport or entertainment coverage, and no usable general "tech" signal
 * (one broad token fires on 20.9% of everything). Measured via
 * `scripts/theme-audit.ts` (25,767 articles, 6,698 distinct themes).
 *
 * Deliberately does NOT reuse `worker/group.ts`'s `THEME_CEILING` — grouping
 * discards themes that are too common to distinguish *which* story an
 * article belongs to, but classification wants exactly the opposite: a
 * theme naming a quarter of the feed is naming what a quarter of the news
 * is about, which is the signal a chip needs.
 */

import type { PlacedArticle } from "../lib/types.ts";

// The chip row. Order is data, not decoration: it breaks ties in `topicOf`,
// running most-specific to least (Politics last — it's the widest net, so
// it should win only when nothing narrower fired).
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
 * Theme **prefix** -> topic. Longest matching prefix wins, which is what
 * lets a specific leaf (`TAX_FNCACT_POLICE` -> Crime) override an otherwise
 * unmapped family (`TAX_FNCACT_*`, job titles). Prefixes because GDELT's
 * 6,698 themes form hierarchical families (`WB_###_*`, `EPU_*`, etc.) — one
 * row per family keeps this table at ~70 rows and self-updating as GDELT
 * adds themes within a family. Percentages in comments are document
 * frequency over the audited pool (`scripts/theme-audit.ts`); re-run
 * before trusting them, they drift.
 */
export const THEME_TOPICS: Record<string, Topic> = {
  // --- Disaster ------------------------------------------------------------
  NATURAL_DISASTER: "Disaster", //         earthquake 3.6, flooding 2.9, + tail
  MANMADE_DISASTER: "Disaster", //         28.7 (mostly _IMPLIED — see below)
  // A longer prefix mapping to "" overrides its family with "says nothing" —
  // GDELT sets _IMPLIED when it *inferred* a disaster rather than read one
  // (28.7% of the feed), too weak a signal to classify on.
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

// Prefixes longest-first, so the first hit is the longest match. Sorted
// once at module load, not per call.
const PREFIXES = Object.keys(THEME_TOPICS).sort((a, b) => b.length - a.length);

/** The topic a single theme votes for, or "" — longest prefix wins. */
export function topicOfTheme(theme: string): Topic {
  for (const prefix of PREFIXES) {
    if (theme.startsWith(prefix)) return THEME_TOPICS[prefix];
  }
  return "";
}

/**
 * What ONE article is about: the topic of its rarest matched theme, not the
 * topic with the most matches. Version 1 counted matches and broke ties on
 * `TOPICS` order, which put 44.2% of the feed in Disaster — 75.3% of
 * articles match more than one topic, so declaration order was silently
 * acting as the classifier. `frequency` is the pool's own live document
 * frequency (from `worker/group.ts`), so "rare" means rare in this window.
 * See docs/DESIGN.md#open-items.
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
 * The group's topic: one vote per member (its own rarest-theme topic), not
 * one vote per theme — a heavily-tagged article shouldn't outvote three
 * others. Ties break on `TOPICS` order. Returns "" when nothing matched,
 * rendered as no chip rather than an "Other" chip.
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
