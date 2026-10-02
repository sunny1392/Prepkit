import { describe, expect, it } from "vitest";
import { validateKit } from "../src/kit/validate.js";
import { makeKit } from "./helpers/kit-factory.js";

describe("validateKit", () => {
  it("accepts a well-formed kit", () => {
    const r = validateKit(makeKit());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("rejects float minutes, bad enums and out-of-range difficulty", () => {
    const k = makeKit() as any;
    k.schedule.days[0].minutes = 42.5;
    k.questions[0].difficulty = 4;
    k.role.requirements[0].priority = "required";
    const r = validateKit(k);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/minutes/);
    expect(r.errors.join("\n")).toMatch(/difficulty/);
    expect(r.errors.join("\n")).toMatch(/priority/);
  });
  it("rejects missing required fields", () => {
    const k = makeKit() as any;
    delete k.coverage;
    delete k.source.pages_used;
    expect(validateKit(k).ok).toBe(false);
  });
  it("checks referential integrity", () => {
    const k = makeKit();
    k.questions[0].requirement_ids.push("r99");
    k.schedule.days[0].question_ids.push("q99");
    k.questions[1].id = "q1";
    const r = validateKit(k);
    expect(r.errors).toEqual(expect.arrayContaining([expect.stringMatching(/unknown requirement "r99"/), expect.stringMatching(/unknown question "q99"/), expect.stringMatching(/duplicate question id "q1"/)]));
  });
  it("requires the schedule length to equal days_available", () => {
    const k = makeKit(5);
    k.schedule.days.pop();
    expect(validateKit(k).errors.join()).toMatch(/4 days but days_available is 5/);
  });
});
