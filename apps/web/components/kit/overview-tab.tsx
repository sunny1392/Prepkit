"use client";
import type { Kit } from "@/lib/types";
import type { Op } from "@/lib/use-kit-editor";
import { InlineText } from "./inline-text";
import { MetaBadges, PinButton } from "./meta-badges";
import { RegenerateButton } from "./regenerate-button";
import { Notice, PriorityChip } from "../ui";

export function OverviewTab({ kit, dispatch, busy, onRegenerate }: { kit: Kit; dispatch: (...o: Op[]) => void; busy: boolean; onRegenerate: (section: string, force?: boolean) => void }) {
  const b = kit.company_brief;
  const coverage = new Map(kit.role.requirements.map((r) => [r.id, kit.questions.filter((q) => q.requirement_ids.includes(r.id)).length]));
  const notes = kit.research?.notes ?? [];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <section className="card space-y-3 p-4" aria-labelledby="brief-h" aria-busy={busy}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="brief-h" className="font-semibold">Company brief</h3>
          <div className="flex items-center gap-1">
            <MetaBadges meta={b.meta} />
            <PinButton pinned={!!b.meta?.pinned} label="company brief" onToggle={() => dispatch({ op: "pinBrief", pinned: !b.meta?.pinned })} />
            <RegenerateButton
              label="brief"
              keepCount={0}
              replaceCount={1}
              busy={busy}
              disabled={!!b.meta?.pinned}
              disabledReason="Unpin the brief to regenerate it"
              warn={b.meta?.edited ? "You've edited this brief — regenerating will replace your edits. Pin it instead to keep them." : undefined}
              onConfirm={() => onRegenerate("company_brief", !!b.meta?.edited)}
            />
          </div>
        </div>
        <div>
          <p className="px-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Summary</p>
          <InlineText label="Company summary" value={b.summary} multiline onCommit={(v) => dispatch({ op: "editBrief", patch: { summary: v } })} />
        </div>
        <div>
          <p className="px-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">What they do</p>
          <InlineText label="What they do" value={b.what_they_do} multiline onCommit={(v) => dispatch({ op: "editBrief", patch: { what_they_do: v } })} />
        </div>
        <div className="px-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Sources</p>
          {b.sources.length ? (
            <ul className="mt-1 space-y-0.5 text-sm">
              {b.sources.map((s) => <li key={s} className="truncate"><a className="text-brand hover:underline" href={s} target="_blank" rel="noreferrer noopener">{s}</a></li>)}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">None — nothing could be retrieved, so nothing is claimed.</p>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="process-h">
        <h3 id="process-h" className="font-semibold">Interview process</h3>
        {kit.interview_process?.found ? (
          <ol className="space-y-2">
            {kit.interview_process.stages.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{i + 1}</span>
                <div>
                  <p className="font-medium capitalize">{s.name}</p>
                  {s.description && <p className="text-ink-soft">{s.description}</p>}
                  {s.source && <a className="text-xs text-brand hover:underline" href={s.source} target="_blank" rel="noreferrer noopener">source</a>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-soft">The company doesn't publish its interview process anywhere we could find, and no public discussion turned up. Questions use general formats rather than guessing at theirs.</p>
        )}
        {notes.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">What research found (and didn't)</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        {!!kit.research?.skipped_sources.length && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-soft">{kit.research.skipped_sources.length} source(s) skipped</summary>
            <ul className="mt-1 space-y-1 text-xs text-ink-soft">{kit.research.skipped_sources.map((s) => <li key={s.url} className="break-all">{s.url} — {s.reason}</li>)}</ul>
          </details>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">{kit.source.pages_used.length} page(s) read</summary>
          <ul className="mt-1 space-y-0.5 text-xs">{kit.source.pages_used.map((u) => <li key={u} className="break-all"><a className="text-brand hover:underline" href={u} target="_blank" rel="noreferrer noopener">{u}</a></li>)}</ul>
        </details>
      </section>

      <section className="card space-y-3 p-4 lg:col-span-2" aria-labelledby="role-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="role-h" className="font-semibold">{kit.role.title || "Role"} {kit.role.seniority && <span className="font-normal text-ink-soft">· {kit.role.seniority}</span>}</h3>
          <span className="text-xs text-ink-faint">{kit.source.location || "Location not stated"} · {kit.source.jd_chars.toLocaleString()} chars</span>
        </div>
        {kit.research?.thin_jd && <Notice tone="warn">This posting says very little, so the kit is deliberately small. Requirements below are only what the posting actually states.</Notice>}
        {kit.role.responsibilities.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Responsibilities</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{kit.role.responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Requirements and how many questions cover each</caption>
            <thead className="text-xs uppercase tracking-wide text-ink-faint">
              <tr><th className="py-2 pr-3">ID</th><th className="py-2 pr-3">Requirement</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Priority</th><th className="py-2">Questions</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {kit.role.requirements.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 font-mono text-xs text-ink-faint">{r.id}</td>
                  <td className="py-2 pr-3">
                    {r.text}
                    {r.evidence && <p className="text-xs italic text-ink-faint">“{r.evidence}”</p>}
                  </td>
                  <td className="py-2 pr-3 capitalize text-ink-soft">{r.kind}</td>
                  <td className="py-2 pr-3"><PriorityChip p={r.priority} /></td>
                  <td className={`py-2 font-medium ${coverage.get(r.id) ? "text-emerald-700" : r.priority === "must" ? "text-red-700" : "text-ink-faint"}`}>{coverage.get(r.id) || "none"}</td>
                </tr>
              ))}
              {!kit.role.requirements.length && <tr><td colSpan={5} className="py-3 text-ink-soft">No explicit requirements could be found in this posting.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-faint">Coverage checked in {kit.coverage.passes} pass(es). {kit.coverage.uncovered_requirement_ids.length ? `Uncovered: ${kit.coverage.uncovered_requirement_ids.join(", ")}` : "Every requirement has at least one question."}</p>
      </section>
    </div>
  );
}
