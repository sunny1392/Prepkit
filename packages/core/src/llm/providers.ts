export interface LLMRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for a JSON object response where supported. */
  json?: boolean;
}

export interface LLMTarget {
  provider: string;
  model: string;
  call(req: LLMRequest): Promise<string>;
}

/** Error from a provider call. `retryable` = try again (here or elsewhere); otherwise the target is broken. */
export class LLMCallError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public retryAfterMs?: number,
    /** Daily quota exhausted — don't come back to this target this run. */
    public exhausted = false,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 90_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: any; text: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    return { status: res.status, json, text, headers: res.headers };
  } catch (err) {
    throw new LLMCallError(`network: ${(err as Error).message}`, 0, true);
  } finally {
    clearTimeout(t);
  }
}

function classify(status: number, text: string, headers: Headers): LLMCallError {
  const ra = Number(headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
  const exhausted = status === 429 && /per[- ]day|daily|quota/i.test(text);
  const retryable = status === 429 || status === 408 || status >= 500;
  return new LLMCallError(`HTTP ${status}: ${text.slice(0, 300)}`, status, retryable, retryAfterMs, exhausted);
}

export function openRouterTarget(apiKey: string, model: string): LLMTarget {
  return {
    provider: "openrouter",
    model,
    async call(req) {
      const r = await postJson(
        "https://openrouter.ai/api/v1/chat/completions",
        { authorization: `Bearer ${apiKey}`, "x-title": "PrepKit", "http-referer": "https://github.com/prepkit" },
        {
          model,
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxTokens ?? 4000,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        },
      );
      if (r.status !== 200) throw classify(r.status, r.text, r.headers);
      // OpenRouter can return 200 with an upstream error object.
      if (r.json?.error) {
        const code = Number(r.json.error.code) || 502;
        throw new LLMCallError(`upstream: ${JSON.stringify(r.json.error).slice(0, 300)}`, code, code === 429 || code >= 500);
      }
      const content = r.json?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new LLMCallError("empty completion", 502, true);
      return content;
    },
  };
}

export function geminiTarget(apiKey: string, model: string): LLMTarget {
  return {
    provider: "gemini",
    model,
    async call(req) {
      const r = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": apiKey },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: req.temperature ?? 0.3,
            maxOutputTokens: req.maxTokens ?? 4000,
            ...(req.json ? { responseMimeType: "application/json" } : {}),
          },
        },
      );
      if (r.status !== 200) throw classify(r.status, r.text, r.headers);
      const text = r.json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
      if (!text?.trim()) throw new LLMCallError(`empty completion (${r.json?.candidates?.[0]?.finishReason ?? "unknown"})`, 502, true);
      return text;
    },
  };
}

/** Deterministic stand-in used by tests and offline runs. */
export function mockTarget(handler: (req: LLMRequest) => string | Promise<string>, model = "mock"): LLMTarget {
  return { provider: "mock", model, call: async (req) => handler(req) };
}
