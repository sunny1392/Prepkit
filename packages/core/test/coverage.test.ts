import { describe, expect, it } from "vitest";
import { computeCoverage, runCoverageLoop } from "../src/coverage/coverage.js";
import { q, reqs } from "./helpers/kit-factory.js";
import type { Question } from "../src/kit/schema.js";

describe("computeCoverage", () => {
  it("finds uncovered requirements and dangling references", () => {
    const r = computeCoverage(reqs, [q("q1", "technical", ["r1", "r9"]), q("q2", "behavioural", ["r3"])]);
    expect(r.uncovered).toEqual(["r2", "r4"]);
    expect(r.uncoveredMust).toEqual(["r2"]);
    expect(r.byRequirement.r1).toEqual(["q1"]);
    expect(r.danglingRefs).toEqual([{ questionId: "q1", requirementId: "r9" }]);
  });
});

describe("runCoverageLoop", () => {
  const fb = (r: { id: string }) => q(`fb-${r.id}`, "technical", [r.id]);

  it("closes gaps on the second pass", async () => {
    const calls: string[][] = [];
    const res = await runCoverageLoop<Question>({
      requirements: reqs,
      initial: [q("q1", "technical", ["r1"])],
      fill: async (gaps) => {
        calls.push(gaps.map((g) => g.id));
        return gaps.map((g, i) => q(`g${i}`, "technical", [g.id]));
      },
      fallback: fb,
    });
    expect(calls).toEqual([["r2", "r3", "r4"]]);
    expect(res.uncovered).toEqual([]);
    expect(res.passes).toBe(2);
    expect(res.fallbackFor).toEqual([]);
  });

  it("stops when a pass makes no progress, then uses fallbacks for must-haves only", async () => {
    let n = 0;
    const res = await runCoverageLoop<Question>({
      requirements: reqs,
      initial: [q("q1", "technical", ["r1"])],
      fill: async () => {
        n++;
        return [];
      },
      fallback: fb,
    });
    expect(n).toBe(1); // no progress → don't burn quota on another identical pass
    expect(res.fallbackFor).toEqual(["r2", "r3"]);
    expect(res.uncovered).toEqual(["r4"]); // nice-to-have honestly left uncovered
    expect(computeCoverage(reqs, res.questions).uncoveredMust).toEqual([]);
  });

  it("survives a fill pass that throws", async () => {
    const res = await runCoverageLoop<Question>({
      requirements: reqs,
      initial: [],
      fill: async () => {
        throw new Error("rate limited");
      },
      fallback: fb,
    });
    expect(computeCoverage(reqs, res.questions).uncoveredMust).toEqual([]);
  });

  it("caps the number of fill passes", async () => {
    let n = 0;
    await runCoverageLoop<Question>({
      requirements: reqs,
      initial: [],
      // makes one requirement of progress per pass
      fill: async (gaps) => {
        n++;
        return [q(`g${n}`, "technical", [gaps[0].id])];
      },
      fallback: fb,
      maxFillPasses: 2,
    });
    expect(n).toBe(2);
  });
});
