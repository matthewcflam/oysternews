import type { Metadata } from "next";
import { Instrument_Serif, Newsreader } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

/**
 * The site's typeface. Self-hosted by `next/font`, so there is no request to
 * Google at runtime and no FOUT to design around.
 *
 * The **variable** axis is loaded rather than a fixed set of weights: the map
 * chrome runs from 11px labels to a 26px place heading, and one variable file is
 * smaller than the three static cuts that range would otherwise need.
 *
 * Exposed as a CSS variable rather than applied by class because `globals.css`
 * is where every rule that sizes text already lives — see the `--font-body`
 * declaration on `body` there.
 */
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
});

/**
 * The second typeface, and it earns its place on exactly one string: the search
 * field's "Where to next?".
 *
 * That is a deliberate exception to the one-typeface rule above, not an
 * oversight. The search bar is the only white-on-white surface on the page — it
 * is a light pill floating on a dark map — and Newsreader at 16px on white reads
 * as body copy, which is what a placeholder must not do. Instrument Serif's
 * higher contrast and tighter fit make it read as an invitation.
 *
 * It is a single 400 weight rather than a variable axis, because one 13-character
 * string needs no range.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Oyster — a map of current world news",
  description:
    "A 2D web map of current world news. Stories are plotted where they happen.",
};

/**
 * `Analytics` is here to make one existing decision actionable rather than to
 * collect data for its own sake.
 *
 * §6 decision 11 says to revisit the basemap **"above ~200 visits/month"** —
 * MapTiler bills per request, a measured visit costs 193 requests on a phone,
 * and the free tier **pauses the map until the next month** rather than billing.
 * That is the worst failure this project has: it happens exactly when someone
 * actually clicks the link on the résumé (§1). Until 2026-08-13 nothing in the
 * repo measured visits, so the trigger had no trigger and the decision could
 * only ever be revisited by accident.
 *
 * Free on Hobby, no cookies, no consent banner needed, and it does not touch the
 * map: it is one script tag, and §2.6's "free tier everywhere" still holds.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${instrumentSerif.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
