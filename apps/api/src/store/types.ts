import type { Kit, PracticeRecord, ProgressEvent, ResearchContext } from "@prepkit/core";

export type KitStatus = "queued" | "running" | "ready" | "failed";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface KitRecord {
  id: string;
  userId: string;
  title: string;
  inputHash: string;
  input: { jd: string; company_url: string; days: number };
  status: KitStatus;
  kit: Kit | null;
  /** Research material kept for section regeneration (not part of the kit). */
  context: (ResearchContext & Record<string, unknown>) | null;
  events: ProgressEvent[];
  error: { code: string; message: string } | null;
  /** Optimistic-concurrency counter, bumped on every kit write. */
  version: number;
  practice: PracticeRecord[];
  createdAt: string;
  updatedAt: string;
}

export type KitSummary = Pick<KitRecord, "id" | "title" | "status" | "error" | "version" | "createdAt" | "updatedAt"> & {
  company: string;
  days: number;
  questionCount: number;
  uncoveredMust: number;
};

export interface Store {
  createUser(email: string, passwordHash: string): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;

  createKit(rec: Omit<KitRecord, "id" | "createdAt" | "updatedAt">): Promise<KitRecord>;
  getKit(id: string, userId: string): Promise<KitRecord | null>;
  getKitById(id: string): Promise<KitRecord | null>;
  listKits(userId: string): Promise<KitRecord[]>;
  findActiveByHash(userId: string, hash: string): Promise<KitRecord | null>;
  /**
   * Patch a kit record. If expectedVersion is given the write only happens when
   * the stored version still matches (atomic compare-and-set); returns null on
   * a mismatch. Writes that include `kit` bump the version.
   */
  updateKit(id: string, patch: Partial<KitRecord>, expectedVersion?: number): Promise<KitRecord | null>;
  pushEvent(id: string, e: ProgressEvent): Promise<void>;
  deleteKit(id: string, userId: string): Promise<boolean>;
  listUnfinished(): Promise<KitRecord[]>;
}
