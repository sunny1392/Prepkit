"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as ops from "@prepkit/core/src/kit/operations";
import type { Kit } from "./types";
import { api, ApiError } from "./api";

/** Mirrors the API's operation union. Each is applied locally first (optimistic) with the same pure function the server uses. */
export type Op =
  | { op: "editQuestion"; id: string; patch: ops.QuestionPatch }
  | { op: "addQuestion"; question: { category: Kit["questions"][number]["category"]; prompt: string; answer_outline: string; difficulty: number; requirement_ids: string[] } }
  | { op: "deleteQuestion"; id: string }
  | { op: "moveQuestion"; id: string; category: Kit["questions"][number]["category"]; index: number }
  | { op: "reorderCategory"; category: Kit["questions"][number]["category"]; ids: string[] }
  | { op: "pin"; kind: "question" | "flashcard"; id: string; pinned: boolean }
  | { op: "editFlashcard"; id: string; patch: { front?: string; back?: string; requirement_ids?: string[] } }
  | { op: "addFlashcard"; card: { front: string; back: string; requirement_ids: string[] } }
  | { op: "deleteFlashcard"; id: string }
  | { op: "reorderFlashcards"; ids: string[] }
  | { op: "editBrief"; patch: { summary?: string; what_they_do?: string } }
  | { op: "pinBrief"; pinned: boolean }
  | { op: "editScheduleDay"; day: number; patch: { focus?: string; minutes?: number; question_ids?: string[] } }
  | { op: "pinSchedule"; pinned: boolean };

function applyLocal(kit: Kit, o: Op): Kit {
  const k = structuredClone(kit);
  switch (o.op) {
    case "editQuestion": return ops.editQuestion(k, o.id, o.patch);
    case "addQuestion": return ops.addQuestion(k, o.question);
    case "deleteQuestion": return ops.deleteQuestion(k, o.id);
    case "moveQuestion": return ops.moveQuestion(k, o.id, o.category, o.index);
    case "reorderCategory": return ops.reorderCategory(k, o.category, o.ids);
    case "pin": return ops.setPinned(k, o.kind, o.id, o.pinned);
    case "editFlashcard": return ops.editFlashcard(k, o.id, o.patch);
    case "addFlashcard": return ops.addFlashcard(k, o.card);
    case "deleteFlashcard": return ops.deleteFlashcard(k, o.id);
    case "reorderFlashcards": return ops.reorderFlashcards(k, o.ids);
    case "editBrief": return ops.editBrief(k, o.patch);
    case "pinBrief": return ops.setBriefPinned(k, o.pinned);
    case "editScheduleDay": return ops.editScheduleDay(k, o.day, o.patch);
    case "pinSchedule":
      k.schedule.meta = { ...(k.schedule.meta ?? { origin: "generated", edited: false, generation_id: "", updated_at: "" }), pinned: o.pinned, updated_at: new Date().toISOString() };
      return k;
  }
}

/** Replay pending ops on top of a base kit, dropping any that no longer apply (e.g. the item was deleted elsewhere). */
function replay(base: Kit, pending: Op[]): Kit {
  return pending.reduce((k, o) => {
    try {
      return applyLocal(k, o);
    } catch {
      return k;
    }
  }, base);
}

export type SaveState = "saved" | "saving" | "error" | "conflict";

/**
 * Kit editing state machine.
 *  - Every change is applied locally at once (no round-trip per keystroke —
 *    text fields additionally debounce before dispatching).
 *  - Ops queue up and are sent in batches, one request in flight at a time,
 *    each carrying the version it was based on.
 *  - On 409 (another tab, or a regeneration landed) we take the server's kit
 *    and replay our unsent ops on top of it, then retry — a rebase, not a clobber.
 */
export function useKitEditor(kitId: string, initial: { kit: Kit; version: number }) {
  const [kit, setKit] = useState<Kit>(initial.kit);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastError, setLastError] = useState<string | null>(null);
  const confirmed = useRef(initial);
  const pending = useRef<Op[]>([]);
  const inflight = useRef(false);
  const conflicts = useRef(0);

  const flush = useCallback(async () => {
    if (inflight.current || pending.current.length === 0) return;
    inflight.current = true;
    const batch = pending.current.splice(0, 50);
    setSaveState("saving");
    try {
      const r = await api<{ kit: Kit; version: number }>(`/kits/${kitId}/ops`, { method: "POST", json: { version: confirmed.current.version, ops: batch } });
      conflicts.current = 0;
      if (r.version > confirmed.current.version) confirmed.current = { kit: r.kit, version: r.version };
      setKit(replay(confirmed.current.kit, pending.current));
      setLastError(null);
      setSaveState(pending.current.length ? "saving" : "saved");
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "VERSION_CONFLICT" && conflicts.current < 3) {
        conflicts.current++;
        const d = err.details as { kit: Kit; version: number };
        confirmed.current = { kit: d.kit, version: d.version };
        pending.current.unshift(...batch); // rebase and retry
        setKit(replay(confirmed.current.kit, pending.current));
        setSaveState("conflict");
      } else {
        // Drop the rejected batch; show the last good server state plus anything still queued.
        setKit(replay(confirmed.current.kit, pending.current));
        setLastError(err.message);
        setSaveState("error");
      }
    } finally {
      inflight.current = false;
      if (pending.current.length) setTimeout(flush, 0);
    }
  }, [kitId]);

  const dispatch = useCallback(
    (...newOps: Op[]) => {
      setKit((k) => {
        let next = k;
        for (const o of newOps) {
          try {
            next = applyLocal(next, o);
          } catch (e) {
            setLastError((e as Error).message);
          }
        }
        return next;
      });
      pending.current.push(...newOps);
      void flush();
    },
    [flush],
  );

  /** A regeneration (or reload) produced a newer server kit: adopt it and replay unsent edits. */
  const adoptServerKit = useCallback((serverKit: Kit, version: number) => {
    if (version < confirmed.current.version) return;
    confirmed.current = { kit: serverKit, version };
    setKit(replay(serverKit, pending.current));
  }, []);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (pending.current.length || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  return { kit, dispatch, saveState, lastError, adoptServerKit, version: () => confirmed.current.version };
}
