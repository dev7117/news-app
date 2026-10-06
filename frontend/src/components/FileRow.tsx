import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import type { Attachment } from "../lib/api";
import { ago } from "../lib/format";

/** An attached file (a meeting's or a task's): open it, see who added it, delete it. */
export default function FileRow({ file, step, onRemove }: { file: Attachment; step?: string; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="group flex items-center gap-2 rounded-[8px] px-2 py-1.5 hover:bg-fg/[0.04]">
      <FileText size={15} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <a href={file.url} target="_blank" rel="noreferrer" className="block truncate text-sm hover:underline" title={file.name}>
          {file.name}
        </a>
        <span className="block truncate text-xs text-faint">
          {size(file.bytes)} · {file.source === "agent" ? "from a tool" : file.source === "mcp" ? "by Claude" : file.source.startsWith("agent: ") ? `by ${file.source.slice(7)}` : "you"} · {ago(file.created_at)}
          {step && ` · ${step}`}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-xs btn-icon w-[26px] ${confirm ? "btn-danger" : "btn-quiet [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"}`}
        title={confirm ? "Click again to delete" : "Delete"}
        aria-label={`Delete ${file.name}`}
        onClick={() => {
          if (!confirm) {
            setConfirm(true);
            window.setTimeout(() => setConfirm(false), 3000);
            return;
          }
          onRemove();
        }}
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
