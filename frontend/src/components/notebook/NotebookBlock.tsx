import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, FileText, ListChecks, ImagePlus, Maximize2, Trash2 } from "lucide-react";
import Checkbox from "../Checkbox";
import Markdown from "../Markdown";
import { type Block, type BlockOwner, useBlockMutations } from "../../lib/api";
import { AutoTextarea, SaveHint, useAutosave } from "./autosave";
import { useMentionProvider } from "../autocomplete/providers";
import { useAutocomplete } from "../autocomplete/useAutocomplete";
import { useImagePaste } from "../../lib/useImagePaste";

interface Props {
  owner: BlockOwner;
  /** Tasks: blocks can be subtasks (checkbox). Ideas: notes only. */
  allowSubtasks?: boolean;
  block: Block;
  index: number;
  total: number;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onNext: () => void;
  onOpen: () => void;
  highlight?: boolean;
}

/** One cell of a notebook (idea or task): rendered markdown until clicked, then an editor.
    Esc finishes, Shift+Enter finishes and moves to the next block (like Jupyter). On tasks a
    block can be a subtask, with a checkbox. */
export default function NotebookBlock({ owner, allowSubtasks, block, index, total, editing, onEdit, onNext, onOpen, highlight }: Props) {
  const { update, remove, reorder } = useBlockMutations(owner);
  const subtask = block.kind === "subtask";
  const container = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const title = useAutosave(block.title, (value) => update.mutate({ id: block.id, title: value }));
  const body = useAutosave(block.body, (value) => update.mutate({ id: block.id, body: value }));
  const mention = useAutocomplete({ value: body.value, onChange: body.change, provider: useMentionProvider(), ref: bodyRef });
  // Paste or drop screenshots while editing; dropped on the block when it isn't open, they go at the end.
  const images = useImagePaste({ ref: bodyRef, value: body.value, onChange: body.change });
  const filePicker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) bodyRef.current?.focus();
  }, [editing]);

  const finish = () => {
    title.flush();
    body.flush();
    onEdit(false);
  };

  const move = (delta: -1 | 1) => {
    const ids = (container.current?.closest("[data-notebook]")?.querySelectorAll("[data-block-id]") ?? []) as NodeListOf<HTMLElement>;
    const order = Array.from(ids).map((el) => Number(el.dataset.blockId));
    const at = order.indexOf(block.id);
    const target = at + delta;
    if (target < 0 || target >= order.length) return;
    [order[at], order[target]] = [order[target], order[at]];
    reorder.mutate(order);
  };

  const heading = block.title.trim();
  const firstLine = block.body.trim().split("\n")[0]?.replace(/^#+\s*/, "") ?? "";

  return (
    <div
      ref={container}
      id={`block-${block.id}`}
      data-block-id={block.id}
      className={`group relative scroll-mt-24 rounded-[12px] border transition-[border-color,box-shadow,background-color] duration-150 ${
        editing
          ? "border-[color:rgb(var(--c-accent)/0.5)] bg-tile shadow-[0_0_0_3px_rgb(var(--c-accent)/0.12)]"
          : highlight
            ? "border-[color:rgb(var(--c-accent)/0.4)] bg-tile"
            : "border-edge bg-tile shadow-card hover:border-[color:var(--line)]"
      }`}
      onBlur={(e) => {
        if (editing && !e.currentTarget.contains(e.relatedTarget as Node)) finish();
      }}
      onDragOver={images.handlers.onDragOver}
      onDrop={images.handlers.onDrop}
    >
      <input
        ref={filePicker}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          images.insert([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {/* Toolbar: on hover / focus for pointers, always on touch. */}
      <div className="absolute right-2 top-2 z-10 flex gap-0.5 rounded-[8px] bg-tile/90 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        {allowSubtasks && (
          <ToolButton
            label={subtask ? "Make it a note (no checkbox)" : "Make it a subtask"}
            onClick={() => update.mutate({ id: block.id, kind: subtask ? "note" : "subtask" })}
          >
            {subtask ? <FileText size={13} /> : <ListChecks size={13} />}
          </ToolButton>
        )}
        <ToolButton label="Add an image (or paste / drop one)" onClick={() => filePicker.current?.click()}>
          <ImagePlus size={13} />
        </ToolButton>
        <ToolButton label="Open as a document" onClick={() => { finish(); onOpen(); }}>
          <Maximize2 size={13} />
        </ToolButton>
        <ToolButton label="Move up" disabled={index === 0} onClick={() => move(-1)}>
          <ArrowUp size={13} />
        </ToolButton>
        <ToolButton label="Move down" disabled={index === total - 1} onClick={() => move(1)}>
          <ArrowDown size={13} />
        </ToolButton>
        <ToolButton
          label={confirmDelete ? "Click again to delete" : "Delete block"}
          danger={confirmDelete}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3000);
              return;
            }
            remove.mutate(block.id);
          }}
        >
          <Trash2 size={13} />
        </ToolButton>
      </div>

      <div className="flex items-start gap-1 px-2 pt-2">
        <button
          type="button"
          className="btn btn-quiet btn-xs btn-icon mt-[3px] w-[26px] shrink-0"
          aria-expanded={!block.collapsed}
          aria-label={block.collapsed ? "Expand block" : "Collapse block"}
          title={block.collapsed ? "Expand" : "Collapse"}
          onClick={() => update.mutate({ id: block.id, collapsed: !block.collapsed })}
        >
          <ChevronRight size={14} className={`transition-transform duration-200 ease-out ${block.collapsed ? "" : "rotate-90"}`} />
        </button>
        {subtask && (
          <span className="mt-[7px] shrink-0">
            <Checkbox
              checked={block.done}
              label={block.done ? "Reopen subtask" : "Complete subtask"}
              onChange={() => update.mutate({ id: block.id, done: !block.done })}
            />
          </span>
        )}
        {editing ? (
          <input
            className="min-w-0 flex-1 bg-transparent py-1.5 pr-36 text-[0.9375rem] font-semibold tracking-[-0.011em] outline-none placeholder:font-normal placeholder:text-faint focus-visible:outline-none"
            placeholder={subtask ? "Subtask" : "Block title (optional)"}
            value={title.value}
            onChange={(e) => title.change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") finish();
              if (e.key === "Enter") {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={`min-w-0 flex-1 truncate py-1.5 pr-36 text-left text-[0.9375rem] font-semibold tracking-[-0.011em] ${
              subtask && block.done ? "text-faint line-through decoration-faint/60" : ""
            }`}
            onClick={() => (block.collapsed ? update.mutate({ id: block.id, collapsed: false }) : onEdit(true))}
          >
            {heading || (block.collapsed ? <span className="font-normal text-muted">{firstLine || "Empty block"}</span> : <span className="font-normal text-faint">Untitled</span>)}
          </button>
        )}
      </div>

      {!block.collapsed && (
        <div className="px-4 pb-4 pl-[42px]">
          {editing ? (
            <>
              <AutoTextarea
                {...mention.bind}
                onPaste={images.handlers.onPaste}
                ref={bodyRef}
                className="w-full bg-transparent font-mono text-[0.8125rem] leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none"
                placeholder="Markdown…  @ to mention · paste a screenshot · Shift+Enter: next block · Esc: done"
                value={body.value}
                onChange={(e) => body.change(e.target.value)}
                onKeyDown={(e) => {
                  mention.onKeyDown(e);
                  if (e.defaultPrevented) return;
                  if (e.key === "Escape") {
                    e.preventDefault();
                    finish();
                  } else if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    title.flush();
                    body.flush();
                    // Let go of this block right away, so nothing typed while the next one
                    // is being created lands here.
                    (e.target as HTMLTextAreaElement).blur();
                    onNext();
                  }
                }}
              />
              {mention.popup}
              <div className="mt-1 flex items-center gap-3 text-xs text-faint">
                {images.uploading ? <span>Uploading image…</span> : <SaveHint status={body.status === "idle" ? title.status : body.status} />}
                <span className="ml-auto hidden sm:inline">Shift+Enter next · Esc done</span>
              </div>
            </>
          ) : (
            <button type="button" className="block w-full text-left" onClick={() => onEdit(true)} aria-label="Edit block">
              {block.body.trim() ? (
                <div className={subtask && block.done ? "opacity-60" : ""}>
                  <Markdown>{block.body}</Markdown>
                </div>
              ) : (
                <p className="text-sm text-faint">{subtask ? "Details, steps, links…" : "Click to write…"}</p>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn btn-xs btn-icon w-[26px] ${danger ? "btn-danger" : "btn-quiet"}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep focus (and the editor) where it is
      onClick={onClick}
    >
      {children}
    </button>
  );
}
