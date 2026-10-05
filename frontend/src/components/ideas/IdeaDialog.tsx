import { useEffect, useState } from "react";
import { ArrowUpRight, FileText, ListChecks, Trash2 } from "lucide-react";
import Checkbox from "../Checkbox";
import { blockLabel } from "../notebook/Notebook";
import { useNavigate, useSearchParams } from "react-router-dom";
import Modal from "../Modal";
import { type Area, type Idea, useCustomers, useIdeaMutations, useProjects } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

/** Old ?idea=<id> links (toasts, Claude) now open the idea's page. */
export function IdeaFromUrl() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const id = Number(params.get("idea"));
  useEffect(() => {
    if (id) navigate(`/ideas/${id}`, { replace: true });
  }, [id, navigate]);
  return null;
}

export function PromoteDialog({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { promote } = useIdeaMutations();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const navigate = useNavigate();
  const blocks = idea.blocks ?? [];
  // Every block becomes a subtask unless unticked here (then it comes over as a note).
  const [asNotes, setAsNotes] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState(idea.title);
  const [target, setTarget] = useState<number | "">(idea.project_id ?? "");
  const [today, setToday] = useState(false);
  const candidates = projects.filter((p) =>
    idea.customer_id ? p.customer_id === idea.customer_id : idea.project_id ? true : p.area === idea.area
  );
  const needsProject = !!idea.customer_id && !target;

  return (
    <Modal title="Promote to a task" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          promote.mutate(
            { id: idea.id, title, project_id: target || undefined, today: today || undefined, note_block_ids: [...asNotes] },
            {
              onSuccess: (task) => {
                onClose();
                navigate(`/tasks/${task.id}`);
                toast("Promoted to a task", "success");
              },
              onError: (err) => toast(err.message, "error"),
            }
          );
        }}
      >
        <p className="text-sm text-muted">
          The summary becomes the task's description and each block becomes a subtask. The idea stays, marked promoted,
          with a link to the task.
        </p>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Task title</span>
          <input className="field w-full" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Project</span>
          <select className="field w-full" value={target} onChange={(e) => setTarget(e.target.value ? Number(e.target.value) : "")}>
            <option value="">{idea.customer ? "Pick one of their projects…" : "No project"}</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.customer ? `${p.customer} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={today} onChange={(e) => setToday(e.target.checked)} /> Also put it on today
        </label>
        {blocks.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="eyebrow">Blocks</span>
              <span className="text-xs text-faint">
                {blocks.length - asNotes.size} subtask{blocks.length - asNotes.size === 1 ? "" : "s"}
                {asNotes.size > 0 && `, ${asNotes.size} note${asNotes.size === 1 ? "" : "s"}`}
              </span>
            </div>
            <ul className="max-h-60 space-y-0.5 overflow-y-auto rounded-[10px] border border-edge p-1.5">
              {blocks.map((b, i) => {
                const subtask = !asNotes.has(b.id);
                const toggle = () => {
                  const next = new Set(asNotes);
                  if (subtask) next.add(b.id);
                  else next.delete(b.id);
                  setAsNotes(next);
                };
                return (
                  <li key={b.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-fg/[0.04]">
                    <Checkbox checked={subtask} onChange={toggle} label={subtask ? "Bring over as a note instead" : "Make it a subtask"} />
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" onClick={toggle}>
                      {blockLabel(b, i)}
                    </button>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-faint">
                      {subtask ? <ListChecks size={12} /> : <FileText size={12} />} {subtask ? "Subtask" : "Note"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={needsProject || !title.trim() || promote.isPending}>
            <ArrowUpRight size={15} /> Promote
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Where the idea belongs (customer / project / area), and deleting it. */
export function PlaceDialog({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { update, remove } = useIdeaMutations();
  const { data: customers = [] } = useCustomers();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fail = { onError: (e: Error) => toast(e.message, "error") };
  const save = (body: { customer_id?: number | null; project_id?: number | null; area?: Area }) =>
    update.mutate({ id: idea.id, ...body }, fail);
  const projectChoices = projects.filter((p) =>
    idea.customer_id ? p.customer_id === idea.customer_id : p.customer_id === null && p.area === idea.area
  );

  return (
    <Modal title="Where it belongs" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Customer</span>
          <select
            className="field w-full"
            value={idea.customer_id ?? ""}
            onChange={(e) => save({ customer_id: e.target.value ? Number(e.target.value) : null, project_id: null })}
          >
            <option value="">None</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Project</span>
          <select
            className="field w-full"
            value={idea.project_id ?? ""}
            onChange={(e) => save({ project_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{idea.customer ? `Any ${idea.customer} project` : "None"}</option>
            {projectChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!idea.customer_id && !idea.project_id && (
          <div>
            <span className="eyebrow mb-1.5 block">Area</span>
            <div className="segmented">
              {(["work", "personal"] as Area[]).map((a) => (
                <button key={a} type="button" className="filter-tab" aria-pressed={idea.area === a} onClick={() => save({ area: a })}>
                  {a === "work" ? "Work" : "Personal"}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-edge pt-4">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                window.setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              remove.mutate(idea.id, {
                onSuccess: () => {
                  onClose();
                  navigate("/ideas");
                  toast("Idea deleted", "success");
                },
              });
            }}
          >
            <Trash2 size={14} /> {confirmDelete ? "Click again to delete the idea and its blocks" : "Delete idea"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
