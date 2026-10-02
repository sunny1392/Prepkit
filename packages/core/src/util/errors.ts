/** Structured error carrying a machine-readable code, surfaced to the UI and batch output. */
export class PrepError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "PrepError";
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter. attempt is 0-based. */
export function backoffMs(attempt: number, baseMs = 500, capMs = 20_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
