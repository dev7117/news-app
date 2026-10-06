import TopicsSection from "../components/hub/TopicsSection";
import CadencesPanel from "../components/cadence/CadencesPanel";
import SyncTab from "../components/hub/SyncTab";
import { useState } from "react";
import { CalendarClock, ChevronLeft, FileText, FolderPlus, Globe, Pencil, Plus, Sparkles } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Board from "../components/Board";
import CustomerArt from "../components/CustomerArt";
import Markdown from "../components/Markdown";
import { MeetingForm, useOpenMeeting } from "../components/MeetingDialog";
import Modal from "../components/Modal";
import ProjectDialog from "../components/ProjectDialog";
import QuickAdd from "../components/QuickAdd";
import { EmptyState } from "../components/TaskList";
import TaskRow from "../components/TaskRow";
import CustomerEditDialog from "../components/hub/CustomerEditDialog";
import LinksPanel, { LinksList } from "../components/hub/LinksPanel";
import IdeaCapture from "../components/ideas/IdeaCapture";
import IdeaGrid from "../components/ideas/IdeaGrid";
import { type CustomerHub, type Meeting, useHub, useIdeas, useMeetings } from "../lib/api";
import { ago, meetingWhen } from "../lib/format";

type Tab = "overview" | "work" | "ideas" | "meetings" | "cadences" | "links" | "sync";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "work", label: "Work" },
  { id: "ideas", label: "Ideas" },
  { id: "meetings", label: "Meetings" },
  { id: "cadences", label: "Cadences" },
  { id: "links", label: "Links & tools" },
  { id: "sync", label: "Sync" },
];

