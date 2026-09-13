// Ids carry a hash of the drawn URLs: two draws with one seed over different bundles would
// otherwise share ids, and score-audit.ts would silently score a sheet against the wrong sample.

import { createHash } from "node:crypto";

export function drawFingerprint(urls: string[]): string {
  return createHash("sha256").update(urls.join("\n")).digest("hex").slice(0, 6);
}

// Legacy `<seed36>-<index>` ids can't be verified. They are reported, not rejected, so
// judged-c29ce-90.jsonl stays re-scorable.
export function fingerprintOf(recordId: string): string | null {
  const parts = recordId.split("-");
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}
