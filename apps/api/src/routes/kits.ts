import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ah, parse } from "../middleware/http.js";
import { CreateKitBody, OpSchema, publicKit, summarise, type KitService } from "../services/kits.js";
import type { Store } from "../store/types.js";

export function kitsRouter(store: Store, kits: KitService) {
  const r = Router();
  const createLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, keyGenerator: (req) => req.userId ?? req.ip ?? "anon", message: { error: { code: "RATE_LIMITED", message: "You've created a lot of kits this hour. Try again later." } } });

  r.get("/", ah(async (req, res) => {
    res.json({ kits: (await store.listKits(req.userId!)).map(summarise) });
  }));

  r.post("/", createLimiter, ah(async (req, res) => {
    const body = parse(CreateKitBody, req.body);
    const { kit, deduped } = await kits.create(req.userId!, body);
    res.status(deduped ? 200 : 202).json({ kit: summarise(kit), deduped });
  }));

  /** Multi-role prep: an array of description/company pairs (parsed client-side from JSON or CSV). */
  r.post("/batch", createLimiter, ah(async (req, res) => {
    const { cases } = parse(z.object({ cases: z.array(CreateKitBody).min(1).max(20) }), req.body);
    const results = [];
    for (const [i, c] of cases.entries()) {
      try {
        const { kit, deduped } = await kits.create(req.userId!, c);
        results.push({ index: i, ok: true, deduped, kit: summarise(kit) });
      } catch (err) {
        results.push({ index: i, ok: false, error: { code: (err as { code?: string }).code ?? "INTERNAL", message: (err as Error).message } });
      }
    }
    res.status(207).json({ results });
  }));

  r.get("/:id", ah(async (req, res) => {
    res.json({ kit: publicKit(await kits.mustGet(req.params.id, req.userId!)) });
  }));

  /** Lightweight progress poll. */
  r.get("/:id/status", ah(async (req, res) => {
    const k = await kits.mustGet(req.params.id, req.userId!);
    const since = Number(req.query.since ?? 0) || 0;
    res.json({ status: k.status, error: k.error, version: k.version, events: k.events.slice(since), eventCount: k.events.length });
  }));

  r.post("/:id/retry", ah(async (req, res) => {
    res.status(202).json({ kit: summarise(await kits.retry(req.params.id, req.userId!)) });
  }));

  r.delete("/:id", ah(async (req, res) => {
    await kits.mustGet(req.params.id, req.userId!);
    await store.deleteKit(req.params.id, req.userId!);
    res.status(204).end();
  }));

  r.post("/:id/ops", ah(async (req, res) => {
    const { version, ops } = parse(z.object({ version: z.number().int().min(0), ops: z.array(OpSchema).min(1).max(50) }), req.body);
    const saved = await kits.applyOps(req.params.id, req.userId!, version, ops);
    res.json({ kit: saved.kit, version: saved.version });
  }));

  r.post("/:id/regenerate", ah(async (req, res) => {
    const { section, force } = parse(z.object({ section: z.string(), force: z.boolean().optional() }), req.body);
    const out = await kits.regenerate(req.params.id, req.userId!, section, force);
    res.json({ kit: out.record.kit, version: out.record.version, section: out.section, kept: out.kept, added: out.added });
  }));

  r.get("/:id/practice", ah(async (req, res) => {
    res.json(await kits.practiceState(req.params.id, req.userId!));
  }));
  r.post("/:id/practice", ah(async (req, res) => {
    const { cardId, confidence } = parse(z.object({ cardId: z.string(), confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]) }), req.body);
    res.json(await kits.recordPractice(req.params.id, req.userId!, cardId, confidence));
  }));
  r.delete("/:id/practice", ah(async (req, res) => {
    res.json(await kits.resetPractice(req.params.id, req.userId!));
  }));
  return r;
}
