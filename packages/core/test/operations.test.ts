import { describe, expect, it } from "vitest";
import {
  addQuestion, deleteQuestion, editBrief, editQuestion, editScheduleDay, isPreserved, mergeRegeneratedCategory,
  mergeRegeneratedFlashcards, moveQuestion, regenerateSchedule, reorderCategory, setPinned, assertBriefRegenerable,
} from "../src/kit/operations.js";
import { validateKit } from "../src/kit/validate.js";
import { makeKit } from "./helpers/kit-factory.js";

const draft = (p: string, rids = ["r1"]) => ({ category: "technical" as const, requirement_ids: rids, prompt: p, answer_outline: "o", difficulty: 2 as const });

describe("regeneration preserves user work", () => {
  it("keeps edited, pinned and user-written questions in the regenerated category", () => {
    let kit = makeKit();
    kit = editQuestion(kit, "q1", { prompt: "My edited prompt" });
    kit = setPinned(kit, "question", "q2", true);
    kit = addQuestion(kit, draft("My own question", ["r2"]));
    const userId = kit.questions.at(-1)!.id;
    const otherCats = JSON.stringify(kit.questions.filter((q) => q.category !== "technical"));

    kit = mergeRegeneratedCategory(kit, "technical", [draft("New A"), draft("New B", ["r4"])], "g2");

    const tech = kit.questions.filter((q) => q.category === "technical");
    expect(tech.map((q) => q.prompt)).toEqual(["My edited prompt", "Prompt q2", "My own question", "New A", "New B"]);
    expect(kit.questions.find((q) => q.id === "q4")).toBeUndefined(); // untouched generated one replaced
    expect(JSON.stringify(kit.questions.filter((q) => q.category !== "technical"))).toBe(otherCats); // other categories untouched
    expect(kit.questions.find((q) => q.id === userId)?.meta?.origin).toBe("user");
    expect(validateKit(kit).ok).toBe(true);
  });

  it("never reuses ids for new questions", () => {
    let kit = makeKit();
    kit = deleteQuestion(kit, "q5");
    kit = mergeRegeneratedCategory(kit, "technical", [draft("New")], "g2");
    const fresh = kit.questions.find((q) => q.prompt === "New")!;
    expect(["q1", "q2", "q3", "q4", "q5"]).not.toContain(fresh.id);
  });

  it("does not touch the brief, flashcards or an edited schedule when a category is regenerated", () => {
    let kit = makeKit();
    kit = editBrief(kit, { summary: "Hand-written brief" });
    kit = editScheduleDay(kit, 1, { focus: "My focus" });
    const cards = JSON.stringify(kit.flashcards);
    kit = mergeRegeneratedCategory(kit, "behavioural", [{ ...draft("B"), category: "behavioural", requirement_ids: ["r3"] }], "g2");
    expect(kit.company_brief.summary).toBe("Hand-written brief");
    expect(kit.schedule.days[0].focus).toBe("My focus");
    expect(JSON.stringify(kit.flashcards)).toBe(cards);
    // the new question is still scheduled somewhere, and nothing dangles
    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    expect(kit.questions.every((q) => scheduled.has(q.id))).toBe(true);
    expect(validateKit(kit).ok).toBe(true);
  });

  it("keeps edited flashcards through flashcard regeneration", () => {
    let kit = makeKit();
    kit.flashcards[0].meta!.edited = true;
    kit = mergeRegeneratedFlashcards(kit, [{ front: "n", back: "b", requirement_ids: ["r2"] }], "g2");
    expect(kit.flashcards.map((f) => f.id)).toEqual(["f1", "f3"]);
  });

  it("guards a pinned or edited brief", () => {
    const kit = makeKit();
    kit.company_brief.meta!.pinned = true;
    expect(() => assertBriefRegenerable(kit, true)).toThrow(/pinned/);
    kit.company_brief.meta!.pinned = false;
    kit.company_brief.meta!.edited = true;
    expect(() => assertBriefRegenerable(kit, false)).toThrow(/hand edits/);
    expect(() => assertBriefRegenerable(kit, true)).not.toThrow();
  });
});

describe("builder operations", () => {
  it("moves a question across categories at an index and marks it edited", () => {
    let kit = makeKit();
    kit = moveQuestion(kit, "q4", "behavioural", 0);
    const beh = kit.questions.filter((q) => q.category === "behavioural").map((q) => q.id);
    expect(beh).toEqual(["q4", "q3"]);
    expect(isPreserved(kit.questions.find((q) => q.id === "q4")!.meta)).toBe(true);
  });

  it("reorders within a category and rejects a bad permutation", () => {
    let kit = makeKit();
    kit = reorderCategory(kit, "technical", ["q4", "q1", "q2"]);
    expect(kit.questions.filter((q) => q.category === "technical").map((q) => q.id)).toEqual(["q4", "q1", "q2"]);
    expect(() => reorderCategory(kit, "technical", ["q1"])).toThrow();
  });

  it("deleting a question prunes it from the schedule and updates coverage", () => {
    let kit = makeKit();
    kit = deleteQuestion(kit, "q2");
    expect(kit.schedule.days.flatMap((d) => d.question_ids)).not.toContain("q2");
    expect(kit.coverage.uncovered_requirement_ids).toContain("r2");
  });

  it("schedule regeneration respects days and pinning", () => {
    let kit = makeKit(3);
    kit = regenerateSchedule(kit);
    expect(kit.schedule.days).toHaveLength(3);
    kit.schedule.meta!.pinned = true;
    expect(() => regenerateSchedule(kit)).toThrow(/pinned/);
  });
});
