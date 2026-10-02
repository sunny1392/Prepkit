"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Kit, PracticeState } from "@/lib/types";
import { EmptyState, ErrorBox, Spinner } from "../ui";
import { useToast } from "../providers";

const CONF = [
  { v: 1 as const, label: "Didn't know it", key: "1", cls: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100" },
  { v: 2 as const, label: "Shaky", key: "2", cls: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100" },
  { v: 3 as const, label: "Confident", key: "3", cls: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" },
];

export function usePractice(kitId: string) {
  const [state, setState] = useState<PracticeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setState(await api<PracticeState>(`/kits/${kitId}/practice`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load practice.");
    }
  }, [kitId]);
  useEffect(() => {
    load();
  }, [load]);
  return { state, setState, error, load };
}

export function PracticeTab({ kit, kitId, practice }: { kit: Kit; kitId: string; practice: ReturnType<typeof usePractice> }) {
  const { state, setState, error, load } = practice;
  const toast = useToast();
  const [session, setSession] = useState<string[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const cards = useMemo(() => new Map(kit.flashcards.map((f) => [f.id, f])), [kit.flashcards]);
  const card = session ? cards.get(session[idx]) : undefined;

  const start = () => {
    if (!state) return;
    // Least-confident first (server decides the order); cap a session at 15 cards.
    setSession(state.order.filter((id) => cards.has(id)).slice(0, 15));
    setIdx(0);
    setRevealed(false);
  };

  const rate = useCallback(
    async (confidence: 1 | 2 | 3) => {
      if (!card || saving) return;
      setSaving(true);
      try {
        setState(await api<PracticeState>(`/kits/${kitId}/practice`, { method: "POST", json: { cardId: card.id, confidence } }));
        setIdx((i) => i + 1);
        setRevealed(false);
      } catch (e) {
        toast("error", (e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [card, kitId, saving, setState, toast],
  );

  useEffect(() => {
    if (!session || !card) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if ((e.key === " " || e.key === "Enter") && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key) as 1 | 2 | 3);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, card, revealed, rate]);

  if (error) return <ErrorBox message={error} action={<button className="btn-secondary" onClick={load}>Retry</button>} />;
  if (!state) return <div className="flex items-center gap-2 text-sm text-ink-soft" role="status"><Spinner className="h-4 w-4" /> Loading practice…</div>;
  if (!kit.flashcards.length) return <EmptyState title="No flashcards to practise">Add some on the Flashcards tab.</EmptyState>;

  const p = state.progress;
  const pct = p.total ? Math.round((p.covered / p.total) * 100) : 0;
  const rec = new Map(state.records.map((r) => [r.cardId, r]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {!session || !card ? (
          <div className="card space-y-3 p-6 text-center">
            {session && idx > 0 ? <p className="font-medium">Session done — {idx} card(s) reviewed.</p> : <p className="font-medium">Ready to practise?</p>}
            <p className="text-sm text-ink-soft">Cards you haven't seen come first, then the ones you were least confident about.</p>
            <div className="flex justify-center gap-2">
              <button className="btn-primary" onClick={start} autoFocus>{session ? "Start another session" : "Start session"}</button>
              {p.covered > 0 && (
                <button className="btn-ghost" onClick={async () => { if (confirm("Reset all practice history for this kit?")) { setState(await api<PracticeState>(`/kits/${kitId}/practice`, { method: "DELETE" })); setSession(null); } }}>Reset history</button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft" aria-live="polite">Card {idx + 1} of {session.length}{rec.get(card.id) ? ` · last time: ${CONF[rec.get(card.id)!.confidence - 1].label.toLowerCase()}` : " · new"}</p>
            <div className="card min-h-[14rem] p-6">
              <p className="text-lg font-medium">{card.front}</p>
              {revealed ? (
                <div className="mt-4 whitespace-pre-wrap border-t border-zinc-100 pt-4 text-ink-soft">{card.back || <em>No answer written.</em>}</div>
              ) : (
                <button className="btn-secondary mt-6" onClick={() => setRevealed(true)} autoFocus>Reveal answer <kbd className="ml-1 rounded bg-zinc-100 px-1 text-xs">Space</kbd></button>
              )}
            </div>
            {revealed && (
              <div role="group" aria-label="How confident were you?" className="grid grid-cols-3 gap-2">
                {CONF.map((c) => (
                  <button key={c.v} disabled={saving} onClick={() => rate(c.v)} className={`btn border ${c.cls}`} autoFocus={c.v === 2}>
                    {c.label} <kbd className="rounded bg-white/70 px-1 text-xs">{c.key}</kbd>
                  </button>
                ))}
              </div>
            )}
            <button className="btn-ghost text-xs" onClick={() => setSession(null)}>End session</button>
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <div className="card p-4">
          <p className="text-sm font-medium">Covered {p.covered} of {p.total} cards</p>
          <div className="mt-2 h-2 overflow-hidden rounded bg-zinc-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Cards practised">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div><dt className="text-ink-faint">Confident</dt><dd className="text-lg font-semibold text-emerald-700">{p.confident}</dd></div>
            <div><dt className="text-ink-faint">Shaky</dt><dd className="text-lg font-semibold text-amber-700">{p.shaky}</dd></div>
            <div><dt className="text-ink-faint">Weak</dt><dd className="text-lg font-semibold text-red-700">{p.weak}</dd></div>
          </dl>
        </div>
        <div className="card p-4">
          <p className="text-sm font-medium">Not yet practised</p>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-ink-soft">
            {kit.flashcards.filter((f) => !rec.has(f.id)).map((f) => <li key={f.id} className="truncate">{f.front}</li>)}
            {p.remaining === 0 && <li>Everything has been covered at least once.</li>}
          </ul>
        </div>
      </aside>
    </div>
  );
}
