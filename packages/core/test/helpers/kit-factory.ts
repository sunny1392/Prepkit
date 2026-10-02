import type { Kit, Question, Requirement } from "../../src/kit/schema.js";
import { meta } from "../../src/kit/operations.js";
import { allocateSchedule } from "../../src/schedule/allocate.js";

export const reqs: Requirement[] = [
  { id: "r1", text: "5+ years with React", kind: "technical", priority: "must" },
  { id: "r2", text: "PostgreSQL", kind: "technical", priority: "must" },
  { id: "r3", text: "Mentoring junior engineers", kind: "behavioural", priority: "must" },
  { id: "r4", text: "Kafka", kind: "technical", priority: "nice" },
];

export function q(id: string, category: Question["category"], rids: string[], difficulty: 1 | 2 | 3 = 2): Question {
  return { id, category, requirement_ids: rids, prompt: `Prompt ${id}`, answer_outline: "x", difficulty, meta: meta("generated", "g1") };
}

export function makeKit(days = 5): Kit {
  const questions = [q("q1", "technical", ["r1"], 3), q("q2", "technical", ["r2"]), q("q3", "behavioural", ["r3"]), q("q4", "technical", ["r4"], 1), q("q5", "company-fit", [], 1)];
  return {
    source: { company: "Acme", company_url: "https://acme.test", role: "Engineer", location: "", jd_chars: 100, researched_at: new Date().toISOString(), pages_used: [] },
    company_brief: { summary: "s", what_they_do: "w", sources: [], meta: meta("generated", "g1") },
    role: { title: "Engineer", seniority: "senior", responsibilities: [], requirements: structuredClone(reqs) },
    questions,
    flashcards: [
      { id: "f1", front: "a", back: "b", requirement_ids: ["r1"], meta: meta("generated", "g1") },
      { id: "f2", front: "c", back: "d", requirement_ids: ["r3"], meta: meta("generated", "g1") },
    ],
    schedule: { ...allocateSchedule({ questions, requirements: reqs, days }), meta: meta("generated", "g1") },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}
