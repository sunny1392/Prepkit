import { describe, expect, it } from "vitest";
import { allocateSchedule, questionPriority } from "../src/schedule/allocate.js";
import { q, reqs } from "./helpers/kit-factory.js";
import type { Question } from "../src/kit/schema.js";

const many = (n: number): Question[] =>
  Array.from({ length: n }, (_, i) => q(`q${i + 1}`, i % 4 === 0 ? "behavioural" : "technical", [reqs[i % reqs.length].id], ((i % 3) + 1) as 1 | 2 | 3));

function invariants(days: number, questions: Question[]) {
  const s = allocateSchedule({ questions, requirements: reqs, days });
  expect(s.days_available).toBe(days);
  expect(s.days).toHaveLength(days);
  s.days.forEach((d, i) => {
    expect(d.day).toBe(i + 1);
    expect(Number.isInteger(d.minutes)).toBe(true);
    expect(d.minutes).toBeGreaterThan(0);
    expect(d.focus.length).toBeGreaterThan(0);
    for (const id of d.question_ids) expect(questions.some((x) => x.id === id)).toBe(true);
  });
  const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
  for (const x of questions) expect(scheduled.has(x.id)).toBe(true); // all material allocated
  for (const r of reqs.filter((r) => r.priority === "must")) {
    const covering = questions.filter((x) => x.requirement_ids.includes(r.id));
    if (covering.length) expect(covering.some((x) => scheduled.has(x.id))).toBe(true);
  }
  return s;
}

describe("allocateSchedule", () => {
  it.each([1, 2, 5, 7, 14, 30, 60])("spans exactly %i day(s) and allocates everything (20 questions)", (d) => { invariants(d, many(20)); });
  it.each([1, 5, 60])("works with fewer questions than days (%i days, 3 questions)", (d) => { invariants(d, many(3)); });

  it("puts all questions on the single day of a 1-day plan", () => {
    const s = invariants(1, many(12));
    expect(s.days[0].question_ids).toHaveLength(12);
  });

  it("front-loads must-have and harder material", () => {
    const qs = many(20);
    const must = new Set(reqs.filter((r) => r.priority === "must").map((r) => r.id));
    const s = allocateSchedule({ questions: qs, requirements: reqs, days: 5 });
    const byId = new Map(qs.map((x) => [x.id, x]));
    const avg = (d: number) => {
      const ids = s.days[d].question_ids.map((id) => byId.get(id)!);
      return ids.reduce((sum, x) => sum + questionPriority(x, must), 0) / ids.length;
    };
    expect(avg(0)).toBeGreaterThan(avg(3));
    // the hardest must-have question is on day 1
    const top = [...qs].sort((a, b) => questionPriority(b, must) - questionPriority(a, must))[0];
    expect(s.days[0].question_ids).toContain(top.id);
  });

  it("turns spare days into review days rather than leaving them empty", () => {
    const s = invariants(60, many(5));
    expect(s.days.every((d) => d.question_ids.length > 0)).toBe(true);
    expect(s.days.slice(10).every((d) => d.focus.startsWith("Review"))).toBe(true);
  });

  it("handles a kit with no questions", () => {
    const s = allocateSchedule({ questions: [], requirements: [], days: 3 });
    expect(s.days).toHaveLength(3);
  });

  it("rejects out-of-range days", () => {
    expect(() => allocateSchedule({ questions: [], requirements: [], days: 0 })).toThrow(RangeError);
    expect(() => allocateSchedule({ questions: [], requirements: [], days: 1.5 as number })).not.toThrow(); // truncated to 1
    expect(() => allocateSchedule({ questions: [], requirements: [], days: 500 })).toThrow(RangeError);
  });

  it("is deterministic", () => {
    const qs = many(17);
    expect(allocateSchedule({ questions: qs, requirements: reqs, days: 6 })).toEqual(allocateSchedule({ questions: qs, requirements: reqs, days: 6 }));
  });
});
