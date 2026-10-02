import type { LLMClient } from "../llm/client.js";
import { researchCompany, type ResearchContext } from "../steps/company-brief.js";
import { generateFlashcards } from "../steps/generate-flashcards.js";
import { generateQuestions, planCategories } from "../steps/generate-questions.js";
import { QUESTION_CATEGORIES, type Flashcard, type Kit, type Question, type QuestionCategory } from "./schema.js";
import {
  assertBriefRegenerable,
  isPreserved,
  mergeRegeneratedBrief,
  mergeRegeneratedCategory,
  mergeRegeneratedFlashcards,
  regenerateSchedule,
} from "./operations.js";
import { validateKit } from "./validate.js";
import { PrepError } from "../util/errors.js";
import { newGenerationId } from "../util/text.js";

export type Section = "company_brief" | "schedule" | "flashcards" | `questions:${QuestionCategory}`;

export function parseSection(s: string): Section {
  if (s === "company_brief" || s === "schedule" || s === "flashcards") return s;
  const m = s.match(/^questions:(.+)$/);
  if (m && (QUESTION_CATEGORIES as readonly string[]).includes(m[1])) return s as Section;
  throw new PrepError("INVALID_INPUT", `Unknown section "${s}".`);
}

export type SectionDrafts =
  | { section: "schedule" }
  | { section: "company_brief"; brief: { summary: string; what_they_do: string; sources: string[] }; process?: Kit["interview_process"] }
  | { section: "flashcards"; drafts: Array<Omit<Flashcard, "id" | "meta">> }
  | { section: `questions:${QuestionCategory}`; drafts: Array<Omit<Question, "id" | "meta">> };

/**
 * Phase 1 of regeneration (slow, calls the model): produce drafts for ONE
 * section from a snapshot of the kit and the research context stored with it
 * (no re-crawl). Nothing is written here.
 */
export async function generateSectionDrafts(snapshot: Kit, context: ResearchContext, section: Section, llm: LLMClient, opts: { force?: boolean } = {}): Promise<SectionDrafts> {
  if (section === "schedule") return { section };
  if (section === "company_brief") {
    assertBriefRegenerable(snapshot, !!opts.force);
    const r = await researchCompany(llm, context);
    return { section, brief: { summary: r.summary, what_they_do: r.what_they_do, sources: r.sources }, process: r.interview_process };
  }
  if (section === "flashcards") {
    const drafts = await generateFlashcards(llm, snapshot.role.requirements, snapshot.questions, {
      roleTitle: snapshot.role.title,
      companyName: snapshot.source.company,
      companySummary: snapshot.company_brief.summary,
    });
    return { section, drafts };
  }
  const category = section.slice("questions:".length) as QuestionCategory;
  const qctx = {
    roleTitle: snapshot.role.title,
    seniority: snapshot.role.seniority,
    companyName: snapshot.source.company,
    companySummary: snapshot.company_brief.summary,
    stages: snapshot.interview_process?.stages ?? [],
  };
  const plan = planCategories(snapshot.role.requirements, qctx).find((p) => p.category === category) ?? { category, requirements: [], count: 3, reason: "requested by user" };
  const drafts = await generateQuestions(llm, plan, qctx, {
    avoid: snapshot.questions.filter((q) => q.category !== category || isPreserved(q.meta)).map((q) => q.prompt),
    label: `regenerate:${category}`,
  });
  return { section, drafts };
}

/**
 * Phase 2 (fast, pure): merge drafts into the LATEST stored kit — not the
 * snapshot — so edits the user made while the model was running are kept.
 * Only un-touched generated items of that one section are replaced.
 */
export function applySectionDrafts(latest: Kit, d: SectionDrafts, opts: { force?: boolean } = {}): { kit: Kit; kept: number; added: number } {
  const kit: Kit = structuredClone(latest);
  const genId = newGenerationId();
  let kept = 0;
  let added = 0;
  if (d.section === "schedule") regenerateSchedule(kit);
  else if (d.section === "company_brief") {
    assertBriefRegenerable(kit, !!opts.force);
    mergeRegeneratedBrief(kit, d.brief, genId);
    if (d.process) kit.interview_process = d.process;
  } else if (d.section === "flashcards") {
    kept = kit.flashcards.filter((f) => isPreserved(f.meta)).length;
    mergeRegeneratedFlashcards(kit, d.drafts, genId);
    added = d.drafts.length;
  } else {
    const category = d.section.slice("questions:".length) as QuestionCategory;
    kept = kit.questions.filter((q) => q.category === category && isPreserved(q.meta)).length;
    mergeRegeneratedCategory(kit, category, d.drafts, genId);
    added = d.drafts.length;
  }
  const v = validateKit(kit);
  if (!v.ok) throw new PrepError("VALIDATION_FAILED", `Regenerated kit failed validation: ${v.errors.slice(0, 3).join("; ")}`);
  return { kit: v.kit!, kept, added };
}

/** Convenience for one-shot use (tests, scripts): generate then apply to the same kit. */
export async function regenerateSection(kit: Kit, context: ResearchContext, section: Section, llm: LLMClient, opts: { force?: boolean } = {}) {
  return applySectionDrafts(kit, await generateSectionDrafts(kit, context, section, llm, opts), opts);
}
