import { useState } from "react";
import Modal from "./Modal";
import { type Area, type Project, useCustomers, useProjectMutations } from "../lib/api";
import { useToast } from "../hooks/useToast";

interface Props {
  project?: Project;
  defaultArea?: Area;
  defaultCustomer?: string;
  onClose: () => void;
  onSaved?: (project: Project) => void;
}

export default function ProjectDialog({ project, defaultArea = "work", defaultCustomer, onClose, onSaved }: Props) {
  const { create, update } = useProjectMutations();
  const { data: customers = [] } = useCustomers();
  const { toast } = useToast();
  const [name, setName] = useState(project?.name ?? "");
  const [area, setArea] = useState<Area>(project?.area ?? defaultArea);
  const [customer, setCustomer] = useState(project?.customer ?? defaultCustomer ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name, area, customer: customer || null, description };
    const done = {
      onSuccess: (saved: Project) => {
        toast(project ? "Project saved" : `Created ${saved.name}`, "success");
        onSaved?.(saved);
        onClose();
      },
      onError: (error: Error) => toast(error.message, "error"),
    };
    if (project) update.mutate({ id: project.id, ...body }, done);
    else create.mutate(body, done);
  };

  return (
    <Modal title={project ? "Edit project" : "New project"} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Name</span>
          <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </label>
        <div>
          <span className="eyebrow mb-1.5 block">Area</span>
          <div className="segmented">
            {(["work", "personal"] as Area[]).map((a) => (
              <button key={a} type="button" className="filter-tab" aria-pressed={area === a} onClick={() => setArea(a)}>
                {a === "work" ? "Work" : "Personal"}
              </button>
            ))}
          </div>
          {project && area !== project.area && (
            <p className="mt-1.5 text-xs text-muted">Its tasks move to {area} too.</p>
          )}
        </div>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Customer</span>
          <input
            className="field w-full"
            placeholder="Optional: pick one or type a new name"
            list="customer-names"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
          <datalist id="customer-names">
            {customers.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          {customer.trim() && !customers.some((c) => c.name.toLowerCase() === customer.trim().toLowerCase()) && (
            <p className="mt-1.5 text-xs text-muted">Creates a new customer “{customer.trim()}”.</p>
          )}
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Description</span>
          <textarea
            className="field min-h-[72px] w-full resize-y"
            placeholder="What this covers. Claude reads this when matching tasks to projects."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || pending}>
            {project ? "Save" : "Create project"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
