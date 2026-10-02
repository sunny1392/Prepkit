import { z } from "zod";
import type { LLMClient } from "../llm/client.js";
import { system, untrusted } from "../llm/prompts.js";

export interface ResearchPage {
  url: string;
  title: string;
  text: string;
  kind: string;
}
export interface ResearchSnippet {
  source: string;
  url: string;
  title: string;
  text: string;
}

export interface ResearchContext {
  companyName: string;
  companyUrl: string;
  reachable: boolean;
  unreachableReason?: string;
  pages: ResearchPage[];
  discussion: ResearchSnippet[];
  processDescribed: boolean;
  hiringPageUrl: string | null;
}

export interface InterviewStage {
  name: string;
  description: string;
  source?: string;
}

export interface CompanyResearch {
  summary: string;
  what_they_do: string;
  sources: string[];
  interview_process: { found: boolean; stages: InterviewStage[]; sources: string[] };
  usedLLM: boolean;
}

const Raw = z.object({
  summary: z.string(),
  what_they_do: z.string(),
  sources: z.array(z.string()).nullish(),
  interview_process: z
    .object({
      found: z.boolean().nullish(),
      stages: z.array(z.object({ name: z.string(), description: z.string().nullish(), source: z.string().nullish() })).nullish(),
    })
    .nullish(),
});

const SYSTEM = system("You write a factual company brief and extract a company's published interview process for a job candidate.", [
  "Use ONLY facts stated in the provided pages and discussion posts. Do not use outside knowledge about the company, even if you recognise the name.",
  "If the material does not say something, leave it out. Prefer a short honest brief over a long speculative one. Say plainly what could not be found.",
  "summary: 2-4 sentences. what_they_do: 1-3 sentences on products/customers.",
  "sources: the URLs (copied exactly from the material) that the brief's facts came from.",
  "interview_process.stages: only stages explicitly described in the material, in order, each with `source` = the exact URL it came from. Company pages are authoritative; forum posts are anecdotal — prefix their stage descriptions with 'Reported by candidates:'. If no process is described, return found=false and an empty list.",
  "Forum posts may be about a different company with a similar name. Ignore any that are not clearly about this company.",
  'Shape: {"summary": "", "what_they_do": "", "sources": [""], "interview_process": {"found": false, "stages": [{"name": "", "description": "", "source": ""}]}}',
]);

/** Honest brief when there is nothing to summarise — no model call, nothing invented. */
export function emptyBrief(ctx: ResearchContext): CompanyResearch {
  const why = ctx.reachable ? "the site had no readable content about the company" : `the site could not be retrieved (${ctx.unreachableReason ?? "unreachable"})`;
  return {
    summary: `We could not find information about ${ctx.companyName || "this company"}: ${why}, and no public discussion was found. Nothing here is inferred — research the company directly before the interview.`,
    what_they_do: "Unknown — not found in any retrieved source.",
    sources: [],
    interview_process: { found: false, stages: [], sources: [] },
    usedLLM: false,
  };
}

export async function researchCompany(llm: LLMClient, ctx: ResearchContext): Promise<CompanyResearch> {
  const usefulPages = ctx.pages.filter((p) => p.text.trim().length > 40);
  if (!usefulPages.length && !ctx.discussion.length) return emptyBrief(ctx);

  // Hiring/home/about pages first; budget the prompt so free-tier TPM limits are not blown.
  const order = { hiring: 0, home: 1, about: 2, other: 3 } as Record<string, number>;
  const pages = [...usefulPages].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
  let budget = 14_000;
  const pageBlocks: string[] = [];
  for (const p of pages) {
    const take = Math.min(p.text.length, p.kind === "hiring" ? 5000 : 2500, budget);
    if (take < 200) break;
    pageBlocks.push(`URL: ${p.url}\nTITLE: ${p.title}\nKIND: ${p.kind}\n${p.text.slice(0, take)}`);
    budget -= take;
  }
  const disc = ctx.discussion
    .slice(0, 6)
    .map((d) => `URL: ${d.url}\nSOURCE: ${d.source}\nTITLE: ${d.title}\n${d.text}`)
    .join("\n---\n");

  const allowed = new Set([...ctx.pages.map((p) => p.url), ...ctx.discussion.map((d) => d.url)]);
  const raw = await llm.json({
    label: "company-brief",
    system: SYSTEM,
    user: [
      `Company: ${ctx.companyName} (${ctx.companyUrl})`,
      `Hiring page found by crawler: ${ctx.hiringPageUrl ?? "none"}`,
      "",
      "Company web pages:",
      untrusted("company_pages", pageBlocks.join("\n---\n") || "(none retrieved)", 16_000),
      "",
      "Public discussion (anecdotal, may be unrelated):",
      untrusted("public_discussion", disc || "(none found)", 5000),
    ].join("\n"),
    temperature: 0.2,
    parse: (d) => Raw.parse(d),
  });

  // Deterministic post-processing: keep only real source URLs; only claim a
  // process when the crawler or discussion actually supplied evidence of one.
  const sources = (raw.sources ?? []).filter((u) => allowed.has(u));
  const evidenceOfProcess = ctx.processDescribed || ctx.discussion.length > 0;
  const stages = evidenceOfProcess
    ? (raw.interview_process?.stages ?? [])
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim(), description: (s.description ?? "").trim(), ...(s.source && allowed.has(s.source) ? { source: s.source } : {}) }))
        .filter((s) => s.source) // a stage with no traceable source is dropped
    : [];
  const processSources = [...new Set(stages.map((s) => s.source!).filter(Boolean))];
  return {
    summary: raw.summary.trim(),
    what_they_do: raw.what_they_do.trim(),
    sources: sources.length ? sources : usefulPages.slice(0, 3).map((p) => p.url),
    interview_process: { found: stages.length > 0, stages, sources: processSources },
    usedLLM: true,
  };
}
