/**
 * Scan-record schema v1 — the one shape that flows from the scan job, through
 * the publish gate, into site/data/repos/, and out to rendered pages.
 *
 * Validation is hand-rolled (no runtime deps): the record is produced by our
 * own pipeline, so validation is a drift/tamper guard, not a parser for
 * arbitrary input. Everything user-influenced inside it (messages, repo
 * description) is escaped at render time regardless.
 */

export const SCHEMA_VERSION = 1;

export type ScanOutcome = "pass" | "fail" | "gap" | "unverified" | "info";
export type RawOutcome = "pass" | "fail" | "degraded" | "disabled" | "info";

export interface ControlRecord {
  id: string;
  phase: number;
  in_scope: boolean;
  raw_outcome: RawOutcome;
  scan_outcome: ScanOutcome;
  reclassified: boolean;
  reason: string | null;
  messages: string[];
}

export interface PhaseScore {
  phase: number;
  pass: number;
  fail: number;
  gap: number;
  unverified: number;
  info: number;
  /** 100·pass/countable, or null when countable is 0 ("no evidence"). */
  percent: number | null;
}

export type Grade = "A+" | "A" | "B" | "C" | "D" | "F" | "NA";

export interface Score {
  grade: Grade;
  provisional: boolean;
  overall_percent: number | null;
  evidence_coverage_percent: number;
  phases: PhaseScore[];
}

export interface ScanRecord {
  schema_version: number;
  methodology_version: number;
  repo: {
    owner: string;
    name: string;
    url: string;
    default_branch: string;
    commit: string;
    description: string;
  };
  scanned_at: string;
  scanner: {
    sscsb_version: string;
    workflow_run_id: number;
    workflow_run_url: string;
  };
  request_issue: number | null;
  controls: ControlRecord[];
  score: Score;
}

const SCAN_OUTCOMES: ReadonlySet<string> = new Set([
  "pass",
  "fail",
  "gap",
  "unverified",
  "info",
]);
const RAW_OUTCOMES: ReadonlySet<string> = new Set([
  "pass",
  "fail",
  "degraded",
  "disabled",
  "info",
]);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Throws with a precise message on the first violation. */
export function validateScanRecord(value: unknown): ScanRecord {
  const fail = (msg: string): never => {
    throw new Error(`scan record invalid: ${msg}`);
  };
  if (typeof value !== "object" || value === null) fail("not an object");
  const r = value as Record<string, unknown>;
  if (r.schema_version !== SCHEMA_VERSION) {
    fail(
      `schema_version ${String(r.schema_version)} — this build understands only ${SCHEMA_VERSION}`,
    );
  }
  if (typeof r.methodology_version !== "number") fail("methodology_version missing");
  const repo = r.repo as Record<string, unknown> | undefined;
  if (!repo || typeof repo !== "object") fail("repo missing");
  const owner = String(repo!.owner ?? "");
  const name = String(repo!.name ?? "");
  if (!OWNER_RE.test(owner)) fail(`repo.owner ${JSON.stringify(owner)} malformed`);
  if (!NAME_RE.test(name)) fail(`repo.name ${JSON.stringify(name)} malformed`);
  if (!/^[0-9a-f]{40}$/.test(String(repo!.commit ?? ""))) fail("repo.commit not a 40-hex sha");
  if (typeof r.scanned_at !== "string" || Number.isNaN(Date.parse(r.scanned_at))) {
    fail("scanned_at not an ISO timestamp");
  }
  const controls = r.controls;
  if (!Array.isArray(controls) || controls.length === 0) fail("controls empty");
  for (const c of controls as Array<Record<string, unknown>>) {
    if (typeof c.id !== "string" || c.id.length === 0) fail("control missing id");
    if (!RAW_OUTCOMES.has(String(c.raw_outcome))) {
      fail(`control ${String(c.id)}: raw_outcome ${JSON.stringify(c.raw_outcome)}`);
    }
    if (!SCAN_OUTCOMES.has(String(c.scan_outcome))) {
      fail(`control ${String(c.id)}: scan_outcome ${JSON.stringify(c.scan_outcome)}`);
    }
    if (!Array.isArray(c.messages)) fail(`control ${String(c.id)}: messages not a list`);
  }
  const score = r.score as Record<string, unknown> | undefined;
  if (!score || typeof score !== "object") fail("score missing");
  if (!["A+", "A", "B", "C", "D", "F", "NA"].includes(String(score!.grade))) {
    fail(`grade ${JSON.stringify(score!.grade)}`);
  }
  const phases = score!.phases;
  if (!Array.isArray(phases) || phases.length !== 5) fail("score.phases must have 5 entries");
  return value as ScanRecord;
}

/** The directory filename for a record: lowercased `{owner}--{name}.json`. */
export function recordFilename(owner: string, name: string): string {
  return `${owner.toLowerCase()}--${name.toLowerCase()}.json`;
}
