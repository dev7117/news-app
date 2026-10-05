import { useRef, useState } from "react";
import { useMentionProvider } from "../autocomplete/providers";
import { useImagePaste } from "../../lib/useImagePaste";
import { useAutocomplete } from "../autocomplete/useAutocomplete";
import Modal from "../Modal";
import Markdown from "../Markdown";
import { type Block, type BlockOwner, useBlockMutations } from "../../lib/api";
import { SaveHint, useAutosave } from "./autosave";

/** One block as its own document: a big editor with live preview, side by side on wide screens. */
export default function BlockFocus({
  owner,
  block,
  ideaTitle,
  onClose,
}: {
  owner: BlockOwner;
  block: Block;
  ideaTitle: string;
  onClose: () => void;
}) {
  const { update } = useBlockMutations(owner);
  const title = useAutosave(block.title, (value) => update.mutate({ id: block.id, title: value }));
  const body = useAutosave(block.body, (value) => update.mutate({ id: block.id, body: value }));
  const [tab, setTab] = useState<"write" | "preview">("write");
  const editor = useRef<HTMLTextAreaElement>(null);
  const mention = useAutocomplete({ value: body.value, onChange: body.change, provider: useMentionProvider(), ref: editor });
  const images = useImagePaste({ ref: editor, value: body.value, onChange: body.change });
  const close = () => {
    title.flush();
    body.flush();
    onClose();
  };

  return (
    <Modal title={`${ideaTitle} · ${block.title || "Untitled block"}`} onClose={close} viewportWide>
      <div className="flex min-h-[70vh] flex-col">
        <div className="mb-3 flex items-center gap-3">
          <input
            className="min-w-0 flex-1 bg-transparent text-[1.25rem] font-semibold tracking-[-0.015em] outline-none placeholder:text-faint"
            placeholder="Block title"
            value={title.value}
            onChange={(e) => title.change(e.target.value)}
            onBlur={title.flush}
          />
          {images.uploading ? <span className="text-xs text-faint">Uploading image…</span> : <SaveHint status={body.status === "idle" ? title.status : body.status} />}
          <div className="segmented lg:hidden">
            {(["write", "preview"] as const).map((t) => (
              <button key={t} type="button" className="filter-tab capitalize" aria-pressed={tab === t} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="grid flex-1 gap-4 lg:grid-cols-2">
          <textarea
            className={`field min-h-[60vh] w-full resize-none font-mono text-[0.8125rem] leading-relaxed ${tab === "preview" ? "hidden lg:block" : ""}`}
            placeholder="Markdown…  (paste or drop screenshots)"
            value={body.value}
            autoFocus
            {...mention.bind}
            {...images.handlers}
            ref={editor}
            onChange={(e) => body.change(e.target.value)}
            onKeyDown={mention.onKeyDown}
            onBlur={() => {
              mention.bind.onBlur();
              body.flush();
            }}
          />
          {mention.popup}
          <div className={`min-h-[60vh] overflow-y-auto rounded-[8px] border border-edge p-4 ${tab === "write" ? "hidden lg:block" : ""}`}>
            {body.value.trim() ? <Markdown>{body.value}</Markdown> : <p className="text-sm text-faint">Preview</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
