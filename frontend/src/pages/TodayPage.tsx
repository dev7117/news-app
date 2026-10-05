import { useState } from "react";
import { ChevronRight, Sun } from "lucide-react";
import QuickAdd from "../components/QuickAdd";
import { EmptyState, SortableTasks } from "../components/TaskList";
import TaskRow from "../components/TaskRow";
import AttentionPane from "../components/today/AttentionPane";
import Calendar from "../components/today/Calendar";
import { useTaskMutations, useTasks, useToday } from "../lib/api";
import { useToast } from "../hooks/useToast";
import { useFocus } from "../lib/focus";
import { groupTasks, TODAY_GROUPS, type TodayGroup } from "../lib/grouping";
import { usePersisted } from "../lib/usePersisted";

/** Today: your list for today, beside it what's upcoming or needs attention (ready to pull
    in), and below, the calendar: your day as a progress track, or the week. */
export default function TodayPage() {
  const { data: view } = useToday();
  const { data: mine = [] } = useTasks({ mine: true });
  const { reorder, patch } = useTaskMutations();
  const { toast } = useToast();
  const [showDone, setShowDone] = useState(false);
  const [dropping, setDropping] = useState(false);
  const { focus } = useFocus();
  const [savedGroup, setGroupBy] = usePersisted<TodayGroup>("todo-today-group", "none");
  // Personal work has no customers; group it by project instead.
  const groupBy: TodayGroup = focus === "personal" && savedGroup === "customer" ? "project" : savedGroup;
  const groups = view ? groupTasks(view.open, groupBy) : [];
  // Reordering inside a group keeps the other tasks where they were in the overall order.
  const reorderGroup = (groupIds: number[]) => {
    if (!view) return;
    const inGroup = new Set(groupIds);
    const queue = [...groupIds];
    reorder.mutate(view.open.map((t) => (inGroup.has(t.id) ? queue.shift()! : t.id)));
  };
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-[1180px]">
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <p className="eyebrow">{date}</p>
          <h1 className="page-title">Today</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">Group</span>
          <div className="segmented">
            {TODAY_GROUPS.filter((g) => focus !== "personal" || g.id !== "customer").map((g) => (
              <button key={g.id} type="button" className="filter-tab" aria-pressed={groupBy === g.id} onClick={() => setGroupBy(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div
          className={`min-w-0 rounded-[14px] transition-[box-shadow,background-color] duration-150 ${
            dropping ? "bg-accent/[0.04] shadow-[0_0_0_2px_rgb(var(--c-accent)/0.35)]" : ""
          }`}
          // Tasks dragged in from "Needs attention" land on today.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("text/x-todo-task")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
          }}
          onDrop={(e) => {
            setDropping(false);
            const id = Number(e.dataTransfer.getData("text/x-todo-task"));
            if (!id) return;
            e.preventDefault();
            patch.mutate({ id, today: true }, { onError: (err) => toast(err.message, "error") });
          }}
        >
          <div className="mb-6">
            <QuickAdd placeholder="Add to today…  #project ^fri !high" implied="!today" />
          </div>

          {view && view.open.length === 0 && view.done.length === 0 ? (
            <EmptyState icon={<Sun size={18} />} title="Nothing on today">
              Pull something in from Needs attention, or add one above.
            </EmptyState>
          ) : (
            view && (
              <section className="mb-8">
                {groupBy === "none" ? (
                  <SortableTasks tasks={view.open} onReorder={(ids) => reorder.mutate(ids)} />
                ) : (
                  groups.map((g) => (
                    <div key={g.key} className="mb-5 last:mb-0">
                      <h2 className="mb-0.5 flex items-center gap-2 px-2 text-xs font-medium text-muted">
                        {g.label} <span className="tabular text-faint">{g.tasks.length}</span>
                      </h2>
                      <SortableTasks tasks={g.tasks} onReorder={reorderGroup} />
                    </div>
                  ))
                )}
                {view.done.length > 0 && (
                  <div className="mt-4">
                    <button type="button" className="btn btn-quiet btn-xs" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                      <ChevronRight size={13} className={`transition-transform duration-200 ease-out ${showDone ? "rotate-90" : ""}`} />
                      Done today <span className="tabular">{view.done.length}</span>
                    </button>
                    {showDone && (
                      <div className="anim-rise -mx-1 mt-1">
                        {view.done.map((task) => (
                          <TaskRow key={task.id} task={task} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          )}
        </div>

        <AttentionPane groupBy={groupBy} />
      </div>

      <div className="mt-10">
        <Calendar tasks={mine} />
      </div>
    </div>
  );
}
