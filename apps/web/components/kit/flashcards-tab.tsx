"use client";
import { useState } from "react";
import type { Flashcard, Kit } from "@/lib/types";
import type { Op } from "@/lib/use-kit-editor";
import { InlineText } from "./inline-text";
import { MetaBadges, PinButton } from "./meta-badges";
import { RegenerateButton } from "./regenerate-button";
import { SortableItem, SortableList } from "./sortable";
import { EmptyState } from "../ui";

const preserved = (f: Flashcard) => !!f.meta && (f.meta.origin === "user" || f.meta.edited || f.meta.pinned);

export function FlashcardsTab({ kit, dispatch, busy, onRegenerate }: { kit: Kit; dispatch: (...o: Op[]) => void; busy: boolean; onRegenerate: () => void }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const keep = kit.flashcards.filter(preserved).length;
  return (
    <div className="space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-soft">{kit.flashcards.length} cards. Edit inline; drag to reorder.</p>
        <RegenerateButton label="flashcards" keepCount={keep} replaceCount={kit.flashcards.length - keep} busy={busy} onConfirm={onRegenerate} />
      </div>
      <form
        className="card grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!front.trim()) return;
          dispatch({ op: "addFlashcard", card: { front: front.trim(), back: back.trim(), requirement_ids: [] } });
          setFront("");
          setBack("");
        }}
      >
        <label className="sr-only" htmlFor="nf-front">Front</label>
        <input id="nf-front" className="input" placeholder="Front (question or prompt)" value={front} onChange={(e) => setFront(e.target.value)} />
        <label className="sr-only" htmlFor="nf-back">Back</label>
        <input id="nf-back" className="input" placeholder="Back (what to recall)" value={back} onChange={(e) => setBack(e.target.value)} />
        <button className="btn-primary" disabled={!front.trim()}>Add card</button>
      </form>
      {kit.flashcards.length === 0 ? (
        <EmptyState title="No flashcards">Add one above or regenerate.</EmptyState>
      ) : (
        <SortableList ids={kit.flashcards.map((f) => f.id)} onReorder={(ids) => dispatch({ op: "reorderFlashcards", ids })} label="flashcards">
          {kit.flashcards.map((f) => (
            <SortableItem key={f.id} id={f.id}>
              {(handle) => (
                <article className="card flex gap-2 p-3" aria-label={`Flashcard ${f.id}`}>
                  {handle}
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Front</p>
                      <InlineText label={`Front of ${f.id}`} value={f.front} multiline className="font-medium" onCommit={(v) => dispatch({ op: "editFlashcard", id: f.id, patch: { front: v } })} />
                    </div>
                    <div>
                      <p className="px-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Back</p>
                      <InlineText label={`Back of ${f.id}`} value={f.back} multiline className="text-sm text-ink-soft" onCommit={(v) => dispatch({ op: "editFlashcard", id: f.id, patch: { back: v } })} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 px-1.5 text-xs sm:col-span-2">
                      <MetaBadges meta={f.meta} />
                      {f.requirement_ids.map((r) => <span key={r} className="chip bg-zinc-100 text-ink-soft">{r}</span>)}
                      <span className="flex-1" />
                      <PinButton pinned={!!f.meta?.pinned} label={`flashcard ${f.id}`} onToggle={() => dispatch({ op: "pin", kind: "flashcard", id: f.id, pinned: !f.meta?.pinned })} />
                      <button className="btn-danger px-2 text-xs" onClick={() => dispatch({ op: "deleteFlashcard", id: f.id })} aria-label={`Delete flashcard ${f.id}`}>Delete</button>
                    </div>
                  </div>
                </article>
              )}
            </SortableItem>
          ))}
        </SortableList>
      )}
    </div>
  );
}
