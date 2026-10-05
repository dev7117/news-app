import { useEffect, useState } from "react";
import { ExternalLink, Sun, SunDim, Trash2 } from "lucide-react";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Area,
  type Status,
  type Task,
  type TaskPatch,
  useProjects,
  useTaskMutations,
} from "../lib/api";
import { timestamp } from "../lib/format";
import { useOpenMeeting } from "./MeetingDialog";
import { useToast } from "../hooks/useToast";
import PeopleFields from "./people/PeopleFields";

const STATUSES: Status[] = ["inbox", "todo", "in_progress", "waiting", "done", "cancelled"];


/** The task's fields: status, today, area, project, priority, due, link, source; and delete. */
export function TaskSidebar({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const { patch, remove } = useTaskMutations();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const [waitingOn, setWaitingOn] = useState(task.waiting_on ?? "");
  const [link, setLink] = useState(task.external_url ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setWaitingOn(task.waiting_on ?? ""), [task.waiting_on]);
  useEffect(() => setLink(task.external_url ?? ""), [task.external_url]);

  const save = (body: TaskPatch) =>
    patch.mutate({ id: task.id, ...body }, { onError: (e) => toast(e.message, "error") });

  return (
      <aside className="space-y-4">
        <Field label="Status">
          <select
            className="field field-sm w-full"
            value={task.status}
            onChange={(e) => save({ status: e.target.value as Status })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <PeopleFields task={task} />
        {task.status === "waiting" && (
          <Field label="Waiting on">
            <input
              className="field field-sm w-full"
              placeholder="Who or what"
              value={waitingOn}
              onChange={(e) => setWaitingOn(e.target.value)}
              onBlur={() => waitingOn !== (task.waiting_on ?? "") && save({ waiting_on: waitingOn })}
            />
          </Field>
        )}
        <button
          type="button"
          className={`btn btn-sm w-full justify-start ${task.today ? "btn-ghost text-accent" : "btn-ghost"}`}
          aria-pressed={task.today}
          onClick={() => save({ today: !task.today })}
        >
          {task.today ? <SunDim size={15} /> : <Sun size={15} />}
          {task.today ? "On today · remove" : "Do it today"}
        </button>
        <Field label="Area">
          <div className="segmented w-full">
            {(["work", "personal"] as Area[]).map((area) => (
              <button
                key={area}
                type="button"
                className="filter-tab flex-1 justify-center capitalize"
                aria-pressed={task.area === area}
                disabled={!!task.project_id && task.area !== area}
                title={task.project_id && task.area !== area ? "Set by the project" : undefined}
                onClick={() => save({ area })}
              >
                {area === "work" ? "Work" : "Personal"}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Project">
          <select
            className="field field-sm w-full"
            value={task.project_id ?? ""}
            onChange={(e) => save({ project_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">No project</option>
            {(["work", "personal"] as Area[]).map((area) => (
              <optgroup key={area} label={area === "work" ? "Work" : "Personal"}>
                {projects
                  .filter((p) => p.area === area)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.customer ? `${p.customer} · ${p.name}` : p.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Priority">
          <div className="segmented w-full">
            {PRIORITY_LABELS.map((label, value) => (
              <button
                key={label}
                type="button"
                className="filter-tab flex-1 justify-center px-1"
                aria-pressed={task.priority === value}
                onClick={() => save({ priority: value as Task["priority"] })}
              >
                {value === 0 ? "–" : label === "Medium" ? "Med" : label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Due">
          <input
            type="date"
            className="field field-sm w-full"
            value={task.due_on ?? ""}
            onChange={(e) => save({ due_on: e.target.value || null })}
          />
        </Field>
        <Field label="Link">
          <div className="flex gap-1">
            <input
              className="field field-sm min-w-0 flex-1"
              placeholder="https://"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onBlur={() => link !== (task.external_url ?? "") && save({ external_url: link })}
            />
            {task.external_url && (
              <a
                href={task.external_url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label="Open link"
                title="Open link"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </Field>
        <dl className="space-y-1 border-t border-edge pt-4 text-xs text-muted">
          <div className="flex justify-between gap-2">
            <dt>Source</dt>
            <dd className="truncate text-right" title={task.source}>
              {task.source}
              {task.external_id ? ` · ${task.external_id}` : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Created</dt>
            <dd className="tabular">{timestamp(task.created_at)}</dd>
          </div>
          {task.completed_at && (
            <div className="flex justify-between gap-2">
              <dt>Closed</dt>
              <dd className="tabular">{timestamp(task.completed_at)}</dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          className="btn btn-danger btn-sm w-full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3000);
              return;
            }
            remove.mutate(task.id, {
              onSuccess: () => {
                toast("Task deleted", "success");
                onDeleted();
              },
            });
          }}
        >
          <Trash2 size={14} />
          {confirmDelete ? "Click again to delete" : "Delete task"}
        </button>
      </aside>
  );
}

export function FromMeetings({ task }: { task: Task }) {
  const open = useOpenMeeting();
  return (
    <div>
      <div className="eyebrow mb-1.5">From meetings</div>
      <div className="flex flex-wrap gap-1.5">
        {task.meetings!.map((m) => (
          <button key={m.id} type="button" className="tag hover:text-fg" onClick={() => open(m.id)}>
            {m.title} · {m.held_on}
          </button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}
