import { createHash } from "node:crypto";
import {
  addFlashcard, addQuestion, applyReview, applySectionDrafts, deleteFlashcard, deleteQuestion, editBrief, editFlashcard, editQuestion,
  editScheduleDay, generateSectionDrafts, moveQuestion, orderSession, parseSection, practiceProgress, PrepError, readinessReport,
  reorderCategory, reorderFlashcards, setBriefPinned, setPinned, validateInput, validateKit, llmFromEnv, MAX_DAYS, MIN_DAYS,
  QUESTION_CATEGORIES, computeCoverage, type Kit, type LLMClient, type Confidence,
} from "@prepkit/core";
import { z } from "zod";
import type { JobRunner } from "./jobs.js";
import type { KitRecord, KitSummary, Store } from "../store/types.js";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const normUrl = (s: string) => norm(s).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

/** Same description + same company ⇒ same hash (days excluded: it's the same posting). */
export function inputHash(userId: string, jd: string, companyUrl: string): string {
  return createHash("sha256").update(`${userId}\n${norm(jd)}\n${normUrl(companyUrl)}`).digest("hex");
}

export const CreateKitBody = z.object({
  jd: z.string().min(10, "Paste the job description").max(60_000),
  company_url: z.string().min(3, "Enter the company website").max(2000),
  days: z.coerce.number().int().min(MIN_DAYS).max(MAX_DAYS),
  /** Create a new kit even if this posting was already submitted. */
  force: z.boolean().optional(),
});

const Cat = z.enum(QUESTION_CATEGORIES);
const RidList = z.array(z.string().max(20)).max(50);
const Text = (max: number) => z.string().max(max);

/** Every builder mutation is one typed operation, applied by a pure function from @prepkit/core. */
export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("editQuestion"), id: z.string(), patch: z.object({ prompt: Text(2000).min(1).optional(), answer_outline: Text(5000).optional(), difficulty: z.number().int().min(1).max(3).optional(), requirement_ids: RidList.optional(), category: Cat.optional() }) }),
  z.object({ op: z.literal("addQuestion"), question: z.object({ category: Cat, prompt: Text(2000).min(1), answer_outline: Text(5000).default(""), difficulty: z.number().int().min(1).max(3).default(2), requirement_ids: RidList.default([]) }) }),
  z.object({ op: z.literal("deleteQuestion"), id: z.string() }),
  z.object({ op: z.literal("moveQuestion"), id: z.string(), category: Cat, index: z.number().int().min(0) }),
  z.object({ op: z.literal("reorderCategory"), category: Cat, ids: z.array(z.string()).max(500) }),
  z.object({ op: z.literal("pin"), kind: z.enum(["question", "flashcard"]), id: z.string(), pinned: z.boolean() }),
  z.object({ op: z.literal("editFlashcard"), id: z.string(), patch: z.object({ front: Text(1000).min(1).optional(), back: Text(3000).optional(), requirement_ids: RidList.optional() }) }),
  z.object({ op: z.literal("addFlashcard"), card: z.object({ front: Text(1000).min(1), back: Text(3000).default(""), requirement_ids: RidList.default([]) }) }),
  z.object({ op: z.literal("deleteFlashcard"), id: z.string() }),
  z.object({ op: z.literal("reorderFlashcards"), ids: z.array(z.string()).max(500) }),
  z.object({ op: z.literal("editBrief"), patch: z.object({ summary: Text(5000).optional(), what_they_do: Text(3000).optional() }) }),
  z.object({ op: z.literal("pinBrief"), pinned: z.boolean() }),
  z.object({ op: z.literal("editScheduleDay"), day: z.number().int().min(1), patch: z.object({ focus: Text(300).optional(), minutes: z.number().int().min(0).max(1440).optional(), question_ids: z.array(z.string()).max(200).optional() }) }),
  z.object({ op: z.literal("pinSchedule"), pinned: z.boolean() }),
]);
export type Op = z.infer<typeof OpSchema>;

function applyOp(kit: Kit, op: Op): Kit {
  switch (op.op) {
    case "editQuestion": return editQuestion(kit, op.id, op.patch);
    case "addQuestion": return addQuestion(kit, op.question);
    case "deleteQuestion": return deleteQuestion(kit, op.id);
    case "moveQuestion": return moveQuestion(kit, op.id, op.category, op.index);
    case "reorderCategory": return reorderCategory(kit, op.category, op.ids);
    case "pin": return setPinned(kit, op.kind, op.id, op.pinned);
    case "editFlashcard": return editFlashcard(kit, op.id, op.patch);
    case "addFlashcard": return addFlashcard(kit, op.card);
    case "deleteFlashcard": return deleteFlashcard(kit, op.id);
    case "reorderFlashcards": return reorderFlashcards(kit, op.ids);
    case "editBrief": return editBrief(kit, op.patch);
    case "pinBrief": return setBriefPinned(kit, op.pinned);
    case "editScheduleDay": return editScheduleDay(kit, op.day, op.patch);
    case "pinSchedule": {
      kit.schedule.meta = { ...(kit.schedule.meta ?? { origin: "generated", edited: false, generation_id: "unknown", updated_at: "" }), pinned: op.pinned, updated_at: new Date().toISOString() };
      return kit;
    }
  }
}

export function summarise(r: KitRecord): KitSummary {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    error: r.error,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    company: r.kit?.source.company ?? r.input.company_url,
    days: r.input.days,
    questionCount: r.kit?.questions.length ?? 0,
    uncoveredMust: r.kit ? computeCoverage(r.kit.role.requirements, r.kit.questions).uncoveredMust.length : 0,
  };
}

