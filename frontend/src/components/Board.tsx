import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Folder, Sun } from "lucide-react";
import { STATUS_LABELS, type Status, type Task, useTaskMutations, useTasks, type TaskFilters } from "../lib/api";
import { dueLabel, todayIso } from "../lib/format";
import { usePersisted } from "../lib/usePersisted";
import { useToast } from "../hooks/useToast";
import { useOpenTask } from "./TaskRow";
import Avatar from "./people/Avatar";

export type GroupBy = "customer" | "project" | "none";

const COLUMNS: Status[] = ["todo", "in_progress", "waiting", "done"];
const DONE_WINDOW_DAYS = 14;
const PRIORITY_DOT = ["", "bg-fg/25", "bg-warning", "bg-danger"];

interface Lane {
  key: string;
  label: string;
  tasks: Task[];
}

function lanesFor(tasks: Task[], groupBy: GroupBy): Lane[] {
  if (groupBy === "none") return [{ key: "all", label: "", tasks }];
  const lanes = new Map<string, Lane>();
  for (const task of tasks) {
    const { key, label } = laneOf(task, groupBy);
    if (!lanes.has(key)) lanes.set(key, { key, label, tasks: [] });
    lanes.get(key)!.tasks.push(task);
  }
  // Named lanes alphabetically, then the catch-alls (work before personal).
  return [...lanes.values()].sort((a, b) => {
    const rank = (lane: Lane) => (lane.key.startsWith("none") ? (lane.key === "none-personal" ? 2 : 1) : 0);
    return rank(a) - rank(b) || a.label.localeCompare(b.label);
  });
}

/** Customer lanes split the customer-less tasks into work ("No customer") and "Personal". */
export function laneOf(task: Task, groupBy: GroupBy): { key: string; label: string } {
  if (groupBy === "customer") {
    if (task.customer_id !== null) return { key: `c${task.customer_id}`, label: task.customer ?? "" };
    return task.area === "personal"
      ? { key: "none-personal", label: "Personal" }
      : { key: "none-work", label: "No customer" };
  }
  if (groupBy === "project") {
    if (task.project_id !== null) return { key: `p${task.project_id}`, label: task.project ?? "" };
    return { key: "none", label: "No project" };
  }
  return { key: "all", label: "" };
}

/** Kanban: To do · In progress · Waiting · Done (last 14 days). Drag a card to another column to
    change its status, or up and down a column to rank it (Done stays newest first). */
