import { useState } from "react";
import { FolderPlus, Folders } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ProjectDialog from "../components/ProjectDialog";
import { EmptyState } from "../components/TaskList";
import { useProjects } from "../lib/api";
import { ProjectTile } from "./CustomersPage";

/** Personal projects. In Work focus projects live under Customers (and its internal projects);
    this is their home in Personal focus, where Customers is hidden. */
export default function ProjectsPage() {
  const { data: projects } = useProjects();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const mine = (projects ?? []).filter((p) => p.area === "personal");
  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="mt-1 text-muted">Your personal projects.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setCreating(true)}>
          <FolderPlus size={15} /> New project
        </button>
      </header>
      {projects && mine.length === 0 ? (
        <EmptyState icon={<Folders size={18} />} title="No personal projects yet">
          Group personal tasks into a project, e.g. a move, a trip or a home setup.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mine.map((p) => (
            <ProjectTile key={p.id} project={p} />
          ))}
        </div>
      )}
      {creating && (
        <ProjectDialog defaultArea="personal" onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />
      )}
    </div>
  );
}
