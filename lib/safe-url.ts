/**
 * The guard on `/api/og`.
 *
 * **Why this is its own module and not twenty lines inside the route.** The route
 * takes a URL from the client and fetches it, which is an SSRF primitive; these
 * predicates are the entire reason it is not one. `app/**` is outside vitest's
 * include list (`vitest.config.ts`), so logic that lives there is logic nothing
 * asserts — and a security guard that silently stops guarding looks exactly like
 * a guard that is working, because both answer "no image".
 *
 * Everything here is pure and synchronous. The DNS lookup that uses it stays in
 * the route, where the runtime is Node.
 */

/**
 * Is this address one the public internet cannot reach?
 *
 * Written out by range rather than pulled from a package: the list is short, it
 * does not change, and a dependency here would be a dependency inside a security
 * guard. **Unparseable input returns `true`** — an address this cannot read is an
 * address it cannot vouch for, and the safe default is to refuse.
 */
export function isPrivateAddress(address: string, family: number): boolean {
  if (family === 6) {
    const value = address.toLowerCase();
    // ::1 loopback, :: unspecified.
    if (value === "::1" || value === "::") return true;
    // fc00::/7 unique-local, fd00::/8 within it.
    if (/^f[cd]/.test(value)) return true;
    // fe80::/10 link-local.
    if (/^fe[89ab]/.test(value)) return true;
    // ::ffff:10.0.0.1 — an IPv4 address wearing an IPv6 hat, and the obvious way
    // to smuggle one past an IPv4-only check.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1], 4);
    return false;
  }

  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return true;
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local, and where every cloud metadata service lives.
  // This is the single most important line in the file.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10, carrier-grade NAT, which is a private network in practice.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Multicast and reserved.
  if (a >= 224) return true;

  return false;
}

/**
 * A hostname that must not be resolved at all, whatever DNS says about it.
 *
 * DNS is the second line; this is the first. A resolver can be configured to
 * point `localhost` anywhere, and `.internal` is the search domain half of every
 * cloud's private zone.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

/**
 * Parse a candidate into a URL this endpoint is willing to *consider*, or `null`.
 *
 * **Scheme and hostname only — this does not resolve anything.** The DNS half of
 * the guard lives in the route because it is async and needs `node:dns`; both
 * halves are required, and neither is sufficient. Returning a URL from here means
 * "worth resolving", not "safe to fetch".
 */
export function parseCandidate(candidate: string): URL | null {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // `file:`, `data:`, `gopher:`, `ftp:` — the whole reason a scheme allowlist
  // beats a scheme denylist.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isBlockedHost(url.hostname)) return null;

  return url;
}
