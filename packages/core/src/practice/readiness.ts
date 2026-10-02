import type { Kit } from "../kit/schema.js";
import type { PracticeRecord } from "./practice.js";

export type Readiness = "red" | "amber" | "green";

export interface RequirementReadiness {
  requirementId: string;
  text: string;
  priority: "must" | "nice";
  status: Readiness;
  questions: number;
  cards: number;
  cardsPractised: number;
  avgConfidence: number | null;
  reason: string;
}

/**
 * Creative feature — the readiness gap report. Answers "if they ask me about
 * X tomorrow, am I ready?" per requirement, from data the kit already has
 * (coverage + practice confidence), with no model call:
 *   red    no question, nothing practised, or average confidence < 1.75
 *   amber  partly practised (< all cards) or average confidence < 2.5
 *   green  every linked card practised with average confidence ≥ 2.5
 * Sorted must-haves first, worst first — so it doubles as "what to do next".
 */
export function readinessReport(kit: Kit, records: PracticeRecord[]): RequirementReadiness[] {
  const rec = new Map(records.map((r) => [r.cardId, r]));
  const rank: Record<Readiness, number> = { red: 0, amber: 1, green: 2 };
  return kit.role.requirements
    .map((r) => {
      const qs = kit.questions.filter((q) => q.requirement_ids.includes(r.id)).length;
      const cards = kit.flashcards.filter((f) => f.requirement_ids.includes(r.id));
      const practised = cards.map((c) => rec.get(c.id)).filter((x): x is PracticeRecord => !!x);
      const avg = practised.length ? practised.reduce((s, p) => s + p.confidence, 0) / practised.length : null;
      let status: Readiness;
      let reason: string;
      if (!qs && !cards.length) {
        status = "red";
        reason = "No question or flashcard covers this yet";
      } else if (!practised.length) {
        status = "red";
        reason = cards.length ? "Not practised yet" : "No flashcard — practise the linked questions";
      } else if (avg! < 1.75) {
        status = "red";
        reason = "You marked these cards as not known";
      } else if (practised.length < cards.length || avg! < 2.5) {
        status = "amber";
        reason = practised.length < cards.length ? `${cards.length - practised.length} card(s) still unpractised` : "Confidence is shaky";
      } else {
        status = "green";
        reason = "Practised with confidence";
      }
      return { requirementId: r.id, text: r.text, priority: r.priority, status, questions: qs, cards: cards.length, cardsPractised: practised.length, avgConfidence: avg === null ? null : Math.round(avg * 100) / 100, reason };
    })
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "must" ? -1 : 1) || rank[a.status] - rank[b.status]);
}