export default function Board({
  filters,
  groupBy,
  storageKey,
  showMeta = true,
}: {
  filters: TaskFilters;
  groupBy: GroupBy;
  storageKey: string;
  /** Customer/project line on cards; off where the page already says it (a project's board). */
  showMeta?: boolean;
}) {
  const since = useMemo(() => new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 19), []);
  const { data: open } = useTasks({ ...filters, status: ["todo", "in_progress", "waiting"], top_level: true });
  const { data: done } = useTasks({ ...filters, status: ["done"], closed_since: since, limit: 300, top_level: true });
  const { patch, move: moveTask, group, ungroup } = useTaskMutations();
  const { toast } = useToast();
  // Optimistic column moves, dropped once the server's answer arrives.
  const [moved, setMoved] = useState<Record<number, Status>>({});
  // Optimistic column orders (every task in the column, across lanes), same lifetime.
  const [orders, setOrders] = useState<Partial<Record<Status, number[]>>>({});
  // Cards dropped into a group disappear into it at once.
  const [absorbed, setAbsorbed] = useState<number[]>([]);
  useEffect(() => {
    setMoved({});
    setOrders({});
    setAbsorbed([]);
  }, [open, done]);
  // The group that just took a card (pulses), and a new one being named (title selected).
  const [pulse, setPulse] = useState<number | null>(null);
  const [naming, setNaming] = useState<number | null>(null);
  const [collapsed, setCollapsed] = usePersisted<string[]>(`todo-board-collapsed:${storageKey}:${groupBy}`, []);

  const tasks = useMemo(() => {
    const all = [...(open ?? []), ...(done ?? [])]
      .filter((t) => !absorbed.includes(t.id))
      .map((t) => (moved[t.id] ? { ...t, status: moved[t.id] } : t));
    return COLUMNS.flatMap((status) => {
      const column = all.filter((t) => t.status === status);
      const order = orders[status];
      if (!order) return column;
      const at = new Map(order.map((id, i) => [id, i]));
      return column.sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity));
    });
  }, [open, done, moved, orders, absorbed]);
  const lanes = lanesFor(tasks, groupBy);

  const revert = (task: Task, e: Error) => {
    setMoved((m) => {
      const { [task.id]: _, ...rest } = m;
      return rest;
    });
    setOrders({});
    toast(e.message, "error");
  };

  /** Held over another card and dropped: into its group, or a new group of the two (iOS folder). */
  const merge = (task: Task, ontoId: number) => {
    const onto = tasks.find((t) => t.id === ontoId);
    if (!onto) return;
    const joining = !!onto.children_total;
    setAbsorbed((a) => [...a, task.id]);
    group.mutate(
      { task_id: task.id, onto_id: ontoId },
      {
        onSuccess: (parent) => {
          setPulse(parent.id);
          window.setTimeout(() => setPulse((p) => (p === parent.id ? null : p)), 400);
          if (!joining) setNaming(parent.id);
          toast(joining ? `Added to “${parent.title}”` : `Grouped into “${parent.title}”`, "success", {
            action: {
              label: "Undo",
              onClick: () => {
                ungroup.mutate(task.id);
                if (!joining) ungroup.mutate(ontoId);
              },
            },
          });
        },
        onError: (e) => {
          setAbsorbed((a) => a.filter((id) => id !== task.id));
          toast(e.message, "error");
        },
      }
    );
  };

  /** Dropped into ``status``'s column of ``task``'s lane, before ``beforeId`` (null = the lane's end). */
  const move = (task: Task, status: Status, beforeId: number | null) => {
    if (status !== "done" && beforeId !== task.id) {
      const current = tasks.filter((t) => t.status === status).map((t) => t.id);
      const order = current.filter((id) => id !== task.id);
      let at = beforeId === null ? -1 : order.indexOf(beforeId);
      if (at === -1) {
        // The end of this lane's part of the column, so it doesn't jump to another customer.
        const lane = laneOf(task, groupBy).key;
        const inLane = order.map((id) => laneOf(tasks.find((t) => t.id === id)!, groupBy).key === lane);
        const last = inLane.lastIndexOf(true);
        at = last === -1 ? order.length : last + 1;
      }
      order.splice(at, 0, task.id);
      if (task.status === status && order.join() === current.join()) return;
      setMoved((m) => ({ ...m, [task.id]: status }));
      setOrders((o) => ({ ...o, [status]: order }));
      moveTask.mutate(
        { id: task.id, order, status: task.status === status ? undefined : status },
        { onError: (e) => revert(task, e) }
      );
      return;
    }
    if (task.status === status) return;
    setMoved((m) => ({ ...m, [task.id]: status }));
    patch.mutate(
      { id: task.id, status },
      {
        onSuccess: () => {
          if (status === "done")
            toast(`Done: ${task.title}`, "success", {
              action: { label: "Undo", onClick: () => patch.mutate({ id: task.id, status: task.status }) },
            });
        },
        onError: (e) => revert(task, e),
      }
    );
  };

  if (!open || !done) return <div className="h-64" />;

  return (
    <div className="space-y-6">
      {groupBy === "none" || (
        <div className="hidden grid-cols-4 gap-3 px-1 md:grid">
          {COLUMNS.map((status) => (
            <ColumnTitle key={status} status={status} count={tasks.filter((t) => t.status === status).length} />
          ))}
        </div>
      )}
      {lanes.map((lane) => {
        const isCollapsed = collapsed.includes(lane.key);
        const openCount = lane.tasks.filter((t) => t.status !== "done").length;
        return (
          <section key={lane.key} className="anim-fade">
            {groupBy !== "none" && (
              <button
                type="button"
                className="mb-2 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed(isCollapsed ? collapsed.filter((k) => k !== lane.key) : [...collapsed, lane.key])
                }
              >
                <ChevronRight
                  size={14}
                  className={`text-faint transition-transform duration-200 ease-out ${isCollapsed ? "" : "rotate-90"}`}
                />
                <span className="section-title">{lane.label}</span>
                <span className="tabular text-sm text-faint">{openCount} open</span>
              </button>
            )}
            {!isCollapsed && (
              <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                <div className="grid min-w-[880px] grid-cols-4 gap-3">
                  {COLUMNS.map((status) => (
                    <Column
                      key={status}
                      status={status}
                      tasks={lane.tasks.filter((t) => t.status === status)}
                      showTitle={groupBy === "none"}
                      showProject={showMeta && groupBy !== "project"}
                      showCustomer={showMeta && (groupBy === "none" || groupBy === "project")}
                      onDrop={(task, beforeId) => move(task, status, beforeId)}
                      onMerge={merge}
                      pulse={pulse}
                      naming={naming}
                      onNamed={() => setNaming(null)}
                      allTasks={tasks}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })}
      {lanes.length === 0 && <p className="py-12 text-center text-muted">Nothing on the board.</p>}
    </div>
  );
}

function ColumnTitle({ status, count }: { status: Status; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} aria-hidden="true" />
      <span className="text-[0.8125rem] font-medium">{STATUS_LABELS[status]}</span>
      <span className="tabular text-xs text-faint">{count}</span>
      {status === "done" && <span className="text-xs text-faint">· 14 days</span>}
    </div>
  );
}

const DOT: Partial<Record<Status, string>> = {
  todo: "bg-fg/25",
  in_progress: "bg-accent",
  waiting: "bg-warning",
  done: "bg-success",
};

function Column({
  status,
  tasks,
  showTitle,
  showProject,
  showCustomer,
  onDrop,
  onMerge,
  allTasks,
  pulse,
  naming,
  onNamed,
}: {
  status: Status;
  tasks: Task[];
  showTitle: boolean;
  showProject: boolean;
  showCustomer: boolean;
  onDrop: (task: Task, beforeId: number | null) => void;
  onMerge: (task: Task, ontoId: number) => void;
  allTasks: Task[];
  pulse: number | null;
  naming: number | null;
  onNamed: () => void;
}) {
  const [over, setOver] = useState(false);
  // Where a drop would land: before this card's id, null for the end, undefined when not over.
  const [before, setBefore] = useState<number | null | undefined>(undefined);
  const ranked = status !== "done";
  // Folder gesture: hold over the middle of a card and, after a beat, it's ready to group.
  const [mergeId, setMergeId] = useState<number | null>(null);
  const hover = useRef<{ id: number; timer: number } | null>(null);
  const stopHover = () => {
    if (hover.current) window.clearTimeout(hover.current.timer);
    hover.current = null;
    setMergeId(null);
  };
  useEffect(() => stopHover, []);
  return (
    <div
      className={`flex min-h-[96px] flex-col gap-2 rounded-[12px] p-2 transition-colors duration-150 ${
        over ? "bg-accent/[0.08] ring-1 ring-accent/40" : "bg-fg/[0.03]"
      }`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("text/x-todo-task")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
        // Over a card: before it (top half) or before the next one; anywhere else, the end.
        const card = (e.target as HTMLElement).closest<HTMLElement>("[data-card]");
        if (!ranked) return;
        if (!card) {
          stopHover();
          return setBefore(null);
        }
        const id = Number(card.dataset.card);
        const box = card.getBoundingClientRect();
        // The middle of another card (not a group being dragged) is the folder zone.
        const y = (e.clientY - box.top) / box.height;
        const canMerge = dragged && dragged.id !== id && !dragged.children_total;
        if (canMerge && y > 0.22 && y < 0.78) {
          if (hover.current?.id !== id) {
            stopHover();
            hover.current = { id, timer: window.setTimeout(() => setMergeId(id), MERGE_DELAY) };
          }
          if (mergeId === id) return setBefore(undefined);
        } else if (hover.current) {
          stopHover();
        }
        const index = tasks.findIndex((t) => t.id === id);
        setBefore(y < 0.5 ? id : tasks[index + 1]?.id ?? null);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setOver(false);
          setBefore(undefined);
          stopHover();
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        setBefore(undefined);
        const merging = mergeId;
        stopHover();
        const id = Number(e.dataTransfer.getData("text/x-todo-task"));
        const task = allTasks.find((t) => t.id === id);
        if (!task) return;
        if (merging !== null && merging !== task.id) onMerge(task, merging);
        else onDrop(task, before ?? null);
      }}
    >
      {showTitle && (
        <div className="px-1 pb-1 pt-0.5">
          <ColumnTitle status={status} count={tasks.length} />
        </div>
      )}
      {/* Below md the shared header is hidden, so each column names itself. */}
      {!showTitle && (
        <div className="px-1 md:hidden">
          <ColumnTitle status={status} count={tasks.length} />
        </div>
      )}
      {tasks.map((task) => (
        <Fragment key={task.id}>
          {over && before === task.id && <DropLine />}
          <Card
            task={task}
            showProject={showProject}
            showCustomer={showCustomer}
            merge={mergeId === task.id}
            pulse={pulse === task.id}
            naming={naming === task.id}
            onNamed={onNamed}
          />
        </Fragment>
      ))}
      {over && before === null && <DropLine />}
    </div>
  );
}

function DropLine() {
  return <div className="-my-[5px] h-0.5 rounded-full bg-accent" aria-hidden="true" />;
}

/** How long a card has to hover over another before they'll group (iOS waits a beat too). */
const MERGE_DELAY = 450;
/** The card being dragged (dataTransfer can't be read until the drop). */
let dragged: Task | null = null;

function Card({
  task,
  showProject,
  showCustomer,
  merge,
  pulse,
  naming,
  onNamed,
}: {
  task: Task;
  showProject: boolean;
  showCustomer: boolean;
  /** Another card is held over this one: grouping on drop. */
  merge: boolean;
  /** This group just took a card. */
  pulse: boolean;
  /** A new group: its name is up for editing. */
  naming: boolean;
  onNamed: () => void;
}) {
  const open = useOpenTask();
  const [dragging, setDragging] = useState(false);
  const isGroup = !!task.children_total;
  const done = task.status === "done";
  const meta = [showCustomer && task.customer, showProject && task.project].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      data-card={task.id}
      data-merge={merge || undefined}
      draggable={!naming}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-todo-task", String(task.id));
        e.dataTransfer.effectAllowed = "move";
        dragged = task;
        setDragging(true);
      }}
      onDragEnd={() => {
        dragged = null;
        setDragging(false);
      }}
      onClick={() => !naming && open(task.id)}
      onKeyDown={(e) => e.key === "Enter" && !naming && e.target === e.currentTarget && open(task.id)}
      className={`well folder-card group cursor-grab p-3 text-left hover:border-[color:var(--line)] active:cursor-grabbing ${
        dragging ? "scale-[0.98] opacity-40" : ""
      } ${pulse ? (naming ? "folder-open" : "folder-absorb") : ""}`}
    >
      <div className="flex items-start gap-2">
        {task.priority > 0 && !done && (
          <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} title={`Priority ${task.priority}`} />
        )}
        {isGroup && <Folder size={14} className="mt-[3px] shrink-0 text-muted" aria-label="Group" />}
        {naming ? (
          <GroupName task={task} onDone={onNamed} />
        ) : (
          <span className={`min-w-0 flex-1 break-words leading-snug ${done ? "text-faint line-through decoration-faint/60" : ""}`}>
            {task.title}
          </span>
        )}
        {task.today && !done && <Sun size={13} className="mt-0.5 shrink-0 text-accent" aria-label="On today" />}
        {task.assignee && <Avatar name={task.assignee} size={20} className="-mr-0.5 mt-px" agent={task.assignee_kind === "agent"} />}
      </div>
      {meta && <div className="mt-1 truncate text-xs text-muted">{meta}</div>}
      {isGroup && <GroupPreview task={task} />}
      {!!task.subtasks_total && !done && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
            <div className="h-full rounded-full bg-success" style={{ width: `${(100 * (task.subtasks_done ?? 0)) / task.subtasks_total}%` }} />
          </div>
          <span className="tabular text-[0.6875rem] text-faint">
            {task.subtasks_done}/{task.subtasks_total}
          </span>
        </div>
      )}
      {(task.due_on || task.waiting_on || task.external_url) && !done && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {task.due_on && (
            <span className={`tag ${task.overdue ? "tag-danger" : task.due_on <= todayIso() ? "tag-warning" : ""}`}>
              {dueLabel(task.due_on, task.overdue)}
            </span>
          )}
          {task.status === "waiting" && task.waiting_on && <span className="tag tag-warning">{task.waiting_on}</span>}
          {task.external_url && (
            <a
              href={task.external_url}
              target="_blank"
              rel="noreferrer"
              className="tag hover:text-fg"
              onClick={(e) => e.stopPropagation()}
              title={task.external_url}
            >
              <ExternalLink size={11} /> {task.external_id ?? "Link"}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** What's inside a group, like the miniature icons on an iOS folder: up to four tasks, then a count. */
function GroupPreview({ task }: { task: Task }) {
  const children = task.children ?? [];
  const total = task.children_total ?? children.length;
  const finished = task.children_done ?? 0;
  const shown = children.slice(0, total > 4 ? 3 : 4);
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-1 rounded-[9px] bg-fg/[0.04] p-1">
        {shown.map((c) => (
          <span
            key={c.id}
            className={`flex min-w-0 items-center gap-1 rounded-[6px] bg-tile px-1.5 py-1 text-[0.6875rem] leading-tight shadow-card ${
              c.status === "done" || c.status === "cancelled" ? "text-faint line-through" : ""
            }`}
            title={c.title}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[c.status] ?? "bg-fg/25"}`} aria-hidden="true" />
            <span className="truncate">{c.title}</span>
          </span>
        ))}
        {total > 4 && (
          <span className="grid place-items-center rounded-[6px] bg-tile px-1.5 py-1 text-[0.6875rem] text-muted shadow-card">
            +{total - 3} more
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
          <div className="h-full rounded-full bg-success transition-[width] duration-300" style={{ width: `${(100 * finished) / total}%` }} />
        </div>
        <span className="tabular text-[0.6875rem] text-faint">
          {finished}/{total} tasks
        </span>
      </div>
    </div>
  );
}

/** A new group's name, selected for typing over (like a new iOS folder). Enter or click away keeps it. */
function GroupName({ task, onDone }: { task: Task; onDone: () => void }) {
  const { patch } = useTaskMutations();
  const [value, setValue] = useState(task.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const save = () => {
    const title = value.trim();
    if (title && title !== task.title) patch.mutate({ id: task.id, title });
    onDone();
  };
  return (
    <input
      ref={input}
      className="field field-sm min-w-0 flex-1 font-medium"
      value={value}
      aria-label="Group name"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") save();
        if (e.key === "Escape") onDone();
      }}
    />
  );
}
