import { useMemo, useState } from "react";
import { Archive, Building2, FolderPlus, Plus, Search } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import CustomerArt from "../components/CustomerArt";
import Modal from "../components/Modal";
import ProjectDialog from "../components/ProjectDialog";
import { EmptyState } from "../components/TaskList";
import { type Customer, type Meeting, type Project, useCreateCustomer, useCustomers, useProjects, useUpcoming } from "../lib/api";
import { ago, meetingWhen } from "../lib/format";
import { usePersisted } from "../lib/usePersisted";
import { useToast } from "../hooks/useToast";

export default function CustomersPage() {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = usePersisted<"activity" | "name">("todo-customers-sort", "activity");
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const { data: customers } = useCustomers(showArchived);
  const { data: upcoming = [] } = useUpcoming(7);
  const { data: projects = [] } = useProjects();

  const nextMeeting = useMemo(() => {
    const map = new Map<number, Meeting>();
    for (const m of upcoming) if (!map.has(m.customer_id)) map.set(m.customer_id, m);
    return map;
  }, [upcoming]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (customers ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
    const activity = (c: Customer) =>
      [c.last_meeting_on, c.last_task_activity?.slice(0, 10)].filter(Boolean).sort().pop() ?? "";
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : activity(b).localeCompare(activity(a)) || a.name.localeCompare(b.name)
    );
  }, [customers, query, sort]);

  const meetingSoon = filtered.filter((c) => nextMeeting.has(c.id));
  const other = projects.filter((p) => p.customer_id === null);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end gap-3">
        <h1 className="page-title">Customers</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-pressed={showArchived}
            onClick={() => setShowArchived(!showArchived)}
          >
            <Archive size={14} /> {showArchived ? "Hide archived" : "Archived"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>
            <Plus size={15} /> New customer
          </button>
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="field w-full pl-9"
            placeholder="Find a customer"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a customer"
            autoFocus
          />
        </div>
        <div className="segmented">
          <button type="button" className="filter-tab" aria-pressed={sort === "activity"} onClick={() => setSort("activity")}>
            Recent
          </button>
          <button type="button" className="filter-tab" aria-pressed={sort === "name"} onClick={() => setSort("name")}>
            A–Z
          </button>
        </div>
      </div>

      {customers && customers.length === 0 && (
        <EmptyState icon={<Building2 size={18} />} title="No customers yet">
          Add one, or let Claude create them as it logs meetings.
        </EmptyState>
      )}

      {meetingSoon.length > 0 && !query && (
        <section className="mb-10">
          <h2 className="section-title mb-3">Meeting this week</h2>
          <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
            {meetingSoon.map((c) => (
              <CustomerCard key={c.id} customer={c} meeting={nextMeeting.get(c.id)} className="w-[220px] shrink-0 snap-start" />
            ))}
          </div>
        </section>
      )}

      {filtered.length > 0 && (
        <section className="mb-12">
          {meetingSoon.length > 0 && !query && <h2 className="section-title mb-3">All customers</h2>}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-4 gap-y-6">
            {filtered.map((c) => (
              <CustomerCard key={c.id} customer={c} meeting={nextMeeting.get(c.id)} />
            ))}
          </div>
        </section>
      )}
      {customers && customers.length > 0 && filtered.length === 0 && (
        <p className="py-8 text-center text-muted">No customer matches “{query}”.</p>
      )}

      {!query && (
        <section className="mb-10">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="section-title">Internal & personal projects</h2>
            <button type="button" className="btn btn-quiet btn-xs ml-auto" onClick={() => setNewProject(true)}>
              <FolderPlus size={13} /> Project
            </button>
          </div>
          {other.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {other.map((p) => (
                <ProjectTile key={p.id} project={p} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-faint">Projects without a customer show up here.</p>
          )}
        </section>
      )}

      {creating && <NewCustomerDialog onClose={() => setCreating(false)} />}
      {newProject && <ProjectDialog defaultArea="personal" onClose={() => setNewProject(false)} />}
    </div>
  );
}

function CustomerCard({ customer, meeting, className = "" }: { customer: Customer; meeting?: Meeting; className?: string }) {
  const meta = [
    customer.open_count ? `${customer.open_count} open` : "Nothing open",
    customer.last_meeting_on ? `met ${ago(customer.last_meeting_on + "T12:00:00")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={`/customers/${customer.id}`}
      className={`group anim-rise flex min-w-0 flex-col gap-2 ${customer.archived ? "opacity-60" : ""} ${className}`}
    >
      <div className="relative transition-transform duration-150 ease-out group-active:scale-[0.97] [@media(hover:hover)]:group-hover:-translate-y-0.5">
        <CustomerArt customer={customer} className="aspect-[4/3] w-full rounded-[12px]" textClass="text-3xl" />
        {meeting && (
          <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded-md bg-accent px-2 py-0.5 text-[0.6875rem] font-medium text-accent-ink">
            {meetingWhen(meeting)}
          </span>
        )}
        {customer.overdue_count > 0 && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[0.6875rem] font-medium text-white backdrop-blur">
            {customer.overdue_count} overdue
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <div className="truncate font-medium">{customer.name}</div>
        <div className="truncate text-xs text-muted">{meta}</div>
      </div>
    </Link>
  );
}

function ProjectTile({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="well flex flex-col gap-1 p-3 transition-[border-color,transform] duration-150 ease-out hover:border-[color:var(--line)] active:scale-[0.99]"
    >
      <span className="truncate font-medium">{project.name}</span>
      <span className="text-xs text-muted">
        {project.area === "work" ? "Work" : "Personal"} · {project.open_count} open
      </span>
    </Link>
  );
}

function NewCustomerDialog({ onClose }: { onClose: () => void }) {
  const create = useCreateCustomer();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  return (
    <Modal title="New customer" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name, website: website || undefined },
            {
              onSuccess: (c) => {
                onClose();
                navigate(`/customers/${c.id}`);
              },
              onError: (error) => toast(error.message, "error"),
            }
          );
        }}
      >
        <label className="block">
          <span className="eyebrow mb-1.5 block">Name</span>
          <input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Website</span>
          <input className="field w-full" placeholder="acme.com (used for the logo)" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
