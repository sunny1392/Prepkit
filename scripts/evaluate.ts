/**
 * Batch entry point:  npm run evaluate -- --input <cases.json> --output <kits.json>
 *
 * Runs the exact same runPipeline() the API uses, per case, and writes the
 * Appendix B envelope. One failing case never aborts the run; the output file
 * is rewritten after every case so a crash still leaves partial results.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { installProxyFromEnv, llmFromEnv, PrepError, runPipeline, validateKit, type Kit, type LLMClient } from "@prepkit/core";

try {
  process.loadEnvFile?.(".env");
} catch {
  /* .env is optional; real env vars win */
}

interface Case {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}
interface Entry {
  id: string;
  status: "ok" | "failed";
  kit: Kit | null;
  error: { code: string; message: string } | null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=").slice(1).join("=");
}

const TOTAL_BUDGET_MS = Number(process.env.EVAL_BUDGET_MS ?? 14 * 60_000);
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new PrepError("TIMEOUT", `Case exceeded its ${Math.round(ms / 1000)}s time budget.`)), ms);
    p.then(
      (v) => (clearTimeout(t), res(v)),
      (e) => (clearTimeout(t), rej(e)),
    );
  });
}

async function main() {
  const input = arg("input");
  const output = arg("output");
  if (!input || !output) {
    console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
    process.exit(2);
  }
  installProxyFromEnv();
  const started = Date.now();
  const cases = JSON.parse(await readFile(resolve(input), "utf8")) as Case[];
  if (!Array.isArray(cases)) throw new Error("Input must be a JSON array of cases.");

  // Evaluation sites may be served from localhost, so private hosts are allowed here (and only here).
  const allowPrivate = process.env.EVAL_ALLOW_PRIVATE_HOSTS !== "false";
  let llm: LLMClient;
  try {
    llm = llmFromEnv();
  } catch (err) {
    // No provider configured: still honour the contract and write one failed entry per case.
    const e = err instanceof PrepError ? { code: err.code, message: err.message } : { code: "INTERNAL", message: String(err) };
    await writeFile(resolve(output), JSON.stringify({ version: "1.0", generated_at: new Date().toISOString(), kits: cases.map((c, i) => ({ id: String(c?.id ?? `case-${i + 1}`), status: "failed", kit: null, error: e })) }, null, 2));
    console.error(e.message);
    process.exit(1);
  }
  llm.onEvent = (e) => {
    if (e.outcome !== "ok") console.error(`  [llm] ${e.label} ${e.target}: ${e.outcome}${e.detail ? ` — ${e.detail.slice(0, 120)}` : ""}`);
  };

  const results: Entry[] = new Array(cases.length);
  const outPath = resolve(output);
  await mkdir(dirname(outPath), { recursive: true });
  const flush = () =>
    writeFile(outPath, JSON.stringify({ version: "1.0", generated_at: new Date().toISOString(), kits: results.filter(Boolean) }, null, 2));

  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= cases.length) return;
      const c = cases[i];
      const id = String(c?.id ?? `case-${i + 1}`);
      const remainingCases = cases.length - done;
      const remainingMs = TOTAL_BUDGET_MS - (Date.now() - started);
      const budget = Math.max(30_000, Math.floor((remainingMs * Math.min(CONCURRENCY, remainingCases)) / remainingCases));
      const t0 = Date.now();
      console.error(`[${id}] start (${c?.company_url}, ${c?.days} days, budget ${Math.round(budget / 1000)}s)`);
      try {
        const { kit } = await withTimeout(
          runPipeline(
            { jd: c.jd, company_url: c.company_url, days: c.days },
            { llm, allowPrivate, maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 12), onProgress: (e) => e.status !== "running" && console.error(`[${id}] ${e.step}: ${e.status} — ${e.message}`) },
          ),
          budget,
        );
        const v = validateKit(kit);
        results[i] = v.ok ? { id, status: "ok", kit, error: null } : { id, status: "failed", kit: null, error: { code: "VALIDATION_FAILED", message: v.errors.slice(0, 5).join("; ") } };
      } catch (err) {
        const code = err instanceof PrepError ? err.code : "INTERNAL";
        results[i] = { id, status: "failed", kit: null, error: { code, message: (err as Error).message } };
      }
      done++;
      console.error(`[${id}] ${results[i].status} in ${Math.round((Date.now() - t0) / 1000)}s`);
      await flush();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));
  await flush();
  const ok = results.filter((r) => r.status === "ok").length;
  console.error(`Done: ${ok}/${cases.length} ok, ${llm.calls} LLM calls, ${Math.round((Date.now() - started) / 1000)}s → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
