"use client";
import { useState } from "react";
import type { Kit, Question, QuestionCategory } from "@/lib/types";
import type { Op } from "@/lib/use-kit-editor";
import { InlineText } from "./inline-text";
import { MetaBadges, PinButton } from "./meta-badges";
import { RegenerateButton } from "./regenerate-button";
import { SortableItem, SortableList } from "./sortable";
import { EmptyState, PriorityChip } from "../ui";

export const CATEGORIES: Array<{ id: QuestionCategory; label: string; blurb: string }> = [
  { id: "technical", label: "Technical", blurb: "Depth in the technical and domain requirements" },
  { id: "behavioural", label: "Behavioural", blurb: "'Tell me about a time…' for the behavioural requirements" },
  { id: "system-design", label: "System design", blurb: "Architecture and trade-offs" },
  { id: "company-fit", label: "Company fit", blurb: "Motivation, mission and values" },
];
const preserved = (q: Question) => !!q.meta && (q.meta.origin === "user" || q.meta.edited || q.meta.pinned);

export function QuestionsTab({ kit, dispatch, regenerating, onRegenerate }: { kit: Kit; dispatch: (...o: Op[]) => void; regenerating: Set<string>; onRegenerate: (section: string) => void }) {
  const [filter, setFilter] = useState<QuestionCategory | "all">("all");
  const shown = CATEGORIES.filter((c) => filter === "all" || c.id === filter);
  return (
    <div className="space-y-6">
      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
        {[{ id: "all" as const, label: "All" }, ...CATEGORIES].map((c) => {
          const n = c.id === "all" ? kit.questions.length : kit.questions.filter((q) => q.category === c.id).length;
          return (
            <button key={c.id} aria-pressed={filter === c.id} onClick={() => setFilter(c.id)} className={`chip px-3 py-1 text-sm ${filter === c.id ? "bg-brand text-white" : "bg-white text-ink-soft ring-1 ring-zinc-200 hover:bg-zinc-100"}`}>
              {c.label} <span className="ml-1 opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.map((c) => (
        <CategorySection key={c.id} kit={kit} category={c} dispatch={dispatch} busy={regenerating.has(`questions:${c.id}`)} onRegenerate={() => onRegenerate(`questions:${c.id}`)} />
      ))}
    </div>
  );
}

function CategorySection({ kit, category, dispatch, busy, onRegenerate }: { kit: Kit; category: (typeof CATEGORIES)[number]; dispatch: (...o: Op[]) => void; busy: boolean; onRegenerate: () => void }) {
  const qs = kit.questions.filter((q) => q.category === category.id);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const keep = qs.filter(preserved).length;
  return (
    <section aria-labelledby={`cat-${category.id}`} className="space-y-3" aria-busy={busy}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id={`cat-${category.id}`} className="font-semibold">{category.label} <span className="font-normal text-ink-faint">({qs.length})</span></h3>
          <p className="text-xs text-ink-soft">{category.blurb}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setAdding(true)}>+ Add question</button>
          <RegenerateButton label={category.label.toLowerCase()} keepCount={keep} replaceCount={qs.length - keep} busy={busy} onConfirm={onRegenerate} />
        </div>
      </div>
      {busy && <div className="h-1 overflow-hidden rounded bg-indigo-100"><div className="h-full w-1/3 animate-pulseBar bg-brand" /></div>}
      {adding && (
        <form
          className="card flex flex-col gap-2 p-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            dispatch({ op: "addQuestion", question: { category: category.id, prompt: draft.trim(), answer_outline: "", difficulty: 2, requirement_ids: [] } });
            setDraft("");
            setAdding(false);
          }}
        >
          <label htmlFor={`add-${category.id}`} className="sr-only">New {category.label} question</label>
          <input id={`add-${category.id}`} autoFocus className="input" placeholder="Type your question…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!draft.trim()}>Add</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      {qs.length === 0 ? (
        <EmptyState title={`No ${category.label.toLowerCase()} questions`}>
          {category.id === "system-design" ? "The company didn't publish a system design round and the role isn't senior, so none were generated. Add your own or regenerate." : "Add your own, or regenerate this category."}
        </EmptyState>
      ) : (
        <SortableList ids={qs.map((q) => q.id)} onReorder={(ids) => dispatch({ op: "reorderCategory", category: category.id, ids })} label={`${category.label} questions`}>
          {qs.map((q) => (
            <SortableItem key={q.id} id={q.id}>
              {(handle) => <QuestionCard q={q} kit={kit} dispatch={dispatch} handle={handle} />}
            </SortableItem>
          ))}
        </SortableList>
      )}
    </section>
  );
}

