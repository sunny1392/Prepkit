"use client";
import { useState } from "react";
import { Modal, Spinner } from "../ui";

/**
 * Regenerate one section. Confirms first and says exactly what will be kept,
 * so nobody loses work by surprise.
 */
export function RegenerateButton({
  label,
  keepCount,
  replaceCount,
  busy,
  disabled,
  disabledReason,
  onConfirm,
  warn,
}: {
  label: string;
  keepCount: number;
  replaceCount: number;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  warn?: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary" disabled={busy || disabled} onClick={() => setOpen(true)} title={disabled ? disabledReason : undefined} aria-busy={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden>↻</span>}
        {busy ? "Regenerating…" : `Regenerate ${label}`}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Regenerate ${label}?`}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {keepCount > 0 && <li><strong className="text-ink">{keepCount}</strong> item(s) you wrote, edited or pinned will be kept.</li>}
          {replaceCount > 0 && <li><strong className="text-ink">{replaceCount}</strong> untouched generated item(s) will be replaced.</li>}
          <li>Everything outside this section stays exactly as it is. You can keep editing while it runs.</li>
          {warn && <li className="text-amber-800">{warn}</li>}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" autoFocus onClick={() => { setOpen(false); onConfirm(); }}>Regenerate</button>
        </div>
      </Modal>
    </>
  );
}
