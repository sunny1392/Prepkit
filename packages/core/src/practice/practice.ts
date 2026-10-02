import type { Flashcard } from "../kit/schema.js";

export type Confidence = 1 | 2 | 3; // 1 = didn't know it, 2 = shaky, 3 = confident

export interface PracticeRecord {
  cardId: string;
  confidence: Confidence;
  reviews: number;
  lastReviewedAt: string;
}

/**
 * Next-session order — a confidence-weighted sort, deliberately not full
 * spaced repetition: interview prep spans days, not months, so the useful
 * question is "what am I worst at right now", not "when is this due".
 *   1. cards never seen (unknown confidence is the biggest risk)
 *   2. then lowest confidence first
 *   3. ties: least recently reviewed first, then kit order
 */
export function orderSession<C extends Pick<Flashcard, "id">>(cards: C[], records: PracticeRecord[]): C[] {
  const rec = new Map(records.map((r) => [r.cardId, r]));
  const idx = new Map(cards.map((c, i) => [c.id, i]));
  return [...cards].sort((a, b) => {
    const ra = rec.get(a.id);
    const rb = rec.get(b.id);
    const ca = ra?.confidence ?? 0;
    const cb = rb?.confidence ?? 0;
    if (ca !== cb) return ca - cb;
    const ta = ra ? Date.parse(ra.lastReviewedAt) : 0;
    const tb = rb ? Date.parse(rb.lastReviewedAt) : 0;
    if (ta !== tb) return ta - tb;
    return idx.get(a.id)! - idx.get(b.id)!;
  });
}

export function applyReview(records: PracticeRecord[], cardId: string, confidence: Confidence, at = new Date()): PracticeRecord[] {
  const existing = records.find((r) => r.cardId === cardId);
  const updated: PracticeRecord = { cardId, confidence, reviews: (existing?.reviews ?? 0) + 1, lastReviewedAt: at.toISOString() };
  return [...records.filter((r) => r.cardId !== cardId), updated];
}

export function practiceProgress(cards: Pick<Flashcard, "id">[], records: PracticeRecord[]) {
  const ids = new Set(cards.map((c) => c.id));
  const live = records.filter((r) => ids.has(r.cardId));
  return {
    total: cards.length,
    covered: live.length,
    confident: live.filter((r) => r.confidence === 3).length,
    shaky: live.filter((r) => r.confidence === 2).length,
    weak: live.filter((r) => r.confidence === 1).length,
    remaining: cards.length - live.length,
  };
}
