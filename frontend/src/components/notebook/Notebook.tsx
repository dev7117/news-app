import { useState } from "react";
import { ListChecks, Plus } from "lucide-react";
import { type Block, type BlockOwner, useBlockMutations } from "../../lib/api";
import BlockFocus from "./BlockFocus";
import NotebookBlock from "./NotebookBlock";

export interface Starter {
  title: string;
  kind?: Block["kind"];
}

export const blockLabel = (b: Block, i: number) =>
  b.title || b.body.trim().split("\n")[0]?.replace(/^#+\s*/, "") || `Block ${i + 1}`;

/** Ordered markdown blocks for an idea or a task (where blocks can be subtasks). */
export default function Notebook({
  owner,
  blocks,
  documentTitle,
  allowSubtasks = false,
  starters,
  emptyTitle,
  emptyHint,
  highlight,
}: {
  owner: BlockOwner;
  blocks: Block[];
  documentTitle: string;
  allowSubtasks?: boolean;
  starters: Starter[];
  emptyTitle: string;
  emptyHint: string;
  highlight?: number | null;
}) {
  const api = useBlockMutations(owner);
  const [editing, setEditing] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const focusBlock = blocks.find((b) => b.id === focused);

  const addAfter = (afterId?: number, starter?: Starter) =>
    api.add.mutate(
      { after_id: afterId, title: starter?.title ?? "", kind: starter?.kind ?? "note" },
      { onSuccess: (block: Block) => setEditing(block.id) }
    );

  const next = (index: number) => {
    const following = blocks[index + 1];
    if (following) {
      setEditing(following.id);
    } else {
      setEditing(null);
      // A new block after a subtask is another subtask: Shift+Enter builds a checklist.
      addAfter(blocks[index].id, { title: "", kind: blocks[index].kind });
    }
  };

  const last = blocks[blocks.length - 1];

  return (
    <>
      <div className="space-y-1" data-notebook>
        {blocks.map((block, index) => (
          <div key={block.id}>
            <NotebookBlock
              owner={owner}
              allowSubtasks={allowSubtasks}
              block={block}
              index={index}
              total={blocks.length}
              editing={editing === block.id}
              onEdit={(on) => setEditing(on ? block.id : null)}
              onNext={() => next(index)}
              onOpen={() => setFocused(block.id)}
              highlight={highlight === block.id}
            />
            {index < blocks.length - 1 && <InsertLine onAdd={() => addAfter(block.id)} />}
          </div>
        ))}
      </div>

      {blocks.length === 0 ? (
        <div className="mt-2 rounded-[12px] border border-dashed border-[color:var(--line)] p-6 text-center">
          <p className="font-medium">{emptyTitle}</p>
          <p className="mt-1 text-sm text-muted">{emptyHint}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {starters.map((s) => (
              <button key={s.title} type="button" className="btn btn-ghost btn-xs" onClick={() => addAfter(undefined, s)}>
                {s.kind === "subtask" ? <ListChecks size={12} /> : <Plus size={12} />} {s.title}
              </button>
            ))}
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => addAfter()}>
              <Plus size={12} /> Blank block
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allowSubtasks && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addAfter(last.id, { title: "", kind: "subtask" })}>
              <ListChecks size={14} /> Add subtask
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addAfter(last.id)}>
            <Plus size={14} /> Add {allowSubtasks ? "note" : "block"}
          </button>
        </div>
      )}

      {focusBlock && <BlockFocus owner={owner} block={focusBlock} ideaTitle={documentTitle} onClose={() => setFocused(null)} />}
    </>
  );
}

/** Jump list of a notebook's blocks (sticky, wide screens). */
export function NotebookOutline({ blocks, onJump }: { blocks: Block[]; onJump: (id: number) => void }) {
  return (
    <nav className="hidden xl:block" aria-label="Blocks">
      <div className="sticky top-24">
        <div className="eyebrow mb-2">Outline</div>
        <ol className="space-y-0.5 text-sm">
          {blocks.map((b, i) => (
            <li key={b.id}>
              <button
                type="button"
                className={`flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-left hover:bg-fg/[0.05] hover:text-fg ${
                  b.kind === "subtask" && b.done ? "text-faint line-through" : "text-muted"
                }`}
                onClick={() => onJump(b.id)}
              >
                {b.kind === "subtask" && <span aria-hidden="true">{b.done ? "☑" : "☐"}</span>}
                <span className="truncate">{blockLabel(b, i)}</span>
              </button>
            </li>
          ))}
          {!blocks.length && <li className="px-2 text-faint">No blocks yet</li>}
        </ol>
      </div>
    </nav>
  );
}

/** Scroll a block into view and flash it. */
export function useJump() {
  const [highlight, setHighlight] = useState<number | null>(null);
  const jump = (blockId: number) => {
    document.getElementById(`block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(blockId);
    window.setTimeout(() => setHighlight(null), 1200);
  };
  return { highlight, jump };
}

/** A thin gap between blocks that reveals "+ Insert block" on hover (always tappable on touch). */
function InsertLine({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="group/insert relative flex h-3 items-center justify-center">
      <button
        type="button"
        className="btn btn-ghost btn-xs relative z-10 h-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/insert:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={onAdd}
      >
        <Plus size={12} /> Insert block
      </button>
      <span className="absolute inset-x-6 top-1/2 h-px bg-[color:var(--line)] opacity-0 transition-opacity group-hover/insert:opacity-100" />
    </div>
  );
}
