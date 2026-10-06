import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, GitPullRequestArrow, Sparkles, Sun } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useOpenMeeting } from "../components/MeetingDialog";
import { useOpenTask } from "../components/TaskRow";
import { EmptyState } from "../components/TaskList";
import Checkbox from "../components/Checkbox";
import { type Change, type Proposal, useDecideProposal, useProposal, useProposals } from "../lib/api";
import { ago } from "../lib/format";
import { useToast } from "../hooks/useToast";

const ACTION_LABEL: Record<Change["action"], string> = {
  create: "New task",
  update: "Update",
  note: "Progress note",
  complete: "Complete",
  add_link: "Add link",
  promote_idea: "Idea → task",
  add_subtask: "Add subtask",
  check_subtask: "Check subtask",
  follow: "Followers",
};

export default function ReviewPage() {
  const { data: pending } = useProposals("pending");
  const { data: all = [] } = useProposals();
  const [params] = useSearchParams();
  const focus = Number(params.get("proposal")) || null;
  const [showDecided, setShowDecided] = useState(false);
  const decided = all.filter((p) => p.status !== "pending");

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="page-title">Review</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Changes Claude proposed from your meetings and notes. Nothing touches your tasks until you apply it. Untick
          anything you don't want; the rest applies.
        </p>
      </header>

      {pending && pending.length === 0 && (
        <EmptyState icon={<Check size={18} />} title="Nothing to review">
          When Claude proposes task changes they show up here, and as a count in the nav and the bar.
        </EmptyState>
      )}

      <div className="space-y-6">
        {pending?.map((p) => (
          <ProposalCard key={p.id} id={p.id} highlight={focus === p.id} />
        ))}
        {focus && !pending?.some((p) => p.id === focus) && all.some((p) => p.id === focus) && (
          <ProposalCard id={focus} highlight />
        )}
      </div>

      {decided.length > 0 && (
        <section className="mt-12">
          <button type="button" className="btn btn-quiet btn-xs -ml-2" aria-expanded={showDecided} onClick={() => setShowDecided(!showDecided)}>
            <ChevronRight size={13} className={`transition-transform duration-200 ease-out ${showDecided ? "rotate-90" : ""}`} />
            Decided <span className="tabular">{decided.length}</span>
          </button>
          {showDecided && (
            <ul className="anim-rise mt-2 space-y-1">
              {decided.map((p) => (
                <DecidedRow key={p.id} proposal={p} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function DecidedRow({ proposal }: { proposal: Proposal }) {
  const [open, setOpen] = useState(false);
  const tag = { applied: "tag-success", partial: "tag-warning", rejected: "", pending: "" }[proposal.status];
  return (
    <li>
      <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-fg/[0.04]" onClick={() => setOpen(!open)}>
        <span className={`tag ${tag}`}>{proposal.status === "partial" ? "Partly applied" : proposal.status === "applied" ? "Applied" : "Rejected"}</span>
        <span className="min-w-0 flex-1 truncate">{proposal.summary || proposal.source}</span>
        <span className="text-xs text-faint">{proposal.decided_at ? ago(proposal.decided_at) : ""}</span>
      </button>
      {open && (
        <div className="mt-2">
          <ProposalCard id={proposal.id} />
        </div>
      )}
    </li>
  );
}

function ProposalCard({ id, highlight }: { id: number; highlight?: boolean }) {
  const { data: proposal } = useProposal(id);
  const decide = useDecideProposal();
  const openMeeting = useOpenMeeting();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, { title?: string; today?: boolean }>>({});

  // Everything starts selected.
  useEffect(() => {
    if (proposal) setSelected(new Set(proposal.changes?.filter((c) => c.status === "pending").map((c) => c.id)));
  }, [proposal?.id, proposal?.changes?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!proposal) return <div className="well h-40" />;
  const pending = proposal.status === "pending";
  const changes = proposal.changes ?? [];
  const toggle = (changeId: number) => {
    const next = new Set(selected);
    if (next.has(changeId)) next.delete(changeId);
    else next.add(changeId);
    setSelected(next);
  };

  const apply = (approve: number[] | "none") =>
    decide.mutate(
      { id: proposal.id, approve, edits },
      {
        onSuccess: (result) => {
          const applied = result.changes?.filter((c) => c.status === "applied").length ?? 0;
          const failed = result.changes?.filter((c) => c.status === "failed").length ?? 0;
          toast(
            approve === "none" ? "Proposal rejected" : `Applied ${applied} change${applied === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}`,
            failed ? "error" : "success"
          );
        },
        onError: (e) => toast(e.message, "error"),
      }
    );

  return (
    <article className={`well anim-rise overflow-hidden ${highlight ? "ring-2 ring-accent/50" : ""}`}>
      <header className="border-b border-edge px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <GitPullRequestArrow size={16} className="text-muted" />
          <h2 className="section-title min-w-0 flex-1">{proposal.summary || "Proposed changes"}</h2>
          <span className="flex items-center gap-1 text-xs text-faint">
            <Sparkles size={12} /> {proposal.created_by === "mcp" ? "Claude" : proposal.created_by} · {ago(proposal.created_at)}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
          {proposal.meeting_id ? (
            <button type="button" className="hover:text-fg hover:underline" onClick={() => openMeeting(proposal.meeting_id!)}>
              {proposal.source}
            </button>
          ) : (
            <span>{proposal.source}</span>
          )}
          {proposal.customer_id && (
            <Link to={`/customers/${proposal.customer_id}`} className="tag hover:text-fg">
              {proposal.customer}
            </Link>
          )}
        </div>
      </header>

      <div className="divide-y divide-[color:var(--edge)]">
        {changes.map((change) => (
          <ChangeBlock
            key={change.id}
            change={change}
            pending={pending}
            selected={selected.has(change.id)}
            onToggle={() => toggle(change.id)}
            title={edits[change.id]?.title}
            onTitle={(title) => setEdits({ ...edits, [change.id]: { ...edits[change.id], title } })}
            today={!!edits[change.id]?.today}
            onToday={(today) => setEdits({ ...edits, [change.id]: { ...edits[change.id], today } })}
          />
        ))}
      </div>

      {pending && (
        <footer className="flex flex-wrap items-center gap-2 border-t border-edge bg-fg/[0.02] px-5 py-3">
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() =>
              setSelected(selected.size === changes.length ? new Set() : new Set(changes.map((c) => c.id)))
            }
          >
            {selected.size === changes.length ? "Select none" : "Select all"}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={decide.isPending} onClick={() => apply("none")}>
              Reject all
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={decide.isPending || selected.size === 0}
              onClick={() => apply([...selected])}
            >
              <Check size={14} /> Apply {selected.size} of {changes.length}
            </button>
          </div>
        </footer>
      )}
    </article>
  );
}

function ChangeBlock({
  change,
  pending,
  selected,
  onToggle,
  title,
  onTitle,
  today,
  onToday,
}: {
  change: Change;
  pending: boolean;
  selected: boolean;
  onToggle: () => void;
  title?: string;
  onTitle: (title: string) => void;
  today: boolean;
  onToday: (today: boolean) => void;
}) {
  const openTask = useOpenTask();
  const live = pending && change.status === "pending";
  const statusTag =
    change.status === "applied" ? (
      <span className="tag tag-success">Applied</span>
    ) : change.status === "rejected" ? (
      <span className="tag">Rejected</span>
    ) : change.status === "failed" ? (
      <span className="tag tag-danger" title={change.error ?? ""}>
        Failed
      </span>
    ) : null;
  const resultTask = change.action !== "add_link" ? change.result_id ?? change.task_id : null;

  return (
    <div className={`px-5 py-4 transition-opacity duration-150 ${live && !selected ? "opacity-50" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {live && <Checkbox checked={selected} onChange={onToggle} label={selected ? "Don't apply this" : "Apply this"} />}
        <span className="text-[0.8125rem] font-medium">{ACTION_LABEL[change.action]}</span>
        {change.action === "create" && live ? (
          <input
            className="field field-sm min-w-[200px] flex-1"
            value={title ?? change.task_title ?? ""}
            onChange={(e) => onTitle(e.target.value)}
            aria-label="Task title"
          />
        ) : (
          change.task_title &&
          (resultTask ? (
            <button type="button" className="min-w-0 truncate text-left hover:underline" onClick={() => openTask(resultTask)}>
              {change.task_title}
            </button>
          ) : (
            <span className="min-w-0 truncate">{change.task_title}</span>
          ))
        )}
        {live && (change.action === "create" || change.action === "promote_idea") && (
          <button
            type="button"
            className={`btn btn-xs ${today ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={today}
            title={today ? "Won't go on today" : "Put it on your list for today when applied"}
            onClick={() => {
              onToday(!today);
              if (!today && !selected) onToggle();
            }}
          >
            <Sun size={13} /> {today ? "On today" : "Today"}
          </button>
        )}
        {change.stale.length > 0 && live && (
          <span className="tag tag-warning" title={`Changed since Claude proposed this: ${change.stale.join(", ")}`}>
            <AlertTriangle size={11} /> Changed since
          </span>
        )}
        {statusTag}
      </div>
      {change.reason && <p className="mb-2 text-sm italic text-muted">“{change.reason}”</p>}
      <div className="diff overflow-hidden rounded-[8px] border border-edge">
        {[...change.lines, ...(live && today ? [{ op: "+", field: "today", text: "on your list today" }] : [])].map((line, i) => (
          <div key={i} className="diff-line" data-op={line.op}>
            <span>{line.op === " " ? "" : line.op}</span>
            <span>{line.field}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
      {change.error && <p className="mt-2 text-sm text-danger">{change.error}</p>}
    </div>
  );
}
