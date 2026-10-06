import { GroupTasks, InGroup, PrepFor } from "../components/task/Group";
import ImageStrip, { imageRefs, withImages, wordsOf } from "../components/ImageStrip";
import { useImagePaste } from "../lib/useImagePaste";
import { ChevronLeft, ExternalLink, ListChecks } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Checkbox from "../components/Checkbox";
import { FromMeetings, TaskSidebar } from "../components/TaskDialog";
import { EmptyState } from "../components/TaskList";
import { TaskTags } from "../components/TaskRow";
import Notebook, { type Starter } from "../components/notebook/Notebook";
import { AutoTextarea, useAutosave } from "../components/notebook/autosave";
import { useMentionProvider } from "../components/autocomplete/providers";
import { useAutocomplete } from "../components/autocomplete/useAutocomplete";
import { useRef } from "react";
import Timeline from "../components/task/Timeline";
import AgentPanel from "../components/task/AgentPanel";
import TaskFiles from "../components/task/TaskFiles";
import { isClosed, type Task, useTask, useTaskMutations } from "../lib/api";

const STARTERS: Starter[] = [
  { title: "First step", kind: "subtask" },
  { title: "Notes" },
  { title: "Plan" },
  { title: "Links & references" },
];

/** A task: what it is, its notebook (subtasks + notes), its fields, and its timeline. */
export default function TaskPage() {
  const id = Number(useParams().taskId);
  const { data: task, error } = useTask(id);
  if (error) return <EmptyState icon={<ListChecks size={18} />} title="Task not found" />;
  if (!task) return null;
  return <TaskView key={task.id} task={task} />;
}

function TaskView({ task }: { task: Task }) {
  const navigate = useNavigate();
  const { patch } = useTaskMutations();
  const title = useAutosave(task.title, (value) => value.trim() && patch.mutate({ id: task.id, title: value }));
  const notes = useAutosave(task.notes, (value) => patch.mutate({ id: task.id, notes: value }));
  const notesRef = useRef<HTMLTextAreaElement>(null);
  // The description box holds the words; its images show as thumbnails below (kept at the end of the notes).
  const words = wordsOf(notes.value);
  const noCaret = useRef<HTMLTextAreaElement>(null); // pasted images go at the end
  const setWords = (text: string) => notes.change(withImages(text, imageRefs(notes.value)));
  const mention = useAutocomplete({ value: words, onChange: setWords, provider: useMentionProvider(), ref: notesRef });
  const images = useImagePaste({ ref: noCaret, value: notes.value, onChange: notes.change });
  // Progress from the blocks on the page (updated the moment a box is ticked).
  const subtasks = (task.blocks ?? []).filter((b) => b.kind === "subtask");
  const total = subtasks.length;
  const done = subtasks.filter((b) => b.done).length;
  const closed = isClosed(task.status);
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  return (
    <div>
      <button type="button" className="btn btn-quiet btn-xs -ml-2 mb-4" onClick={back}>
        <ChevronLeft size={13} /> Back
      </button>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <header className="mb-6">
            <InGroup task={task} />
            <div className="flex items-start gap-3">
              <span className="mt-[11px]">
                <Checkbox
                  checked={task.status === "done"}
                  label={closed ? "Reopen" : "Mark done"}
                  onChange={() => patch.mutate({ id: task.id, status: closed ? "todo" : "done" })}
                />
              </span>
              <input
                className={`min-w-0 flex-1 bg-transparent text-[1.75rem] font-semibold leading-tight tracking-[-0.022em] outline-none ${
                  closed ? "text-muted line-through decoration-faint/60" : ""
                }`}
                value={title.value}
                aria-label="Task title"
                onChange={(e) => title.change(e.target.value)}
                onBlur={title.flush}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              {task.external_url && (
                <a href={task.external_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm mt-1.5 shrink-0" title={task.external_url}>
                  <ExternalLink size={14} /> {task.external_id ?? "Link"}
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[30px]">
              <TaskTags task={{ ...task, subtasks_total: total, subtasks_done: done, parent: null }} />
            </div>
            {total > 0 && (
              <div className="mt-4 flex items-center gap-3 pl-[30px]">
                <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-fg/[0.08]" role="progressbar" aria-valuenow={done} aria-valuemax={total} aria-label="Subtasks done">
                  <div className="h-full rounded-full bg-success transition-[width] duration-300 ease-out" style={{ width: `${(100 * done) / total}%` }} />
                </div>
                <span className="tabular text-sm text-muted">
                  {done} of {total} subtasks
                </span>
              </div>
            )}
            <AutoTextarea
              {...mention.bind}
              ref={notesRef}
              className="mt-4 w-full bg-transparent pl-[30px] leading-relaxed text-muted outline-none placeholder:text-faint"
              placeholder="What this is about, in a line or two…  (@ to mention someone · paste a screenshot)"
              value={words}
              aria-label="Description"
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={mention.onKeyDown}
              {...images.handlers}
              onBlur={() => {
                mention.bind.onBlur();
                notes.flush();
              }}
            />
            {mention.popup}
            {images.uploading && <p className="mt-1 pl-[30px] text-xs text-faint">Uploading image…</p>}
            <ImageStrip
              text={notes.value}
              className="mt-2 pl-[30px]"
              onRemove={(url) => notes.change(withImages(words, imageRefs(notes.value).filter((r) => !r.includes(`(${url})`))))}
            />
          </header>

          <AgentPanel task={task} />
          <PrepFor task={task} />
          <GroupTasks task={task} />

          <Notebook
            owner={{ kind: "task", id: task.id }}
            blocks={task.blocks ?? []}
            documentTitle={task.title}
            allowSubtasks
            starters={STARTERS}
            emptyTitle="Break it down"
            emptyHint="Add subtasks to check off, and notes as markdown blocks. Shift+Enter after a subtask adds the next one."
          />

          <TaskFiles task={task} />

          {!!task.meetings?.length && (
            <div className="mt-8">
              <FromMeetings task={task} />
            </div>
          )}
        </div>

        <TaskSidebar task={task} onDeleted={back} />
      </div>

      <div className="mt-10">
        <Timeline task={task} />
      </div>
    </div>
  );
}
