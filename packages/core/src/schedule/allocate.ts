import type { Question, QuestionCategory, Requirement, ScheduleDay } from "../kit/schema.js";

export const MIN_DAYS = 1;
export const MAX_DAYS = 90;

/** Integer study minutes for first working through a question, by difficulty. */
export const MINUTES_BY_DIFFICULTY: Record<1 | 2 | 3, number> = { 1: 10, 2: 20, 3: 30 };
/** Integer minutes to revisit a question on a review day. */
export const REVIEW_MINUTES = 5;
/** Spaced-review offsets (days after first study) preferred on review days. */
const REVIEW_OFFSETS = [1, 3, 7, 14, 30];

const CATEGORY_LABEL: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

type Q = Pick<Question, "id" | "requirement_ids" | "category" | "difficulty">;

/** Priority score: must-have first, then harder, then system design (usually the longest prep). */
export function questionPriority(q: Q, mustIds: Set<string>): number {
  const must = q.requirement_ids.some((id) => mustIds.has(id));
  return (must ? 100 : 0) + q.difficulty * 10 + (q.category === "system-design" ? 1 : 0);
}

function focusFor(qs: Q[], reqById: Map<string, Requirement>, review = false): string {
  if (!qs.length) return review ? "Light review" : "Company research and role review";
  const counts = new Map<QuestionCategory, number>();
  for (const q of qs) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => CATEGORY_LABEL[c]);
  const topics: string[] = [];
  for (const q of qs) {
    for (const rid of q.requirement_ids) {
      const t = reqById.get(rid)?.text;
      if (t && !topics.includes(t)) topics.push(t.length > 40 ? `${t.slice(0, 37)}…` : t);
    }
  }
  const label = top.slice(0, 2).join(" + ");
  const topicStr = topics.length ? ` — ${topics.slice(0, 2).join(", ")}` : "";
  return `${review ? "Review: " : ""}${label}${topicStr}`;
}

/**
 * Split an ordered list into `n` contiguous chunks with roughly equal minutes,
 * each chunk non-empty. Order is preserved, so the highest-priority material
 * lands on the earliest days.
 */
function chunkByMinutes(items: Q[], n: number): Q[][] {
  const chunks: Q[][] = [];
  let i = 0;
  let remainingMin = items.reduce((s, q) => s + MINUTES_BY_DIFFICULTY[q.difficulty as 1 | 2 | 3], 0);
  for (let d = 0; d < n; d++) {
    const daysLeft = n - d;
    const target = remainingMin / daysLeft;
    const chunk: Q[] = [];
    let mins = 0;
    while (i < items.length) {
      const itemsLeftAfter = items.length - i - 1;
      const m = MINUTES_BY_DIFFICULTY[items[i].difficulty as 1 | 2 | 3];
      const mustLeaveOneEach = itemsLeftAfter < daysLeft - 1;
      if (chunk.length > 0 && (mustLeaveOneEach || mins + m / 2 > target)) break;
      chunk.push(items[i]);
      mins += m;
      i++;
    }
    remainingMin -= mins;
    chunks.push(chunk);
  }
  return chunks;
}

export interface ScheduleInput {
  questions: Q[];
  requirements: Requirement[];
  days: number;
}

/**
 * Deterministic schedule allocation (no model involved).
 *
 * 1. Order questions by priority (must-have → harder → system design).
 * 2. Choose study days: if there are at least as many questions as days, every
 *    day is a study day; otherwise the first ceil(days/2) days (at most one per
 *    question) are study days and the rest are review days.
 * 3. Split the ordered questions into contiguous, minute-balanced chunks over
 *    the study days, so hard/must material is studied first, never the night before.
 * 4. Review days revisit questions on a spaced schedule (1, 3, 7, 14, 30 days
 *    after first study), must-haves first, so every day has real content.
 * 5. With ≥3 days, the final day also re-runs the top must-have questions.
 *
 * Guarantees (tested): exactly `days` days; every question appears at least
 * once; minutes are integers; day numbers are 1..days.
 */
export function allocateSchedule(input: ScheduleInput): { days_available: number; days: ScheduleDay[] } {
  const days = Math.trunc(input.days);
  if (!Number.isFinite(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(`days must be an integer between ${MIN_DAYS} and ${MAX_DAYS} (got ${input.days})`);
  }
  const mustIds = new Set(input.requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const reqById = new Map(input.requirements.map((r) => [r.id, r]));
  const order = new Map(input.questions.map((q, i) => [q.id, i]));
  const sorted = [...input.questions].sort((a, b) => questionPriority(b, mustIds) - questionPriority(a, mustIds) || order.get(a.id)! - order.get(b.id)!);

  if (!sorted.length) {
    return {
      days_available: days,
      days: Array.from({ length: days }, (_, i) => ({ day: i + 1, focus: focusFor([], reqById, i > 0), question_ids: [], minutes: 30 })),
    };
  }

  const studyDays = sorted.length >= days ? days : Math.min(sorted.length, Math.max(1, Math.ceil(days / 2)));
  const chunks = chunkByMinutes(sorted, studyDays);
  const firstDay = new Map<string, number>();
  chunks.forEach((c, d) => c.forEach((q) => firstDay.set(q.id, d + 1)));
  const reviewCount = new Map<string, number>(sorted.map((q) => [q.id, 0]));

  const out: ScheduleDay[] = [];
  for (let d = 1; d <= days; d++) {
    if (d <= studyDays) {
      const qs = chunks[d - 1];
      const ids = qs.map((q) => q.id);
      let minutes = qs.reduce((s, q) => s + MINUTES_BY_DIFFICULTY[q.difficulty as 1 | 2 | 3], 0);
      // Final day of a multi-day plan: also revisit the top must-haves studied earlier.
      if (d === days && days >= 3) {
        const extra = sorted.filter((q) => firstDay.get(q.id)! < d && q.requirement_ids.some((r) => mustIds.has(r))).slice(0, 3);
        for (const q of extra) {
          ids.push(q.id);
          minutes += REVIEW_MINUTES;
        }
      }
      out.push({ day: d, focus: focusFor(qs, reqById), question_ids: ids, minutes });
      continue;
    }
    // Review day: due questions by spaced offsets, then least-reviewed must-haves.
    const perDay = Math.min(8, Math.max(2, Math.ceil(sorted.length / Math.max(1, days - studyDays)) + 1));
    const due = sorted.filter((q) => REVIEW_OFFSETS.includes(d - firstDay.get(q.id)!));
    const rest = [...sorted].sort((a, b) => reviewCount.get(a.id)! - reviewCount.get(b.id)! || questionPriority(b, mustIds) - questionPriority(a, mustIds));
    const pick: Q[] = [];
    for (const q of [...due, ...rest]) {
      if (pick.length >= perDay) break;
      if (!pick.includes(q)) pick.push(q);
    }
    pick.forEach((q) => reviewCount.set(q.id, reviewCount.get(q.id)! + 1));
    out.push({ day: d, focus: focusFor(pick, reqById, true), question_ids: pick.map((q) => q.id), minutes: Math.max(15, pick.length * REVIEW_MINUTES * 2) });
  }
  return { days_available: days, days: out };
}
