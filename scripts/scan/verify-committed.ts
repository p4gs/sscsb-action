/** Verify committed workflows, excluding publishers installed by this scan's init. */
import { copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, sep } from "node:path";

const workflow = /^\.github\/workflows\/[^/]+\.ya?ml$/;

function leavesCheckout(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/** Resolve missing internal targets without treating an outside dangling link as safe. */
function resolveSnapshotLink(base: string, path: string): string {
  try { return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let cursor = parse(path).root;
  let pending = path.slice(cursor.length).split(sep).filter(Boolean);
  let followed = 0;
  while (pending.length > 0) {
    const part = pending.shift()!;
    if (part === ".") continue;
    // Resolve .. AFTER preceding symlinks, just as the filesystem does.
    if (part === "..") { cursor = dirname(cursor); continue; }
    const next = join(cursor, part);
    let info;
    try { info = lstatSync(next); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Init must never create missing directories outside the checkout,
      // even if a later .. component would lead back inside it.
      if (leavesCheckout(base, next)) throw new Error(`snapshot link leaves checkout: ${path}`);
      cursor = next;
      continue;
    }
    if (info.isSymbolicLink()) {
      if (++followed > 40) throw new Error(`snapshot link cycle: ${path}`);
      const target = readlinkSync(next);
      if (isAbsolute(target)) {
        cursor = parse(target).root;
        pending = [...target.slice(cursor.length).split(sep).filter(Boolean), ...pending];
      } else {
        pending = [...target.split(sep).filter(Boolean), ...pending];
      }
    } else { cursor = next; }
  }
  return cursor;
}

export function assertWorkflowDirectories(root: string): void {
  for (const name of [".github", ".github/workflows"]) {
    const path = join(root, name);
    // lstat also catches dangling directory links (existsSync does not).
    let info;
    try { info = lstatSync(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`unsafe workflow directory: ${name}`);
    }
  }
}

/** Run before init, which can write through a checkout's links. */
export function assertSafeSnapshot(root: string, preFiles: ReadonlySet<string>): void {
  const base = realpathSync(root);
  assertWorkflowDirectories(base);
  for (const name of preFiles) {
    if (isAbsolute(name) || name.split("/").includes("..")) {
      throw new Error(`unsafe snapshot path: ${name}`);
    }
    const info = lstatSync(join(base, name));
    if (!info.isSymbolicLink()) continue;
    const resolved = resolveSnapshotLink(base, join(base, name));
    if (leavesCheckout(base, resolved)) {
      throw new Error(`snapshot link leaves checkout: ${name}`);
    }
    const rewritten = [".gitignore", ".sscsb/hooks/pre-commit", ".sscsb/hooks/commit-msg", ".sscsb/hooks/pre-push", ".sscsb/policy/allowed_signers"];
    if (workflow.test(name) || rewritten.some(dest => dest === name || dest.startsWith(`${name}/`))) {
      throw new Error(`snapshot link aliases writable evidence: ${name}`);
    }
  }
}

export async function withCommittedWorkflows<T>(root: string, preFiles: ReadonlySet<string>, verify: () => T | Promise<T>): Promise<T> {
  assertSafeSnapshot(root, preFiles);
  const dir = join(root, ".github/workflows");
  if (!existsSync(dir)) return await verify();
  const generated: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`unsafe workflow file: ${name}`);
    if (!preFiles.has(`.github/workflows/${name}`)) generated.push(name);
  }
  if (generated.length === 0) return await verify();
  const hold = mkdtempSync(join(tmpdir(), "sscsb-workflows-"));
  const held: string[] = [];
  try {
    for (const name of generated) {
      copyFileSync(join(dir, name), join(hold, name));
      held.push(name);
      unlinkSync(join(dir, name));
    }
    return await verify();
  } finally {
    // copy/unlink works when the checkout and system temp are different mounts.
    // A restoration failure retains the backup and propagates as operational 2.
    for (const name of held) copyFileSync(join(hold, name), join(dir, name));
    rmSync(hold, { recursive: true });
  }
}

export async function runVerify(args: string[]): Promise<number> {
  try {
    const preflight = args[0] === "--preflight";
    const snapshot = preflight ? args[1] : args[0];
    const root = args[2] ?? process.cwd();
    if (!snapshot) throw new Error("pre-init snapshot path required");
    const preFiles = new Set(readFileSync(snapshot, "utf8").split("\0").filter(Boolean));
    if (preflight) {
      assertSafeSnapshot(root, preFiles);
      return 0;
    }
    return await withCommittedWorkflows(root, preFiles, () => {
      const child = Bun.spawnSync([args[1] ?? "sscsb", "verify", "--format", "json"], {
        cwd: root, stdout: "inherit", stderr: "inherit",
      });
      if (child.signalCode) throw new Error(`verifier terminated by ${child.signalCode}`);
      return child.exitCode;
    });
  } catch (error) {
    console.error(`::error::committed-workflow verification: ${String(error)}`);
    return 2;
  }
}

// Invoke Bun from the scanner's trusted directory; only the Rust child uses
// the target cwd, so target bunfig/preload/.env files cannot configure Bun.
if (import.meta.main) process.exit(await runVerify(process.argv.slice(2)));
