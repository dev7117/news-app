import { AlertTriangle, ChevronsLeft, ChevronsRight, Clock, GitPullRequestArrow, Hourglass, Inbox, Sun, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { type Task, useCounts, useTaskMutations, useTasks } from "../../lib/api";
import { dueLabel, todayIso } from "../../lib/format";
import { groupTasks, type TodayGroup } from "../../lib/grouping";
import { usePersisted } from "../../lib/usePersisted";
import { useOpenTask } from "../TaskRow";
import Avatar from "../people/Avatar";
import { useToast } from "../../hooks/useToast";

const WEEK = 7 * 86_400_000;

/** Beside Today: what's upcoming or needs attention, to pull onto today (sun button, or drag
    onto the list). Collapses to a slim rail; the choice is kept per browser. */
export default function AttentionPane({ groupBy = "none" }: { groupBy?: TodayGroup }) {
  const [open, setOpen] = usePersisted("todo-today-pane", true);
  const { data: mine = [] } = useTasks({ mine: true });
  const { data: delegated = [] } = useTasks({ delegated: true });
  const { data: counts } = useCounts();
  const today = todayIso();
  const weekOut = new Date(Date.now() + WEEK).toISOString().slice(0, 10);

  const notToday = mine.filter((t) => !t.today && t.status !== "in_progress");
  const overdue = notToday.filter((t) => t.overdue);
  const dueSoon = notToday.filter((t) => !t.overdue && t.due_on && t.due_on >= today && t.due_on <= weekOut);
  const waiting = notToday.filter((t) => t.status === "waiting" && !t.overdue && !dueSoon.includes(t));
  const followUp = delegated.filter((t) => t.overdue || (t.due_on && t.due_on <= weekOut) || t.status === "waiting");
  const total = overdue.length + dueSoon.length + waiting.length + followUp.length;

  if (!open) {
    return (
      <aside className="hidden lg:block">
        <button
          type="button"
          className="sticky top-24 flex w-10 flex-col items-center gap-2 rounded-[12px] border border-edge bg-tile py-3 text-muted shadow-card hover:text-fg"
          onClick={() => setOpen(true)}
          title="Show what needs attention"
          aria-label={`Show what needs attention (${total})`}
        >
          <ChevronsLeft size={15} />
          <AlertTriangle size={15} />
          {total > 0 && <span className="tabular text-xs font-medium">{total}</span>}
          <span className="text-[0.6875rem] [writing-mode:vertical-rl]">Needs attention</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="min-w-0 lg:w-[320px]">
      <div className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-title">Needs attention</h2>
          <span className="tabular text-sm text-faint">{total}</span>
          <button
            type="button"
            className="btn btn-quiet btn-xs btn-icon ml-auto hidden w-[26px] lg:inline-flex"
            onClick={() => setOpen(false)}
            title="Collapse"
            aria-label="Collapse"
          >
            <ChevronsRight size={14} />
          </button>
        </div>

        <div className="mb-4 flex gap-1.5">
          <Link to="/inbox" className="tag hover:text-fg">
            <Inbox size={11} /> Inbox {counts?.inbox ?? 0}
          </Link>
          {!!counts?.review && (
            <Link to="/review" className="tag tag-accent">
              <GitPullRequestArrow size={11} /> Review {counts.review}
            </Link>
          )}
        </div>

        {total === 0 && <p className="rounded-[10px] bg-fg/[0.03] px-3 py-4 text-center text-sm text-muted">All clear. Nothing overdue or due this week.</p>}
        {groupBy === "none" ? (
          <>
            <Group icon={<AlertTriangle size={13} />} title="Overdue" tasks={overdue} tone="text-danger" />
            <Group icon={<Clock size={13} />} title="Due this week" tasks={dueSoon} />
            <Group icon={<Hourglass size={13} />} title="Waiting" tasks={waiting} />
            <Group icon={<UserRound size={13} />} title="Follow up with others" tasks={followUp} delegated />
          </>
        ) : (
          // Grouped like the list; tasks on someone else stay follow-ups (avatar, not draggable).
          groupTasks(
            [...overdue, ...dueSoon, ...waiting, ...followUp].sort(
              (a, b) => Number(b.overdue) - Number(a.overdue) || (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999")
            ),
            groupBy
          ).map((g) => (
            <Group key={g.key} title={g.label} tasks={g.tasks} />
          ))
        )}
        <p className="mt-2 px-1 text-xs text-faint">Drag onto your list or use ☀ to do it today.</p>
      </div>
    </aside>
  );
}

function Group({
  icon,
  title,
  tasks,
  tone = "text-muted",
  delegated,
}: {
  icon?: React.ReactNode;
  title: string;
  tasks: Task[];
  tone?: string;
  delegated?: boolean;
}) {
  if (!tasks.length) return null;
  return (
    <section className="mb-4">
      <h3 className={`mb-1 flex items-center gap-1.5 px-1 text-xs font-medium ${tone}`}>
        {icon} {title} <span className="tabular text-faint">{tasks.length}</span>
      </h3>
      <ul className="space-y-1">
        {tasks.map((t) => (
          <PaneRow key={t.id} task={t} delegated={delegated || t.assignee_id !== null} />
        ))}
      </ul>
    </section>
  );
}

function PaneRow({ task, delegated }: { task: Task; delegated?: boolean }) {
  const open = useOpenTask();
  const { patch } = useTaskMutations();
  const { toast } = useToast();
  return (
    <li
      draggable={!delegated}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-todo-task", String(task.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group flex items-start gap-2 rounded-[10px] border border-edge bg-tile px-2.5 py-2 transition-colors hover:border-[color:var(--line)] ${
        delegated ? "" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(task.id)}>
        <span className="line-clamp-2 text-sm leading-snug">{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {task.due_on && (
            <span className={`tag ${task.overdue ? "tag-danger" : "tag-warning"}`}>{dueLabel(task.due_on, task.overdue)}</span>
          )}
          {task.status === "waiting" && task.waiting_on && <span className="tag">{task.waiting_on}</span>}
          {(task.customer || task.project) && <span className="tag">{task.customer ?? task.project}</span>}
        </span>
      </button>
      {delegated && task.assignee ? (
        <Link to={`/people/${task.assignee_id}`} title={`${task.assignee}'s page`} className="mt-0.5 shrink-0">
          <Avatar name={task.assignee} size={22} />
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-quiet btn-xs btn-icon mt-0.5 w-[26px] shrink-0"
          title="Do it today"
          aria-label={`Put “${task.title}” on today`}
          onClick={() =>
            patch.mutate(
              { id: task.id, today: true },
              { onSuccess: () => toast(`On today: ${task.title}`, "success"), onError: (e) => toast(e.message, "error") }
            )
          }
        >
          <Sun size={14} />
        </button>
      )}
    </li>
  );
}
