import { assertFetchable, type UrlGuardOptions } from "./url-guard.js";
import { PrepError, backoffMs, sleep } from "../util/errors.js";

export const USER_AGENT = "PrepKitBot/1.0 (+interview-prep research; respects robots.txt)";

export interface FetchOptions extends UrlGuardOptions {
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  /** Accepted content types (prefix match). */
  accept?: string[];
  /** Minimum gap between requests to the same host. */
  perHostIntervalMs?: number;
  headers?: Record<string, string>;
}

export interface FetchedPage {
  requestedUrl: string;
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  body: string;
}

const DEFAULT_ACCEPT = ["text/html", "application/xhtml+xml", "text/plain"];
const MAX_REDIRECTS = 5;

/** Per-host politeness: serialise requests to one host with a minimum gap. */
const hostQueues = new Map<string, Promise<void>>();
async function throttleHost(host: string, intervalMs: number): Promise<void> {
  const prev = hostQueues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  hostQueues.set(host, prev.then(() => next));
  await prev;
  setTimeout(release, intervalMs);
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len && len > maxBytes) throw new PrepError("TOO_LARGE", `Response is ${len} bytes (limit ${maxBytes}).`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PrepError("TOO_LARGE", `Response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function fetchOnce(url: URL, opts: Required<Omit<FetchOptions, "headers">> & { headers?: Record<string, string> }): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    current = await assertFetchable(current, opts); // re-check every hop
    await throttleHost(current.host, opts.perHostIntervalMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": USER_AGENT, accept: opts.accept.join(", ") + ";q=0.9,*/*;q=0.1", ...opts.headers },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error).name === "AbortError";
      throw new PrepError(aborted ? "TIMEOUT" : "NETWORK", aborted ? `Timed out after ${opts.timeoutMs}ms.` : `Network error: ${(err as Error).message}`);
    }
    try {
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        await res.body?.cancel();
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel();
        throw new PrepError("HTTP_RETRYABLE", `HTTP ${res.status}`, { status: res.status, retryAfter: res.headers.get("retry-after") });
      }
      if (res.status >= 400) {
        await res.body?.cancel();
        throw new PrepError("HTTP_ERROR", `HTTP ${res.status}`, { status: res.status });
      }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!opts.accept.some((a) => contentType.startsWith(a))) {
        await res.body?.cancel();
        throw new PrepError("BAD_CONTENT_TYPE", `Unsupported content type "${contentType || "unknown"}".`);
      }
      const body = await readCapped(res, opts.maxBytes);
      return { requestedUrl: url.toString(), url: current.toString(), status: res.status, contentType, body };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PrepError("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects.`);
}

const RETRYABLE = new Set(["TIMEOUT", "NETWORK", "HTTP_RETRYABLE"]);

/**
 * Fetch a single untrusted page: URL guard on every hop, content-type and size
 * limits, per-host throttling, and retries with backoff on transient failures
 * only (a 404 is not retried).
 */
export async function fetchPage(raw: string | URL, options: FetchOptions): Promise<FetchedPage> {
  const opts = {
    timeoutMs: 10_000,
    maxBytes: 2_000_000,
    retries: 2,
    accept: DEFAULT_ACCEPT,
    perHostIntervalMs: 300,
    ...options,
  };
  const url = typeof raw === "string" ? new URL(raw) : raw;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fetchOnce(url, opts);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof PrepError) || !RETRYABLE.has(err.code) || attempt === opts.retries) break;
      const retryAfter = Number((err.details as { retryAfter?: string })?.retryAfter);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15_000) : backoffMs(attempt, 400, 4000));
    }
  }
  throw lastErr;
}
