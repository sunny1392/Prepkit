import type { Flashcard, ItemMeta, Kit, Question, QuestionCategory } from "./schema.js";
import { computeCoverage } from "../coverage/coverage.js";
import { allocateSchedule } from "../schedule/allocate.js";
import { nextId } from "../util/text.js";
import { PrepError } from "../util/errors.js";

/**
 * Pure kit mutations used by the API (and tested directly). Every editable
 * item carries meta { origin, edited, pinned }:
 *   origin  "generated" | "user" | "fallback"
 *   edited  true once the user changes it by hand
 *   pinned  explicit "keep this through regeneration"
 * An item is PRESERVED by regeneration if origin==="user" || edited || pinned.
 * Regeneration replaces only un-touched generated/fallback items of the
 * section being regenerated; every other section is left byte-for-byte alone.
 */

const now = () => new Date().toISOString();

/** Allocate the next id for questions ("q") or flashcards ("f"); never reuses a deleted id. */
export function allocId(kit: Kit, prefix: "q" | "f"): string {
  const list = prefix === "q" ? kit.questions.map((q) => q.id) : kit.flashcards.map((f) => f.id);
  const seq = kit.id_seq ?? { q: 0, f: 0 };
  const id = nextId(prefix, list, seq[prefix]);
  seq[prefix] = Number(id.slice(1));
  kit.id_seq = seq;
  return id;
}

export function meta(origin: ItemMeta["origin"], generation_id: string): ItemMeta {
  return { origin, edited: false, pinned: false, generation_id, updated_at: now() };
}

export function isPreserved(m: ItemMeta | undefined): boolean {
  return !!m && (m.origin === "user" || m.edited || m.pinned);
}

const touch = (m: ItemMeta | undefined, patch: Partial<ItemMeta> = { edited: true }): ItemMeta => ({
  ...(m ?? meta("generated", "unknown")),
  ...patch,
  updated_at: now(),
});

/** Recompute derived fields after any mutation. */
export function refreshDerived(kit: Kit): Kit {
  const qIds = new Set(kit.questions.map((q) => q.id));
  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  for (const q of kit.questions) q.requirement_ids = q.requirement_ids.filter((r) => reqIds.has(r));
  for (const f of kit.flashcards) f.requirement_ids = f.requirement_ids.filter((r) => reqIds.has(r));
  for (const d of kit.schedule.days) d.question_ids = d.question_ids.filter((id) => qIds.has(id));
  kit.coverage.uncovered_requirement_ids = computeCoverage(kit.role.requirements, kit.questions).uncovered;
  return kit;
}

/** Re-run the deterministic allocator unless the user has edited or pinned the schedule. */
function maybeReschedule(kit: Kit): Kit {
  if (isPreserved(kit.schedule.meta)) {
    // Keep the user's schedule; just make sure newly added questions are somewhere.
    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    const missing = kit.questions.filter((q) => !scheduled.has(q.id));
    if (missing.length && kit.schedule.days.length) {
      const last = kit.schedule.days[kit.schedule.days.length - 1];
      last.question_ids.push(...missing.map((q) => q.id));
    }
    return kit;
  }
  const s = allocateSchedule({ questions: kit.questions, requirements: kit.role.requirements, days: kit.schedule.days_available });
  kit.schedule = { ...s, meta: kit.schedule.meta };
  return kit;
}

function findQuestion(kit: Kit, id: string): Question {
  const q = kit.questions.find((x) => x.id === id);
  if (!q) throw new PrepError("NOT_FOUND", `Question ${id} not found.`);
  return q;
}
function findCard(kit: Kit, id: string): Flashcard {
  const f = kit.flashcards.find((x) => x.id === id);
  if (!f) throw new PrepError("NOT_FOUND", `Flashcard ${id} not found.`);
  return f;
}

// ---------- questions ----------

export type QuestionPatch = Partial<Pick<Question, "prompt" | "answer_outline" | "difficulty" | "requirement_ids" | "category">>;

export function editQuestion(kit: Kit, id: string, patch: QuestionPatch): Kit {
  const q = findQuestion(kit, id);
  Object.assign(q, patch);
  q.meta = touch(q.meta);
  return refreshDerived(kit);
}

