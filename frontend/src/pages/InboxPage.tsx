import { ArrowRight, Inbox, Sun, X } from "lucide-react";
import QuickAdd from "../components/QuickAdd";
import { EmptyState } from "../components/TaskList";
import { TaskTags, useOpenTask } from "../components/TaskRow";
import { type Task, useProjects, useTaskMutations, useTasks } from "../lib/api";
import { useToast } from "../hooks/useToast";

export default function InboxPage() {
  const { data: tasks } = useTasks({ status: ["inbox"] });
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="page-title">Inbox</h1>
        <p className="mt-1 text-muted">
          Captures from the hotkey, sync scripts and Claude that still need a home. Give each a project, put it on
          today, or accept it as a to-do.
        </p>
      </header>
      <div className="mb-8">
        <QuickAdd />
      </div>
      {tasks && tasks.length === 0 ? (
        <EmptyState icon={<Inbox size={18} />} title="Inbox zero">
          New captures land here.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {tasks?.map((task) => (
            <InboxRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function InboxRow({ task }: { task: Task }) {
  const open = useOpenTask();
  const { patch } = useTaskMutations();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const move = (body: Parameters<typeof patch.mutate>[0], message: string) =>
    patch.mutate(body, {
      onSuccess: () =>
        toast(message, "success", {
          action: { label: "Undo", onClick: () => patch.mutate({ id: task.id, status: "inbox", today: false }) },
        }),
      onError: (e) => toast(e.message, "error"),
    });

  return (
    <div className="well anim-rise flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(task.id)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-words font-medium">{task.title}</span>
          <TaskTags task={{ ...task, status: "todo" }} />
        </div>
        {task.notes && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{task.notes}</p>}
      </button>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <select
          className="field field-sm max-w-[180px]"
          value=""
          aria-label="Move to project"
          onChange={(e) =>
            e.target.value &&
            move(
              { id: task.id, project_id: Number(e.target.value), status: "todo" },
              `Moved to ${projects.find((p) => p.id === Number(e.target.value))?.name}`
            )
          }
        >
          <option value="">Project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => move({ id: task.id, status: "todo", today: true }, "On today")}
        >
          <Sun size={14} /> Today
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Accept as a to-do"
          onClick={() => move({ id: task.id, status: "todo" }, "Moved to to-do")}
        >
          <ArrowRight size={14} /> To do
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm btn-icon"
          title="Dismiss (cancel)"
          aria-label="Dismiss"
          onClick={() => move({ id: task.id, status: "cancelled" }, "Dismissed")}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
