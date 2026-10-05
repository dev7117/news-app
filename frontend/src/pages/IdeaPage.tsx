import { useState } from "react";
import { ArrowUpRight, ChevronLeft, Lightbulb, MapPin, Undo2, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { EmptyState } from "../components/TaskList";
import { useOpenTask } from "../components/TaskRow";
import { PlaceDialog, PromoteDialog } from "../components/ideas/IdeaDialog";
import Notebook, { NotebookOutline, useJump } from "../components/notebook/Notebook";
import { AutoTextarea, useAutosave } from "../components/notebook/autosave";
import { type Idea, useIdea, useIdeaMutations } from "../lib/api";
import { ago } from "../lib/format";

const STARTERS = ["Problem", "What they said", "Options", "Open questions", "Rough plan"].map((title) => ({ title }));

/** An idea as a notebook: summary, then markdown blocks you work on one at a time. */
export default function IdeaPage() {
  const id = Number(useParams().ideaId);
  const { data: idea, error } = useIdea(id);
  if (error) return <EmptyState icon={<Lightbulb size={18} />} title="Idea not found" />;
  if (!idea) return null;
  return <IdeaNotebook key={idea.id} idea={idea} />;
}

function IdeaNotebook({ idea }: { idea: Idea }) {
  const { update } = useIdeaMutations();
  const openTask = useOpenTask();
  const { highlight, jump } = useJump();
  const [promoting, setPromoting] = useState(false);
  const [placing, setPlacing] = useState(false);
  const title = useAutosave(idea.title, (value) => value.trim() && update.mutate({ id: idea.id, title: value }));
  const summary = useAutosave(idea.summary, (value) => update.mutate({ id: idea.id, summary: value }));
  const blocks = idea.blocks ?? [];
  const open = idea.status === "open";
  return (
    <div>
      <Link to="/ideas" className="btn btn-quiet btn-xs -ml-2 mb-4">
        <ChevronLeft size={13} /> Ideas
      </Link>

      <div className="grid gap-8 xl:grid-cols-[200px_minmax(0,1fr)]">
        <NotebookOutline blocks={blocks} onJump={jump} />

        <div className="min-w-0 max-w-3xl">
          <header className="mb-8">
            <input
              className="w-full bg-transparent text-[1.75rem] font-semibold leading-tight tracking-[-0.022em] outline-none"
              value={title.value}
              aria-label="Idea title"
              onChange={(e) => title.change(e.target.value)}
              onBlur={title.flush}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <AutoTextarea
              className="mt-2 w-full bg-transparent text-muted outline-none placeholder:text-faint"
              placeholder="One or two lines: what it is and why it matters…"
              value={summary.value}
              aria-label="Summary"
              onChange={(e) => summary.change(e.target.value)}
              onBlur={summary.flush}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {idea.customer && (
                <Link to={`/customers/${idea.customer_id}?tab=ideas`} className="tag hover:text-fg">
                  {idea.customer}
                </Link>
              )}
              {idea.project && (
                <Link to={`/projects/${idea.project_id}`} className="tag hover:text-fg">
                  {idea.project}
                </Link>
              )}
              {!idea.customer && !idea.project && <span className="tag">{idea.area === "work" ? "Work" : "Personal"}</span>}
              {idea.status === "dropped" && <span className="tag">Dropped</span>}
              <span className="text-xs text-faint">Updated {ago(idea.updated_at)}</span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPlacing(true)}>
                  <MapPin size={14} /> Where it belongs
                </button>
                {open ? (
                  <>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => update.mutate({ id: idea.id, status: "dropped" })}>
                      <X size={14} /> Drop
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setPromoting(true)}>
                      <ArrowUpRight size={14} /> Promote to task
                    </button>
                  </>
                ) : idea.status === "dropped" ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => update.mutate({ id: idea.id, status: "open" })}>
                    <Undo2 size={14} /> Reopen
                  </button>
                ) : null}
              </div>
            </div>
            {idea.status === "promoted" && (
              <div className="mt-4 rounded-[10px] bg-success/[0.08] px-4 py-3 text-sm">
                Promoted to a task:{" "}
                {idea.task_id ? (
                  <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => openTask(idea.task_id!)}>
                    {idea.task_title}
                  </button>
                ) : (
                  <span className="text-muted">(deleted)</span>
                )}
              </div>
            )}
          </header>

          <Notebook
            owner={{ kind: "idea", id: idea.id }}
            blocks={blocks}
            documentTitle={idea.title}
            starters={STARTERS}
            emptyTitle="Break it down"
            emptyHint="Each block is a small markdown document for one part of the idea."
            highlight={highlight}
          />
        </div>
      </div>

      {promoting && <PromoteDialog idea={idea} onClose={() => setPromoting(false)} />}
      {placing && <PlaceDialog idea={idea} onClose={() => setPlacing(false)} />}
    </div>
  );
}