export function addQuestion(kit: Kit, draft: Omit<Question, "id" | "meta">): Kit {
  const id = allocId(kit, "q");
  kit.questions.push({ ...draft, id, meta: meta("user", "user") });
  return maybeReschedule(refreshDerived(kit));
}

/** Record current max ids before removing anything, so they are never reissued. */
function bumpSeq(kit: Kit): void {
  const max = (ids: string[], p: string) => ids.reduce((m, id) => Math.max(m, Number(id.match(new RegExp(`^${p}(\\d+)$`))?.[1] ?? 0)), 0);
  const seq = kit.id_seq ?? { q: 0, f: 0 };
  kit.id_seq = { q: Math.max(seq.q, max(kit.questions.map((q) => q.id), "q")), f: Math.max(seq.f, max(kit.flashcards.map((f) => f.id), "f")) };
}

export function deleteQuestion(kit: Kit, id: string): Kit {
  findQuestion(kit, id);
  bumpSeq(kit);
  kit.questions = kit.questions.filter((q) => q.id !== id);
  return refreshDerived(kit);
}

export function setPinned(kit: Kit, kind: "question" | "flashcard", id: string, pinned: boolean): Kit {
  const item = kind === "question" ? findQuestion(kit, id) : findCard(kit, id);
  item.meta = touch(item.meta, { pinned });
  return kit;
}

/**
 * Move a question to `category` at position `index` within that category's
 * list (the global array keeps category-relative order). Moving or reordering
 * counts as a hand edit, so the question survives regeneration.
 */
export function moveQuestion(kit: Kit, id: string, category: QuestionCategory, index: number): Kit {
  const q = findQuestion(kit, id);
  const rest = kit.questions.filter((x) => x.id !== id);
  q.category = category;
  q.meta = touch(q.meta);
  const inCat = rest.filter((x) => x.category === category);
  const clamped = Math.max(0, Math.min(index, inCat.length));
  let insertAt: number;
  if (inCat.length === 0) insertAt = rest.length;
  else if (clamped === inCat.length) insertAt = rest.indexOf(inCat[inCat.length - 1]) + 1;
  else insertAt = rest.indexOf(inCat[clamped]);
  rest.splice(insertAt, 0, q);
  kit.questions = rest;
  return refreshDerived(kit);
}

/** Reorder the questions of one category to `orderedIds` (must be a permutation). */
export function reorderCategory(kit: Kit, category: QuestionCategory, orderedIds: string[]): Kit {
  const slots = kit.questions.map((q, i) => (q.category === category ? i : -1)).filter((i) => i >= 0);
  const current = slots.map((i) => kit.questions[i].id);
  if (current.length !== orderedIds.length || [...current].sort().join() !== [...orderedIds].sort().join()) {
    throw new PrepError("BAD_REORDER", "Reorder ids must be exactly the questions in that category.");
  }
  const byId = new Map(kit.questions.map((q) => [q.id, q]));
  orderedIds.forEach((id, k) => {
    const q = byId.get(id)!;
    if (current[k] !== id) q.meta = touch(q.meta);
    kit.questions[slots[k]] = q;
  });
  return kit;
}

// ---------- flashcards ----------

export function editFlashcard(kit: Kit, id: string, patch: Partial<Pick<Flashcard, "front" | "back" | "requirement_ids">>): Kit {
  const f = findCard(kit, id);
  Object.assign(f, patch);
  f.meta = touch(f.meta);
  return refreshDerived(kit);
}
export function addFlashcard(kit: Kit, draft: Omit<Flashcard, "id" | "meta">): Kit {
  kit.flashcards.push({ ...draft, id: allocId(kit, "f"), meta: meta("user", "user") });
  return refreshDerived(kit);
}
export function deleteFlashcard(kit: Kit, id: string): Kit {
  findCard(kit, id);
  bumpSeq(kit);
  kit.flashcards = kit.flashcards.filter((f) => f.id !== id);
  return kit;
}
export function reorderFlashcards(kit: Kit, orderedIds: string[]): Kit {
  const byId = new Map(kit.flashcards.map((f) => [f.id, f]));
  if (orderedIds.length !== kit.flashcards.length || orderedIds.some((id) => !byId.has(id))) {
    throw new PrepError("BAD_REORDER", "Reorder ids must be exactly the kit's flashcards.");
  }
  kit.flashcards = orderedIds.map((id) => byId.get(id)!);
  return kit;
}

