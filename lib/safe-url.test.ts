import { describe, expect, it } from "vitest";
import { isBlockedHost, isPrivateAddress, parseCandidate } from "./safe-url";

/**
 * `/api/og` takes a URL from the client and fetches it. These are the assertions
 * that it is not an SSRF primitive.
 *
 * **The failure mode is silent**, which is why this file exists: a guard that
 * stops guarding and a guard that is working both make the endpoint answer
 * `{"image": null}`, so nothing downstream can tell them apart. Probing the live
 * endpoint proves nothing on its own.
 */

describe("isPrivateAddress", () => {
  it("blocks the cloud metadata endpoint", () => {
    // 169.254.169.254 is the reason this whole module exists: on every major
    // cloud it hands out instance credentials to anything that can GET it.
    expect(isPrivateAddress("169.254.169.254", 4)).toBe(true);
  });

  it("blocks loopback, the RFC 1918 ranges and CGNAT", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(address, 4), address).toBe(true);
    }
  });

  it("allows the public addresses either side of a private range", () => {
    // 172.15 and 172.32 are public; only 172.16-172.31 is private. An
    // off-by-one here would block real publishers rather than fail open, but it
    // is worth pinning in both directions.
    for (const address of ["1.1.1.1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "100.63.0.1", "223.255.255.255"]) {
      expect(isPrivateAddress(address, 4), address).toBe(false);
    }
  });

  it("blocks the IPv6 private ranges", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "FE80::1"]) {
      expect(isPrivateAddress(address, 6), address).toBe(true);
    }
  });

  it("sees through an IPv4-mapped IPv6 address", () => {
    // The obvious way to smuggle 169.254.169.254 past an IPv4-only check.
    expect(isPrivateAddress("::ffff:169.254.169.254", 6)).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1", 6)).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8", 6)).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111", 6)).toBe(false);
  });

  it("refuses what it cannot parse", () => {
    // An address this cannot read is an address it cannot vouch for.
    for (const address of ["", "not an address", "10.0.0", "1.2.3.4.5", "999.1.1.1", "10.0.0.-1"]) {
      expect(isPrivateAddress(address, 4), address).toBe(true);
    }
  });
});

describe("isBlockedHost", () => {
  it("blocks the names a resolver could point anywhere", () => {
    for (const host of ["localhost", "LOCALHOST", "api.localhost", "db.local", "metadata.internal", ""]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("allows an ordinary publisher", () => {
    for (const host of ["chron.com", "www.bbc.co.uk", "apnews.com"]) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });
});

describe("parseCandidate", () => {
  it("allows http and https only", () => {
    expect(parseCandidate("https://chron.com/storm")?.href).toBe("https://chron.com/storm");
    expect(parseCandidate("http://chron.com/storm")?.href).toBe("http://chron.com/storm");
  });

  it("refuses every other scheme", () => {
    // A scheme allowlist, not a denylist: file: and data: are the ones anyone
    // thinks of, and gopher: and ftp: are the ones they do not.
    for (const candidate of [
      "file:///etc/passwd",
      "file://C:/Windows/win.ini",
      "data:text/html,<script>",
      "gopher://x.test/",
      "ftp://x.test/",
      "javascript:alert(1)",
    ]) {
      expect(parseCandidate(candidate), candidate).toBeNull();
    }
  });

  it("refuses a blocked hostname before anything resolves it", () => {
    expect(parseCandidate("http://localhost:3000/")).toBeNull();
    expect(parseCandidate("http://metadata.internal/")).toBeNull();
  });

  it("refuses what is not a URL at all", () => {
    for (const candidate of ["", "not a url", "/relative/path", "chron.com"]) {
      expect(parseCandidate(candidate), candidate).toBeNull();
    }
  });

  it("still returns a URL for a private IP literal — the DNS half catches that", () => {
    // Documenting the seam rather than hiding it: this function is scheme and
    // hostname only, and BOTH halves of the guard are required. The route
    // resolves the host and runs isPrivateAddress over every answer, which is
    // what catches a literal as well as a name that points at one.
    expect(parseCandidate("http://169.254.169.254/")).not.toBeNull();
  });
});
