import { llmFromEnv, PrepError, runPipeline, type LLMClient, type PipelineDeps } from "@prepkit/core";
import type { Store } from "../store/types.js";

export interface JobRunnerOptions {
  allowPrivate: boolean;
  maxPages: number;
  concurrency: number;
  llm?: () => LLMClient;
  searchDiscussion?: PipelineDeps["searchDiscussion"];
}

/**
 * In-process job queue for kit generation. Generation takes ~1-3 minutes on
 * free tiers, so POST /kits returns 202 immediately and the client polls
 * status. State lives in the database, not in memory: a restart re-queues any
 * kit left queued/running (the pipeline is idempotent — it rebuilds from the
 * stored input). Concurrency is capped because the LLM budget is shared.
 */
export class JobRunner {
  private queue: string[] = [];
  private active = new Set<string>();
  private llm: LLMClient | null = null;

  constructor(
    private store: Store,
    private opts: JobRunnerOptions,
  ) {}

  private getLLM(): LLMClient {
    if (!this.llm) this.llm = this.opts.llm ? this.opts.llm() : llmFromEnv();
    return this.llm;
  }

  isQueuedOrRunning(id: string) {
    return this.active.has(id) || this.queue.includes(id);
  }

  enqueue(id: string) {
    if (this.isQueuedOrRunning(id)) return; // double-submit guard
    this.queue.push(id);
    this.pump();
  }

  async resumeUnfinished() {
    for (const k of await this.store.listUnfinished()) {
      await this.store.updateKit(k.id, { status: "queued", events: [...k.events, { step: "resume", status: "running", message: "Server restarted — generation resumed", at: new Date().toISOString() }] });
      this.enqueue(k.id);
    }
  }

  /** Resolve when the queue is idle (tests). */
  async idle(): Promise<void> {
    while (this.queue.length || this.active.size) await new Promise((r) => setTimeout(r, 20));
  }

  private pump() {
    while (this.active.size < this.opts.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.active.add(id);
      this.run(id)
        .catch((e) => console.error("job crashed", id, e))
        .finally(() => {
          this.active.delete(id);
          this.pump();
        });
    }
  }

  private async run(id: string) {
    const rec = await this.store.getKitById(id);
    if (!rec) return;
    await this.store.updateKit(id, { status: "running", error: null });
    try {
      const llm = this.getLLM();
      const { kit, context } = await runPipeline(rec.input, {
        llm,
        allowPrivate: this.opts.allowPrivate,
        maxPages: this.opts.maxPages,
        searchDiscussion: this.opts.searchDiscussion,
        onProgress: (e) => void this.store.pushEvent(id, e),
      });
      const title = [kit.role.title || "Untitled role", kit.source.company].filter(Boolean).join(" · ");
      await this.store.updateKit(id, { status: "ready", kit, context: context as never, title, error: null });
    } catch (err) {
      const e = err instanceof PrepError ? { code: err.code, message: err.message } : { code: "INTERNAL", message: "Generation failed unexpectedly." };
      if (!(err instanceof PrepError)) console.error(err);
      await this.store.updateKit(id, { status: "failed", error: e });
    }
  }
}
