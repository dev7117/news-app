import { useRef, useState } from "react";
import { api } from "./api";
import { useToast } from "../hooks/useToast";

let seq = 0;

/** Paste or drop images (screenshots) into a markdown field: each uploads to /api/uploads
    and lands at the caret as `![alt](url)`, behind a placeholder while it uploads. Spread
    `handlers` onto the textarea. */
export function useImagePaste<T extends HTMLTextAreaElement | HTMLInputElement>({
  ref,
  value,
  onChange,
}: {
  ref: React.RefObject<T>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { toast } = useToast();
  // Uploads finish after more typing, so they edit the latest text, not the text at paste time.
  const latest = useRef(value);
  latest.current = value;
  const [uploading, setUploading] = useState(0);

  const set = (next: string) => {
    latest.current = next;
    onChange(next);
  };

  const insert = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    const el = ref.current;
    const text = latest.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const items = images.map((file) => {
      const pasted = !file.name || /^image\.\w+$/.test(file.name);
      const alt = pasted ? "screenshot" : file.name.replace(/\.\w+$/, "").replace(/[[\]]/g, "");
      return { file, alt, placeholder: `![Uploading ${alt}…](uploading-${++seq})` };
    });
    const before = text.slice(0, start);
    const block = items.map((i) => i.placeholder).join("\n\n");
    // On its own line, so it renders as a picture rather than inline in a sentence.
    const lead = before && !before.endsWith("\n") ? "\n\n" : "";
    const after = text.slice(end).replace(/^\n+/, "");
    // In a field being typed in, leave a fresh line to keep writing on.
    set(before + lead + block + (after ? "\n\n" + after : el ? "\n" : ""));

    setUploading((n) => n + items.length);
    for (const item of items) {
      api<{ url: string }>("/api/uploads", { method: "POST", body: item.file, headers: { "Content-Type": item.file.type } })
        .then(({ url }) => set(latest.current.replace(item.placeholder, `![${item.alt}](${url})`)))
        .catch((e: Error) => {
          set(latest.current.replace(item.placeholder, "").replace(/\n{3,}/g, "\n\n"));
          toast(`Couldn't add the image: ${e.message}`, "error");
        })
        .finally(() => setUploading((n) => n - 1));
    }
    return true;
  };

  const handlers = {
    onPaste: (e: React.ClipboardEvent) => {
      if (insert([...e.clipboardData.files])) e.preventDefault();
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      if (insert([...e.dataTransfer.files])) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };

  return { handlers, uploading: uploading > 0, insert };
}