export function publicKit(r: KitRecord) {
  const { context: _c, inputHash: _h, ...rest } = r;
  return rest;
}

export class KitService {
  private regenLocks = new Set<string>();
  private llm: LLMClient | null = null;

  constructor(
    private store: Store,
    private jobs: JobRunner,
    private llmFactory: () => LLMClient = llmFromEnv,
  ) {}

  private getLLM() {
    if (!this.llm) this.llm = this.llmFactory();
    return this.llm;
  }

  async mustGet(id: string, userId: string): Promise<KitRecord> {
    const k = await this.store.getKit(id, userId);
    if (!k) throw new PrepError("NOT_FOUND", "Kit not found."); // also for other users' kits: don't leak existence
    return k;
  }

  /** Create (or dedupe) a kit and queue generation. */
  async create(userId: string, body: z.infer<typeof CreateKitBody>): Promise<{ kit: KitRecord; deduped: boolean }> {
    const input = validateInput(body);
    const hash = inputHash(userId, input.jd, input.company_url);
    if (!body.force) {
      const existing = await this.store.findActiveByHash(userId, hash);
      if (existing) return { kit: existing, deduped: true };
    }
    const firstLine = input.jd.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? "New kit";
    const rec = await this.store.createKit({
      userId, title: firstLine, inputHash: hash, input, status: "queued", kit: null, context: null,
      events: [{ step: "queued", status: "running", message: "Waiting for a generation slot", at: new Date().toISOString() }],
      error: null, version: 0, practice: [],
    });
    this.jobs.enqueue(rec.id);
    return { kit: rec, deduped: false };
  }

  async retry(id: string, userId: string) {
    const k = await this.mustGet(id, userId);
    if (k.status !== "failed") throw new PrepError("BUSY", "Only a failed kit can be retried.");
    await this.store.updateKit(id, { status: "queued", error: null, events: [{ step: "queued", status: "running", message: "Retrying", at: new Date().toISOString() }] });
    this.jobs.enqueue(id);
    return this.mustGet(id, userId);
  }

  /**
   * Apply builder operations atomically with optimistic concurrency: the
   * client sends the version it last saw; if the stored kit has moved on
   * (another tab, a finished regeneration) we return 409 with the current
   * kit and the client rebases its pending edits.
   */
  async applyOps(id: string, userId: string, version: number, ops: Op[]) {
    const rec = await this.mustGet(id, userId);
    if (!rec.kit) throw new PrepError("NOT_READY", "This kit is still being generated.");
    if (rec.version !== version) throw new PrepError("VERSION_CONFLICT", "This kit changed since you loaded it.", { version: rec.version, kit: rec.kit });
    let kit = structuredClone(rec.kit);
    for (const op of ops) kit = applyOp(kit, op);
    const v = validateKit(kit);
    if (!v.ok) throw new PrepError("INVALID_INPUT", `That change would make the kit invalid: ${v.errors.slice(0, 3).join("; ")}`);
    const saved = await this.store.updateKit(id, { kit: v.kit! }, version);
    if (!saved) {
      const cur = await this.mustGet(id, userId);
      throw new PrepError("VERSION_CONFLICT", "This kit changed since you loaded it.", { version: cur.version, kit: cur.kit });
    }
    return saved;
  }

  /**
   * Regenerate one section. Two phases so edits are never clobbered:
   *  1. generate drafts from a snapshot (slow, model call, no lock on the kit);
   *  2. merge drafts into the LATEST stored kit with compare-and-set, retrying
   *     the merge if the user saved an edit in between.
   */
  async regenerate(id: string, userId: string, sectionRaw: string, force = false) {
    const section = parseSection(sectionRaw);
    const lock = `${id}:${section}`;
    if (this.regenLocks.has(lock)) throw new PrepError("BUSY", "That section is already being regenerated.");
    this.regenLocks.add(lock);
    try {
      const snap = await this.mustGet(id, userId);
      if (!snap.kit || !snap.context) throw new PrepError("NOT_READY", "This kit is still being generated.");
      const drafts = await generateSectionDrafts(snap.kit, snap.context, section, this.getLLM(), { force });
      for (let attempt = 0; attempt < 5; attempt++) {
        const latest = await this.mustGet(id, userId);
        const { kit, kept, added } = applySectionDrafts(latest.kit!, drafts, { force });
        const saved = await this.store.updateKit(id, { kit }, latest.version);
        if (saved) return { record: saved, kept, added, section };
      }
      throw new PrepError("VERSION_CONFLICT", "The kit kept changing during regeneration. Please try again.");
    } finally {
      this.regenLocks.delete(lock);
    }
  }

  async practiceState(id: string, userId: string) {
    const rec = await this.mustGet(id, userId);
    if (!rec.kit) throw new PrepError("NOT_READY", "This kit is still being generated.");
    return {
      order: orderSession(rec.kit.flashcards, rec.practice).map((c) => c.id),
      records: rec.practice,
      progress: practiceProgress(rec.kit.flashcards, rec.practice),
      readiness: readinessReport(rec.kit, rec.practice),
    };
  }

  async recordPractice(id: string, userId: string, cardId: string, confidence: Confidence) {
    const rec = await this.mustGet(id, userId);
    if (!rec.kit?.flashcards.some((f) => f.id === cardId)) throw new PrepError("NOT_FOUND", "Flashcard not found.");
    // Practice lives beside the kit, so regenerating sections never resets it.
    await this.store.updateKit(id, { practice: applyReview(rec.practice, cardId, confidence) });
    return this.practiceState(id, userId);
  }

  async resetPractice(id: string, userId: string) {
    await this.mustGet(id, userId);
    await this.store.updateKit(id, { practice: [] });
    return this.practiceState(id, userId);
  }
}
