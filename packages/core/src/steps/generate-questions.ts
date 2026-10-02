import { z } from "zod";
import type { LLMClient } from "../llm/client.js";
import { system, untrusted } from "../llm/prompts.js";
import type { QuestionCategory, Requirement } from "../kit/schema.js";
import type { InterviewStage } from "./company-brief.js";

export interface DraftQuestion {
  category: QuestionCategory;
  requirement_ids: string[];
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
}

export interface QuestionContext {
  roleTitle: string;
  seniority: string;
  companyName: string;
  companySummary: string;
  stages: InterviewStage[];
}

export interface CategoryPlan {
  category: QuestionCategory;
  requirements: Requirement[];
  count: number;
  /** Why this category is (or isn't) in the kit — shown in the UI. */
  reason: string;
}

const SENIOR = /senior|staff|principal|lead|architect|manager|head/i;
const hasStage = (stages: InterviewStage[], re: RegExp) => stages.some((s) => re.test(`${s.name} ${s.description}`));

/**
 * Decide, in code, which categories to generate and from which requirements.
 * Routing is by requirement kind so technical and behavioural questions come
 * from different calls with different instructions; the published interview
 * process changes what is asked (a system-design round adds that category, a
 * values round boosts company-fit).
 */
export function planCategories(requirements: Requirement[], ctx: QuestionContext): CategoryPlan[] {
  const tech = requirements.filter((r) => r.kind === "technical");
  const beh = requirements.filter((r) => r.kind === "behavioural");
  const dom = requirements.filter((r) => r.kind === "domain");
  const sdRound = hasStage(ctx.stages, /system design|architecture|design interview/i);
  const valuesRound = hasStage(ctx.stages, /values|culture|behaviou?ral|team fit|bar raiser/i);
  const senior = SENIOR.test(`${ctx.seniority} ${ctx.roleTitle}`);
  const plans: CategoryPlan[] = [];

  if (tech.length || dom.length) {
    plans.push({
      category: "technical",
      requirements: [...tech, ...dom],
      count: Math.min(12, Math.max(3, tech.length * 2 + dom.length)),
      reason: `${tech.length} technical and ${dom.length} domain requirements`,
    });
  }
  plans.push({
    category: "behavioural",
    requirements: beh,
    count: beh.length ? Math.min(8, Math.max(3, beh.length * 2)) + (valuesRound ? 1 : 0) : 2,
    reason: beh.length ? `${beh.length} behavioural requirements` : "no behavioural requirements stated; generic questions only",
  });
  if (sdRound || (senior && tech.length)) {
    plans.push({
      category: "system-design",
      requirements: tech,
      count: sdRound ? 4 : 2,
      reason: sdRound ? "the company's published process includes a system design round" : "senior technical role",
    });
  }
  plans.push({
    category: "company-fit",
    requirements: dom,
    count: valuesRound ? 4 : 3,
    reason: valuesRound ? "the company's process includes a values/culture interview" : "standard motivation and fit questions",
  });
  return plans;
}

const INSTRUCTIONS: Record<QuestionCategory, string[]> = {
  technical: [
    "Write technical interview questions that test real, hands-on depth in each listed requirement — not trivia or definitions.",
    "Mix conceptual, debugging, trade-off and 'how would you build/fix' questions. Calibrate to the seniority.",
    "answer_outline: 3-6 concise bullet points (as one string, '\\n'-separated) of what a strong answer covers.",
  ],
  behavioural: [
    "Write behavioural interview questions ('Tell me about a time…') targeting the listed behavioural requirements.",
    "answer_outline: a STAR-shaped outline: what situation to pick, what actions to emphasise, what result/learning to land, and a pitfall to avoid.",
    "If no requirements are listed, write general behavioural questions about collaboration, ownership and handling setbacks with requirement_ids [].",
  ],
  "system-design": [
    "Write system design questions grounded in the company's actual product domain where it is known, otherwise in the role's technical requirements.",
    "answer_outline: requirements clarification, high-level components, data model, scaling/bottlenecks, trade-offs.",
  ],
  "company-fit": [
    "Write questions about motivation, this company's product/mission and values, and the candidate's fit. Base company-specific questions ONLY on the provided company summary; if it says nothing is known, keep questions generic (e.g. 'Why this role?') and do not invent facts.",
    "answer_outline: what the interviewer is checking for and what specific research or personal evidence to bring.",
  ],
};

const Raw = z.object({ questions: z.array(z.unknown()) });
const RawQ = z.object({
  prompt: z.string().min(8),
  answer_outline: z.union([z.string(), z.array(z.string())]).nullish(),
  difficulty: z.coerce.number().nullish(),
  requirement_ids: z.array(z.string()).nullish(),
});

function processLine(stages: InterviewStage[]): string {
  if (!stages.length) return "The company has not published its interview process. Do not assume any particular format.";
  return "The company's published/reported interview stages (tailor questions to these formats):\n" + stages.map((s, i) => `${i + 1}. ${s.name}: ${s.description}`).join("\n");
}

