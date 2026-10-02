import { z } from "zod";
import type { LLMClient } from "../llm/client.js";
import { system, untrusted } from "../llm/prompts.js";
import { REQUIREMENT_KINDS, type Requirement } from "../kit/schema.js";
import { normalise, tokenCoverage, tokens } from "../util/text.js";

export interface ExtractedRole {
  company: string;
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
  requirements: Requirement[];
  /** Requirements the model proposed that we dropped, with why. */
  rejected: Array<{ text: string; reason: string }>;
  thin: boolean;
}

const RawSchema = z.object({
  company: z.string().nullish(),
  title: z.string().nullish(),
  seniority: z.string().nullish(),
  location: z.string().nullish(),
  responsibilities: z.array(z.string()).nullish(),
  requirements: z.array(z.unknown()),
});
const RawReq = z.object({
  text: z.string().min(2),
  kind: z.string(),
  priority: z.string(),
  evidence: z.string().nullish(),
});

const SYSTEM = system("You extract structured hiring requirements from a single job posting.", [
  "Extract ONLY requirements the posting explicitly states about the candidate (skills, experience, knowledge, behaviours). Never add requirements that are typical for the role but not written in the posting.",
  "If the posting is short or vague, return few requirements. An empty list is acceptable. Do not pad.",
  "Each requirement needs `evidence`: an exact, verbatim quote (max 25 words) copied from the posting that states it.",
  "One requirement per stated line or bullet. Split a line only when it mixes required and optional parts (e.g. 'Python; Go is a plus' → two requirements).",
  "priority 'must' = stated as required: 'required', 'must', 'you have', 'minimum', 'X+ years', or listed under Requirements / Qualifications / What you need. Also use 'must' for the core skill in a posting that has no requirements section (e.g. 'We need a React developer').",
  "priority 'nice' = 'nice to have', 'bonus', 'a plus', 'preferred', 'ideally', 'familiarity with ... is helpful', or listed under a Nice-to-have / Bonus / Preferred heading.",
  "kind 'technical' = languages, frameworks, tools, engineering practices, technical skills. 'behavioural' = communication, leadership, mentoring, collaboration, ownership, working style. 'domain' = industry or business knowledge (e.g. payments, healthcare compliance, logistics).",
  "Do NOT treat benefits, perks, salary, company descriptions, equal-opportunity statements or application instructions as requirements.",
  "responsibilities = what the person will do in the job (short phrases, as stated). Empty if not stated.",
  "seniority: one of intern, junior, mid, senior, staff, principal, lead, manager, or '' if the posting does not say. company and location: as stated, or ''.",
  'Shape: {"company": "", "title": "", "seniority": "", "location": "", "responsibilities": [""], "requirements": [{"text": "", "kind": "technical|behavioural|domain", "priority": "must|nice", "evidence": ""}]}',
]);

