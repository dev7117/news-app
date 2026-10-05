import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ACTIVE_RUN, type LauncherRun, type RunStatus, useLinkRuns, useRun, useRunMutations } from "../../lib/api";
import { ago } from "../../lib/format";

const STATUS: Record<RunStatus, { label: (r: LauncherRun) => string; tag: string }> = {
  queued: { label: (r) => `Waiting for ${r.agent}`, tag: "" },
  claimed: { label: (r) => `Awaiting approval on ${r.agent}`, tag: "tag-warning" },
  running: { label: (r) => `Running on ${r.agent}`, tag: "tag-accent" },
  succeeded: { label: () => "Done", tag: "tag-success" },
  failed: { label: (r) => (r.exit_code !== null ? `Failed (${r.exit_code})` : "Failed"), tag: "tag-danger" },
  declined: { label: () => "Not approved", tag: "" },
  expired: { label: () => "Expired", tag: "" },
  cancelled: { label: () => "Cancelled", tag: "" },
};

function duration(run: LauncherRun) {
  if (!run.started_at) return "";
  const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(run.started_at).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function RunTag({ run }: { run: LauncherRun }) {
  const s = STATUS[run.status];
  return (
    <span className={`tag ${s.tag}`} title={run.error ?? undefined}>
      {ACTIVE_RUN.includes(run.status) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label(run)}
    </span>
  );
}

/** The last few runs of a tool; click one to read its output. */
export default function RunHistory({ linkId }: { linkId: number }) {
  const { data: runs = [] } = useLinkRuns(linkId);
  const [open, setOpen] = useState<number | null>(null);
  if (!runs.length) return null;
  return (
    <ul className="mt-2 space-y-1 border-t border-edge pt-2">
      {runs.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs hover:bg-fg/[0.04]"
            aria-expanded={open === r.id}
            onClick={() => setOpen(open === r.id ? null : r.id)}
          >
            <ChevronRight size={12} className={`shrink-0 text-faint transition-transform duration-200 ease-out ${open === r.id ? "rotate-90" : ""}`} />
            <RunTag run={r} />
            <span className="text-faint">{r.agent}</span>
            <span className="ml-auto tabular text-faint">
              {duration(r) && `${duration(r)} · `}
              {ago(r.requested_at)}
            </span>
          </button>
          {open === r.id && <RunOutput runId={r.id} />}
        </li>
      ))}
    </ul>
  );
}

function RunOutput({ runId }: { runId: number }) {
  const { data: run } = useRun(runId);
  const { cancel } = useRunMutations();
  if (!run) return null;
  return (
    <div className="anim-fade mb-2 mt-1">
      {run.error && <p className="mb-1 text-xs text-danger">{run.error}</p>}
      {run.output ? (
        <pre className="diff max-h-80 overflow-auto whitespace-pre-wrap rounded-[8px] border border-edge bg-fg/[0.03] p-3 text-xs">{run.output}</pre>
      ) : (
        <p className="px-1 text-xs text-faint">{ACTIVE_RUN.includes(run.status) ? "No output yet…" : "No output."}</p>
      )}
      {run.status === "queued" && (
        <button type="button" className="btn btn-quiet btn-xs mt-1" onClick={() => cancel.mutate(run.id)}>
          Cancel
        </button>
      )}
    </div>
  );
}
