import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PrepError } from "@prepkit/core";
import { ah, parse } from "../middleware/http.js";
import { clearSession, issueSession, requireAuth } from "../middleware/auth.js";
import type { Store } from "../store/types.js";

const Creds = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export function authRouter(store: Store) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later." } } });

  r.post("/register", limiter, ah(async (req, res) => {
    const { email, password } = parse(Creds, req.body);
    if (await store.findUserByEmail(email)) throw new PrepError("EMAIL_TAKEN", "An account with that email already exists.");
    const user = await store.createUser(email, await bcrypt.hash(password, 10)).catch((e) => {
      if (e?.code === 11000) throw new PrepError("EMAIL_TAKEN", "An account with that email already exists.");
      throw e;
    });
    issueSession(res, user.id);
    res.status(201).json({ user: { id: user.id, email: user.email } });
  }));

  r.post("/login", limiter, ah(async (req, res) => {
    const { email, password } = parse(Creds.extend({ password: z.string().min(1).max(200) }), req.body);
    const user = await store.findUserByEmail(email);
    // Same error and similar timing whether the email exists or not.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    if (!user || !ok) throw new PrepError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    issueSession(res, user.id);
    res.json({ user: { id: user.id, email: user.email } });
  }));

  r.post("/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  r.get("/me", requireAuth(store), ah(async (req, res) => {
    const u = await store.findUserById(req.userId!);
    res.json({ user: { id: u!.id, email: u!.email } });
  }));
  return r;
}
