import { useMemo } from "react";
import { Columns3, List, ListTodo, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Board, { type GroupBy, laneOf } from "../components/Board";
import QuickAdd from "../components/QuickAdd";
import { EmptyState, TaskGroup } from "../components/TaskList";
import { type Area, type Status, type Task, type TaskFilters, useCustomers, useSearch, useTasks } from "../lib/api";
import { useFocus } from "../lib/focus";
import { usePersisted } from "../lib/usePersisted";

const STATUS_FILTERS: { id: string; label: string; status?: Status[] }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress", status: ["in_progress"] },
  { id: "waiting", label: "Waiting", status: ["waiting"] },
  { id: "done", label: "Done", status: ["done", "cancelled"] },
];

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "customer", label: "Customer" },
  { id: "project", label: "Project" },
  { id: "none", label: "None" },
];

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const area = (params.get("area") as Area | null) ?? undefined;
  const statusId = params.get("status") ?? "open";
  const customerParam = params.get("customer") ?? "";
  const q = params.get("q") ?? "";
  const statusFilter = STATUS_FILTERS.find((s) => s.id === statusId) ?? STATUS_FILTERS[0];
  const [view, setView] = usePersisted<"board" | "list">("todo-tasks-view", "board");
  const [savedGroup, setGroupBy] = usePersisted<GroupBy>("todo-tasks-group", "customer");
  const { data: customers = [] } = useCustomers();
  const { focus } = useFocus();
  // Personal work has no customers; group it by project instead.
  const groupBy: GroupBy = focus === "personal" && savedGroup === "customer" ? "project" : savedGroup;

  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const base: TaskFilters = {
    area,
    customer_id: customerParam && customerParam !== "none" ? Number(customerParam) : undefined,
    no_customer: customerParam === "none" || undefined,
  };
  const searching = q.trim().length > 1;
  const { data: hits } = useSearch(q, true);
  const shownHits = (hits ?? []).filter(
    (t) =>
      (!area || t.area === area) &&
      (!base.customer_id || t.customer_id === base.customer_id) &&
      (!base.no_customer || t.customer_id === null)
  );

  return (
    <div className={view === "board" && !searching ? "" : "mx-auto max-w-4xl"}>
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <h1 className="page-title">{focus === "all" ? "All tasks" : focus === "work" ? "Work tasks" : "Personal tasks"}</h1>
        <div className="segmented ml-auto">
          <button type="button" className="filter-tab" aria-pressed={view === "board"} onClick={() => setView("board")}>
            <Columns3 size={14} /> Board
          </button>
          <button type="button" className="filter-tab" aria-pressed={view === "list"} onClick={() => setView("list")}>
            <List size={14} /> List
          </button>
        </div>
      </header>
      <div className="mb-6 max-w-3xl">
        <QuickAdd />
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="field field-sm w-full pl-8"
            placeholder="Search titles, notes and history"
            value={q}
            onChange={(e) => set("q", e.target.value)}
            aria-label="Search tasks"
          />
        </div>
        {focus === "all" && (
        <div className="segmented">
          {[undefined, "work", "personal"].map((a) => (
            <button
              key={a ?? "all"}
              type="button"
              className="filter-tab"
              aria-pressed={area === a}
              onClick={() => set("area", a)}
            >
              {a === "work" ? "Work" : a === "personal" ? "Personal" : "All"}
            </button>
          ))}
        </div>
        )}
        {focus !== "personal" && (
        <select
          className="field field-sm"
          value={customerParam}
          onChange={(e) => set("customer", e.target.value || undefined)}
          aria-label="Customer"
        >
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">No customer</option>
        </select>
        )}
        {!searching && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">Group</span>
            <div className="segmented">
              {GROUPS.filter((g) => focus !== "personal" || g.id !== "customer").map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="filter-tab"
                  aria-pressed={groupBy === g.id}
                  onClick={() => setGroupBy(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {!searching && view === "list" && (
          <div className="segmented">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="filter-tab"
                aria-pressed={statusId === s.id}
                onClick={() => set("status", s.id === "open" ? undefined : s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {searching ? (
        shownHits.length ? (
          <TaskGroup title="Matches" count={shownHits.length} tasks={shownHits} />
        ) : (
          <EmptyState icon={<Search size={18} />} title="No matches">
            Search covers done tasks too.
          </EmptyState>
        )
      ) : view === "board" ? (
        <Board filters={base} groupBy={groupBy} storageKey="tasks" />
      ) : (
        <TaskListView filters={{ ...base, status: statusFilter.status }} groupBy={groupBy} statusId={statusId} />
      )}
    </div>
  );
}

function TaskListView({ filters, groupBy, statusId }: { filters: TaskFilters; groupBy: GroupBy; statusId: string }) {
  const { data: tasks } = useTasks({ ...filters, limit: statusId === "done" ? 200 : 1000 });

  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; tasks: Task[] }>();
    for (const task of tasks ?? []) {
      const lane = laneOf(task, groupBy);
      if (!byKey.has(lane.key)) byKey.set(lane.key, { ...lane, tasks: [] });
      byKey.get(lane.key)!.tasks.push(task);
    }
    const rank = (key: string) => (key.startsWith("none") ? (key === "none-personal" ? 2 : 1) : 0);
    return [...byKey.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  }, [tasks, groupBy]);

  if (tasks && tasks.length === 0) return <EmptyState icon={<ListTodo size={18} />} title="Nothing here" />;
  return (
    <>
      {groups.map(({ key, label, tasks: list }) => (
        <TaskGroup
          key={key}
          title={groupBy === "none" ? undefined : label}
          count={list.length}
          tasks={list}
          showProject={groupBy !== "project"}
        />
      ))}
    </>
  );
}
