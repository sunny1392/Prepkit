import type { NextFunction, Request, Response, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";
import { PrepError } from "@prepkit/core";

const STATUS: Record<string, number> = {
  INVALID_INPUT: 400,
  INVALID_URL: 400,
  BLOCKED_URL: 400,
  BAD_REORDER: 400,
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  VERSION_CONFLICT: 409,
  PINNED: 409,
  EDITED: 409,
  BUSY: 409,
  NOT_READY: 409,
  LLM_UNAVAILABLE: 503,
  LLM_RATE_LIMITED: 503,
  LLM_NOT_CONFIGURED: 503,
};

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function parse<T>(schema: ZodType<T, any, any>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new PrepError("VALIDATION_ERROR", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), r.error.issues);
  }
  return r.data;
}

/** Every error leaves as { error: { code, message, details? } } so the UI can react to the code. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof PrepError) {
    res.status(STATUS[err.code] ?? 500).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: err.message } });
    return;
  }
  if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: { code: "TOO_LARGE", message: "Request body too large." } });
    return;
  }
  if ((err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "BAD_JSON", message: "Request body is not valid JSON." } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side." } });
}
