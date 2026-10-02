import { describe, expect, it } from "vitest";
import { groundRequirements } from "../src/steps/extract-requirements.js";

const JD = `Senior Backend Engineer

What you'll do:
- Design and build our dispatch APIs

Requirements:
- 5+ years building backend services in Node.js
- Strong PostgreSQL skills
- Experience mentoring junior engineers

Nice to have:
- Kafka or other event streaming
- 2+ years of Go
- Familiarity with logistics is a plus`;

const r = (text: string, evidence: string, priority = "must", kind = "technical") => ({ text, evidence, priority, kind });

describe("groundRequirements", () => {
  it("drops requirements whose evidence is not in the posting (no invention)", () => {
    const out = groundRequirements(JD, [r("Node.js", "5+ years building backend services in Node.js"), r("Kubernetes", "Experience running Kubernetes in production"), r("AWS", "")]);
    expect(out.requirements.map((x) => x.text)).toEqual(["Node.js"]);
    expect(out.rejected.map((x) => x.reason)).toEqual(["evidence not found in posting", "evidence not found in posting"]);
  });

  it("corrects must/nice from the posting's own wording and section headings", () => {
    const out = groundRequirements(JD, [
      r("Kafka", "Kafka or other event streaming", "must"),
      r("Go", "2+ years of Go", "must"), // "2+ years" but under Nice to have → nice
      r("Logistics", "Familiarity with logistics is a plus", "must", "domain"),
      r("PostgreSQL", "Strong PostgreSQL skills", "nice"), // under Requirements → must
    ]);
    const p = Object.fromEntries(out.requirements.map((x) => [x.text, x.priority]));
    expect(p).toEqual({ PostgreSQL: "must", Kafka: "nice", Go: "nice", Logistics: "nice" });
  });

  it("assigns stable ids in posting order and dedupes", () => {
    const out = groundRequirements(JD, [r("Kafka", "Kafka or other event streaming", "nice"), r("Node.js", "building backend services in Node.js"), r("Node.js", "building backend services in Node.js")]);
    expect(out.requirements.map((x) => [x.id, x.text])).toEqual([
      ["r1", "Node.js"],
      ["r2", "Kafka"],
    ]);
  });

  it("grounds the requirement text itself when the model omits evidence", () => {
    const out = groundRequirements(JD, [{ text: "Strong PostgreSQL skills", kind: "technical", priority: "must", evidence: null }]);
    expect(out.requirements.map((x) => x.text)).toEqual(["Strong PostgreSQL skills"]);
  });

  it("normalises behavioral → behavioural and unknown kinds", () => {
    const out = groundRequirements(JD, [r("Mentoring", "Experience mentoring junior engineers", "must", "behavioral"), r("PostgreSQL", "Strong PostgreSQL skills", "must", "weird")]);
    expect(out.requirements.map((x) => x.kind).sort()).toEqual(["behavioural", "technical"]);
  });

  it("rejects an embellished requirement text even with valid evidence", () => {
    const out = groundRequirements(JD, [r("Expert Kubernetes and Terraform operator", "Strong PostgreSQL skills")]);
    expect(out.requirements).toEqual([]);
  });
});

describe("groundRequirements — non-requirement sections", () => {
  it("drops items listed under Benefits/Perks", () => {
    const jd = "Engineer\n\nRequirements:\n- TypeScript\n\nBenefits:\n- Remote-first, 25 days PTO";
    const out = groundRequirements(jd, [
      { text: "TypeScript", evidence: "TypeScript", priority: "must", kind: "technical" },
      { text: "Remote-first", evidence: "Remote-first, 25 days PTO", priority: "must", kind: "domain" },
    ]);
    expect(out.requirements.map((r) => r.text)).toEqual(["TypeScript"]);
  });
});