// ---------- brief & schedule ----------

export function editBrief(kit: Kit, patch: Partial<Pick<Kit["company_brief"], "summary" | "what_they_do">>): Kit {
  Object.assign(kit.company_brief, patch);
  kit.company_brief.meta = touch(kit.company_brief.meta);
  return kit;
}
export function setBriefPinned(kit: Kit, pinned: boolean): Kit {
  kit.company_brief.meta = touch(kit.company_brief.meta, { pinned });
  return kit;
}

export function editScheduleDay(kit: Kit, day: number, patch: { focus?: string; minutes?: number; question_ids?: string[] }): Kit {
  const d = kit.schedule.days.find((x) => x.day === day);
  if (!d) throw new PrepError("NOT_FOUND", `Day ${day} not found.`);
  if (patch.minutes !== undefined) patch.minutes = Math.max(0, Math.round(patch.minutes));
  Object.assign(d, patch);
  kit.schedule.meta = touch(kit.schedule.meta);
  return refreshDerived(kit);
}

// ---------- regeneration merges ----------

/**
 * Replace one question category with freshly generated drafts, keeping every
 * preserved question (user-written, edited, pinned) in its current position.
 * New questions get fresh ids (never reused, so practice history stays valid)
 * and are appended after the kept ones. Other categories are untouched.
 */
export function mergeRegeneratedCategory(kit: Kit, category: QuestionCategory, drafts: Array<Omit<Question, "id" | "meta">>, generationId: string): Kit {
  bumpSeq(kit);
  const kept = kit.questions.filter((q) => q.category !== category || isPreserved(q.meta));
  const keptPrompts = new Set(kept.map((q) => q.prompt.trim().toLowerCase()));
  const fresh: Question[] = [];
  for (const d of drafts) {
    if (keptPrompts.has(d.prompt.trim().toLowerCase())) continue;
    const id = allocId(kit, "q");
    fresh.push({ ...d, category, id, meta: meta("generated", generationId) });
  }
  // Insert new items right after the last kept item of this category (or at the end).
  const lastIdx = kept.map((q) => q.category).lastIndexOf(category);
  kit.questions = lastIdx >= 0 ? [...kept.slice(0, lastIdx + 1), ...fresh, ...kept.slice(lastIdx + 1)] : [...kept, ...fresh];
  return maybeReschedule(refreshDerived(kit));
}

export function mergeRegeneratedFlashcards(kit: Kit, drafts: Array<Omit<Flashcard, "id" | "meta">>, generationId: string): Kit {
  bumpSeq(kit);
  const kept = kit.flashcards.filter((f) => isPreserved(f.meta));
  const fresh: Flashcard[] = [];
  for (const d of drafts) {
    const id = allocId(kit, "f");
    fresh.push({ ...d, id, meta: meta("generated", generationId) });
  }
  kit.flashcards = [...kept, ...fresh];
  return refreshDerived(kit);
}

export function assertBriefRegenerable(kit: Kit, force: boolean): void {
  const m = kit.company_brief.meta;
  if (m?.pinned) throw new PrepError("PINNED", "The company brief is pinned. Unpin it to regenerate.");
  if (m?.edited && !force) throw new PrepError("EDITED", "The company brief has hand edits that regeneration would replace. Confirm to continue.");
}

export function mergeRegeneratedBrief(kit: Kit, brief: { summary: string; what_they_do: string; sources: string[] }, generationId: string): Kit {
  kit.company_brief = { ...brief, meta: meta("generated", generationId) };
  return kit;
}

export function regenerateSchedule(kit: Kit, days?: number): Kit {
  if (kit.schedule.meta?.pinned) throw new PrepError("PINNED", "The schedule is pinned. Unpin it to regenerate.");
  const d = days ?? kit.schedule.days_available;
  const s = allocateSchedule({ questions: kit.questions, requirements: kit.role.requirements, days: d });
  kit.schedule = { ...s, meta: meta("generated", `sched-${Date.now().toString(36)}`) };
  return refreshDerived(kit);
}
