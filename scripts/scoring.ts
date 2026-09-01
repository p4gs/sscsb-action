/**
 * Scoring — the single implementation shared by the scan pipeline (which
 * writes score blocks into records) and the site build (which re-derives
 * display values). Published verbatim on /methodology/.
 *
 * Doctrine (inherited from sscsb itself, AGENTS.md "0 is not a clean bill of
 * health"): an unperformed check is never a verdict. `unverified` and `info`
 * controls are excluded from EVERY denominator — they are a third visual
 * state, not a pass or a fail.
 */

import type { ControlRecord, Grade, PhaseScore, Score } from "./schema";

export const PHASES = [1, 2, 3, 4, 5] as const;

/** Grade boundaries (owner-specified academic scale). A+ requires exactly 100. */
export function gradeFor(overallPercent: number): Exclude<Grade, "NA"> {
  if (overallPercent === 100) return "A+";
  if (overallPercent >= 90) return "A";
  if (overallPercent >= 80) return "B";
  if (overallPercent >= 70) return "C";
  if (overallPercent >= 60) return "D";
  return "F";
}

/** Coverage below this: no letter at all — "insufficient evidence". */
export const COVERAGE_FLOOR_NA = 50;
/** Coverage below this (but ≥ the NA floor): letter shown as provisional. */
export const COVERAGE_FLOOR_PROVISIONAL = 75;

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Compute the score block from reclassified controls.
 *
 * Only `in_scope` controls participate at all. Within scope:
 *   countable = pass + fail + gap        (unverified/info never count)
 *   phase %   = 100·pass/countable       (countable 0 ⇒ null, "no evidence")
 *   overall   = Σpass/Σcountable         (same rule)
 *   coverage  = Σcountable/|scope|
 */
export function computeScore(controls: ControlRecord[]): Score {
  const scoped = controls.filter((c) => c.in_scope);
  const phases: PhaseScore[] = PHASES.map((phase) => {
    const rows = scoped.filter((c) => c.phase === phase);
    const count = (o: string) => rows.filter((c) => c.scan_outcome === o).length;
    const pass = count("pass");
    const fail = count("fail");
    const gap = count("gap");
    const countable = pass + fail + gap;
    return {
      phase,
      pass,
      fail,
      gap,
      unverified: count("unverified"),
      info: count("info"),
      percent: countable === 0 ? null : round1((100 * pass) / countable),
    };
  });

  const totalPass = phases.reduce((n, p) => n + p.pass, 0);
  const totalCountable = phases.reduce((n, p) => n + p.pass + p.fail + p.gap, 0);
  const overall = totalCountable === 0 ? null : round1((100 * totalPass) / totalCountable);
  const coverage = scoped.length === 0 ? 0 : round1((100 * totalCountable) / scoped.length);

  let grade: Grade;
  let provisional = false;
  if (overall === null || coverage < COVERAGE_FLOOR_NA) {
    grade = "NA";
  } else {
    grade = gradeFor(overall);
    provisional = coverage < COVERAGE_FLOOR_PROVISIONAL;
  }

  return {
    grade,
    provisional,
    overall_percent: overall,
    evidence_coverage_percent: coverage,
    phases,
  };
}
