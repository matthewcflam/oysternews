import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sonder — a map of current world news",
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
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