const NICE_MARKERS = /\b(nice[- ]to[- ]have|bonus|a plus|is a plus|are a plus|plus if|preferred|preferably|ideally|desirable|not required|optional|helpful|would be great|great if)\b/i;
const MUST_MARKERS = /\b(required|must|minimum|at least|\d+\+?\s*years|essential|you have|you bring|you'?ll need)\b/i;
const NICE_HEADING = /(nice[- ]to[- ]have|bonus|preferred|plus|extra credit|desirable|good to have)/i;
const NON_REQ_HEADING = /(benefits|perks|we offer|what we offer|compensation|salary|why join|about (us|the company)|equal opportunity|how to apply)/i;
const MUST_HEADING = /(requirements|required|qualifications|must[- ]have|what you('ll)? (need|bring)|you have|about you|who you are|skills)/i;

/** Find the posting line that best contains the evidence, and the heading above it. */
function locate(jdLines: string[], evidence: string): { line: string; heading: string } | null {
  let best = -1;
  let bestScore = 0;
  jdLines.forEach((l, i) => {
    const sc = tokenCoverage(evidence, l);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  });
  if (best < 0 || bestScore < 0.5) return null;
  let heading = "";
  for (let i = best - 1; i >= 0; i--) {
    const l = jdLines[i].trim();
    const looksHeading = l.length > 0 && l.length <= 60 && (/:$/.test(l) || /^#+\s/.test(l) || (!/[.,;]$/.test(l) && tokens(l).length <= 6 && !/^[-*•]/.test(l)));
    if (looksHeading && (NICE_HEADING.test(l) || MUST_HEADING.test(l) || /:$/.test(l) || /^#+/.test(l))) {
      heading = l;
      break;
    }
  }
  return { line: jdLines[best], heading };
}

/**
 * Deterministic guard on the model's output:
 *  1. grounding — a requirement survives only if its evidence quote is
 *     actually in the posting (≥80% of its words present in the JD);
 *  2. priority — the wording of the source line / its section heading
 *     overrides the model's must/nice label when they disagree;
 *  3. dedupe, stable ids r1..rn in posting order.
 */
export function groundRequirements(jd: string, raw: Array<z.infer<typeof RawReq>>): { requirements: Requirement[]; rejected: ExtractedRole["rejected"] } {
  const jdTokens = new Set(tokens(jd));
  const jdNorm = normalise(jd);
  const lines = jd.split(/\r?\n/).filter((l) => l.trim());
  const rejected: ExtractedRole["rejected"] = [];
  const kept: Array<Requirement & { pos: number }> = [];
  const seen = new Set<string>();

  for (const r of raw) {
    // Some free models skip the evidence field; then the requirement text itself must be groundable.
    const evidence = (r.evidence ?? "").trim() || r.text.trim();
    const evNorm = normalise(evidence);
    const grounded = jdNorm.includes(evNorm) || tokenCoverage(evidence, jdTokens) >= 0.8;
    if (!grounded) {
      rejected.push({ text: r.text, reason: "evidence not found in posting" });
      continue;
    }
    // The requirement text itself must also be about what the posting says (not an embellishment).
    if (tokenCoverage(r.text, new Set([...tokens(evidence), ...jdTokens])) < 0.5) {
      rejected.push({ text: r.text, reason: "requirement text not supported by posting" });
      continue;
    }
    const key = normalise(r.text);
    if (seen.has(key)) continue;
    seen.add(key);

    let priority: "must" | "nice" = r.priority.toLowerCase().startsWith("n") ? "nice" : "must";
    const loc = locate(lines, evidence);
    if (loc && NON_REQ_HEADING.test(loc.heading)) {
      rejected.push({ text: r.text, reason: `listed under "${loc.heading}", not a candidate requirement` });
      continue;
    }
    if (loc) {
      if (NICE_MARKERS.test(loc.line) || NICE_MARKERS.test(evidence)) priority = "nice";
      else if (NICE_HEADING.test(loc.heading)) priority = /\b(required|must)\b/i.test(loc.line) ? "must" : "nice";
      else if (MUST_HEADING.test(loc.heading) || MUST_MARKERS.test(loc.line)) priority = "must";
    }
    const kindRaw = r.kind.toLowerCase().replace("behavioral", "behavioural");
    const kind = (REQUIREMENT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as Requirement["kind"]) : "technical";
    const pos = jdNorm.indexOf(evNorm);
    kept.push({ id: "", text: r.text.trim(), kind, priority, evidence, pos: pos < 0 ? Number.MAX_SAFE_INTEGER : pos });
  }
  kept.sort((a, b) => a.pos - b.pos);
  return {
    requirements: kept.map(({ pos: _pos, ...r }, i) => ({ ...r, id: `r${i + 1}` })),
    rejected,
  };
}

export async function extractRequirements(llm: LLMClient, jd: string): Promise<ExtractedRole> {
  const raw = await llm.json({
    label: "extract-requirements",
    system: SYSTEM,
    user: `Extract the role and its requirements from this job posting.\n\n${untrusted("job_posting", jd, 16_000)}`,
    temperature: 0.1,
    parse: (d) => {
      const r = RawSchema.parse(d);
      // Keep individually valid requirement objects; drop malformed ones.
      const reqs = r.requirements.map((x) => RawReq.safeParse(x)).filter((x) => x.success).map((x) => x.data!);
      return { ...r, requirements: reqs };
    },
  });
  const { requirements, rejected } = groundRequirements(jd, raw.requirements);
  const thin = jd.trim().length < 400 || requirements.length <= 2;
  return {
    company: (raw.company ?? "").trim(),
    title: (raw.title ?? "").trim(),
    seniority: (raw.seniority ?? "").trim().toLowerCase(),
    location: (raw.location ?? "").trim(),
    responsibilities: (raw.responsibilities ?? []).map((s) => s.trim()).filter((s) => s && tokenCoverage(s, jd) >= 0.5),
    requirements,
    rejected,
    thin,
  };
}
