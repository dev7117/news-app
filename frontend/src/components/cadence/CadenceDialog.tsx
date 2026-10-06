import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../Modal";
import SchedulePicker from "./SchedulePicker";
import { type Cadence, type CadenceSchedule, useCadenceMutations, useProjects } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

/** New cadence (for a customer), or its settings: name, schedule, prep window, project. */
export default function CadenceDialog({
  customerId,
  cadence,
  onClose,
}: {
  customerId: number;
  cadence?: Cadence;
  onClose: () => void;
}) {
  const { create, update, remove } = useCadenceMutations();
  const { data: projects = [] } = useProjects();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(cadence?.name ?? "");
  const [schedule, setSchedule] = useState<CadenceSchedule>(cadence?.schedule ?? { cron: "0 9 * * 4" });
  const [prepDays, setPrepDays] = useState(cadence?.prep_days ?? 3);
  const [duration, setDuration] = useState(cadence?.duration_min ?? 60);
  const [projectId, setProjectId] = useState<number | null>(cadence?.project_id ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const own = projects.filter((p) => p.customer_id === customerId && !p.archived);
  const fail = (e: Error) => toast(e.message, "error");

  const save = () => {
    const body = { name, schedule, prep_days: prepDays, duration_min: duration, project_id: projectId };
    if (cadence)
      update.mutate({ id: cadence.id, ...body }, { onSuccess: () => onClose(), onError: fail });
    else
      create.mutate(
        { customer_id: customerId, ...body },
        {
          onSuccess: (c) => {
            onClose();
            navigate(`/cadences/${c.id}`);
          },
          onError: fail,
        }
      );
  };

  return (
    <Modal title={cadence ? "Cadence settings" : "New cadence"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="block">
          <span className="eyebrow mb-1.5 block">Name</span>
          <input className="field w-full" placeholder="Weekly Ops" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <div>
          <span className="eyebrow mb-1.5 block">When it meets</span>
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="eyebrow mb-1.5 block">Prep starts</span>
            <div className="flex items-center gap-2">
              <input type="number" min={0} max={30} className="field w-[80px]" value={prepDays} onChange={(e) => setPrepDays(Number(e.target.value))} />
              <span className="text-sm text-muted">days before</span>
            </div>
          </label>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Length</span>
            <div className="flex items-center gap-2">
              <input type="number" min={5} max={600} step={5} className="field w-[80px]" value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
              <span className="text-sm text-muted">minutes</span>
            </div>
          </label>
        </div>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Prep tasks go in</span>
          <select className="field w-full" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No project (work)</option>
            {own.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 pt-2">
          {cadence && (
            <button
              type="button"
              className={`btn btn-sm ${confirmDelete ? "btn-danger" : "btn-quiet"}`}
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                remove.mutate(cadence.id, {
                  onSuccess: () => {
                    onClose();
                    navigate(`/customers/${customerId}?tab=cadences`);
                  },
                  onError: fail,
                });
              }}
            >
              {confirmDelete ? "Delete it and its meeting history" : "Delete cadence"}
            </button>
          )}
          <button type="button" className="btn btn-ghost ml-auto" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending || update.isPending}>
            {cadence ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
