import { expect, test } from "bun:test";
import { CONTROL_CLASSES, reclassify, type VerifyRow } from "./reclassify";
import { validateScanRecord, type ControlRecord } from "./schema";
import { computeScore } from "./scoring";

const row = (id: string, phase = 6): ControlRecord => ({ id, phase, in_scope: true, raw_outcome: "fail", scan_outcome: "fail", reclassified: false, reason: null, messages: [] });
function record(count: number) {
  const c = { ...row("sast", 4), raw_outcome: "pass", scan_outcome: "pass" } as ControlRecord;
  const score = computeScore([c]);
  score.phases = score.phases.slice(0, count);
  return { schema_version: 1, methodology_version: 2, repo: { owner: "p4gs", name: "test", commit: "a".repeat(40) }, scanned_at: "2026-11-16T00:00:00Z", controls: [c], score };
}

test("phase-six failures count in the overall grade", () => {
  const score = computeScore([{ ...row("sast", 4), raw_outcome: "pass", scan_outcome: "pass" }, row("publish-targets")]);
  expect(score.phases).toHaveLength(6);
  expect(score.overall_percent).toBe(50);
  expect(score.evidence_coverage_percent).toBe(100);
  expect(score.grade).toBe("F");
});

test("historical five-phase and current six-phase records remain readable", () => {
  expect(validateScanRecord(record(5)).score.phases).toHaveLength(5);
  expect(validateScanRecord(record(6)).score.phases).toHaveLength(6);
});

test("malformed phase sets and missing control phases are rejected", () => {
  const short = record(4);
  expect(() => validateScanRecord(short)).toThrow("5 or 6");
  const duplicate = record(6);
  duplicate.score.phases[5]!.phase = 5;
  expect(() => validateScanRecord(duplicate)).toThrow("ordered contiguous");
  const outOfOrder = record(6);
  outOfOrder.score.phases.reverse();
  expect(() => validateScanRecord(outOfOrder)).toThrow("ordered contiguous");
  const missing = record(5);
  missing.controls.push(row("publish-targets"));
  expect(() => validateScanRecord(missing)).toThrow("phase absent");
  const long = record(6);
  long.score.phases.push({ ...long.score.phases[5]!, phase: 7 });
  expect(() => validateScanRecord(long)).toThrow("5 or 6");
});

test("new controls retain directory evidence classes and unknown ids fail closed", () => {
  expect(["socket-firewall-ci", "publish-targets", "trusted-publishing", "maintainer-mfa", "publish-tokens", "publish-provenance", "dist-manifests"].map(id => CONTROL_CLASSES[id])).toEqual(["Aprime", "A", "Aprime", "C", "Aprime", "B", "A"]);
  for (const id of ["future-control", "constructor", "toString", "valueOf", "__proto__"]) {
    const raw: VerifyRow = { control: id, phase: 6, name: id, outcome: "pass", messages: [], artifacts: [], tools: [] };
    expect(() => reclassify({ rows: [raw], preFiles: new Set(), workflowsPre: 1, enabled: new Set([id]), defaultEnabled: new Set([id]) })).toThrow("unclassified control");
  }
});
