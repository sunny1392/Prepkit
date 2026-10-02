import type { Request, Response, NextFunction, CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { PrepError } from "@prepkit/core";
import { config } from "../config.js";
import type { Store } from "../store/types.js";

export const COOKIE = "pk_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProd || config.crossSiteCookies,
    sameSite: config.crossSiteCookies ? "none" : "lax",
    maxAge: config.sessionDays * 86_400_000,
    path: "/",
  };
}

export function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
  res.cookie(COOKIE, token, cookieOptions());
  return token;
}

export function clearSession(res: Response) {
  const { maxAge: _m, ...opts } = cookieOptions();
  res.clearCookie(COOKIE, opts);
}

/** Session = signed JWT in an httpOnly cookie. Expired/invalid tokens get a 401 the UI turns into "please sign in again". */
export const requireAuth = (store: Store) => async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE] ?? (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined);
  if (!token) return next(new PrepError("UNAUTHENTICATED", "Please sign in."));
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    const user = await store.findUserById(payload.sub);
    if (!user) throw new Error("no user");
    req.userId = user.id;
    next();
  } catch (err) {
    clearSession(res);
    const expired = (err as Error).name === "TokenExpiredError";
    next(new PrepError("SESSION_EXPIRED", expired ? "Your session has expired. Please sign in again." : "Your session is invalid. Please sign in again."));
  }
};
