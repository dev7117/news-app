import { laneOf } from "../components/Board";
import { PRIORITY_LABELS, STATUS_LABELS, type Task } from "./api";
import { todayIso } from "./format";

/** Groupings on the Today page (its list and the Needs attention pane). */
export type TodayGroup = "none" | "customer" | "project" | "status" | "priority" | "due";

export const TODAY_GROUPS: { id: TodayGroup; label: string }[] = [
  { id: "none", label: "None" },
  { id: "customer", label: "Customer" },
  { id: "project", label: "Project" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "due", label: "Due" },
];

export interface TaskGroupOf {
  key: string;
  label: string;
  tasks: Task[];
}

const STATUS_ORDER = ["in_progress", "todo", "waiting", "inbox", "done", "cancelled"];

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Where a task falls, with a rank that orders the groups (named lanes by label after it). */
function groupOf(task: Task, by: TodayGroup, today: string): { key: string; label: string; rank: number } {
  switch (by) {
    case "status":
      return { key: task.status, label: STATUS_LABELS[task.status], rank: STATUS_ORDER.indexOf(task.status) };
    case "priority":
      return { key: `p${task.priority}`, label: task.priority ? PRIORITY_LABELS[task.priority] : "No priority", rank: 3 - task.priority };
    case "due": {
      const due = task.due_on;
      if (task.overdue) return { key: "overdue", label: "Overdue", rank: 0 };
      if (!due) return { key: "none", label: "No date", rank: 5 };
      if (due <= today) return { key: "today", label: "Today", rank: 1 };
      if (due === addDays(today, 1)) return { key: "tomorrow", label: "Tomorrow", rank: 2 };
      if (due <= addDays(today, 7)) return { key: "week", label: "This week", rank: 3 };
      return { key: "later", label: "Later", rank: 4 };
    }
    case "customer":
    case "project": {
      const lane = laneOf(task, by);
      // Named lanes alphabetically, then the catch-alls (work before personal).
      return { ...lane, rank: lane.key.startsWith("none") ? (lane.key === "none-personal" ? 2 : 1) : 0 };
    }
    default:
      return { key: "all", label: "", rank: 0 };
  }
}

/** Splits tasks into ordered groups, keeping each task's order within its group. */
export function groupTasks(tasks: Task[], by: TodayGroup): TaskGroupOf[] {
  const today = todayIso();
  const groups = new Map<string, TaskGroupOf & { rank: number }>();
  for (const task of tasks) {
    const g = groupOf(task, by, today);
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, rank: g.rank, tasks: [] });
    groups.get(g.key)!.tasks.push(task);
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ rank: _rank, ...g }) => g);
}
