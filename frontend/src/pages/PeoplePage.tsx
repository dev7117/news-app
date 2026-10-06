import { useMemo, useState } from "react";
import { Bot, Search, UserPlus, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "../components/TaskList";
import Avatar from "../components/people/Avatar";
import PersonDialog from "../components/people/PersonDialog";
import { type Person, usePeople } from "../lib/api";

/** Everyone you work with, grouped by where they work. */
export default function PeoplePage() {
  const { data: people } = usePeople();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<Person["kind"] | null>(null);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (people ?? []).filter(
      (p) => !term || [p.name, p.email, p.title, p.customer].some((v) => (v ?? "").toLowerCase().includes(term))
    );
    const map = new Map<string, Person[]>();
    // Agents get their own section, after your side and before customers.
    const AGENTS = "\u0001agents";
    for (const p of list) {
      const key = p.kind === "agent" ? AGENTS : p.customer ?? "";
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    const rank = (k: string) => (k === "" ? 0 : k === AGENTS ? 1 : 2);
    return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [people, q]);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="page-title">People</h1>
          <p className="mt-1 text-muted">Who you assign work to and work with. Open someone before a 1:1.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating("agent")}>
            <Bot size={15} /> New agent
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating("human")}>
            <UserPlus size={15} /> New person
          </button>
        </div>
      </header>
      <div className="relative mb-8 max-w-sm">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="field w-full pl-9" placeholder="Find someone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find someone" />
      </div>

      {people && people.length === 0 ? (
        <EmptyState icon={<UsersRound size={18} />} title="No people yet">
          Add the people you work with, then assign tasks with <span className="font-medium">+name</span> in any add box.
        </EmptyState>
      ) : (
        groups.map(([org, list]) => (
          <section key={org} className="mb-10">
            <h2 className="section-title mb-3">{org === "\u0001agents" ? "Agents" : org || "Our side"}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {list.map((p) => (
                <PersonCard key={p.id} person={p} />
              ))}
            </div>
          </section>
        ))
      )}
      {creating && <PersonDialog kind={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function PersonCard({ person }: { person: Person }) {
  return (
    <Link
      to={`/people/${person.id}`}
      className="well anim-rise flex items-center gap-3 p-4 transition-[border-color,transform] duration-150 ease-out hover:border-[color:var(--line)] active:scale-[0.99]"
    >
      <Avatar name={person.name} size={40} agent={person.kind === "agent"} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{person.name}</div>
        <div className="truncate text-xs text-muted">{person.title || person.email || " "}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className="tag">{person.assigned_open ?? 0} on them</span>
          {!!person.following_open && <span className="tag">{person.following_open} following</span>}
          {!!person.overdue && <span className="tag tag-danger">{person.overdue} overdue</span>}
        </div>
      </div>
    </Link>
  );
}