/** One model call for one category, with that category's own instructions. */
export async function generateQuestions(llm: LLMClient, plan: CategoryPlan, ctx: QuestionContext, opts: { avoid?: string[]; label?: string } = {}): Promise<DraftQuestion[]> {
  const ids = new Set(plan.requirements.map((r) => r.id));
  const reqList = plan.requirements.length
    ? plan.requirements.map((r) => `${r.id} [${r.priority}] ${r.text}`).join("\n")
    : "(none)";
  const sys = system(`You are an experienced interviewer writing ${plan.category} interview questions for a candidate preparing for a specific role.`, [
    ...INSTRUCTIONS[plan.category],
    `Write exactly ${plan.count} questions. Every listed requirement must be covered by at least one question, must-haves first.`,
    "requirement_ids: the ids (from the list given) the question genuinely tests. Use only ids from the list.",
    "difficulty: integer 1 (warm-up), 2 (solid), 3 (hard/senior-level).",
    'Shape: {"questions": [{"prompt": "", "answer_outline": "", "difficulty": 2, "requirement_ids": ["r1"]}]}',
  ]);
  const user = [
    `Role: ${ctx.roleTitle || "unspecified"} (seniority: ${ctx.seniority || "unspecified"}) at ${ctx.companyName || "the company"}.`,
    `Company summary (from our research): ${ctx.companySummary || "nothing known"}`,
    processLine(ctx.stages),
    "",
    "Requirements to cover (id [priority] text) — these are quoted from the job posting:",
    untrusted("requirements", reqList, 6000),
    opts.avoid?.length ? `\nAlready in the kit — do not repeat these:\n${untrusted("existing_questions", opts.avoid.slice(0, 30).join("\n"), 4000)}` : "",
  ].join("\n");

  return llm.json({
    label: opts.label ?? `questions:${plan.category}`,
    system: sys,
    user,
    temperature: 0.5,
    parse: (d) => {
      const raw = Raw.parse(d);
      const out: DraftQuestion[] = [];
      for (const item of raw.questions) {
        const q = RawQ.safeParse(item);
        if (!q.success) continue;
        const outline = Array.isArray(q.data.answer_outline) ? q.data.answer_outline.join("\n") : (q.data.answer_outline ?? "");
        const diff = Math.round(Number(q.data.difficulty ?? 2));
        out.push({
          category: plan.category,
          prompt: q.data.prompt.trim(),
          answer_outline: outline.trim(),
          difficulty: (diff >= 3 ? 3 : diff <= 1 ? 1 : 2) as 1 | 2 | 3,
          // Ids are filtered to the ones we sent — the model cannot invent coverage.
          requirement_ids: [...new Set((q.data.requirement_ids ?? []).filter((id) => ids.has(id)))],
        });
      }
      if (!out.length) throw new Error("no valid questions in response");
      return out;
    },
  });
}

/** Category a gap question should land in, from the requirement's kind. */
export function categoryForKind(kind: Requirement["kind"]): QuestionCategory {
  return kind === "behavioural" ? "behavioural" : kind === "domain" ? "company-fit" : "technical";
}

/** Second-pass generation: only the uncovered requirements, one targeted question each. */
export async function generateGapQuestions(llm: LLMClient, gaps: Requirement[], ctx: QuestionContext, pass: number, existing: string[]): Promise<DraftQuestion[]> {
  const ids = new Set(gaps.map((g) => g.id));
  const byId = new Map(gaps.map((g) => [g.id, g]));
  const sys = system("You fill coverage gaps in an interview prep kit: write targeted questions for requirements that currently have no question.", [
    "Write exactly one question per listed requirement (two for a must-have if natural). Each question must reference the requirement id it covers.",
    "Technical requirements get technical questions; behavioural requirements get 'Tell me about a time…' questions; domain requirements get questions about applying that domain knowledge.",
    "answer_outline: 3-6 concise points of what a strong answer covers ('\\n'-separated string).",
    "difficulty: integer 1-3.",
    'Shape: {"questions": [{"requirement_ids": ["r3"], "prompt": "", "answer_outline": "", "difficulty": 2}]}',
  ]);
  const user = [
    `Role: ${ctx.roleTitle || "unspecified"} at ${ctx.companyName || "the company"}.`,
    "Uncovered requirements (id [priority] [kind] text):",
    untrusted("requirements", gaps.map((g) => `${g.id} [${g.priority}] [${g.kind}] ${g.text}`).join("\n"), 5000),
    existing.length ? `Existing questions (do not repeat):\n${untrusted("existing_questions", existing.slice(0, 25).join("\n"), 3000)}` : "",
  ].join("\n");
  return llm.json({
    label: `gap-fill:pass-${pass}`,
    system: sys,
    user,
    temperature: 0.4,
    parse: (d) => {
      const raw = Raw.parse(d);
      const out: DraftQuestion[] = [];
      for (const item of raw.questions) {
        const q = RawQ.safeParse(item);
        if (!q.success) continue;
        const rids = [...new Set((q.data.requirement_ids ?? []).filter((id) => ids.has(id)))];
        if (!rids.length) continue; // a gap question that covers nothing is useless
        const outline = Array.isArray(q.data.answer_outline) ? q.data.answer_outline.join("\n") : (q.data.answer_outline ?? "");
        const diff = Math.round(Number(q.data.difficulty ?? 2));
        out.push({
          category: categoryForKind(byId.get(rids[0])!.kind),
          prompt: q.data.prompt.trim(),
          answer_outline: outline.trim(),
          difficulty: (diff >= 3 ? 3 : diff <= 1 ? 1 : 2) as 1 | 2 | 3,
          requirement_ids: rids,
        });
      }
      return out;
    },
  });
}

/** Deterministic last resort so a must-have never ships uncovered. Marked origin "fallback". */
export function fallbackQuestion(req: Requirement): DraftQuestion {
  const category = categoryForKind(req.kind);
  const prompt =
    req.kind === "behavioural"
      ? `Tell me about a time you demonstrated this: "${req.text}". What did you do, and what was the outcome?`
      : `The role asks for "${req.text}". Walk me through a concrete project where you applied this, the hardest problem you hit, and how you solved it.`;
  return {
    category,
    prompt,
    answer_outline: "Pick one specific, recent example.\nSet the context briefly (situation, your role).\nSpend most of the time on what YOU did and why.\nQuantify the result.\nClose with what you learned or would do differently.",
    difficulty: req.priority === "must" ? 2 : 1,
    requirement_ids: [req.id],
  };
}
