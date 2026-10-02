import type { LLMClient } from "../llm/client.js";
import { researchCompany, type ResearchContext } from "../steps/company-brief.js";
import { generateFlashcards } from "../steps/generate-flashcards.js";
import { generateQuestions, planCategories } from "../steps/generate-questions.js";
import { QUESTION_CATEGORIES, type Kit, type QuestionCategory } from "./schema.js";
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

/**
 * Regenerate ONE section of a kit. Works on a copy; the caller saves it only
 * if the stored version hasn't moved on (optimistic concurrency). Uses the
 * research context stored with the kit, so no re-crawl is needed.
 */
export async function regenerateSection(
  original: Kit,
  context: ResearchContext,
  section: Section,
  llm: LLMClient,
  opts: { force?: boolean } = {},
): Promise<{ kit: Kit; kept: number; added: number }> {
  const kit: Kit = structuredClone(original);
  const genId = newGenerationId();
  let kept = 0;
  let added = 0;

  if (section === "schedule") {
    regenerateSchedule(kit);
  } else if (section === "company_brief") {
    assertBriefRegenerable(kit, !!opts.force);
    const r = await researchCompany(llm, context);
    mergeRegeneratedBrief(kit, r, genId);
    if (r.interview_process) kit.interview_process = r.interview_process;
  } else if (section === "flashcards") {
    kept = kit.flashcards.filter((f) => isPreserved(f.meta)).length;
    const drafts = await generateFlashcards(llm, kit.role.requirements, kit.questions, {
      roleTitle: kit.role.title,
      companyName: kit.source.company,
      companySummary: kit.company_brief.summary,
    });
    mergeRegeneratedFlashcards(kit, drafts, genId);
    added = drafts.length;
  } else {
    const category = section.slice("questions:".length) as QuestionCategory;
    const qctx = {
      roleTitle: kit.role.title,
      seniority: kit.role.seniority,
      companyName: kit.source.company,
      companySummary: kit.company_brief.summary,
      stages: kit.interview_process?.stages ?? [],
    };
    const plan =
      planCategories(kit.role.requirements, qctx).find((p) => p.category === category) ?? {
        category,
        requirements: [],
        count: 3,
        reason: "requested by user",
      };
    const keptQs = kit.questions.filter((q) => q.category === category && isPreserved(q.meta));
    kept = keptQs.length;
    const drafts = await generateQuestions(llm, plan, qctx, {
      avoid: kit.questions.filter((q) => q.category !== category || isPreserved(q.meta)).map((q) => q.prompt),
      label: `regenerate:${category}`,
    });
    mergeRegeneratedCategory(kit, category, drafts, genId);
    added = drafts.length;
  }

  const v = validateKit(kit);
  if (!v.ok) throw new PrepError("VALIDATION_FAILED", `Regenerated kit failed validation: ${v.errors.slice(0, 3).join("; ")}`);
  return { kit: v.kit!, kept, added };
}
