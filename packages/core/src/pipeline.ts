import type { LLMClient } from "./llm/client.js";
import { crawlCompany, type CrawlResult } from "./retrieval/crawl.js";
import { searchDiscussions, type DiscussionResult } from "./research/discussion-search.js";
import { extractRequirements, type ExtractedRole } from "./steps/extract-requirements.js";
import { emptyBrief, researchCompany, type CompanyResearch, type ResearchContext } from "./steps/company-brief.js";
import { fallbackQuestion, generateGapQuestions, generateQuestions, planCategories, type DraftQuestion, type QuestionContext } from "./steps/generate-questions.js";
import { fallbackFlashcards, generateFlashcards } from "./steps/generate-flashcards.js";
import { runCoverageLoop } from "./coverage/coverage.js";
import { allocateSchedule, MAX_DAYS, MIN_DAYS } from "./schedule/allocate.js";
import { meta } from "./kit/operations.js";
import { QUESTION_CATEGORIES, type Flashcard, type Kit, type Question } from "./kit/schema.js";
import { validateKit } from "./kit/validate.js";
import { PrepError } from "./util/errors.js";
import { newGenerationId } from "./util/text.js";

export type StepName =
  | "validate-input"
  | "extract-requirements"
  | "crawl-company"
  | "search-discussion"
  | "company-brief"
  | "questions:technical"
  | "questions:behavioural"
  | "questions:system-design"
  | "questions:company-fit"
  | "coverage"
  | "flashcards"
  | "schedule"
  | "validate-kit";

export interface ProgressEvent {
  step: StepName | string;
  status: "running" | "done" | "skipped" | "failed";
  message: string;
  at: string;
}

export interface PipelineInput {
  jd: string;
  company_url: string;
  days: number;
}

export interface PipelineDeps {
  llm: LLMClient;
  allowPrivate: boolean;
  maxPages?: number;
  onProgress?: (e: ProgressEvent) => void;
  /** Injectable for tests/offline runs. */
  crawl?: typeof crawlCompany;
  searchDiscussion?: (company: string, url: string) => Promise<DiscussionResult>;
}

export interface PipelineResult {
  kit: Kit;
  /** Retrieved material kept beside the kit so sections can be regenerated without re-crawling. */
  context: ResearchContext & { role: ExtractedRole };
  events: ProgressEvent[];
}

const CATEGORY_ORDER = new Map(QUESTION_CATEGORIES.map((c, i) => [c, i]));

export function validateInput(input: PipelineInput): PipelineInput {
  const jd = (input.jd ?? "").toString().trim();
  if (jd.length < 10) throw new PrepError("INVALID_INPUT", "Job description is empty or too short to analyse.");
  if (jd.length > 60_000) throw new PrepError("INVALID_INPUT", "Job description is too long (max 60,000 characters).");
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new PrepError("INVALID_INPUT", `days must be an integer from ${MIN_DAYS} to ${MAX_DAYS}.`);
  }
  if (!input.company_url || typeof input.company_url !== "string") throw new PrepError("INVALID_INPUT", "company_url is required.");
  return { jd, company_url: input.company_url.trim(), days };
}

/**
 * The full research → generation → validation pipeline. The same function is
 * used by the API job runner and by `npm run evaluate`.
 *
 *   validate input
 *   ├─ extract requirements (LLM) ┐  run in parallel — independent
 *   └─ crawl company site         ┘
 *   search public discussion (needs the company name from either branch)
 *   company brief + interview process (LLM; skipped if nothing was found)
 *   plan categories (code) → one LLM call per category, its own instructions
 *   coverage loop (code checks, LLM fills gaps, code checks again)
 *   flashcards (LLM) + deterministic top-up for uncovered must-haves
 *   schedule (code) → validate (code)
 */
