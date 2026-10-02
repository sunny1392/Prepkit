import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson } from "../src/llm/json.js";
import { LLMClient, RateLimiter } from "../src/llm/client.js";
import { LLMCallError, mockTarget } from "../src/llm/providers.js";

describe("extractJson", () => {
  it("handles fences, prose, trailing commas and truncation", () => {
    expect(extractJson('```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a": [1, 2]} hope that helps')).toEqual({ a: [1, 2] });
    expect(extractJson('{"q": [{"p": "x"}, {"p": "y')).toEqual({ q: [{ p: "x" }, { p: "y" }] });
    expect(() => extractJson("no json here")).toThrow();
  });
});

const schema = (d: unknown) => z.object({ ok: z.boolean() }).parse(d);
const fast = () => new RateLimiter(1000);

describe("LLMClient", () => {
  it("fails over from a rate-limited target to the next", async () => {
    let a = 0;
    const llm = new LLMClient(
      [
        mockTarget(() => {
          a++;
          throw new LLMCallError("429 per-day quota", 429, true, undefined, true);
        }, "a"),
        mockTarget(() => '{"ok": true}', "b"),
      ],
      fast(),
    );
    expect(await llm.json({ label: "t", system: "", user: "", parse: schema })).toEqual({ ok: true });
    expect(a).toBe(1);
    expect(llm.events.map((e) => e.outcome)).toEqual(["failover", "ok"]);
  });

  it("retries a transient 429 after the Retry-After delay", async () => {
    let n = 0;
    const llm = new LLMClient(
      [
        mockTarget(() => {
          if (n++ === 0) throw new LLMCallError("slow down", 429, true, 50);
          return '{"ok": true}';
        }),
      ],
      fast(),
    );
    const t = Date.now();
    expect(await llm.json({ label: "t", system: "", user: "", parse: schema })).toEqual({ ok: true });
    expect(Date.now() - t).toBeGreaterThanOrEqual(45);
  });

  it("sends a repair prompt after invalid output, then succeeds", async () => {
    const seen: string[] = [];
    const llm = new LLMClient(
      [
        mockTarget((req) => {
          seen.push(req.user);
          return seen.length === 1 ? '{"ok": "yes"}' : '{"ok": false}';
        }),
      ],
      fast(),
    );
    expect(await llm.json({ label: "t", system: "", user: "base", parse: schema })).toEqual({ ok: false });
    expect(seen[1]).toMatch(/previous reply was rejected/);
  });

  it("gives up with LLM_UNAVAILABLE when every target is dead", async () => {
    const llm = new LLMClient([mockTarget(() => { throw new LLMCallError("401", 401, false); })], fast());
    await expect(llm.json({ label: "t", system: "", user: "", parse: schema })).rejects.toMatchObject({ code: "LLM_UNAVAILABLE" });
  });

  it("rate limiter spaces requests beyond the per-minute budget", async () => {
    const lim = new RateLimiter(2);
    await lim.acquire();
    await lim.acquire();
    const p = lim.acquire();
    const race = await Promise.race([p.then(() => "acquired"), new Promise((r) => setTimeout(() => r("waiting"), 100))]);
    expect(race).toBe("waiting");
  });
});
