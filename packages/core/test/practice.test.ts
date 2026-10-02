import { describe, expect, it } from "vitest";
import { applyReview, orderSession, practiceProgress } from "../src/practice/practice.js";
import { readinessReport } from "../src/practice/readiness.js";
import { makeKit } from "./helpers/kit-factory.js";

describe("practice ordering", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  it("orders unseen first, then least confident, then least recently reviewed", () => {
    let recs = applyReview([], "a", 3, new Date("2026-01-01"));
    recs = applyReview(recs, "b", 1, new Date("2026-01-03"));
    recs = applyReview(recs, "c", 1, new Date("2026-01-02"));
    expect(orderSession(cards, recs).map((c) => c.id)).toEqual(["d", "c", "b", "a"]);
  });
  it("updates confidence and counts reviews", () => {
    let recs = applyReview([], "a", 1);
    recs = applyReview(recs, "a", 3);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ confidence: 3, reviews: 2 });
    expect(practiceProgress(cards, recs)).toMatchObject({ total: 4, covered: 1, confident: 1, remaining: 3 });
  });
});

describe("readiness report", () => {
  it("flags unpractised must-haves red and sorts must-haves first", () => {
    const kit = makeKit();
    const recs = applyReview([], "f1", 3);
    const rep = readinessReport(kit, recs);
    expect(rep[0].priority).toBe("must");
    expect(rep.find((r) => r.requirementId === "r1")!.status).toBe("green");
    expect(rep.find((r) => r.requirementId === "r3")!.status).toBe("red");
    expect(rep.at(-1)!.priority).toBe("nice");
  });
});