export async function runPipeline(rawInput: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const events: ProgressEvent[] = [];
  const emit = (step: string, status: ProgressEvent["status"], message: string) => {
    const e = { step, status, message, at: new Date().toISOString() };
    events.push(e);
    deps.onProgress?.(e);
  };
  const notes: string[] = [];
  const genId = newGenerationId();
  const llmBefore = deps.llm.calls;

  emit("validate-input", "running", "Checking input");
  const input = validateInput(rawInput);
  emit("validate-input", "done", `${input.jd.length} characters, ${input.days} day(s)`);

  // --- 1. extraction ∥ crawl ---
  emit("extract-requirements", "running", "Reading the job description");
  emit("crawl-company", "running", `Crawling ${input.company_url}`);
  const crawlFn = deps.crawl ?? crawlCompany;
  const [roleRes, crawlRes] = await Promise.allSettled([
    extractRequirements(deps.llm, input.jd),
    crawlFn(input.company_url, { allowPrivate: deps.allowPrivate, maxPages: deps.maxPages, onProgress: (m) => emit("crawl-company", "running", m) }),
  ]);
  if (roleRes.status === "rejected") {
    emit("extract-requirements", "failed", (roleRes.reason as Error).message);
    throw roleRes.reason instanceof PrepError ? roleRes.reason : new PrepError("EXTRACTION_FAILED", String(roleRes.reason));
  }
  const role = roleRes.value;
  emit(
    "extract-requirements",
    "done",
    `${role.requirements.length} requirements (${role.requirements.filter((r) => r.priority === "must").length} must-have)` +
      (role.rejected.length ? `; ${role.rejected.length} ungrounded item(s) dropped` : "") +
      (role.thin ? " — the posting has very little detail" : ""),
  );
  if (role.thin) notes.push("The job description contains very little detail, so this kit is deliberately small. Nothing was added that the posting does not say.");
  if (role.rejected.length) notes.push(`Dropped ${role.rejected.length} requirement(s) the model proposed that could not be found in the posting.`);

  const crawl: CrawlResult =
    crawlRes.status === "fulfilled"
      ? crawlRes.value
      : { reachable: false, startUrl: input.company_url, companyName: "", pages: [], skipped: [], hiringPageUrl: null, processDescribed: false, error: { code: "CRAWL_FAILED", message: String((crawlRes.reason as Error)?.message ?? crawlRes.reason) } };
  if (crawl.reachable) {
    emit("crawl-company", "done", `${crawl.pages.length} page(s) read; hiring page: ${crawl.hiringPageUrl ?? "none found"}${crawl.skipped.length ? `; ${crawl.skipped.length} skipped` : ""}`);
    if (!crawl.hiringPageUrl) notes.push("No careers or hiring page could be found on the company site.");
    else if (!crawl.processDescribed) notes.push("A careers page was found but it does not describe the interview process.");
  } else {
    emit("crawl-company", "failed", crawl.error?.message ?? "Company site unreachable");
    notes.push(`Company site could not be used: ${crawl.error?.message ?? "unreachable"}. The kit is built from the job description alone.`);
  }

  const companyName = role.company || crawl.companyName || "";

  // --- 2. public discussion ---
  emit("search-discussion", "running", `Searching public discussion of ${companyName || "the company"}'s interviews`);
  let discussion: DiscussionResult = { snippets: [], searched: [], failures: [] };
  try {
    discussion = companyName ? await (deps.searchDiscussion ?? searchDiscussions)(companyName, crawl.startUrl) : discussion;
  } catch (err) {
    discussion.failures.push({ source: "all", reason: (err as Error).message });
  }
  if (discussion.snippets.length) emit("search-discussion", "done", `${discussion.snippets.length} relevant post(s) found`);
  else {
    emit("search-discussion", discussion.failures.length === discussion.searched.length && discussion.searched.length ? "failed" : "done", "No public discussion found");
    notes.push("No public discussion of this company's interview process was found.");
  }

  // --- 3. company brief + interview process ---
  const ctx: ResearchContext = {
    companyName,
    companyUrl: crawl.startUrl,
    reachable: crawl.reachable,
    unreachableReason: crawl.error?.message,
    pages: crawl.pages.map((p) => ({ url: p.url, title: p.title, text: p.text, kind: p.kind })),
    discussion: discussion.snippets,
    processDescribed: crawl.processDescribed,
    hiringPageUrl: crawl.hiringPageUrl,
  };
  emit("company-brief", "running", "Writing the company brief");
  let research: CompanyResearch;
  try {
    research = await researchCompany(deps.llm, ctx);
    emit("company-brief", research.usedLLM ? "done" : "skipped", research.usedLLM ? `Brief from ${research.sources.length} source(s); interview stages found: ${research.interview_process.stages.length}` : "Nothing to summarise — honest empty brief");
  } catch (err) {
    research = emptyBrief(ctx);
    const home = ctx.pages[0];
    if (home) {
      research.summary = `Automatic brief generation failed. The company's homepage describes itself as: "${home.title}${home.text ? ` — ${home.text.slice(0, 240)}` : ""}".`;
      research.sources = [home.url];
    }
    emit("company-brief", "failed", `Brief generation failed: ${(err as Error).message}`);
    notes.push("The company brief could not be generated automatically.");
  }

  // --- 4. questions per category ---
  const qctx: QuestionContext = {
    roleTitle: role.title,
    seniority: role.seniority,
    companyName,
    companySummary: research.summary,
    stages: research.interview_process.stages,
  };
  const plans = planCategories(role.requirements, qctx);
  const planned = new Set(plans.map((p) => p.category));
  for (const c of QUESTION_CATEGORIES) if (!planned.has(c)) emit(`questions:${c}`, "skipped", c === "system-design" ? "No system design round published and not a senior technical role" : "No requirements of this kind");

  const drafts: DraftQuestion[] = [];
  for (const plan of plans) {
    emit(`questions:${plan.category}`, "running", `Generating ${plan.count} ${plan.category} questions (${plan.reason})`);
    try {
      const qs = await generateQuestions(deps.llm, plan, qctx, { avoid: drafts.map((d) => d.prompt) });
      drafts.push(...qs);
      emit(`questions:${plan.category}`, "done", `${qs.length} question(s)`);
    } catch (err) {
      emit(`questions:${plan.category}`, "failed", (err as Error).message);
      notes.push(`Generating ${plan.category} questions failed; coverage gaps were filled in the second pass.`);
    }
  }

  // --- 5. coverage loop ---
  let counter = 0;
  const toQuestion = (d: DraftQuestion, origin: "generated" | "fallback"): Question => ({ id: `q${++counter}`, ...d, meta: meta(origin, genId) });
  emit("coverage", "running", "Checking every requirement has a question");
  const loop = await runCoverageLoop<Question>({
    requirements: role.requirements,
    initial: drafts.map((d) => toQuestion(d, "generated")),
    fill: async (gaps, pass) => {
      emit("coverage", "running", `Pass ${pass + 1}: ${gaps.length} requirement(s) uncovered (${gaps.map((g) => g.id).join(", ")}) — generating targeted questions`);
      const qs = await generateGapQuestions(deps.llm, gaps, qctx, pass, drafts.map((d) => d.prompt));
      return qs.map((d) => toQuestion(d, "generated"));
    },
    fallback: (req) => toQuestion(fallbackQuestion(req), "fallback"),
  });
  const questions = [...loop.questions].sort((a, b) => CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)!);
  emit(
    "coverage",
    "done",
    `${loop.passes} pass(es); ` +
      (loop.uncovered.length ? `${loop.uncovered.length} nice-to-have requirement(s) left uncovered` : "all requirements covered") +
      (loop.fallbackFor.length ? `; template questions used for ${loop.fallbackFor.join(", ")}` : ""),
  );
  if (loop.fallbackFor.length) notes.push(`Template questions were used for ${loop.fallbackFor.length} must-have requirement(s) the model did not cover.`);

  // --- 6. flashcards ---
  emit("flashcards", "running", "Writing flashcards");
  let cardDrafts: Array<Omit<Flashcard, "id" | "meta">> = [];
  try {
    cardDrafts = await generateFlashcards(deps.llm, role.requirements, questions, { roleTitle: role.title, companyName, companySummary: research.summary });
    emit("flashcards", "done", `${cardDrafts.length} card(s)`);
  } catch (err) {
    emit("flashcards", "failed", `${(err as Error).message} — using cards built from the questions`);
  }
  const topUp = fallbackFlashcards(role.requirements, questions, cardDrafts);
  const flashcards: Flashcard[] = [
    ...cardDrafts.map((c, i) => ({ id: `f${i + 1}`, ...c, meta: meta("generated", genId) })),
    ...topUp.map((c, i) => ({ id: `f${cardDrafts.length + i + 1}`, ...c, meta: meta("fallback", genId) })),
  ];

  // --- 7. schedule (deterministic) ---
  emit("schedule", "running", `Allocating ${questions.length} questions across ${input.days} day(s)`);
  const schedule = allocateSchedule({ questions, requirements: role.requirements, days: input.days });
  emit("schedule", "done", `${schedule.days.length} day(s), ${schedule.days.reduce((s, d) => s + d.minutes, 0)} minutes total`);

  // --- 8. assemble + validate ---
  const kit: Kit = {
    source: {
      company: companyName,
      company_url: input.company_url,
      role: role.title,
      location: role.location,
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: crawl.pages.map((p) => p.url),
    },
    company_brief: { summary: research.summary, what_they_do: research.what_they_do, sources: research.sources, meta: meta("generated", genId) },
    role: { title: role.title, seniority: role.seniority, responsibilities: role.responsibilities, requirements: role.requirements },
    questions,
    flashcards,
    schedule: { ...schedule, meta: meta("generated", genId) },
    coverage: { uncovered_requirement_ids: loop.uncovered, passes: loop.passes },
    interview_process: research.interview_process,
    id_seq: { q: counter, f: flashcards.length },
    research: {
      notes,
      skipped_sources: crawl.skipped,
      discussion_sources: discussion.snippets.map((s) => s.url),
      thin_jd: role.thin,
      hiring_page_found: !!crawl.hiringPageUrl,
      llm_calls: deps.llm.calls - llmBefore,
    },
  };
  emit("validate-kit", "running", "Validating kit structure");
  const v = validateKit(kit);
  if (!v.ok) {
    emit("validate-kit", "failed", v.errors.slice(0, 3).join("; "));
    throw new PrepError("VALIDATION_FAILED", `Generated kit failed validation: ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  }
  emit("validate-kit", "done", "Kit is valid");
  return { kit: v.kit!, context: { ...ctx, role }, events };
}
