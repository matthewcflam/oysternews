/**
 * The story panel's thumbnail: an article's own `og:image`, looked up server-side.
 *
 * **Why this is a route handler and not a fetch in the browser.** The image URL
 * lives in the publisher's HTML `<head>`, and reading another origin's HTML from
 * the browser is exactly what CORS forbids. Something has to read it server-side.
 *
 * **What this does and does not do, against §2.6.** It reads the page's meta
 * tags, returns **one URL**, and discards the rest. It never returns the page,
 * never returns article text, and never proxies the image bytes — the browser
 * loads the picture from the publisher's own CDN, so their logs see their reader
 * and their cache serves it. That keeps the constraint as it is written: Sonder
 * still reproduces no article content.
 *
 * **Note what it does change, so it is a decision and not a drift.** §2.6's
 * link-out posture until now meant the project touched nothing but GDELT's
 * metadata. This fetches the article page itself. The exposure is a hotlinked
 * image and a server-side GET per story a reader opens, which is a real change of
 * posture even though no text is copied.
 *
 * ---------------------------------------------------------------------------
 * **This endpoint takes a URL from the client and fetches it. That is an SSRF
 * primitive, and the guards below are what stop it being one.** Do not relax any
 * of them without replacing it:
 *
 *   - scheme allowlist: http and https only, so `file://` and friends cannot
 *     reach the filesystem;
 *   - the hostname is resolved and every address checked against the private,
 *     loopback, link-local and unique-local ranges **before** the fetch, which is
 *     what keeps a cloud metadata endpoint (169.254.169.254) out of reach;
 *   - redirects are followed **manually**, re-validating each hop, because a
 *     public host is free to redirect to a private one and `redirect: "follow"`
 *     would take it;
 *   - the response is capped and timed out, so a hostile or merely enormous page
 *     cannot hold a Hobby-tier function open or exhaust its memory;
 *   - only a URL is ever returned, so this is not an open proxy for content.
 *
 * The residual risk is DNS rebinding — the name could resolve differently between
 * the check and the fetch. Closing that needs a pinned-IP agent, which is more
 * machinery than a thumbnail is worth; it is written down here rather than left
 * for someone to discover.
 *
 * **The predicates live in `lib/safe-url.ts` and are tested there**, because
 * `app/**` is outside vitest's include list and a guard nothing asserts is a
 * guard that can stop guarding in silence — this endpoint answers `{"image":
 * null}` whether it refused a request or merely found no image, so no probe from
 * outside can tell a working guard from a broken one.
 * ---------------------------------------------------------------------------
 */

import dns from "node:dns/promises";
import { isPrivateAddress, parseCandidate } from "@/lib/safe-url";

/** `node:dns` is not available on the edge runtime, and the guards need it. */
export const runtime = "nodejs";

/** Long enough for a slow publisher, short enough not to hold a function open. */
const TIMEOUT_MS = 4_000;

/** `og:image` lives in `<head>`; a page that has not declared it by 256 KB has not. */
const MAX_BYTES = 256 * 1024;

/** A public host that redirects to a private one is the attack; each hop is re-checked. */
const MAX_REDIRECTS = 3;

/**
 * Immutable enough. A published article's `og:image` effectively never changes,
 * and a day of CDN caching means a story that many readers open is fetched once.
 * `stale-while-revalidate` keeps the panel fast across the boundary.
 */
const CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": CACHE } });

/**
 * A URL this endpoint is willing to fetch, or `null`.
 *
 * The DNS half of the guard. `parseCandidate` has already refused a bad scheme
 * and a blocked name; this is what refuses a *good* name that points somewhere
 * private, and an IP literal, which are the same check.
 *
 * **`some`, not `every`.** A host that resolves to both a public and a private
 * address is refused: the fetch would be free to pick either.
 */
async function safeUrl(candidate: string): Promise<URL | null> {
  const url = parseCandidate(candidate);
  if (!url) return null;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (addresses.length === 0) return null;
    if (addresses.some((entry) => isPrivateAddress(entry.address, entry.family))) return null;
  } catch {
    // A name that will not resolve is not a name worth fetching.
    return null;
  }

  return url;
}

/**
 * Fetch a page, following redirects by hand so every hop passes `safeUrl`.
 * Returns the response and the URL it finally came from — the second is needed to
 * resolve a relative `og:image` against the right origin.
 */
async function fetchPage(start: URL): Promise<{ response: Response; url: URL } | null> {
  let url = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Named honestly. A publisher who wants to refuse this can, and should be
        // able to; a disguised user agent would take that choice away from them.
        "User-Agent": "SonderBot/1.0 (+https://sonder-drab-eta.vercel.app/about)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      const next = await safeUrl(new URL(location, url).href);
      if (!next) return null;
      url = next;
      continue;
    }

    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(type)) return null;

    return { response, url };
  }

  return null;
}

/** Read at most `MAX_BYTES` of the body, then stop pulling. */
async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let read = 0;

  try {
    while (read < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      // The tag is in <head>; once the body has started there is nothing left to find.
      if (/<\/head>/i.test(chunks[chunks.length - 1])) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return chunks.join("");
}

/**
 * The declared preview image, best first.
 *
 * Attribute order is not fixed in the wild — `property` before `content` and
 * `content` before `property` are both common — so each candidate is matched both
 * ways rather than assuming the tidy form.
 */
function declaredImage(html: string): string | null {
  for (const key of ["og:image:secure_url", "og:image:url", "og:image", "twitter:image"]) {
    const escaped = key.replace(/:/g, "\\:");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*?content\\s*=\\s*["']([^"']+)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]*?(?:property|name)\\s*=\\s*["']${escaped}["']`,
        "i",
      ),
    ];
    for (const pattern of patterns) {
      const found = pattern.exec(html)?.[1]?.trim();
      if (found) return found;
    }
  }
  return null;
}

/**
 * `GET /api/og?url=<article url>` -> `{ image: string | null }`.
 *
 * **`image: null` is a success, not a failure.** Plenty of articles declare no
 * preview image, and the panel has a designed state for that — the flat header in
 * the accent purple. Every failure path below therefore returns 200 with a null
 * image rather than an error status: the panel's fallback is the same picture in
 * every case, and a 500 would only invite a retry that will fail identically.
 */
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get("url");
  if (!target) return json({ image: null }, 400);

  const url = await safeUrl(target);
  if (!url) return json({ image: null });

  try {
    const page = await fetchPage(url);
    if (!page) return json({ image: null });

    const declared = declaredImage(await readHead(page.response));
    if (!declared) return json({ image: null });

    // Relative and protocol-relative `og:image` values are both common. Resolved
    // against the page's FINAL url, which is why fetchPage returns it.
    const image = new URL(declared, page.url);
    if (image.protocol !== "https:" && image.protocol !== "http:") return json({ image: null });

    return json({ image: image.href });
  } catch {
    // Timeout, DNS failure, a socket hangup, malformed HTML. All the same answer.
    return json({ image: null });
  }
}
