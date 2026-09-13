import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(import.meta.dirname, "tippecanoe-min-version.sh");
const MIN = "2.52.0";

let binDir: string;

// On Windows, `bash` on PATH may be WSL's, which can read neither a C:\ script
// path nor a Windows PATH entry for the stub. Git Bash can read both.
function findBash(): string | null {
  if (process.platform !== "win32") return "bash";
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const bash = path.resolve(execPath, "..", "..", "..", "bin", "bash.exe");
    return existsSync(bash) ? bash : null;
  } catch {
    return null;
  }
}

const BASH = findBash();

function stubTippecanoe(output: string): void {
  const stub = path.join(binDir, "tippecanoe");
  writeFileSync(stub, `#!/bin/sh\nprintf '%s\\n' '${output}'\n`, { mode: 0o755 });
}

function runGuard(): { code: number; stderr: string } {
  try {
    execFileSync(BASH ?? "bash", [SCRIPT, MIN], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { code: failure.status ?? -1, stderr: failure.stderr ?? "" };
  }
}

// Skipped only on Windows without Git Bash; CI (Linux) always runs it.
describe.skipIf(BASH === null)("the tippecanoe version guard", () => {
  beforeEach(() => {
    binDir = mkdtempSync(path.join(tmpdir(), "oyster-tippecanoe-"));
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("rejects the version apt installs, which is the one that caused the bug", () => {
    stubTippecanoe("tippecanoe v2.49.0");
    const { code, stderr } = runGuard();
    expect(code).toBe(1);
    expect(stderr).toContain("2.49.0");
    expect(stderr).toContain(MIN);
  });

  it("accepts exactly the version the upstream fix landed in", () => {
    stubTippecanoe("tippecanoe v2.52.0");
    expect(runGuard().code).toBe(0);
  });

  it("accepts a newer version", () => {
    stubTippecanoe("tippecanoe v2.79.0");
    expect(runGuard().code).toBe(0);
  });

  it("compares version components numerically, not as strings", () => {
    stubTippecanoe("tippecanoe v2.100.0");
    expect(runGuard().code).toBe(0);
  });

  it("rejects an older major even when the minor looks large", () => {
    stubTippecanoe("tippecanoe v1.99.0");
    expect(runGuard().code).toBe(1);
  });

  it("fails rather than passes when the version cannot be read", () => {
    stubTippecanoe("");
    expect(runGuard().code).not.toBe(0);
  });

  it("fails when tippecanoe is not installed at all", () => {
    const { code, stderr } = runGuard();
    expect(code).toBe(127);
    expect(stderr).toContain("not installed");
  });
});
