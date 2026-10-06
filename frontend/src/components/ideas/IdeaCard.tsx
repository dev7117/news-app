import { ArrowUpRight, Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Idea } from "../../lib/api";
import { ago } from "../../lib/format";

export function useOpenIdea() {
  const navigate = useNavigate();
  return (id: number) => navigate(`/ideas/${id}`);
}

/** Plain-text preview of markdown notes. */
export const notesPreview = (notes: string) =>
  notes.replace(/[#*_`>[\]]/g, "").replace(/\(https?:[^)]+\)/g, "").replace(/\s+/g, " ").trim();

export default function IdeaCard({ idea, showPlace = true }: { idea: Idea; showPlace?: boolean }) {
  const open = useOpenIdea();
  const place = [idea.customer, idea.project].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => open(idea.id)}
      className={`well anim-rise flex min-h-[96px] w-full flex-col gap-1.5 p-4 text-left transition-[border-color,transform] duration-150 ease-out hover:border-[color:var(--line)] active:scale-[0.99] ${
        idea.status === "dropped" ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <Lightbulb size={14} className="mt-[3px] shrink-0 text-faint" aria-hidden="true" />
        <span className={`min-w-0 flex-1 break-words font-medium leading-snug ${idea.status === "dropped" ? "line-through decoration-faint/60" : ""}`}>
          {idea.title}
        </span>
      </div>
      {idea.summary && <p className="line-clamp-3 pl-[22px] text-sm text-muted">{notesPreview(idea.summary)}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pl-[22px] pt-1 text-xs text-faint">
        {showPlace && place && <span className="tag">{place}</span>}
        {idea.status === "promoted" && (
          <span className="tag tag-success">
            <ArrowUpRight size={11} /> Task
          </span>
        )}
        {idea.status === "dropped" && <span className="tag">Dropped</span>}
        {!!idea.block_count && (
          <span className="tabular">
            {idea.block_count} block{idea.block_count === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto tabular">{ago(idea.updated_at)}</span>
      </div>
    </button>
  );
}
