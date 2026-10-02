const STOP = new Set(["the", "and", "for", "with", "you", "your", "our", "are", "will", "have", "has", "that", "this", "from", "into", "who", "a", "an", "of", "to", "in", "on", "or", "is", "be", "as", "at", "by", "we"]);

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9+#.'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .map((t) => t.replace(/^[.']+|[.']+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Fraction of `needle`'s tokens present in `hay`'s token set (0..1). */
export function tokenCoverage(needle: string, hay: string | Set<string>): number {
  const n = tokens(needle);
  if (!n.length) return 0;
  const h = typeof hay === "string" ? new Set(tokens(hay)) : hay;
  return n.filter((t) => h.has(t)).length / n.length;
}

/** Next sequential id like q12 given existing ids with the same prefix. Ids are never reused. */
export function nextId(prefix: string, existing: Iterable<string>, floor = 0): string {
  let max = floor;
  for (const id of existing) {
    const m = id.match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export const newGenerationId = () => `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
