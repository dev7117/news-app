import { ClipboardList, Folder, FolderOutput } from "lucide-react";
import { Link } from "react-router-dom";
import Checkbox from "../Checkbox";
import Avatar from "../people/Avatar";
import { useOpenTask } from "../TaskRow";
import { isClosed, STATUS_LABELS, type Task, useTaskMutations } from "../../lib/api";
import { dueLabel, todayIso } from "../../lib/format";
import { useToast } from "../../hooks/useToast";

/** Above a task that's in a group: the group, and a way out of it. */
export function InGroup({ task }: { task: Task }) {
  const { ungroup } = useTaskMutations();
  const { toast } = useToast();
  if (!task.parent_id) return null;
  return (
    <div className="mb-2 flex items-center gap-2 pl-[30px] text-sm text-muted">
      <Folder size={14} className="shrink-0" />
      <span>In</span>
      <Link to={`/tasks/${task.parent_id}`} className="min-w-0 truncate font-medium text-fg hover:underline">
        {task.parent}
      </Link>
      <button
        type="button"
        className="btn btn-quiet btn-xs"
        onClick={() =>
          ungroup.mutate(task.id, {
            onSuccess: () => toast(`Took it out of “${task.parent}”`, "success"),
            onError: (e) => toast(e.message, "error"),
          })
        }
      >
        <FolderOutput size={13} /> Take out
      </button>
    </div>
  );
}

/** On a group: the tasks inside it (each a full task of its own). */
export function GroupTasks({ task }: { task: Task }) {
  const open = useOpenTask();
  const { patch, ungroup } = useTaskMutations();
  const { toast } = useToast();
  const children = task.children ?? [];
  if (!children.length) return null;
  const finished = children.filter((c) => isClosed(c.status)).length;
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center gap-2">
        <Folder size={15} className="text-muted" />
        <h2 className="section-title">In this group</h2>
        <span className="tabular text-sm text-faint">
          {finished} of {children.length} done
        </span>
      </div>
      <ul className="overflow-hidden rounded-[12px] border border-edge bg-tile shadow-card">
        {children.map((c) => {
          const closed = isClosed(c.status);
          return (
            <li key={c.id} className="group flex items-center gap-3 border-b border-edge px-3 py-2 last:border-b-0">
              <Checkbox
                checked={c.status === "done"}
                label={closed ? "Reopen" : "Mark done"}
                onChange={() => patch.mutate({ id: c.id, status: closed ? "todo" : "done" })}
              />
              <button
                type="button"
                className={`min-w-0 flex-1 truncate text-left hover:underline ${closed ? "text-faint line-through decoration-faint/60" : ""}`}
                onClick={() => open(c.id)}
              >
                {c.title}
              </button>
              {!closed && c.status !== "todo" && <span className="tag">{STATUS_LABELS[c.status]}</span>}
              {!closed && c.due_on && (
                <span className={`tag ${c.due_on < todayIso() ? "tag-danger" : c.due_on === todayIso() ? "tag-warning" : ""}`}>
                  {dueLabel(c.due_on, c.due_on < todayIso())}
                </span>
              )}
              {c.assignee && <Avatar name={c.assignee} size={20} />}
              <button
                type="button"
                className="btn btn-quiet btn-xs btn-icon w-[26px] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
                title="Take out of the group"
                aria-label={`Take “${c.title}” out of the group`}
                onClick={() => ungroup.mutate(c.id, { onError: (e) => toast(e.message, "error") })}
              >
                <FolderOutput size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** On a cadence prep task (or its group): the meeting it prepares. */
export function PrepFor({ task }: { task: Task }) {
  if (!task.occurrence_id) return null;
  return (
    <Link
      to={`/prep/${task.occurrence_id}`}
      className="mb-6 flex items-center gap-2 rounded-[10px] border border-edge bg-fg/[0.03] px-3 py-2 text-sm hover:border-[color:var(--line)]"
    >
      <ClipboardList size={15} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">Prep for a recurring meeting: steps, talking points and files are on its prep page.</span>
      <span className="font-medium">Open prep</span>
    </Link>
  );
}
