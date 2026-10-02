import type { Question, Requirement } from "../kit/schema.js";

export interface CoverageReport {
  /** requirement id → ids of questions that reference it */
  byRequirement: Record<string, string[]>;
  uncovered: string[];
  uncoveredMust: string[];
  /** question references to requirement ids that don't exist */
  danglingRefs: Array<{ questionId: string; requirementId: string }>;
}

/**
 * Coverage is decided by code, not the model: a requirement is covered iff at
 * least one question lists its id in requirement_ids. That is what makes
 * coverage checkable rather than a matter of opinion.
 */
export function computeCoverage(requirements: Requirement[], questions: Pick<Question, "id" | "requirement_ids">[]): CoverageReport {
  const byRequirement: Record<string, string[]> = Object.fromEntries(requirements.map((r) => [r.id, []]));
  const danglingRefs: CoverageReport["danglingRefs"] = [];
  for (const q of questions) {
    for (const rid of q.requirement_ids) {
      if (byRequirement[rid]) byRequirement[rid].push(q.id);
      else danglingRefs.push({ questionId: q.id, requirementId: rid });
    }
  }
  const uncovered = requirements.filter((r) => byRequirement[r.id].length === 0).map((r) => r.id);
  const must = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  return { byRequirement, uncovered, uncoveredMust: uncovered.filter((id) => must.has(id)), danglingRefs };
}

export interface CoverageLoopResult<Q> {
  questions: Q[];
  passes: number;
  uncovered: string[];
  fallbackFor: string[];
  history: Array<{ pass: number; uncovered: string[]; added: number }>;
}

export interface CoverageLoopDeps<Q extends Pick<Question, "id" | "requirement_ids">> {
  requirements: Requirement[];
  initial: Q[];
  /** Generate questions for the given uncovered requirements (one model call). */
  fill: (gaps: Requirement[], pass: number) => Promise<Q[]>;
  /** Deterministic question for a must-have still uncovered after the loop. */
  fallback: (req: Requirement) => Q;
  maxFillPasses?: number;
}

/**
 * The second pass. check → fill gaps → check again, until:
 *   - nothing is uncovered, or
 *   - a fill pass adds no new coverage (the model is stuck; asking again wastes quota), or
 *   - maxFillPasses (default 2) fill calls have run.
 * Any must-have still uncovered then gets a deterministic fallback question,
 * so a kit never ships with an uncovered must. `passes` counts coverage checks.
 */
export async function runCoverageLoop<Q extends Pick<Question, "id" | "requirement_ids">>(deps: CoverageLoopDeps<Q>): Promise<CoverageLoopResult<Q>> {
  const maxFill = deps.maxFillPasses ?? 2;
  let questions = [...deps.initial];
  let report = computeCoverage(deps.requirements, questions);
  let passes = 1;
  const history: CoverageLoopResult<Q>["history"] = [{ pass: 1, uncovered: report.uncovered, added: 0 }];
  const byId = new Map(deps.requirements.map((r) => [r.id, r]));

  for (let fill = 1; fill <= maxFill && report.uncovered.length > 0; fill++) {
    const before = report.uncovered.length;
    let added: Q[] = [];
    try {
      added = await deps.fill(report.uncovered.map((id) => byId.get(id)!), fill);
    } catch {
      added = []; // a failed fill pass falls through to the deterministic fallback
    }
    questions = [...questions, ...added];
    report = computeCoverage(deps.requirements, questions);
    passes++;
    history.push({ pass: passes, uncovered: report.uncovered, added: added.length });
    if (report.uncovered.length >= before) break; // no progress
  }

  const fallbackFor = [...report.uncoveredMust];
  for (const id of fallbackFor) questions.push(deps.fallback(byId.get(id)!));
  if (fallbackFor.length) {
    report = computeCoverage(deps.requirements, questions);
    passes++;
    history.push({ pass: passes, uncovered: report.uncovered, added: fallbackFor.length });
  }
  return { questions, passes, uncovered: report.uncovered, fallbackFor, history };
}
