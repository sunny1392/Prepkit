"use client";
import type { Kit } from "@/lib/types";
import type { Op } from "@/lib/use-kit-editor";
import { InlineText } from "./inline-text";
import { MetaBadges, PinButton } from "./meta-badges";
import { RegenerateButton } from "./regenerate-button";

const CAT_DOT: Record<string, string> = { technical: "bg-indigo-500", behavioural: "bg-emerald-500", "system-design": "bg-amber-500", "company-fit": "bg-pink-500" };

export function ScheduleTab({ kit, dispatch, busy, onRegenerate }: { kit: Kit; dispatch: (...o: Op[]) => void; busy: boolean; onRegenerate: () => void }) {
  const s = kit.schedule;
  const qById = new Map(kit.questions.map((q) => [q.id, q]));
  const total = s.days.reduce((n, d) => n + d.minutes, 0);
  const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
  const musts = kit.role.requirements.filter((r) => r.priority === "must");
  const unscheduledMust = musts.filter((r) => !kit.questions.some((q) => q.requirement_ids.includes(r.id) && scheduled.has(q.id)));
  const unscheduledQs = kit.questions.filter((q) => !scheduled.has(q.id));
  const edited = !!s.meta?.edited;

  return (
    <div className="space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-soft">
          <strong className="text-ink">{s.days_available}</strong> day(s) · <strong className="text-ink">{Math.round(total / 6) / 10}</strong> hours total ·{" "}
          {unscheduledMust.length ? <span className="text-red-700">{unscheduledMust.length} must-have(s) not scheduled</span> : <span className="text-emerald-700">every must-have is scheduled</span>}
          <p className="text-xs text-ink-faint">Hardest and must-have material comes first; later days revisit it on a spaced schedule.</p>
        </div>
        <div className="flex items-center gap-1">
          <MetaBadges meta={s.meta} />
          <PinButton pinned={!!s.meta?.pinned} label="schedule" onToggle={() => dispatch({ op: "pinSchedule", pinned: !s.meta?.pinned })} />
          <RegenerateButton
            label="schedule"
            keepCount={0}
            replaceCount={s.days.length}
            busy={busy}
            disabled={!!s.meta?.pinned}
            disabledReason="Unpin the schedule to rebuild it"
            warn={edited ? "You've edited the schedule — rebuilding replaces those edits. Questions themselves are not touched." : undefined}
            onConfirm={onRegenerate}
          />
        </div>
      </div>
      {unscheduledQs.length > 0 && <p className="text-xs text-amber-800">{unscheduledQs.length} question(s) aren't on any day. Rebuild the schedule to include them.</p>}
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {s.days.map((d) => (
          <li key={d.day} className="card space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Day {d.day}</span>
              <label className="flex items-center gap-1 text-xs text-ink-soft">
                <input
                  type="number"
                  min={0}
                  max={1440}
                  defaultValue={d.minutes}
                  key={`${d.day}-${d.minutes}`}
                  aria-label={`Minutes for day ${d.day}`}
                  className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right"
                  onBlur={(e) => {
                    const m = Math.round(Number(e.target.value));
                    if (Number.isFinite(m) && m !== d.minutes) dispatch({ op: "editScheduleDay", day: d.day, patch: { minutes: m } });
                  }}
                />
                min
              </label>
            </div>
            <InlineText label={`Focus for day ${d.day}`} value={d.focus} className="text-sm text-ink-soft" onCommit={(v) => dispatch({ op: "editScheduleDay", day: d.day, patch: { focus: v } })} />
            <ul className="space-y-1">
              {d.question_ids.map((id, i) => {
                const q = qById.get(id);
                if (!q) return null;
                return (
                  <li key={`${id}-${i}`} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${CAT_DOT[q.category]}`} aria-hidden />
                    <span className="line-clamp-2"><span className="font-mono text-ink-faint">{id}</span> {q.prompt}</span>
                  </li>
                );
              })}
              {!d.question_ids.length && <li className="text-xs text-ink-faint">Research the company and re-read the posting.</li>}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
