import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import FileRow from "../FileRow";
import { type Task, useTaskFiles } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

/** Files on the task: what its agent produced, and anything you drop here. */
export default function TaskFiles({ task }: { task: Task }) {
  const files = task.files ?? [];
  const { upload, remove } = useTaskFiles(task.id);
  const { toast } = useToast();
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const send = (list: File[]) =>
    list.forEach((file) =>
      upload.mutate(file, { onSuccess: (f) => toast(`Attached ${f.name}`, "success"), onError: (e) => toast(e.message, "error") })
    );

  return (
    <section className="mt-8" aria-label="Files">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="section-title">Files</h2>
        {files.length > 0 && <span className="tabular text-sm text-faint">{files.length}</span>}
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
        {files.length ? (
          <ul className="space-y-1">
            {files.map((f) => (
              <FileRow key={f.id} file={f} onRemove={() => remove.mutate(f.id)} />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-5 text-center text-sm text-faint">Drop files here. An agent working this task attaches what it makes here too.</p>
        )}
        {upload.isPending && <p className="px-2 py-1 text-xs text-faint">Uploading…</p>}
      </div>
    </section>
  );
}
