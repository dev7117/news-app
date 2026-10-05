import { useState } from "react";
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Columns3, List, Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Board from "../components/Board";
import ProjectDialog from "../components/ProjectDialog";
import QuickAdd from "../components/QuickAdd";
import { EmptyState, TaskGroup } from "../components/TaskList";
import { STATUS_LABELS, type Status, type Task, useProjectMutations, useProjects, useTasks } from "../lib/api";
import { usePersisted } from "../lib/usePersisted";
import { useToast } from "../hooks/useToast";

const ORDER: Status[] = ["in_progress", "todo", "waiting", "inbox"];

export default function ProjectPage() {
  const id = Number(useParams().projectId);
  const { data: projects } = useProjects(true);
  const project = projects?.find((p) => p.id === id);
  const { update } = useProjectMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [view, setView] = usePersisted<"board" | "list">("todo-project-view", "board");

  if (projects && !project) return <EmptyState icon={<ChevronLeft size={18} />} title="Project not found" />;
  if (!project) return null;

  return (
    <div className={view === "board" ? "" : "mx-auto max-w-3xl"}>
      <Link
        to={project.customer_id ? `/customers/${project.customer_id}?tab=work` : "/customers"}
        className="btn btn-quiet btn-xs -ml-2 mb-3"
      >
        <ChevronLeft size={13} /> {project.customer ?? "Customers"}
      </Link>
      <header className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="page-title break-words">{project.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="tag">{project.area === "work" ? "Work" : "Personal"}</span>
            {project.customer && <span className="tag">{project.customer}</span>}
            {project.archived && <span className="tag tag-warning">Archived</span>}
          </div>
          {project.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-muted">{project.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <div className="segmented mr-2">
            <button type="button" className="filter-tab" aria-pressed={view === "board"} onClick={() => setView("board")}>
              <Columns3 size={14} /> Board
            </button>
            <button type="button" className="filter-tab" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <List size={14} /> List
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm btn-icon"
            title={project.archived ? "Unarchive" : "Archive"}
            aria-label={project.archived ? "Unarchive" : "Archive"}
            onClick={() =>
              update.mutate(
                { id: project.id, archived: !project.archived },
                { onSuccess: () => toast(project.archived ? "Unarchived" : "Archived", "success") }
              )
            }
          >
            {project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
        </div>
      </header>

      <div className="mb-8 max-w-3xl">
        <QuickAdd placeholder={`Add to ${project.name}…`} implied={`#${project.name.replace(/\s+/g, "-")}`} />
      </div>

      {view === "board" ? (
        <Board filters={{ project_id: id }} groupBy="none" storageKey={`project-${id}`} showMeta={false} />
      ) : (
        <ProjectList projectId={id} />
      )}

      {editing && <ProjectDialog project={project} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ProjectList({ projectId }: { projectId: number }) {
  const { data: open = [] } = useTasks({ project_id: projectId });
  const { data: closed = [] } = useTasks({ project_id: projectId, status: ["done", "cancelled"], limit: 50 });
  const [showClosed, setShowClosed] = useState(false);
  return (
    <>
      {open.length === 0 && <EmptyState icon={<Pencil size={18} />} title="No open tasks" />}
      {ORDER.map((status) => {
        const list = open.filter((t: Task) => t.status === status);
        return list.length ? (
          <TaskGroup key={status} title={STATUS_LABELS[status]} count={list.length} tasks={list} showProject={false} />
        ) : null;
      })}
      {closed.length > 0 && (
        <section>
          <button
            type="button"
            className="btn btn-quiet btn-xs"
            aria-expanded={showClosed}
            onClick={() => setShowClosed(!showClosed)}
          >
            <ChevronRight size={13} className={`transition-transform duration-200 ease-out ${showClosed ? "rotate-90" : ""}`} />
            Closed <span className="tabular">{closed.length}</span>
          </button>
          {showClosed && (
            <div className="anim-rise">
              <TaskGroup tasks={closed} showProject={false} />
            </div>
          )}
        </section>
      )}
    </>
  );
}
