import { useRef, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  History,
  Paperclip,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Checkbox from "../components/Checkbox";
import Markdown from "../components/Markdown";
import { countdown, STATUS_LOOK, when } from "../components/cadence/format";
import { AutoTextarea, SaveHint, useAutosave } from "../components/notebook/autosave";
import {
  ACTIVE_RUN,
  type Attachment,
  isClosed,
  type Occurrence,
  type OccurrenceStatus,
  type OccurrenceTopic,
  useAgents,
  useOccurrence,
  useOccurrenceMutations,
  useTaskMutations,
} from "../lib/api";
import { ago, dueLabel, todayIso } from "../lib/format";
import { useToast } from "../hooks/useToast";

/** One cadence meeting's prep: the steps (tasks, tools, their files), talking points per agenda
    topic (with last meeting's), notes, and every file attached. Claude fills most of it over MCP. */
export default function OccurrencePage() {
  const id = Number(useParams().occurrenceId);
  const { data: occ, error } = useOccurrence(id);
  if (error) return <p className="py-16 text-center text-muted">{error.message}</p>;
  if (!occ) return <div className="h-64" />;
  return <Prep occ={occ} />;
}

function Prep({ occ }: { occ: Occurrence }) {
  const { update } = useOccurrenceMutations(occ.id);
  const { toast } = useToast();
  const cadence = occ.cadence;
  const pct = occ.prep.total ? (100 * occ.prep.done) / occ.prep.total : 0;

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link to={`/cadences/${cadence.id}`} className="btn btn-quiet btn-sm -ml-2 mb-4">
        <ChevronLeft size={13} /> {cadence.name}
      </Link>

      <header className="mb-8">
        <p className="eyebrow">
          <Link to={`/customers/${cadence.customer_id}?tab=cadences`} className="hover:underline">
            {cadence.customer}
          </Link>{" "}
          · {cadence.schedule_text}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="page-title">
            {cadence.name} · {when(occ.starts_at)}
          </h1>
          <span className="text-muted">{countdown(occ.starts_at)}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="segmented">
            {(Object.keys(STATUS_LOOK) as OccurrenceStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className="filter-tab"
                aria-pressed={occ.status === s}
                onClick={() => update.mutate({ status: s }, { onError: (e) => toast(e.message, "error") })}
              >
                {STATUS_LOOK[s].label}
              </button>
            ))}
          </div>
          {occ.prep.total > 0 && (
            <div className="flex min-w-[200px] flex-1 items-center gap-3">
              <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-fg/[0.08]" role="progressbar" aria-valuenow={occ.prep.done} aria-valuemax={occ.prep.total} aria-label="Prep done">
                <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="tabular text-sm text-muted">
                {occ.prep.done} of {occ.prep.total} prep steps
              </span>
            </div>
          )}
          {occ.prep_task_id && (
            <Link to={`/tasks/${occ.prep_task_id}`} className="btn btn-quiet btn-sm">
              <FolderOpen size={14} /> Prep tasks
            </Link>
          )}
        </div>
        {occ.meeting?.attendees && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Users size={14} /> {occ.meeting.attendees}
          </p>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-10">
          {cadence.purpose.trim() && (
            <section className="rounded-[12px] bg-fg/[0.03] px-4 py-3 text-sm text-muted">
              <Markdown>{cadence.purpose}</Markdown>
            </section>
          )}
          <Steps occ={occ} />
          <Topics occ={occ} />
          <Notes occ={occ} />
        </div>
        <Files occ={occ} />
      </div>
    </div>
  );
}

// ----- prep steps -----

