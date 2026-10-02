import { mockTarget, type LLMRequest, type LLMTarget } from "./providers.js";

/**
 * Offline stand-in for an LLM, used by the test suite and by
 * `LLM_PROVIDER_ORDER=mock` (smoke-testing the pipeline with no API key).
 * It is rule-based: it reads bullet lines out of the untrusted job posting
 * block and templates questions from them. It is NOT a substitute for a real
 * model — just enough to exercise every step and the coverage loop.
 */

const block = (user: string, label: string) => user.match(new RegExp(`<untrusted_${label}>\\n([\\s\\S]*?)\\n</untrusted_${label}>`))?.[1] ?? "";

const TECH = /react|node|typescript|javascript|python|go\b|java|sql|postgres|kafka|aws|docker|kubernetes|api|graphql|css|testing|ci|linux|redis|mongo/i;
const BEH = /mentor|communicat|collaborat|lead|ownership|stakeholder|team|feedback|autonom/i;

function extract(user: string) {
  const jd = block(user, "job_posting");
  const lines = jd.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ?? "";
  let section = "";
  const requirements: unknown[] = [];
  for (const l of lines.slice(1)) {
    if (/:$/.test(l) || (!/^[-*•]/.test(l) && l.length < 40)) {
      section = l.toLowerCase();
      continue;
    }
    if (!/^[-*•]/.test(l)) continue;
    const text = l.replace(/^[-*•]\s*/, "");
    if (/responsib|you will|what you'll do/.test(section)) continue;
    requirements.push({
      text,
      kind: BEH.test(text) ? "behavioural" : TECH.test(text) ? "technical" : "domain",
      priority: /nice|bonus|plus|prefer/.test(section) || /a plus|bonus/i.test(text) ? "nice" : "must",
      evidence: text,
    });
  }
  if (!requirements.length) {
    const m = jd.match(new RegExp(TECH.source, "i"));
    if (m) requirements.push({ text: `${m[0]} experience`, kind: "technical", priority: "must", evidence: m[0] });
  }
  const responsibilities = lines.filter((l) => /^[-*•]/.test(l) && /build|own|design|ship|work/i.test(l)).slice(0, 4).map((l) => l.replace(/^[-*•]\s*/, ""));
  return { company: "", title, seniority: /senior/i.test(title) ? "senior" : "", location: "", responsibilities, requirements };
}

function reqsFrom(user: string) {
  return block(user, "requirements")
    .split("\n")
    .map((l) => l.match(/^(r\d+) \[(must|nice)\](?: \[(\w+)\])? (.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ id: m[1], text: m[4] }));
}

function questions(req: LLMRequest) {
  const cat = req.system.match(/writing ([a-z-]+) interview questions/)?.[1] ?? "technical";
  const count = Number(req.system.match(/Write exactly (\d+) questions/)?.[1] ?? 3);
  const reqs = reqsFrom(req.user);
  const gap = /fill coverage gaps/.test(req.system);
  // Deliberately skip the last requirement on the first pass so the coverage loop has a gap to close.
  const use = gap ? reqs : reqs.slice(0, Math.max(1, reqs.length - 1));
  const out = [];
  const n = gap ? use.length : Math.max(count, 1);
  for (let i = 0; i < n; i++) {
    const r = use[i % Math.max(use.length, 1)];
    out.push({
      prompt: r ? `(${cat}) How have you applied "${r.text}" in practice? Give a specific example #${i + 1}.` : `(${cat}) Why do you want this role? #${i + 1}`,
      answer_outline: "Context\nWhat you did\nResult\nWhat you learned",
      difficulty: (i % 3) + 1,
      requirement_ids: r ? [r.id] : [],
    });
  }
  return { questions: out };
}

function brief(user: string) {
  const pages = block(user, "company_pages");
  const urls = [...pages.matchAll(/^URL: (\S+)/gm)].map((m) => m[1]);
  const first = pages.split("\n").find((l) => l && !/^(URL|TITLE|KIND):/.test(l)) ?? "";
  const hiring = pages.split("---").find((p) => /KIND: hiring/.test(p) && /interview/i.test(p));
  const hiringUrl = hiring?.match(/^URL: (\S+)/m)?.[1];
  const stageNames = hiring ? [...hiring.matchAll(/(take-home|system design|values interview|recruiter call|pair programming|phone screen)/gi)].map((m) => m[1]) : [];
  return {
    summary: first ? `From the company's site: ${first.slice(0, 200)}` : "No information found.",
    what_they_do: first.slice(0, 160),
    sources: urls.slice(0, 3),
    interview_process: { found: stageNames.length > 0, stages: [...new Set(stageNames.map((s) => s.toLowerCase()))].map((s) => ({ name: s, description: `Stage: ${s}`, source: hiringUrl })) },
  };
}

function flashcards(user: string) {
  return { flashcards: reqsFrom(user).map((r) => ({ front: `Key points: ${r.text}`, back: "Your strongest example and the trade-offs you'd mention.", requirement_ids: [r.id] })) };
}

export function heuristicMockTarget(): LLMTarget {
  return mockTarget((req) => {
    const s = req.system;
    if (/extract structured hiring requirements/.test(s)) return JSON.stringify(extract(req.user));
    if (/company brief/.test(s)) return JSON.stringify(brief(req.user));
    if (/flashcards/.test(s)) return JSON.stringify(flashcards(req.user));
    if (/interview questions|fill coverage gaps/.test(s)) return JSON.stringify(questions(req));
    return "{}";
  }, "heuristic-mock");
}
