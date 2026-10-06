import { Bot, CirclePause, CirclePlay, ExternalLink, Folder, GripVertical, Sun, SunDim, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isClosed, type Task, useTaskMutations } from "../lib/api";
import { carriedSince, dueLabel, todayIso } from "../lib/format";
import { useToast } from "../hooks/useToast";
import Checkbox from "./Checkbox";

export function useOpenTask() {
  const navigate = useNavigate();
  return (id: number) => navigate(`/tasks/${id}`);
}

const PRIORITY_DOT = ["", "bg-fg/25", "bg-warning", "bg-danger"];

export function TaskTags({
  task,
  showProject = true,
  hidePersonId,
}: {
  task: Task;
  showProject?: boolean;
  /** On a person's page their own name is noise. */
  hidePersonId?: number;
}) {
  const since = task.today && !isClosed(task.status) ? carriedSince(task.today_on) : "";
  return (
    <>
      {task.status === "in_progress" && <span className="tag tag-accent">In progress</span>}
      {task.assignee && task.assignee_id !== hidePersonId && (
        <span className="tag" title={`Assigned to ${task.assignee}`}>
          {task.assignee_kind === "agent" ? <Bot size={11} /> : <UserRound size={11} />} {task.assignee}
        </span>
      )}
      {task.status === "waiting" && (
        <span className="tag tag-warning">{task.waiting_on ? `Waiting on ${task.waiting_on}` : "Waiting"}</span>
      )}
      {task.status === "inbox" && <span className="tag">Inbox</span>}
      {task.parent && (
        <span className="tag" title={`In the group “${task.parent}”`}>
          <Folder size={11} /> {task.parent}
        </span>
      )}
      {!!task.children_total && (
        <span className={`tag tabular ${task.children_done === task.children_total ? "tag-success" : ""}`} title="Tasks in this group done">
          <Folder size={11} /> {task.children_done}/{task.children_total}
        </span>
      )}
      {!!task.subtasks_total && (
        <span className={`tag tabular ${task.subtasks_done === task.subtasks_total ? "tag-success" : ""}`} title="Subtasks done">
          {task.subtasks_done}/{task.subtasks_total}
        </span>
      )}
      {task.due_on && !isClosed(task.status) && (
        <span className={`tag ${task.overdue ? "tag-danger" : task.due_on <= todayIso() ? "tag-warning" : ""}`}>
          {dueLabel(task.due_on, task.overdue)}
        </span>
      )}
      {showProject && task.project && <span className="tag">{task.project}</span>}
      {since && <span className="tag" title={`On today since ${task.today_on}`}>{since}</span>}
      {!["app", "intake"].includes(task.source) && (
        <span className="tag" title={`Source: ${task.source}`}>
          {task.source.length > 24 ? task.source.slice(0, 23) + "…" : task.source}
        </span>
      )}
    </>
  );
}

interface Props {
  task: Task;
  showProject?: boolean;
  hidePersonId?: number;
  draggable?: boolean;
  dragHandlers?: React.HTMLAttributes<HTMLDivElement>;
  dragging?: boolean;
}

export default function TaskRow({ task, showProject = true, hidePersonId, draggable, dragHandlers, dragging }: Props) {
  const open = useOpenTask();
  const { patch } = useTaskMutations();
  const { toast } = useToast();
  const closed = isClosed(task.status);

  const toggleDone = () => {
    const previous = task.status;
    patch.mutate(
      { id: task.id, status: closed ? "todo" : "done" },
      {
        onSuccess: () => {
          if (!closed)
            toast(`Done: ${task.title}`, "success", {
              action: { label: "Undo", onClick: () => patch.mutate({ id: task.id, status: previous }) },
            });
        },
        onError: (e) => toast(e.message, "error"),
      }
    );
  };

  return (
    <div
      className={`group relative flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 transition-colors duration-150 hover:bg-fg/[0.04] ${
        dragging ? "opacity-40" : ""
      }`}
      onClick={() => open(task.id)}
      draggable={draggable}
      {...dragHandlers}
    >
      {draggable && (
        <GripVertical
          size={14}
          className="absolute -left-3 top-1/2 shrink-0 -translate-y-1/2 cursor-grab text-faint opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:hidden"
          aria-hidden="true"
        />
      )}
      <Checkbox checked={task.status === "done"} onChange={toggleDone} label={closed ? "Reopen" : "Mark done"} />
      {task.priority > 0 && !closed && (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} title={`Priority ${task.priority}`} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`min-w-0 break-words ${closed ? "text-faint line-through decoration-faint/60" : ""} ${
              task.status === "cancelled" ? "italic" : ""
            }`}
          >
            {task.title}
          </span>
          <TaskTags task={task} showProject={showProject} hidePersonId={hidePersonId} />
        </div>
      </div>
      {!closed && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
          {task.external_url && (
            <a
              href={task.external_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-quiet btn-xs btn-icon w-[26px]"
              onClick={(e) => e.stopPropagation()}
              title="Open link"
              aria-label="Open link"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button"
            className="btn btn-quiet btn-xs btn-icon w-[26px]"
            title={task.status === "in_progress" ? "Stop working on it" : "Start working on it"}
            aria-label={task.status === "in_progress" ? "Stop working on it" : "Start working on it"}
            onClick={(e) => {
              e.stopPropagation();
              patch.mutate({ id: task.id, status: task.status === "in_progress" ? "todo" : "in_progress" });
            }}
          >
            {task.status === "in_progress" ? <CirclePause size={14} /> : <CirclePlay size={14} />}
          </button>
          <button
            type="button"
            className={`btn btn-quiet btn-xs btn-icon w-[26px] ${task.today ? "text-accent" : ""}`}
            title={task.today ? "Remove from today" : "Do it today"}
            aria-label={task.today ? "Remove from today" : "Do it today"}
            aria-pressed={task.today}
            onClick={(e) => {
              e.stopPropagation();
              patch.mutate({ id: task.id, today: !task.today });
            }}
          >
            {task.today ? <SunDim size={14} /> : <Sun size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}
