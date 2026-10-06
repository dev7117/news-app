import { useState } from "react";
import { CalendarClock, ListChecks, ListOrdered, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import CadenceDialog from "./CadenceDialog";
import { countdown, STATUS_LOOK, when } from "./format";
import { useCadenceMutations, useCadences } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

/** A customer's recurring meetings, each with its next meeting and how far its prep is. */
export default function CadencesPanel({ customerId }: { customerId: number }) {
  const { data: cadences = [] } = useCadences(customerId);
  const { prepare } = useCadenceMutations();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">
          Recurring meetings and their prep: agenda, steps to run, talking points and files. Prep for each meeting appears as tasks a few days ahead.
        </p>
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setCreating(true)}>
          <Plus size={14} /> New cadence
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {cadences.map((c) => (
          <div key={c.id} className={`well flex flex-col p-4 ${c.active ? "" : "opacity-60"}`}>
            <Link to={`/cadences/${c.id}`} className="group">
              <div className="flex items-start gap-2">
                <CalendarClock size={16} className="mt-0.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-medium group-hover:underline">{c.name}</h3>
                  <p className="text-sm text-muted">{c.schedule_text}</p>
                </div>
                {!c.active && <span className="tag">Paused</span>}
              </div>
            </Link>
            <div className="mt-3 flex flex-wrap gap-1.5 pl-6">
              <span className="tag">
                <ListOrdered size={11} /> {c.agenda.length} topic{c.agenda.length === 1 ? "" : "s"}
              </span>
              <span className="tag">
                <ListChecks size={11} /> {c.steps_count ?? 0} prep step{c.steps_count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-auto flex items-center gap-2 border-t border-edge pt-3 pl-6 text-sm" style={{ marginTop: 14 }}>
              {c.next ? (
                <>
                  <span className="min-w-0 truncate">
                    Next: <span className="font-medium">{when(c.next.starts_at)}</span>
                    <span className="text-faint"> · {countdown(c.next.starts_at)}</span>
                  </span>
                  {c.next.status && <span className={`tag ${STATUS_LOOK[c.next.status].tag}`}>{STATUS_LOOK[c.next.status].label}</span>}
                  {c.next.occurrence_id ? (
                    <Link to={`/prep/${c.next.occurrence_id}`} className="btn btn-primary btn-xs ml-auto shrink-0">
                      Open prep
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs ml-auto shrink-0"
                      disabled={prepare.isPending}
                      title="Make this meeting's prep now, before its prep window"
                      onClick={() =>
                        prepare.mutate(
                          { id: c.id, starts_at: c.next!.starts_at },
                          { onSuccess: (o) => navigate(`/prep/${o.id}`), onError: (e) => toast(e.message, "error") }
                        )
                      }
                    >
                      Prep early
                    </button>
                  )}
                </>
              ) : (
                <span className="text-faint">No meeting in the next 60 days</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {!cadences.length && (
        <p className="rounded-[12px] border border-dashed border-edge px-4 py-8 text-center text-sm text-muted">
          No cadences yet. Add the meetings that repeat, like a weekly ops review or a monthly exec readout.
        </p>
      )}
      {creating && <CadenceDialog customerId={customerId} onClose={() => setCreating(false)} />}
    </div>
  );
}
