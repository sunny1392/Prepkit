import { randomUUID } from "node:crypto";
import type { KitRecord, Store, UserRecord } from "./types.js";

/** In-memory store for tests and DB-less local runs. Same semantics as the Mongo store. */
export class MemoryStore implements Store {
  users = new Map<string, UserRecord>();
  kits = new Map<string, KitRecord>();
  private clone = <T>(x: T): T => structuredClone(x);

  async createUser(email: string, passwordHash: string) {
    if ([...this.users.values()].some((u) => u.email === email)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    const u = { id: randomUUID(), email, passwordHash, createdAt: new Date().toISOString() };
    this.users.set(u.id, u);
    return this.clone(u);
  }
  async findUserByEmail(email: string) {
    const u = [...this.users.values()].find((x) => x.email === email);
    return u ? this.clone(u) : null;
  }
  async findUserById(id: string) {
    const u = this.users.get(id);
    return u ? this.clone(u) : null;
  }
  async createKit(rec: Omit<KitRecord, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const k: KitRecord = { ...this.clone(rec), id: randomUUID(), createdAt: now, updatedAt: now };
    this.kits.set(k.id, k);
    return this.clone(k);
  }
  async getKit(id: string, userId: string) {
    const k = this.kits.get(id);
    return k && k.userId === userId ? this.clone(k) : null;
  }
  async getKitById(id: string) {
    const k = this.kits.get(id);
    return k ? this.clone(k) : null;
  }
  async listKits(userId: string) {
    return [...this.kits.values()].filter((k) => k.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(this.clone);
  }
  async findActiveByHash(userId: string, hash: string) {
    const k = [...this.kits.values()].filter((x) => x.userId === userId && x.inputHash === hash && x.status !== "failed").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return k ? this.clone(k) : null;
  }
  async updateKit(id: string, patch: Partial<KitRecord>, expectedVersion?: number) {
    const k = this.kits.get(id);
    if (!k) return null;
    if (expectedVersion !== undefined && k.version !== expectedVersion) return null;
    const next = { ...k, ...this.clone(patch), updatedAt: new Date().toISOString() };
    if (patch.kit !== undefined) next.version = k.version + 1;
    this.kits.set(id, next);
    return this.clone(next);
  }
  async pushEvent(id: string, e: KitRecord["events"][number]) {
    const k = this.kits.get(id);
    if (k) k.events.push(e);
  }
  async deleteKit(id: string, userId: string) {
    const k = this.kits.get(id);
    if (!k || k.userId !== userId) return false;
    return this.kits.delete(id);
  }
  async listUnfinished() {
    return [...this.kits.values()].filter((k) => k.status === "queued" || k.status === "running").map(this.clone);
  }
}
