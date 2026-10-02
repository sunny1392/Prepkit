import { z } from "zod";
import type { LLMClient } from "../llm/client.js";
import { system, untrusted } from "../llm/prompts.js";
import type { Question, Requirement } from "../kit/schema.js";

export interface DraftFlashcard {
  front: string;
  back: string;
  requirement_ids: string[];
}

const Raw = z.object({ flashcards: z.array(z.unknown()) });
const RawF = z.object({ front: z.string().min(3), back: z.string().min(1), requirement_ids: z.array(z.string()).nullish() });

export async function generateFlashcards(llm: LLMClient, requirements: Requirement[], questions: Question[], ctx: { roleTitle: string; companyName: string; companySummary: string }): Promise<DraftFlashcard[]> {
  const ids = new Set(requirements.map((r) => r.id));
  const target = Math.min(24, Math.max(4, requirements.length * 2));
  const sys = system("You write concise study flashcards for interview preparation.", [
    `Write about ${target} flashcards. At least one per must-have requirement.`,
    "front: a short question, concept or prompt (max 25 words). back: the key points to recall (max 70 words). Facts only — no filler.",
    "Mix concept recall (e.g. 'When would you choose X over Y?'), personal prep prompts (e.g. 'Your 30-second story for mentoring'), and company facts ONLY if stated in the company summary.",
    "requirement_ids: ids from the list that the card supports.",
    'Shape: {"flashcards": [{"front": "", "back": "", "requirement_ids": ["r1"]}]}',
  ]);
  const user = [
    `Role: ${ctx.roleTitle || "unspecified"} at ${ctx.companyName || "the company"}.`,
    `Company summary: ${ctx.companySummary || "nothing known"}`,
    "Requirements (id [priority] text):",
    untrusted("requirements", requirements.map((r) => `${r.id} [${r.priority}] ${r.text}`).join("\n") || "(none)", 5000),
    "Questions in the kit (for context):",
    untrusted("questions", questions.slice(0, 30).map((q) => `- ${q.prompt}`).join("\n"), 5000),
  ].join("\n");

  return llm.json({
    label: "flashcards",
    system: sys,
    user,
    temperature: 0.4,
    parse: (d) => {
      const out: DraftFlashcard[] = [];
      for (const item of Raw.parse(d).flashcards) {
        const f = RawF.safeParse(item);
        if (!f.success) continue;
        out.push({ front: f.data.front.trim(), back: f.data.back.trim(), requirement_ids: [...new Set((f.data.requirement_ids ?? []).filter((id) => ids.has(id)))] });
      }
      if (!out.length) throw new Error("no valid flashcards in response");
      return out;
    },
  });
}

/** Deterministic cards for must-haves the model left without one, built from the kit's own questions. */
export function fallbackFlashcards(requirements: Requirement[], questions: Question[], existing: DraftFlashcard[]): DraftFlashcard[] {
  const covered = new Set(existing.flatMap((f) => f.requirement_ids));
  const out: DraftFlashcard[] = [];
  for (const r of requirements) {
    if (r.priority !== "must" || covered.has(r.id)) continue;
    const q = questions.find((x) => x.requirement_ids.includes(r.id));
    out.push({
      front: q ? q.prompt : `What evidence will you give for: ${r.text}?`,
      back: q?.answer_outline || `Prepare one concrete example showing: ${r.text}.`,
      requirement_ids: [r.id],
    });
  }
  return out;
}
