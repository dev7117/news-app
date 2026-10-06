import { useState } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StandBox, TimelineEntry, visibleUpdates } from "../components/hub/TopicsSection";
import { type Topic, useHubMutations, useTopic } from "../lib/api";
import { relativeDay } from "../lib/format";
import { useToast } from "../hooks/useToast";

const STATUS_LABEL: Record<Topic["status"], string> = { active: "Active", watching: "Watching", resolved: "Resolved" };

/** A customer topic with its full timeline: where it stands now, and every update, by month. */
export default function TopicPage() {
  const id = Number(useParams().topicId);
  const { data: topic, error } = useTopic(id);
  if (error) return <p className="py-16 text-center text-muted">{error.message}</p>;
  if (!topic) return <div className="h-64" />;
  return <TopicView topic={topic} />;
}

function TopicView({ topic }: { topic: NonNullable<ReturnType<typeof useTopic>["data"]> }) {
  const { updateTopic, addTopicUpdate, deleteTopic } = useHubMutations(topic.customer_id);
  const { toast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(topic.name);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fail = (e: Error) => toast(e.message, "error");

  const updates = visibleUpdates(topic);
  const months: { label: string; items: typeof updates }[] = [];
  for (const u of updates) {
    const label = new Date(`${u.happened_on}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (months[months.length - 1]?.label !== label) months.push({ label, items: [] });
    months[months.length - 1].items.push(u);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to={`/customers/${topic.customer_id}`} className="btn btn-quiet btn-sm -ml-2 mb-4">
        <ChevronLeft size={13} /> {topic.customer}
      </Link>

      <header className="mb-6">
        <div className="flex items-start gap-3">
          <input
            className="min-w-0 flex-1 bg-transparent text-[1.75rem] font-semibold leading-tight tracking-[-0.022em] outline-none"
            value={name}
            aria-label="Topic name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== topic.name)
                updateTopic.mutate({ id: topic.id, name: name.trim() }, { onError: (e) => { setName(topic.name); fail(e); } });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <div className="segmented mt-1.5">
            {(Object.keys(STATUS_LABEL) as Topic["status"][]).map((s) => (
              <button key={s} type="button" className="filter-tab" aria-pressed={topic.status === s} onClick={() => updateTopic.mutate({ id: topic.id, status: s })}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {updates.length} update{updates.length === 1 ? "" : "s"}
          {updates[0] && ` · latest ${relativeDay(updates[0].happened_on).toLowerCase()}`}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="section-title">Where things stand</h2>
        <StandBox topic={topic} customerId={topic.customer_id} large />
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-title">Timeline</h2>
        </div>
        <form
          className="mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) addTopicUpdate.mutate({ id: topic.id, body: note.trim() }, { onSuccess: () => setNote(""), onError: fail });
          }}
        >
          <input className="field w-full" placeholder="Add an update…" value={note} onChange={(e) => setNote(e.target.value)} />
        </form>
        {months.map((m) => (
          <div key={m.label} className="mb-6">
            <h3 className="eyebrow mb-2">{m.label}</h3>
            <ol>
              {m.items.map((u, i) => (
                <TimelineEntry key={u.id} update={u} last={i === m.items.length - 1} customerId={topic.customer_id} />
              ))}
            </ol>
          </div>
        ))}
        {!updates.length && <p className="text-sm text-faint">No updates yet. Claude adds them as it logs meetings.</p>}
      </section>

      <div className="mt-10 border-t border-edge pt-4">
        <button
          type="button"
          className={`btn btn-sm ${confirmDelete ? "btn-danger" : "btn-quiet"}`}
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true);
            deleteTopic.mutate(topic.id, { onSuccess: () => navigate(`/customers/${topic.customer_id}`), onError: fail });
          }}
        >
          <Trash2 size={13} /> {confirmDelete ? "Delete the topic and its whole timeline" : "Delete topic"}
        </button>
      </div>
    </div>
  );
}
