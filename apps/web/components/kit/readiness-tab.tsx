"use client";
import type { PracticeState } from "@/lib/types";
import { EmptyState, PriorityChip, Spinner } from "../ui";

const DOT = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-500" } as const;
const LABEL = { red: "Not ready", amber: "Getting there", green: "Ready" } as const;

/** Creative feature: per-requirement readiness from coverage + practice confidence. */
export function ReadinessTab({ state, onPractise }: { state: PracticeState | null; onPractise: () => void }) {
  if (!state) return <div className="flex items-center gap-2 text-sm text-ink-soft" role="status"><Spinner className="h-4 w-4" /> Loading…</div>;
  const r = state.readiness;
  if (!r.length) return <EmptyState title="No requirements to assess">This posting didn't state explicit requirements.</EmptyState>;
  const must = r.filter((x) => x.priority === "must");
  const ready = must.filter((x) => x.status === "green").length;
  const worst = r.find((x) => x.status !== "green");
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-lg font-semibold">{ready} of {must.length} must-haves ready</p>
          <p className="text-sm text-ink-soft">“If they asked about this tomorrow, could I answer?” — based on whether it's covered and how you rated yourself in practice.</p>
        </div>
        {worst && <button className="btn-primary" onClick={onPractise}>Practise weakest first</button>}
      </div>
      <ul className="space-y-2">
        {r.map((x) => (
          <li key={x.requirementId} className="card flex items-start gap-3 p-3">
            <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[x.status]}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{x.text} <PriorityChip p={x.priority} /></p>
              <p className="text-xs text-ink-soft"><span className="font-medium">{LABEL[x.status]}</span> — {x.reason}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-ink-faint">
              <p>{x.questions} question(s)</p>
              <p>{x.cardsPractised}/{x.cards} cards{x.avgConfidence !== null ? ` · ${x.avgConfidence.toFixed(1)}/3` : ""}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
