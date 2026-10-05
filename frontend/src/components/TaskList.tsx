import { useState } from "react";
import type { Task } from "../lib/api";
import TaskRow from "./TaskRow";

export function TaskGroup({
  title,
  count,
  tasks,
  showProject = true,
  aside,
}: {
  title?: React.ReactNode;
  count?: number;
  tasks: Task[];
  showProject?: boolean;
  aside?: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      {title && (
        <div className="mb-1 flex items-center gap-2 px-3">
          <h2 className="section-title">{title}</h2>
          {count !== undefined && <span className="tabular text-sm text-faint">{count}</span>}
          {aside && <div className="ml-auto">{aside}</div>}
        </div>
      )}
      <div className="-mx-1">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} showProject={showProject} />
        ))}
      </div>
    </section>
  );
}

/** Today's list: drag rows to set the order (it's the order the bar shows). */
export function SortableTasks({ tasks, onReorder }: { tasks: Task[]; onReorder: (ids: number[]) => void }) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [order, setOrder] = useState<number[] | null>(null);
  const ids = order ?? tasks.map((t) => t.id);
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="-mx-1">
      {ids
        .map((id) => byId.get(id))
        .filter((t): t is Task => !!t)
        .map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            draggable
            dragging={dragId === task.id}
            dragHandlers={{
              onDragStart: (e) => {
                setDragId(task.id);
                setOrder(tasks.map((t) => t.id));
                e.dataTransfer.effectAllowed = "move";
              },
              onDragOver: (e) => {
                e.preventDefault();
                if (dragId === null || dragId === task.id) return;
                setOrder((current) => {
                  const next = (current ?? ids).filter((id) => id !== dragId);
                  next.splice(next.indexOf(task.id) + (ids.indexOf(dragId) < ids.indexOf(task.id) ? 1 : 0), 0, dragId);
                  return next;
                });
              },
              onDragEnd: () => {
                if (order && order.join() !== tasks.map((t) => t.id).join()) onReorder(order);
                setDragId(null);
                setOrder(null);
              },
            }}
          />
        ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="anim-fade flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-fg/[0.06] text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}
