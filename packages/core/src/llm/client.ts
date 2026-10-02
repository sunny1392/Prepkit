import { extractJson } from "./json.js";
import { geminiTarget, LLMCallError, openRouterTarget, type LLMRequest, type LLMTarget } from "./providers.js";
import { PrepError, backoffMs, sleep } from "../util/errors.js";
import { heuristicMockTarget } from "./mock.js";

/** Sliding-window requests-per-minute limiter shared by every call in the process. */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(private rpm: number) {}
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 60_000);
      if (this.stamps.length < this.rpm) {
        this.stamps.push(now);
        return;
      }
      await sleep(60_000 - (now - this.stamps[0]) + 50);
    }
  }
}

export interface LLMEvent {
  label: string;
  target: string;
  outcome: "ok" | "retry" | "invalid" | "failover" | "failed";
  detail?: string;
}

export interface JsonCallOptions<T> {
  /** Name of the step, for logs/progress. */
  label: string;
  system: string;
  user: string;
  /** Parse + validate the decoded JSON; throw to reject. */
  parse: (data: unknown) => T;
  temperature?: number;
  maxTokens?: number;
}

interface TargetState {
  target: LLMTarget;
  coolUntil: number;
  dead: boolean;
}

const MAX_ATTEMPTS = 8;
const MAX_WAIT_MS = 65_000;

/**
 * Provider-agnostic JSON completion with:
 *  - a global RPM limiter (free tiers cap requests AND tokens per minute)
 *  - per-target cooldown honouring Retry-After, exponential backoff with jitter
 *  - failover across a chain of models/providers (OpenRouter free → Gemini)
 *  - lenient JSON extraction, then schema validation; one "repair" retry that
 *    feeds the validation error back before moving to the next target
 */
export class LLMClient {
  private states: TargetState[];
  calls = 0;
  readonly events: LLMEvent[] = [];
  onEvent?: (e: LLMEvent) => void;

  constructor(
    targets: LLMTarget[],
    private limiter = new RateLimiter(15),
  ) {
    if (!targets.length) throw new PrepError("LLM_NOT_CONFIGURED", "No LLM provider configured. Set OPENROUTER_API_KEY and/or GEMINI_API_KEY.");
    this.states = targets.map((target) => ({ target, coolUntil: 0, dead: false }));
  }

  private emit(e: LLMEvent) {
    this.events.push(e);
    this.onEvent?.(e);
  }

  private async pickTarget(): Promise<TargetState> {
    const alive = this.states.filter((s) => !s.dead);
    if (!alive.length) throw new PrepError("LLM_UNAVAILABLE", "All LLM providers failed or are out of quota.");
    const now = Date.now();
    const ready = alive.find((s) => s.coolUntil <= now);
    if (ready) return ready;
    const soonest = alive.reduce((a, b) => (a.coolUntil <= b.coolUntil ? a : b));
    const wait = soonest.coolUntil - now;
    if (wait > MAX_WAIT_MS) throw new PrepError("LLM_RATE_LIMITED", `All LLM providers are rate-limited for another ${Math.round(wait / 1000)}s.`);
    await sleep(wait);
    return soonest;
  }

  async json<T>(opts: JsonCallOptions<T>): Promise<T> {
    let repairNote = "";
    let lastTarget: TargetState | null = null;
    let lastError = "";
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const st = await this.pickTarget();
      if (st !== lastTarget) repairNote = "";
      lastTarget = st;
      const name = `${st.target.provider}/${st.target.model}`;
      await this.limiter.acquire();
      this.calls++;
      const req: LLMRequest = {
        system: opts.system,
        user: repairNote ? `${opts.user}\n\n${repairNote}` : opts.user,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        json: true,
      };
      let raw: string;
      try {
        raw = await st.target.call(req);
      } catch (err) {
        if (err instanceof LLMCallError) {
          lastError = err.message;
          if (err.exhausted || !err.retryable) {
            st.dead = true;
            this.emit({ label: opts.label, target: name, outcome: "failover", detail: err.message });
          } else {
            st.coolUntil = Date.now() + (err.retryAfterMs ?? backoffMs(attempt, 2000, 30_000));
            this.emit({ label: opts.label, target: name, outcome: "retry", detail: err.message });
          }
          continue;
        }
        throw err;
      }
      try {
        const value = opts.parse(extractJson(raw));
        this.emit({ label: opts.label, target: name, outcome: "ok" });
        return value;
      } catch (err) {
        lastError = (err as Error).message.slice(0, 600);
        this.emit({ label: opts.label, target: name, outcome: "invalid", detail: lastError });
        if (!repairNote) {
          // One repair attempt on the same target, telling it what was wrong.
          repairNote = `Your previous reply was rejected: ${lastError}\nReply again with ONLY valid JSON matching the required shape.`;
        } else {
          // Second bad answer from this target: rest it and move on.
          st.coolUntil = Date.now() + 30_000;
          repairNote = "";
        }
      }
    }
    this.emit({ label: opts.label, target: "-", outcome: "failed", detail: lastError });
    throw new PrepError("LLM_UNAVAILABLE", `Step "${opts.label}" failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
  }
}

/** Build the provider chain from environment variables (see .env.example). */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LLMClient {
  const order = (env.LLM_PROVIDER_ORDER ?? "openrouter,gemini").split(",").map((s) => s.trim().toLowerCase());
  const targets: LLMTarget[] = [];
  for (const p of order) {
    if (p === "openrouter" && env.OPENROUTER_API_KEY) {
      const models = (env.OPENROUTER_MODELS ?? "meta-llama/llama-3.3-70b-instruct:free").split(",").map((s) => s.trim()).filter(Boolean);
      for (const m of models) targets.push(openRouterTarget(env.OPENROUTER_API_KEY, m));
    }
    if (p === "gemini" && env.GEMINI_API_KEY) {
      targets.push(geminiTarget(env.GEMINI_API_KEY, env.GEMINI_MODEL ?? "gemini-2.0-flash"));
    }
    if (p === "mock") targets.push(heuristicMockTarget()); // offline smoke runs only

  }
  return new LLMClient(targets, sharedLimiter(Number(env.LLM_RPM ?? 15) || 15));
}

let shared: RateLimiter | null = null;
/** One limiter per process, so concurrent kits share the provider's RPM budget. */
export function sharedLimiter(rpm: number): RateLimiter {
  if (!shared) shared = new RateLimiter(rpm);
  return shared;
}
