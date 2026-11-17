import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSnapshot, runVerify, withCommittedWorkflows } from "./verify-committed";

const dirs: string[] = [];
const temp = () => { const d = mkdtempSync(join(tmpdir(), "sscsb-evidence-test-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const root = temp();
  const dir = join(root, ".github/workflows");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ci.yml"), "committed CI");
  writeFileSync(join(dir, "publish-npm.yml"), "init publisher");
  writeFileSync(join(dir, "publish-pypi.yaml"), "init PyPI publisher");
  return { root, dir, pre: new Set([".github/workflows/ci.yml"]) };
}

test("verification sees committed workflows rather than init-created publishers and preserves gate exit 1", async () => {
  const f = fixture();
  expect(await withCommittedWorkflows(f.root, f.pre, () => {
    expect(readdirSync(f.dir)).toEqual(["ci.yml"]);
    expect(readFileSync(join(f.dir, "ci.yml"), "utf8")).toBe("committed CI");
    return 1;
  })).toBe(1);
  expect(readFileSync(join(f.dir, "publish-npm.yml"), "utf8")).toBe("init publisher");
  expect(existsSync(join(f.dir, "publish-pypi.yaml"))).toBe(true);
});

test("committed custom publishers remain visible and generated files are restored on failure", async () => {
  const f = fixture();
  f.pre.add(".github/workflows/publish-npm.yml");
  await expect(withCommittedWorkflows(f.root, f.pre, () => {
    expect(existsSync(join(f.dir, "publish-npm.yml"))).toBe(true);
    expect(existsSync(join(f.dir, "publish-pypi.yaml"))).toBe(false);
    throw new Error("verifier failed");
  })).rejects.toThrow("verifier failed");
  expect(existsSync(join(f.dir, "publish-pypi.yaml"))).toBe(true);
});

test("symlinked workflow directories cannot move external files", async () => {
  const root = temp(), outside = temp();
  writeFileSync(join(outside, "ci.yml"), "external");
  mkdirSync(join(root, ".github"));
  symlinkSync(outside, join(root, ".github/workflows"));
  await expect(withCommittedWorkflows(root, new Set(), () => 0)).rejects.toThrow("unsafe workflow directory");
  expect(readFileSync(join(outside, "ci.yml"), "utf8")).toBe("external");
});

test("snapshot links cannot expose external files or alias workflow and rewritten policy evidence", () => {
  const f = fixture(), outside = temp();
  writeFileSync(join(outside, "secret"), "outside");
  symlinkSync(join(outside, "secret"), join(f.root, "escape"));
  expect(() => assertSafeSnapshot(f.root, new Set(["escape"]))).toThrow("leaves checkout");
  symlinkSync("ci.yml", join(f.dir, "alias.yml"));
  expect(() => assertSafeSnapshot(f.root, new Set([".github/workflows/alias.yml"]))).toThrow("aliases writable evidence");
  mkdirSync(join(f.root, ".sscsb/hooks"), { recursive: true });
  symlinkSync("../../.github/workflows/ci.yml", join(f.root, ".sscsb/hooks/pre-commit"));
  expect(() => assertSafeSnapshot(f.root, new Set([".sscsb/hooks/pre-commit"]))).toThrow("aliases writable evidence");
});

test("protocol failures use operational exit 2, rather than a gate-data exit 1", async () => {
  const root = temp(), snapshot = join(root, "snapshot.z");
  writeFileSync(snapshot, "missing-file\0");
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await runVerify([snapshot, "sscsb", root])).toBe(2);
    expect(error).toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

test("directory aliases cannot redirect init's rewritten hooks or signer policy", () => {
  for (const name of [".sscsb", ".sscsb/hooks", ".sscsb/policy"]) {
    const f = fixture(), evidence = join(f.root, "tracked-evidence");
    mkdirSync(evidence);
    writeFileSync(join(evidence, "pre-commit"), "committed evidence");
    if (name !== ".sscsb") mkdirSync(join(f.root, ".sscsb"));
    symlinkSync(evidence, join(f.root, name));
    expect(() => assertSafeSnapshot(f.root, new Set([name]))).toThrow("aliases writable evidence");
    expect(readFileSync(join(evidence, "pre-commit"), "utf8")).toBe("committed evidence");
  }
});

test("dangling internal documentation links are accepted without allowing outside escapes", () => {
  const f = fixture(), outside = temp();
  mkdirSync(join(f.root, "docs"));
  symlinkSync("not-written-yet.md", join(f.root, "docs/future.md"));
  expect(() => assertSafeSnapshot(f.root, new Set(["docs/future.md"])) ).not.toThrow();
  symlinkSync(join(f.root, "docs/absolute-future.md"), join(f.root, "absolute-internal"));
  expect(() => assertSafeSnapshot(f.root, new Set(["absolute-internal"])) ).not.toThrow();
  mkdirSync(join(f.root, "docs/child"));
  symlinkSync("docs/child", join(f.root, "internal-alias"));
  symlinkSync("internal-alias/../future.md", join(f.root, "internal-dotdot"));
  expect(() => assertSafeSnapshot(f.root, new Set(["internal-dotdot"])) ).not.toThrow();
  symlinkSync(join(outside, "missing"), join(f.root, "outside-missing"));
  expect(() => assertSafeSnapshot(f.root, new Set(["outside-missing"])) ).toThrow("leaves checkout");
  mkdirSync(join(outside, "child"));
  symlinkSync(join(outside, "child"), join(f.root, "external-alias"));
  symlinkSync("external-alias/../missing", join(f.root, "dotdot-escape"));
  expect(() => assertSafeSnapshot(f.root, new Set(["dotdot-escape"])) ).toThrow("leaves checkout");
  symlinkSync("cycle-b", join(f.root, "cycle-a"));
  symlinkSync("cycle-a", join(f.root, "cycle-b"));
  expect(() => assertSafeSnapshot(f.root, new Set(["cycle-a"])) ).toThrow();
  symlinkSync("docs/missing/../../cycle-a", join(f.root, "missing-prefix-cycle"));
  expect(() => assertSafeSnapshot(f.root, new Set(["missing-prefix-cycle"])) ).toThrow();
  symlinkSync(join(f.root, "docs"), join(outside, "return-inside"));
  symlinkSync(`${outside}/missing/../return-inside/future.md`, join(f.root, "missing-outside-prefix"));
  expect(() => assertSafeSnapshot(f.root, new Set(["missing-outside-prefix"])) ).toThrow("leaves checkout");
  expect(existsSync(join(outside, "missing"))).toBe(false);
});

test("the real verifier subprocess preserves exits 0, 1 and 2 and restores generated workflows", async () => {
  const f = fixture(), snapshot = join(f.root, "snapshot.z"), binary = join(f.root, "verifier");
  writeFileSync(snapshot, ".github/workflows/ci.yml\0");
  for (const exit of [0, 1, 2]) {
    writeFileSync(binary, `#!/bin/sh\nexit ${exit}\n`);
    chmodSync(binary, 0o755);
    expect(await runVerify([snapshot, binary, f.root])).toBe(exit);
    expect(existsSync(join(f.dir, "publish-npm.yml"))).toBe(true);
  }
});
