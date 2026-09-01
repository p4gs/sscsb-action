/**
 * Assemble the scan record from the artifacts directory-scan.yml captured:
 * pre-init file list, verify JSON, report JSON, and repo metadata env vars.
 *
 * Inputs (all env, no argv — the workflow passes attacker-influenced strings
 * only through env):
 *   PRE_FILES_PATH    NUL-separated `git ls-files -z` output from BEFORE init
 *   VERIFY_JSON_PATH  sscsb verify --format json output (target repo)
 *   REPORT_JSON_PATH  sscsb report --format json output (target repo — its
 *                     committed config decides which optional controls it
 *                     opted into)
 *   DEFAULTS_JSON_PATH sscsb report --format json from a FRESH init in an
 *                     empty temp repo — the same binary's registry defaults,
 *                     so the default-on scope can never drift from the
 *                     scanner version and can never be shrunk by the target
 *   SLUG, DEFAULT_BRANCH, COMMIT_SHA, DESCRIPTION, SSCSB_VERSION,
 *   RUN_ID, RUN_URL, ISSUE_NUMBER (optional)
 *   OUT_PATH         where to write the record
 */

import { METHODOLOGY_VERSION } from "../config";
import { reclassify, type VerifyRow } from "../reclassify";
import { computeScore } from "../scoring";
import { validateScanRecord, type ScanRecord } from "../schema";

interface ReportControl {
  enabled: boolean;
  [k: string]: unknown;
}

export async function buildRecord(): Promise<ScanRecord> {
  const env = (k: string): string => {
    const v = process.env[k];
    if (v === undefined || v === "") throw new Error(`missing env ${k}`);
    return v;
  };

  const preRaw = await Bun.file(env("PRE_FILES_PATH")).text();
  const preFiles = new Set(preRaw.split("\0").filter((p) => p.length > 0));
  const workflowsPre = [...preFiles].filter((p) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p),
  ).length;

  const verifyDoc = (await Bun.file(env("VERIFY_JSON_PATH")).json()) as {
    schema_version: number;
    results: VerifyRow[];
  };
  if (verifyDoc.schema_version !== 1) {
    throw new Error(`verify JSON schema_version ${verifyDoc.schema_version} unsupported`);
  }

  const enabledSetOf = (doc: { controls: Record<string, ReportControl> }) =>
    new Set(
      Object.entries(doc.controls)
        .filter(([, c]) => c.enabled)
        .map(([id]) => id),
    );
  // Target's committed config decides which OPTIONAL controls it opted into…
  const reportDoc = (await Bun.file(env("REPORT_JSON_PATH")).json()) as {
    controls: Record<string, ReportControl>;
  };
  const enabled = enabledSetOf(reportDoc);
  // …while the registry defaults come from a fresh-init report produced by the
  // SAME binary in an empty repo. Scope = defaults ∪ target-enabled, so a
  // target disabling a default-on control scores gap instead of shrinking the
  // denominator.
  const defaultsDoc = (await Bun.file(env("DEFAULTS_JSON_PATH")).json()) as {
    controls: Record<string, ReportControl>;
  };
  const defaultEnabled = enabledSetOf(defaultsDoc);

  const [owner, name] = env("SLUG").split("/") as [string, string];
  const controls = reclassify({
    rows: verifyDoc.results,
    preFiles,
    workflowsPre,
    enabled,
    defaultEnabled,
  });

  const record: ScanRecord = {
    schema_version: 1,
    methodology_version: METHODOLOGY_VERSION,
    repo: {
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      default_branch: env("DEFAULT_BRANCH"),
      commit: env("COMMIT_SHA"),
      description: (process.env.DESCRIPTION ?? "").slice(0, 300),
    },
    scanned_at: new Date().toISOString(),
    scanner: {
      sscsb_version: env("SSCSB_VERSION"),
      workflow_run_id: Number(env("RUN_ID")),
      workflow_run_url: env("RUN_URL"),
    },
    request_issue: process.env.ISSUE_NUMBER ? Number(process.env.ISSUE_NUMBER) : null,
    controls,
    score: computeScore(controls),
  };
  return validateScanRecord(record);
}

if (import.meta.main) {
  const record = await buildRecord();
  await Bun.write(process.env.OUT_PATH ?? "scan-record.json", JSON.stringify(record, null, 2));
  console.log(
    `record built: ${record.repo.owner}/${record.repo.name} → grade ${record.score.grade} ` +
      `(${record.score.overall_percent ?? "no evidence"}%, coverage ${record.score.evidence_coverage_percent}%)`,
  );
}
