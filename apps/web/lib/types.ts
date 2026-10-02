export type { Kit, Question, Flashcard, Requirement, QuestionCategory, ScheduleDay, ItemMeta } from "@prepkit/core/src/kit/schema";
import type { Kit } from "@prepkit/core/src/kit/schema";

export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface ProgressEvent {
  step: string;
  status: "running" | "done" | "skipped" | "failed";
  message: string;
  at: string;
}

export interface KitSummary {
  id: string;
  title: string;
  status: KitStatus;
  error: { code: string; message: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  company: string;
  days: number;
  questionCount: number;
  uncoveredMust: number;
}

export interface KitRecord {
  id: string;
  title: string;
  status: KitStatus;
  input: { jd: string; company_url: string; days: number };
  kit: Kit | null;
  events: ProgressEvent[];
  error: { code: string; message: string } | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Readiness {
  requirementId: string;
  text: string;
  priority: "must" | "nice";
  status: "red" | "amber" | "green";
  questions: number;
  cards: number;
  cardsPractised: number;
  avgConfidence: number | null;
  reason: string;
}

export interface PracticeState {
  order: string[];
  records: Array<{ cardId: string; confidence: 1 | 2 | 3; reviews: number; lastReviewedAt: string }>;
  progress: { total: number; covered: number; confident: number; shaky: number; weak: number; remaining: number };
  readiness: Readiness[];
}