function QuestionCard({ q, kit, dispatch, handle }: { q: Question; kit: Kit; dispatch: (...o: Op[]) => void; handle: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const reqs = kit.role.requirements.filter((r) => q.requirement_ids.includes(r.id));
  return (
    <article className="card flex gap-2 p-3" aria-label={`Question ${q.id}`}>
      {handle}
      <div className="min-w-0 flex-1 space-y-2">
        <InlineText label={`Question ${q.id} prompt`} value={q.prompt} multiline className="font-medium" onCommit={(v) => dispatch({ op: "editQuestion", id: q.id, patch: { prompt: v } })} />
        <div className="flex flex-wrap items-center gap-1.5 px-1.5 text-xs">
          <MetaBadges meta={q.meta} />
          {reqs.map((r) => (
            <span key={r.id} className="chip bg-zinc-100 text-ink-soft" title={r.text}>
              {r.id} · {r.text.length > 28 ? `${r.text.slice(0, 26)}…` : r.text}
            </span>
          ))}
          {!reqs.length && <span className="text-ink-faint">General — not tied to a requirement</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 px-1.5">
          <button className="btn-ghost px-2 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide" : "Show"} answer outline</button>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Difficulty
            <select className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs" value={q.difficulty} onChange={(e) => dispatch({ op: "editQuestion", id: q.id, patch: { difficulty: Number(e.target.value) } })}>
              <option value={1}>1 · warm-up</option>
              <option value={2}>2 · solid</option>
              <option value={3}>3 · hard</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Move to
            <select
              className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs"
              value={q.category}
              onChange={(e) => {
                const category = e.target.value as Question["category"];
                dispatch({ op: "moveQuestion", id: q.id, category, index: kit.questions.filter((x) => x.category === category).length });
              }}
            >
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <details className="relative text-xs">
            <summary className="btn-ghost cursor-pointer list-none px-2 text-xs">Requirements…</summary>
            <fieldset className="absolute left-0 z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
              <legend className="sr-only">Requirements this question covers</legend>
              {kit.role.requirements.map((r) => (
                <label key={r.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-zinc-50">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={q.requirement_ids.includes(r.id)}
                    onChange={(e) => dispatch({ op: "editQuestion", id: q.id, patch: { requirement_ids: e.target.checked ? [...q.requirement_ids, r.id] : q.requirement_ids.filter((x) => x !== r.id) } })}
                  />
                  <span><PriorityChip p={r.priority} /> {r.text}</span>
                </label>
              ))}
              {!kit.role.requirements.length && <p className="p-1 text-ink-faint">No requirements were extracted.</p>}
            </fieldset>
          </details>
          <span className="flex-1" />
          <PinButton pinned={!!q.meta?.pinned} label={`question ${q.id}`} onToggle={() => dispatch({ op: "pin", kind: "question", id: q.id, pinned: !q.meta?.pinned })} />
          <button className="btn-danger px-2 text-xs" onClick={() => dispatch({ op: "deleteQuestion", id: q.id })} aria-label={`Delete question ${q.id}`}>Delete</button>
        </div>
        {open && (
          <div className="rounded-md bg-zinc-50 p-1">
            <InlineText label={`Answer outline for ${q.id}`} value={q.answer_outline} multiline className="whitespace-pre-wrap text-sm text-ink-soft" placeholder="Add an answer outline…" onCommit={(v) => dispatch({ op: "editQuestion", id: q.id, patch: { answer_outline: v } })} />
          </div>
        )}
      </div>
    </article>
  );
}
