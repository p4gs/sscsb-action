/**
 * Reclassification — turning `sscsb verify` raw outcomes from a scan of a
 * third-party clone into honest directory verdicts.
 *
 * The scan protocol runs `sscsb init` before `verify`, and init installs the
 * very artifacts many controls check for — so a raw PASS can be evidence the
 * SCANNER created seconds earlier, not evidence about the repository. The rule
 * that fixes this is diff-based: anything init created (absent from the
 * pre-init `git ls-files` snapshot) can never count as the target's evidence.
 *
 * Evidence classes (full rationale on /methodology/):
 *   A  — committed-artifact controls: pass only on pre-existing artifacts.
 *   A' — static audits of committed workflows: vacuous with zero pre-existing
 *        workflows; otherwise the raw verdict maps directly (init's own
 *        templates pass sscsb's audit by construction, so init can only
 *        pollute toward PASS, never cause FAIL).
 *   B  — live-remote checks (GitHub API): raw verdict maps directly.
 *   C  — local-environment checks: unobservable in a repo scan → unverified.
 *   M  — meta/informational: excluded from scoring entirely.
 *
 * Fail-closed: a control id with no class is an error, never a guess — a new
 * sscsb control must be classified here before its scans can be scored.
 */

import type { ControlRecord, RawOutcome, ScanOutcome } from "./schema";

export type EvidenceClass = "A" | "Aprime" | "B" | "C" | "M";

/** Every control sscsb v1 can emit, mapped to its evidence class. */
export const CONTROL_CLASSES: Readonly<Record<string, EvidenceClass>> = {
  // Phase 1
  secrets: "A",
  "commit-signing": "C",
  "agent-signing": "C",
  "signing-model": "C",
  "branch-protection": "B",
  "actions-audit": "Aprime",
  gittuf: "A",
  "ai-trailers": "C",
  "ai-dep-gate": "C",
  "pr-template": "A",
  "ai-receipts": "C",
  // Phase 2
  sbom: "A",
  "vuln-scan": "A",
  scorecard: "B",
  renovate: "A",
  "package-trust": "C",
  bumblebee: "C",
  grype: "C",
  "socket-firewall": "C",
  // Phase 3
  "sigstore-signing": "A",
  "slsa-provenance": "A",
  "github-attestations": "A",
  "sbom-attestation": "A",
  "model-signing": "A",
  "provenance-verify": "A",
  "release-immutability": "A",
  "octo-sts": "A",
  "harden-runner": "Aprime",
  witness: "C",
  // Phase 4
  sast: "A",
  sighthound: "C",
  codeql: "A",
  fuzzing: "A",
  "workflow-audit-extended": "Aprime",
  "secure-repo": "M",
  "wait-for-secrets": "A",
  // Phase 5
  "dependency-track": "A",
  guac: "C",
  openvex: "C",
  oras: "C",
  "security-insights": "A",
  "best-practices-badge": "A",
  "osps-baseline": "A",
  "compliance-map": "M",
};

/** One row of `sscsb verify --format json` output (schema_version 1). */
export interface VerifyRow {
  control: string;
  phase: number;
  name: string;
  outcome: RawOutcome;
  messages: string[];
  artifacts: string[];
  tools: string[];
}

export interface ReclassifyInput {
  rows: VerifyRow[];
  /** Repo-relative paths present BEFORE `sscsb init` ran (git ls-files -z). */
  preFiles: ReadonlySet<string>;
  /** Count of pre-init files matching .github/workflows/*.ya?ml */
  workflowsPre: number;
  /** Control ids enabled per the target's own committed config (from report). */
  enabled: ReadonlySet<string>;
  /** Registry default-enabled ids (from report; controls absent = default-off). */
  defaultEnabled: ReadonlySet<string>;
}

const MAX_MESSAGES = 8;
const MAX_MESSAGE_LEN = 300;

/** Strip control characters and cap length — messages reach markdown/HTML. */
export function sanitizeMessage(m: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = m.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  return stripped.length > MAX_MESSAGE_LEN
    ? `${stripped.slice(0, MAX_MESSAGE_LEN)}\u2026`
    : stripped;
}

function mapDirect(raw: RawOutcome): ScanOutcome {
  switch (raw) {
    case "pass":
      return "pass";
    case "fail":
      return "fail";
    case "degraded":
      return "unverified";
    case "disabled":
      // Only reachable for in-scope (default-on) controls the target switched
      // off in its committed config: that is a posture choice, scored as gap.
      return "gap";
    case "info":
      return "info";
  }
}

export function reclassify(input: ReclassifyInput): ControlRecord[] {
  const out: ControlRecord[] = [];
  for (const row of input.rows) {
    const cls = CONTROL_CLASSES[row.control];
    if (cls === undefined) {
      throw new Error(
        `unclassified control \`${row.control}\` — a new sscsb control must be ` +
          `added to CONTROL_CLASSES (with a methodology entry) before scoring`,
      );
    }
    const inScope =
      cls !== "M" &&
      (input.defaultEnabled.has(row.control) || input.enabled.has(row.control));

    let scan: ScanOutcome;
    let reclassified = false;
    let reason: string | null = null;

    if (cls === "M" || !inScope) {
      scan = "info";
      if (cls === "M") reason = "informational control — excluded from scoring";
      else reason = "optional control not enabled by this repository";
    } else if (cls === "C") {
      scan = "unverified";
      reclassified = row.outcome === "pass" || row.outcome === "fail";
      reason = "requires the local development environment; not observable in a repository scan";
    } else if (cls === "Aprime") {
      if (input.workflowsPre === 0) {
        scan = "unverified";
        reclassified = true;
        reason = "no committed workflows to audit — a pass here would be vacuous";
      } else {
        scan = mapDirect(row.outcome);
      }
    } else if (cls === "B") {
      scan = mapDirect(row.outcome);
    } else {
      // Class A: committed artifacts are the evidence.
      const created = row.artifacts.filter((p) => !input.preFiles.has(p));
      if (row.artifacts.length > 0 && created.length > 0) {
        scan = "gap";
        reclassified = true;
        reason = `evidence installed by the scanner's own init (${created.join(", ")}) — absent from the repository`;
      } else {
        scan = mapDirect(row.outcome);
        if (row.outcome === "degraded" && row.artifacts.length > 0) {
          // Artifact-carrying tool controls degrade on missing runner tools;
          // with all artifacts pre-existing, the committed evidence stands.
          scan = "pass";
          reclassified = true;
          reason =
            "runner-tool availability is the scanner's environment, not the repository's; all registered artifacts pre-exist";
        }
      }
    }

    out.push({
      id: row.control,
      phase: row.phase,
      in_scope: inScope,
      raw_outcome: row.outcome,
      scan_outcome: scan,
      reclassified,
      reason,
      messages: row.messages.slice(0, MAX_MESSAGES).map(sanitizeMessage),
    });
  }
  return out;
}
