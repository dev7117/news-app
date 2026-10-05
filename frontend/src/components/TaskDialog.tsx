import { useEffect, useState } from "react";
import { ExternalLink, MessageSquareText, Pencil, Sparkles, Sun, SunDim, Trash2 } from "lucide-react";
import Modal from "./Modal";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Area,
  type Status,
  type Task,
  type TaskPatch,
  type TaskUpdate,
  useProjects,
  useTask,
  useTaskMutations,
} from "../lib/api";
import { timestamp } from "../lib/format";
import { useOpenMeeting } from "./MeetingDialog";
import { useToast } from "../hooks/useToast";

const STATUSES: Status[] = ["inbox", "todo", "in_progress", "waiting", "done", "cancelled"];

interface Props {
  taskId: number;
  onClose: () => void;
}

export default function TaskDialog({ taskId, onClose }: Props) {
  const { data: task, error } = useTask(taskId);
  return (
    <Modal title={task ? task.title : "Task"} onClose={onClose} wide>
      {error ? (
        <p className="text-muted">{error.message}</p>
      ) : !task ? (
        <div className="h-64" />
      ) : (
        <TaskEditor key={task.id} task={task} onDeleted={onClose} />
      )}
    </Modal>
  );
}

function TaskEditor({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const { patch, remove } = useTaskMutations();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [waitingOn, setWaitingOn] = useState(task.waiting_on ?? "");
  const [link, setLink] = useState(task.external_url ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Server changes (another tab, Claude) flow in unless the user is editing that field.
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.notes), [task.notes]);

  const save = (body: TaskPatch) =>
    patch.mutate({ id: task.id, ...body }, { onError: (e) => toast(e.message, "error") });

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_240px]">
      <div className="min-w-0 space-y-5">
        <input
          className="field w-full text-[0.9375rem] font-medium"
          value={title}
          aria-label="Title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div>
          <label className="eyebrow mb-1.5 block" htmlFor="task-notes">
            Notes
          </label>
          <textarea
            id="task-notes"
            className="field min-h-[120px] w-full resize-y leading-relaxed"
            placeholder="Details, context, links…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== task.notes && save({ notes })}
          />
        </div>
        {!!task.meetings?.length && <FromMeetings task={task} />}
        <History task={task} />
      </div>

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
    </div>
  );
}

function FromMeetings({ task }: { task: Task }) {
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

const KIND_ICON: Record<TaskUpdate["kind"], React.ReactNode> = {
  created: <Sparkles size={13} />,
  change: <Pencil size={13} />,
  note: <MessageSquareText size={13} />,
};

function History({ task }: { task: Task }) {
  const { note } = useTaskMutations();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const updates = [...(task.updates ?? [])].reverse();

  const submit = () => {
    if (!draft.trim()) return;
    note.mutate(
      { id: task.id, body: draft.trim() },
      { onSuccess: () => setDraft(""), onError: (e) => toast(e.message, "error") }
    );
  };

  return (
    <section>
      <div className="eyebrow mb-1.5">History</div>
      <div className="mb-4 flex gap-2">
        <textarea
          className="field min-h-[36px] flex-1 resize-y"
          rows={1}
          placeholder="Log progress…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <button type="button" className="btn btn-ghost" disabled={!draft.trim() || note.isPending} onClick={submit}>
          Add
        </button>
      </div>
      <ol className="relative space-y-3 border-l border-edge pl-4">
        {updates.map((u) => (
          <li key={u.id} className="anim-rise relative">
            <span className="absolute -left-[25px] top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border border-edge bg-tile text-faint">
              {KIND_ICON[u.kind]}
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-faint">
              <span className="tabular">{timestamp(u.created_at)}</span>
              <span className="truncate">{u.source}</span>
            </div>
            <p className={`whitespace-pre-wrap break-words ${u.kind === "note" ? "" : "text-muted"}`}>
              {u.body || (u.kind === "created" ? "Created" : "")}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