function Steps({ occ }: { occ: Occurrence }) {
  const { patch } = useTaskMutations();
  const [open, setOpen] = useState<number | null>(null);
  if (!occ.steps.length) return null;
  return (
    <section>
      <h2 className="section-title mb-3">Prep steps</h2>
      <ul className="overflow-hidden rounded-[12px] border border-edge bg-tile shadow-card">
        {occ.steps.map((step) => {
          const task = step.task;
          const done = task ? isClosed(task.status) : false;
          const expanded = open === step.id;
          return (
            <li key={step.id} className="border-b border-edge last:border-b-0">
              <div className="flex items-center gap-3 px-3 py-2.5">
                {task ? (
                  <Checkbox
                    checked={task.status === "done"}
                    label={done ? "Reopen" : "Mark done"}
                    onChange={() => patch.mutate({ id: task.id, status: done ? "todo" : "done" })}
                  />
                ) : (
                  <span className="w-[18px]" />
                )}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : step.id)}
                >
                  <ChevronRight size={13} className={`shrink-0 text-faint transition-transform duration-200 ease-out ${expanded ? "rotate-90" : ""}`} />
                  <span className={`truncate ${done ? "text-faint line-through decoration-faint/60" : ""}`}>{step.title}</span>
                </button>
                {!!step.files.length && (
                  <span className="tag tabular" title={step.files.map((f) => f.name).join(", ")}>
                    <Paperclip size={11} /> {step.files.length}
                  </span>
                )}
                {task?.due_on && !done && (
                  <span className={`tag ${task.due_on < todayIso() ? "tag-danger" : task.due_on === todayIso() ? "tag-warning" : ""}`}>
                    {dueLabel(task.due_on, task.due_on < todayIso())}
                  </span>
                )}
                {step.link_id && <StepRun occId={occ.id} step={step} />}
              </div>
              {expanded && (
                <div className="anim-fade space-y-2 px-3 pb-3 pl-[52px] text-sm">
                  {step.instructions.trim() ? <Markdown>{step.instructions}</Markdown> : <p className="text-faint">No instructions.</p>}
                  {step.tool && (
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <SquareTerminal size={12} /> {step.tool}:{" "}
                      <code className="truncate">
                        {step.tool_cwd ? `${step.tool_cwd} $ ` : "$ "}
                        {step.tool_command}
                      </code>
                    </p>
                  )}
                  {step.outputs && (
                    <p className="text-xs text-muted">
                      Attaches: <code>{step.outputs.split("\n").join(", ")}</code>
                    </p>
                  )}
                  {!!step.files.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {step.files.map((f) => (
                        <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="tag hover:text-fg">
                          <FileText size={11} /> {f.name}
                        </a>
                      ))}
                    </div>
                  )}
                  {task && (
                    <Link to={`/tasks/${task.id}`} className="inline-block text-xs text-muted hover:underline">
                      Open the task
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StepRun({ occId, step }: { occId: number; step: Occurrence["steps"][number] }) {
  const { runStep } = useOccurrenceMutations(occId);
  const { data: agents = [] } = useAgents();
  const { toast } = useToast();
  const online = agents.filter((a) => a.online);
  const [agent, setAgent] = useState("");
  const run = step.last_run;
  const active = run && ACTIVE_RUN.includes(run.status);
  const start = () =>
    runStep.mutate(
      { stepId: step.id, agent: agent || undefined },
      { onSuccess: (r) => toast(`Running “${step.tool}” on ${r.agent}`, "success"), onError: (e) => toast(e.message, "error") }
    );
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {run && (
        <span
          className={`tag ${run.status === "succeeded" ? "tag-success" : run.status === "failed" || run.status === "declined" ? "tag-danger" : active ? "tag-accent" : ""}`}
          title={run.finished_at ? `Finished ${ago(run.finished_at)} on ${run.agent}` : `On ${run.agent}`}
        >
          {active ? "Running…" : run.status === "succeeded" ? "Ran" : run.status}
        </span>
      )}
      {online.length > 1 && (
        <select className="field field-sm w-[110px]" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Machine">
          <option value="">Machine…</option>
          {online.map((a) => (
            <option key={a.name}>{a.name}</option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        disabled={!online.length || runStep.isPending || !!active || (online.length > 1 && !agent)}
        title={online.length ? `Run ${step.tool}; its output files get attached here` : "No machine connected (Settings → Machines)"}
        onClick={start}
      >
        <Play size={12} /> Run
      </button>
    </div>
  );
}

// ----- agenda & talking points -----

function Topics({ occ }: { occ: Occurrence }) {
  const { addTopic } = useOccurrenceMutations(occ.id);
  const [adding, setAdding] = useState("");
  const previous = new Map((occ.previous?.topics ?? []).map((t) => [t.title.toLowerCase(), t]));
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="section-title">Agenda & talking points</h2>
        {occ.previous && <span className="text-sm text-faint">· last meeting {occ.previous.held_on}</span>}
      </div>
      <ol className="space-y-3">
        {occ.topics.map((topic, i) => (
          <TopicCard key={topic.id} occId={occ.id} topic={topic} index={i} previous={previous.get(topic.title.toLowerCase())} />
        ))}
      </ol>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) addTopic.mutate(adding.trim(), { onSuccess: () => setAdding("") });
        }}
      >
        <input className="field field-sm flex-1" placeholder="Add a topic for this meeting only…" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!adding.trim()}>
          <Plus size={14} /> Add
        </button>
      </form>
    </section>
  );
}

function TopicCard({ occId, topic, index, previous }: { occId: number; topic: OccurrenceTopic; index: number; previous?: OccurrenceTopic }) {
  const { setPoints, removeTopic } = useOccurrenceMutations(occId);
  const points = useAutosave(topic.points, (value) => setPoints.mutate({ topicId: topic.id, points: value }));
  const [editing, setEditing] = useState(false);
  const [showPrevious, setShowPrevious] = useState(false);
  return (
    <li className="well group p-4">
      <div className="flex items-start gap-3">
        <span className="tabular mt-0.5 text-sm text-faint">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{topic.title}</h3>
            {topic.source === "mcp" && <span className="tag">by Claude</span>}
            <SaveHint status={points.status} />
            <button
              type="button"
              className="btn btn-quiet btn-xs btn-icon ml-auto w-[26px] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
              title="Remove from this meeting"
              aria-label={`Remove ${topic.title}`}
              onClick={() => removeTopic.mutate(topic.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {topic.guidance && <p className="mt-0.5 text-xs text-muted">{topic.guidance}</p>}
          <div className="mt-2">
            {editing ? (
              <AutoTextarea
                autoFocus
                className="w-full bg-transparent font-mono text-[0.8125rem] leading-relaxed outline-none placeholder:text-faint"
                placeholder="- Talking points (markdown)"
                value={points.value}
                onChange={(e) => points.change(e.target.value)}
                onBlur={() => {
                  points.flush();
                  setEditing(false);
                }}
                onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()}
              />
            ) : (
              <button type="button" className="block w-full text-left" onClick={() => setEditing(true)} aria-label={`Edit talking points for ${topic.title}`}>
                {points.value.trim() ? <Markdown>{points.value}</Markdown> : <p className="text-sm text-faint">No talking points yet. Click to write, or let Claude prep it.</p>}
              </button>
            )}
          </div>
          {previous?.points.trim() && (
            <div className="mt-3 border-t border-edge pt-2">
              <button type="button" className="flex items-center gap-1.5 text-xs text-muted hover:text-fg" aria-expanded={showPrevious} onClick={() => setShowPrevious(!showPrevious)}>
                <History size={12} /> Last time
                <ChevronRight size={12} className={`transition-transform duration-200 ease-out ${showPrevious ? "rotate-90" : ""}`} />
              </button>
              {showPrevious && (
                <div className="anim-fade mt-1.5 text-sm text-muted">
                  <Markdown>{previous.points}</Markdown>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ----- notes -----

function Notes({ occ }: { occ: Occurrence }) {
  const { update } = useOccurrenceMutations(occ.id);
  const notes = useAutosave(occ.notes, (value) => update.mutate({ notes: value }));
  const [editing, setEditing] = useState(false);
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="section-title">Notes</h2>
        <SaveHint status={notes.status} />
      </div>
      <div className="well p-4">
        {editing ? (
          <AutoTextarea
            autoFocus
            className="min-h-[80px] w-full bg-transparent font-mono text-[0.8125rem] leading-relaxed outline-none"
            placeholder="Context, numbers, a summary of the reports… (markdown)"
            value={notes.value}
            onChange={(e) => notes.change(e.target.value)}
            onBlur={() => {
              notes.flush();
              setEditing(false);
            }}
          />
        ) : (
          <button type="button" className="block w-full text-left" onClick={() => setEditing(true)}>
            {notes.value.trim() ? <Markdown>{notes.value}</Markdown> : <p className="text-sm text-faint">Click to write notes for this meeting.</p>}
          </button>
        )}
      </div>
    </section>
  );
}

// ----- files -----

function Files({ occ }: { occ: Occurrence }) {
  const { upload, removeFile } = useOccurrenceMutations(occ.id);
  const { toast } = useToast();
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const steps = new Map(occ.steps.map((s) => [s.id, s.title]));
  const send = (files: File[]) =>
    files.forEach((file) =>
      upload.mutate({ file }, { onSuccess: (f) => toast(`Attached ${f.name}`, "success"), onError: (e) => toast(e.message, "error") })
    );

  return (
    <aside>
      <div className="lg:sticky lg:top-24">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-title">Files</h2>
          <span className="tabular text-sm text-faint">{occ.files.length}</span>
          <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => picker.current?.click()}>
            <Upload size={13} /> Attach
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              send([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <div
          className={`rounded-[12px] border border-dashed p-2 transition-colors duration-150 ${over ? "border-accent bg-accent/[0.06]" : "border-edge"}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            send([...e.dataTransfer.files]);
          }}
        >
          {occ.files.length ? (
            <ul className="space-y-1">
              {occ.files.map((f) => (
                <FileRow key={f.id} file={f} step={f.step_id ? steps.get(f.step_id) : undefined} onRemove={() => removeFile.mutate(f.id)} />
              ))}
            </ul>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-faint">
              Drop reports and exports here. Tools that run for a step, and Claude, attach theirs here too.
            </p>
          )}
          {upload.isPending && <p className="px-2 py-1 text-xs text-faint">Uploading…</p>}
        </div>
        {occ.meeting && (
          <p className="mt-4 flex items-start gap-2 text-xs text-faint">
            <CalendarClock size={13} className="mt-px shrink-0" />
            <span>
              Attach from a script with <code className="text-muted">todo-agent upload {occ.id} &lt;file&gt;</code>
            </span>
          </p>
        )}
      </div>
    </aside>
  );
}

function FileRow({ file, step, onRemove }: { file: Attachment; step?: string; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="group flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-fg/[0.04]">
      <FileText size={15} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <a href={file.url} target="_blank" rel="noreferrer" className="block truncate text-sm hover:underline" title={file.name}>
          {file.name}
        </a>
        <span className="block truncate text-xs text-faint">
          {size(file.bytes)} · {file.source === "agent" ? "from a tool" : file.source === "mcp" ? "by Claude" : "you"} · {ago(file.created_at)}
          {step && ` · ${step}`}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-xs btn-icon w-[26px] ${confirm ? "btn-danger" : "btn-quiet [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"}`}
        title={confirm ? "Click again to delete" : "Delete"}
        aria-label={`Delete ${file.name}`}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            window.setTimeout(() => setConfirm(false), 3000);
            return;
          }
          onRemove();
        }}
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
