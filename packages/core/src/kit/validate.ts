import { KitSchema, type Kit } from "./schema.js";

export interface KitValidationResult {
  ok: boolean;
  errors: string[];
  kit?: Kit;
}

/**
 * Structural (Zod) + referential validation of a kit. Run before every save
 * and before every batch output. Pure function — no I/O.
 */
export function validateKit(input: unknown): KitValidationResult {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const kit = parsed.data;
  const errors: string[] = [];

  const dupes = (ids: string[], label: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${label} id "${id}"`);
      seen.add(id);
    }
    return seen;
  };

  const reqIds = dupes(kit.role.requirements.map((r) => r.id), "requirement");
  const qIds = dupes(kit.questions.map((q) => q.id), "question");
  dupes(kit.flashcards.map((f) => f.id), "flashcard");

  for (const q of kit.questions) {
    for (const rid of q.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`question ${q.id} references unknown requirement "${rid}"`);
    }
  }
  for (const f of kit.flashcards) {
    for (const rid of f.requirement_ids) {
      if (!reqIds.has(rid)) errors.push(`flashcard ${f.id} references unknown requirement "${rid}"`);
    }
  }

  const s = kit.schedule;
  if (s.days.length !== s.days_available) {
    errors.push(`schedule has ${s.days.length} days but days_available is ${s.days_available}`);
  }
  s.days.forEach((d, i) => {
    if (d.day !== i + 1) errors.push(`schedule day at index ${i} is numbered ${d.day}, expected ${i + 1}`);
    for (const qid of d.question_ids) {
      if (!qIds.has(qid)) errors.push(`schedule day ${d.day} references unknown question "${qid}"`);
    }
  });

  for (const rid of kit.coverage.uncovered_requirement_ids) {
    if (!reqIds.has(rid)) errors.push(`coverage lists unknown requirement "${rid}"`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], kit };
}
