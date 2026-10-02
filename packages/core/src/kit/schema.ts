import { z } from "zod";

/**
 * Kit structure — Appendix A of the brief, field names exact.
 * Extensions (all optional, additive): `meta` on editable items, `evidence` on
 * requirements, `interview_process` + `research` at the top level.
 */

export const QUESTION_CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];

/** Generated / edited / pinned state carried by every editable item. */
export const ItemMetaSchema = z.object({
  origin: z.enum(["generated", "user", "fallback"]),
  edited: z.boolean(),
  pinned: z.boolean(),
  generation_id: z.string(),
  updated_at: z.string(),
});
export type ItemMeta = z.infer<typeof ItemMetaSchema>;

const intMinutes = z.number().int().nonnegative();

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
  evidence: z.string().optional(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  meta: ItemMetaSchema.optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string(),
  requirement_ids: z.array(z.string()),
  meta: ItemMetaSchema.optional(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: intMinutes,
});
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;

export const InterviewStageSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: z.string().optional(),
});

export const KitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().nonnegative(),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
    meta: ItemMetaSchema.optional(),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: z.object({
    days_available: z.number().int().min(1),
    days: z.array(ScheduleDaySchema),
    meta: ItemMetaSchema.optional(),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().nonnegative(),
  }),
  // ---- extensions ----
  interview_process: z
    .object({ found: z.boolean(), stages: z.array(InterviewStageSchema), sources: z.array(z.string()) })
    .optional(),
  research: z
    .object({
      notes: z.array(z.string()),
      skipped_sources: z.array(z.object({ url: z.string(), reason: z.string() })),
      discussion_sources: z.array(z.string()),
      thin_jd: z.boolean(),
      hiring_page_found: z.boolean(),
      llm_calls: z.number().int().nonnegative(),
    })
    .optional(),
});
export type Kit = z.infer<typeof KitSchema>;