export default function CustomerHubPage() {
  const id = Number(useParams().customerId);
  const { data: hub, error } = useHub(id);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "overview";
  const { data: ideas = [] } = useIdeas({ customer_id: id });
  const [editing, setEditing] = useState(false);
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    if (next === "overview") p.delete("tab");
    else p.set("tab", next);
    setParams(p, { replace: true });
  };

  if (error) return <EmptyState icon={<ChevronLeft size={18} />} title="Customer not found" />;
  if (!hub) return null;
  const c = hub.customer;

  return (
    <div>
      <Link to="/customers" className="btn btn-quiet btn-xs -ml-2 mb-4">
        <ChevronLeft size={13} /> Customers
      </Link>

      <header className="mb-8 flex flex-wrap items-center gap-5">
        <CustomerArt customer={c} className="h-20 w-20 shrink-0 rounded-[16px] sm:h-24 sm:w-24" textClass="text-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title break-words">{c.name}</h1>
            {c.archived && <span className="tag tag-warning">Archived</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {c.website && (
              <a
                href={c.website.includes("://") ? c.website : `https://${c.website}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-fg"
              >
                <Globe size={14} /> {c.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <Stat value={c.open_count} label="open" />
            <Stat value={c.in_progress_count} label="in progress" />
            <Stat value={c.waiting_count} label="waiting" />
            {c.overdue_count > 0 && <span className="tag tag-danger">{c.overdue_count} overdue</span>}
            {c.last_meeting_on && <span>Last met {ago(c.last_meeting_on + "T12:00:00")}</span>}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Edit
        </button>
      </header>

      <div className="mb-8 overflow-x-auto [scrollbar-width:none]">
        <div className="segmented">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="filter-tab" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === "meetings" && hub.upcoming.length > 0 && <span className="tabular text-xs text-accent">{hub.upcoming.length}</span>}
              {t.id === "ideas" && ideas.length > 0 && <span className="tabular text-xs text-faint">{ideas.length}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <Overview hub={hub} onTab={setTab} />}
      {tab === "work" && <Work hub={hub} />}
      {tab === "ideas" && (
        <div className="space-y-6">
          <div className="max-w-3xl">
            <IdeaCapture customerId={c.id} placeholder={`Jot an idea for ${c.name}…`} />
          </div>
          {ideas.length ? (
            <IdeaGrid ideas={ideas} showPlace={false} />
          ) : (
            <p className="text-sm text-faint">
              No ideas for {c.name} yet. Things they hint at, or you'd like to pitch, belong here until they're real work.
            </p>
          )}
        </div>
      )}
      {tab === "meetings" && <Meetings hub={hub} />}
      {tab === "cadences" && <CadencesPanel customerId={c.id} />}
      {tab === "links" && <LinksPanel customerId={c.id} links={hub.links} />}
      {tab === "sync" && <SyncTab customerId={c.id} customerName={c.name} projects={hub.projects} />}

      {editing && <CustomerEditDialog customer={c} onClose={() => setEditing(false)} />}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="tabular font-medium text-fg">{value}</span> {label}
    </span>
  );
}

function Card({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`well p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="section-title">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

// ----- overview -----

function Overview({ hub, onTab }: { hub: CustomerHub; onTab: (tab: Tab) => void }) {
  const c = hub.customer;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <TopicsSection customer={c} />
        {hub.upcoming.length > 0 && (
          <Card title="Coming up">
            <MeetingList meetings={hub.upcoming} upcoming />
          </Card>
        )}
        <Card
          title="Recent meetings"
          aside={
            <button type="button" className="btn btn-quiet btn-xs" onClick={() => onTab("meetings")}>
              All meetings
            </button>
          }
        >
          {hub.meetings.length ? (
            <MeetingList meetings={hub.meetings} />
          ) : (
            <p className="text-sm text-faint">No recaps yet. Claude logs them from your meeting notes.</p>
          )}
        </Card>
      </div>

      <aside className="min-w-0 space-y-6">
        <Card
          title="Needs attention"
          aside={
            <button type="button" className="btn btn-quiet btn-xs" onClick={() => onTab("work")}>
              Board
            </button>
          }
        >
          {hub.next_up.length ? (
            <div className="-mx-3">
              {hub.next_up.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-faint">Nothing urgent.</p>
          )}
        </Card>
        <Card title="Links & tools">
          <LinksList links={hub.links} onManage={() => onTab("links")} />
        </Card>
        <ProjectsCard hub={hub} />
        {c.notes && (
          <Card title="Notes">
            <Markdown className="text-sm">{c.notes}</Markdown>
          </Card>
        )}
      </aside>
    </div>
  );
}

function ProjectsCard({ hub }: { hub: CustomerHub }) {
  const [creating, setCreating] = useState(false);
  return (
    <Card
      title="Projects"
      aside={
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setCreating(true)}>
          <FolderPlus size={13} /> New
        </button>
      }
    >
      {hub.projects.length ? (
        <ul className="-mx-2">
          {hub.projects.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fg/[0.05] ${p.archived ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {p.overdue_count > 0 && <span className="tag tag-danger">{p.overdue_count}</span>}
                <span className="tabular text-xs text-faint">{p.open_count} open</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">Tasks need a project. Add one to start.</p>
      )}
      {creating && <ProjectDialog defaultArea="work" defaultCustomer={hub.customer.name} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function MeetingList({ meetings, upcoming }: { meetings: Meeting[]; upcoming?: boolean }) {
  const open = useOpenMeeting();
  return (
    <ul className="-mx-2 space-y-1">
      {meetings.map((m) => (
        <li key={m.id}>
          <button type="button" className="w-full rounded-[10px] px-2 py-2 text-left hover:bg-fg/[0.04]" onClick={() => open(m.id)}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{m.title}</span>
              <span className="text-xs text-muted">{meetingWhen(m)}</span>
              {upcoming && (m.prep ? <span className="tag tag-accent">Prep ready</span> : <span className="tag">No prep yet</span>)}
              {!upcoming && m.task_count > 0 && <span className="tag">{m.task_count} tasks</span>}
            </div>
            {!upcoming && m.summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{m.summary.replace(/[#*_`>-]/g, "").trim()}</p>}
            {upcoming && m.attendees && <p className="mt-0.5 truncate text-xs text-faint">{m.attendees}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ----- work -----

function Work({ hub }: { hub: CustomerHub }) {
  const active = hub.projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState<number | null>(active[0]?.id ?? null);
  const target = active.find((p) => p.id === projectId) ?? active[0];
  return (
    <div>
      {target ? (
        <div className="mb-6 flex max-w-3xl flex-wrap items-start gap-2">
          {active.length > 1 && (
            <select
              className="field shrink-0"
              value={target.id}
              onChange={(e) => setProjectId(Number(e.target.value))}
              aria-label="Add to project"
            >
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <div className="min-w-[240px] flex-1">
            <QuickAdd placeholder={`Add to ${target.name}…`} implied={`#${target.name.replace(/\s+/g, "-")}`} />
          </div>
        </div>
      ) : (
        <p className="mb-6 text-sm text-muted">Add a project (Overview → Projects) to start adding tasks.</p>
      )}
      <Board filters={{ customer_id: hub.customer.id }} groupBy={active.length > 1 ? "project" : "none"} storageKey={`customer-${hub.customer.id}`} />
    </div>
  );
}

// ----- meetings -----

function Meetings({ hub }: { hub: CustomerHub }) {
  const { data: recaps = [] } = useMeetings(hub.customer.id);
  const [logging, setLogging] = useState(false);
  const open = useOpenMeeting();

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">
          Claude syncs upcoming meetings from your calendar with prep, and turns notes into recaps.
        </p>
        <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={() => setLogging(true)}>
          <Plus size={14} /> Log meeting
        </button>
      </div>

      {hub.upcoming.length > 0 && (
        <section>
          <h2 className="section-title mb-3 flex items-center gap-2">
            <CalendarClock size={16} className="text-muted" /> Upcoming
          </h2>
          <div className="space-y-3">
            {hub.upcoming.map((m) => (
              <button key={m.id} type="button" className="well block w-full p-4 text-left transition-colors hover:border-[color:var(--line)]" onClick={() => open(m.id)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-sm text-muted">{meetingWhen(m)}</span>
                </div>
                {m.prep ? (
                  <Markdown className="mt-2 line-clamp-6 text-sm">{m.prep}</Markdown>
                ) : (
                  <p className="mt-1 text-sm text-faint">No prep yet.</p>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title mb-3 flex items-center gap-2">
          <FileText size={16} className="text-muted" /> Recaps
        </h2>
        {recaps.length === 0 && <p className="text-sm text-faint">No recaps yet.</p>}
        <ol className="relative space-y-4 border-l border-edge pl-5">
          {recaps.map((m) => (
            <li key={m.id} className="relative">
              <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-fg/30" />
              <button type="button" className="w-full text-left" onClick={() => open(m.id)}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-xs text-muted">{meetingWhen(m)}</span>
                  {m.task_count > 0 && <span className="tag">{m.task_count} tasks</span>}
                </div>
                {m.summary && <Markdown className="mt-1 line-clamp-4 text-sm text-muted">{m.summary}</Markdown>}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {logging && (
        <Modal title="Log a meeting" onClose={() => setLogging(false)} wide>
          <MeetingForm customerId={hub.customer.id} onDone={() => setLogging(false)} />
        </Modal>
      )}
    </div>
  );
}
