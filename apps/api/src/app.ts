import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import type { LLMClient, PipelineDeps } from "@prepkit/core";
import { config } from "./config.js";
import { errorHandler } from "./middleware/http.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { kitsRouter } from "./routes/kits.js";
import { JobRunner } from "./services/jobs.js";
import { KitService } from "./services/kits.js";
import type { Store } from "./store/types.js";

export interface AppDeps {
  store: Store;
  llm?: () => LLMClient;
  searchDiscussion?: PipelineDeps["searchDiscussion"];
  allowPrivate?: boolean;
}

export function createApp(deps: AppDeps) {
  const jobs = new JobRunner(deps.store, {
    allowPrivate: deps.allowPrivate ?? config.allowPrivateHosts,
    maxPages: config.crawlMaxPages,
    concurrency: config.jobConcurrency,
    llm: deps.llm,
    searchDiscussion: deps.searchDiscussion,
  });
  const kits = new KitService(deps.store, jobs, deps.llm);

  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/auth", authRouter(deps.store));
  app.use("/kits", requireAuth(deps.store), kitsRouter(deps.store, kits));
  app.use((_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } }));
  app.use(errorHandler);
  return { app, jobs, kits };
}
