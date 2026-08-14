import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The version guard is the only thing standing between this project and a
 * silently ruined archive, so it is executed rather than reviewed.
 *
 * tippecanoe below 2.52.0 drops every feature that declares a `minzoom` — which
 * is every feature this project publishes — while exiting 0 and producing a
 * plausible-looking archive with one feature per tile. Nothing downstream can
 * tell that apart from a correct build: not the exit code, not the §8
 * invariants, not any unit test. See HANDOFF.md §2.4.
 *
 * **A guard that wrongly passes is as silent as the bug it guards against**, so
 * these run the real script against a stub `tippecanoe` on PATH, which is the
 * only way to exercise the comparison without installing four tippecanoes.
 */
const SCRIPT = path.join(import.meta.dirname, "tippecanoe-min-version.sh");
const MIN = "2.52.0";

let binDir: string;

/** A fake `tippecanoe` whose only job is to answer `--version`. */
function stubTippecanoe(output: string): void {
  const stub = path.join(binDir, "tippecanoe");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`, { mode: 0o755 });
}

function runGuard(): { code: number; stderr: string } {
  try {
    execFileSync("bash", [SCRIPT, MIN], {
      encoding: "utf8",
      // Captured, not inherited. The guard's whole output is a long refusal
      // message, and execFileSync forwards stderr to the parent by default —
      // which would print it four times per run.
      stdio: ["ignore", "pipe", "pipe"],
      // The stub has to win over any real tippecanoe on this machine.
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? -1, stderr: failure.stderr ?? "" };
  }
}

describe("the tippecanoe version guard", () => {
  beforeEach(() => {
    binDir = mkdtempSync(path.join(tmpdir(), "sonder-tippecanoe-"));
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("rejects the version apt installs, which is the one that caused the bug", () => {
    // Ubuntu 24.04's `apt-get install tippecanoe`. Not a hypothetical: this is
    // what CI ran until 2026-08-14 and what emptied a published archive.
    stubTippecanoe("tippecanoe v2.49.0");
    const { code, stderr } = runGuard();
    expect(code).toBe(1);
    expect(stderr).toContain("2.49.0");
    expect(stderr).toContain(MIN);
  });

  it("accepts exactly the version the upstream fix landed in", () => {
    // felt/tippecanoe bd48ba8 shipped in 2.52.0. The boundary is the whole
    // point of the constant, so it is asserted rather than assumed inclusive.
    stubTippecanoe("tippecanoe v2.52.0");
    expect(runGuard().code).toBe(0);
  });

  it("accepts a newer version", () => {
    stubTippecanoe("tippecanoe v2.79.0");
    expect(runGuard().code).toBe(0);
  });

  it("compares version components numerically, not as strings", () => {
    // `sort -V` and not `sort`: as plain strings "2.100.0" < "2.52.0" and a
    // future release would be rejected by a guard that looked like it worked.
    stubTippecanoe("tippecanoe v2.100.0");
    expect(runGuard().code).toBe(0);
  });

  it("rejects an older major even when the minor looks large", () => {
    stubTippecanoe("tippecanoe v1.99.0");
    expect(runGuard().code).toBe(1);
  });

  it("fails rather than passes when the version cannot be read", () => {
    // A cached binary that cannot find libsqlite3 prints nothing useful. The
    // dangerous outcome is treating unparseable as acceptable.
    stubTippecanoe("");
    expect(runGuard().code).not.toBe(0);
  });

  it("fails when tippecanoe is not installed at all", () => {
    const { code, stderr } = runGuard();
    expect(code).toBe(127);
    expect(stderr).toContain("not installed");
  });
});
