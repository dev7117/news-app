import { useMemo, useState } from "react";
import { Lightbulb, Search } from "lucide-react";
import QuickAdd from "../components/QuickAdd";
import { EmptyState } from "../components/TaskList";
import IdeaGrid from "../components/ideas/IdeaGrid";
import { type Idea, useIdeas } from "../lib/api";
import { useFocus } from "../lib/focus";

const STATUSES: { id: Idea["status"]; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "promoted", label: "Promoted" },
  { id: "dropped", label: "Dropped" },
];

/** The backlog of not-yet-tasks, grouped by customer, then project, then loose ones. */
export default function IdeasPage() {
  const [status, setStatus] = useState<Idea["status"]>("open");
  const [q, setQ] = useState("");
  const { focus } = useFocus();
  const { data: ideas } = useIdeas({ status, q: q.trim() || undefined });

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; sub?: string; rank: number; ideas: Idea[] }>();
    for (const idea of ideas ?? []) {
      const key = idea.customer_id ? `c${idea.customer_id}` : idea.project_id ? `p${idea.project_id}` : `loose-${idea.area}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          title: idea.customer ?? idea.project ?? (idea.area === "work" ? "Work, loose" : "Personal, loose"),
          rank: idea.customer_id ? 0 : idea.project_id ? 1 : idea.area === "work" ? 2 : 3,
          ideas: [],
        });
      }
      map.get(key)!.ideas.push(idea);
    }
    return [...map.values()].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  }, [ideas]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="page-title">Ideas</h1>
        <p className="mt-1 max-w-2xl text-muted">
          Things worth keeping that aren't ready to be tasks. They stay off your boards and Today until you promote them.
        </p>
      </header>
      <div className="mb-6 max-w-3xl">
        <QuickAdd
          implied="!idea"
          placeholder={`Jot ${focus === "personal" ? "a personal" : focus === "work" ? "a work" : "an"} idea…  #project @work`}
        />
      </div>
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input className="field field-sm w-full pl-8" placeholder="Search ideas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ideas" />
        </div>
        <div className="segmented">
          {STATUSES.map((s) => (
            <button key={s.id} type="button" className="filter-tab" aria-pressed={status === s.id} onClick={() => setStatus(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {ideas && ideas.length === 0 ? (
        <EmptyState icon={<Lightbulb size={18} />} title={q ? "No matching ideas" : status === "open" ? "No ideas yet" : `Nothing ${status}`}>
          {status === "open" && !q && (
            <>
              Add one above, or type <span className="font-medium">!idea</span> in any add box, including the bar.
            </>
          )}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mb-10">
            <h2 className="section-title mb-3">
              {g.title} <span className="tabular text-sm font-normal text-faint">{g.ideas.length}</span>
            </h2>
            <IdeaGrid ideas={g.ideas} />
          </section>
        ))
      )}
    </div>
  );
}
