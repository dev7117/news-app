import { useRef, useState } from "react";
import { Globe, ImageUp, Trash2 } from "lucide-react";
import Modal from "../Modal";
import CustomerArt from "../CustomerArt";
import { type Customer, useCustomerMutations, useHubMutations } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

export default function CustomerEditDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { updateCustomer, uploadLogo, fetchLogo, clearLogo } = useHubMutations(customer.id);
  const { remove } = useCustomerMutations();
  const { toast } = useToast();
  const [name, setName] = useState(customer.name);
  const [website, setWebsite] = useState(customer.website ?? "");
  const [notes, setNotes] = useState(customer.notes);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fail = { onError: (e: Error) => toast(e.message, "error") };

  return (
    <Modal title="Edit customer" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          updateCustomer.mutate(
            { name, website: website || null, notes },
            { onSuccess: () => { toast("Saved", "success"); onClose(); }, ...fail }
          );
        }}
      >
        <div className="flex items-center gap-4">
          <CustomerArt customer={customer} className="h-16 w-16 shrink-0 rounded-[12px]" textClass="text-lg" />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => file.current?.click()}>
              <ImageUp size={14} /> Upload logo
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!customer.website || fetchLogo.isPending}
              title={customer.website ? `Use the icon from ${customer.website}` : "Save a website first"}
              onClick={() => fetchLogo.mutate(undefined, { onSuccess: () => toast("Logo updated", "success"), ...fail })}
            >
              <Globe size={14} /> {fetchLogo.isPending ? "Fetching…" : "From website"}
            </button>
            {customer.logo && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => clearLogo.mutate(undefined, fail)}>
                Remove
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/x-icon"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo.mutate(f, { onSuccess: () => toast("Logo updated", "success"), ...fail });
                e.target.value = "";
              }}
            />
          </div>
        </div>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Name</span>
          <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Website</span>
          <input className="field w-full" placeholder="acme.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Notes</span>
          <textarea
            className="field min-h-[96px] w-full resize-y"
            placeholder="Contacts, contract, how you work with them. Claude reads this."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                window.setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              remove.mutate(customer.id, { onSuccess: () => { toast(`Deleted ${customer.name}; projects kept`, "success"); onClose(); window.history.back(); } });
            }}
          >
            <Trash2 size={14} /> {confirmDelete ? "Click again to delete" : "Delete"}
          </button>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => updateCustomer.mutate({ archived: !customer.archived }, { onSuccess: onClose, ...fail })}
          >
            {customer.archived ? "Unarchive" : "Archive"}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
