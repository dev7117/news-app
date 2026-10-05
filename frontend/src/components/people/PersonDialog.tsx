import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Modal from "../Modal";
import { type Area, type Person, useCustomers, usePeopleMutations } from "../../lib/api";
import { useFocus } from "../../lib/focus";
import { useToast } from "../../hooks/useToast";

export default function PersonDialog({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { create, update, remove } = usePeopleMutations();
  const { data: customers = [] } = useCustomers();
  const { area } = useFocus();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: person?.name ?? "",
    email: person?.email ?? "",
    title: person?.title ?? "",
    customer_id: person?.customer_id ?? null,
    area: person?.area ?? area ?? ("work" as Area),
    notes: person?.notes ?? "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal title={person ? `Edit ${person.name}` : "New person"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = { ...form, email: form.email || null };
          const fail = (err: Error) => toast(err.message, "error");
          if (person) update.mutate({ id: person.id, ...body }, { onSuccess: onClose, onError: fail });
          else create.mutate(body, { onSuccess: (p) => { onClose(); navigate(`/people/${p.id}`); }, onError: fail });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="eyebrow mb-1.5 block">Name</span>
            <input className="field w-full" value={form.name} onChange={set("name")} required autoFocus />
          </label>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Role</span>
            <input className="field w-full" placeholder="Head of IT" value={form.title} onChange={set("title")} />
          </label>
        </div>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Email</span>
          <input className="field w-full" type="email" placeholder="Used to spot them in meeting attendees" value={form.email} onChange={set("email")} />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Works at</span>
          <select
            className="field w-full"
            value={form.customer_id ?? ""}
            onChange={(e) => setForm({ ...form, customer_id: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Our side (team, partners)</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">Where they work. Tasks with them can span any customer or project.</span>
        </label>
        {!form.customer_id && (
          <div>
            <span className="eyebrow mb-1.5 block">Area</span>
            <div className="segmented">
              {(["work", "personal"] as Area[]).map((a) => (
                <button key={a} type="button" className="filter-tab" aria-pressed={form.area === a} onClick={() => setForm({ ...form, area: a })}>
                  {a === "work" ? "Work" : "Personal"}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className="eyebrow mb-1.5 block">About</span>
          <textarea className="field min-h-[72px] w-full resize-y" placeholder="Context worth remembering" value={form.notes} onChange={set("notes")} />
        </label>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {person && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  window.setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                remove.mutate(person.id, { onSuccess: () => { onClose(); navigate("/people"); } });
              }}
            >
              <Trash2 size={14} /> {confirmDelete ? "Click again (their tasks come back to you)" : "Delete"}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!form.name.trim()}>
              {person ? "Save" : "Add person"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
