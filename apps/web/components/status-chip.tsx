import type { KitStatus } from "@/lib/types";
const S: Record<KitStatus, [string, string]> = {
  queued: ["Queued", "bg-zinc-100 text-ink-soft"],
  running: ["Researching…", "bg-indigo-50 text-indigo-700 animate-pulseBar"],
  ready: ["Ready", "bg-emerald-50 text-emerald-700"],
  failed: ["Failed", "bg-red-50 text-red-700"],
};
export function StatusChip({ status }: { status: KitStatus }) {
  const [label, cls] = S[status];
  return <span className={`chip ${cls}`}>{label}</span>;
}
