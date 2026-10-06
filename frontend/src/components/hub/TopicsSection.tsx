import { useState } from "react";
import { ChevronRight, GitMerge, History, MoreHorizontal, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import Markdown from "../Markdown";
import { useOpenMeeting } from "../MeetingDialog";
import { type Customer, type Topic, type TopicCard, type TopicUpdate, useHubMutations, useTopics } from "../../lib/api";
import { ago, relativeDay, todayIso } from "../../lib/format";
import { usePersisted } from "../../lib/usePersisted";
import { useToast } from "../../hooks/useToast";

const WINDOWS = [
  { days: 1, label: "Today", phrase: "today" },
  { days: 7, label: "This week", phrase: "this week" },
  { days: 14, label: "Two weeks", phrase: "in two weeks" },
  { days: 30, label: "One month", phrase: "this month" },
] as const;

const STATUS_TAG: Record<Topic["status"], string> = { active: "tag-accent", watching: "tag-warning", resolved: "tag-success" };
const STATUS_LABEL: Record<Topic["status"], string> = { active: "Active", watching: "Watching", resolved: "Resolved" };
const NEXT: Record<Topic["status"], Topic["status"]> = { active: "watching", watching: "resolved", resolved: "active" };

/** Where things stand with a customer, one card per topic: a "where things stand" Claude keeps
    current, and a timeline of updates (mostly from meetings) that only ever grows. Shows the
    topics updated in the chosen window, busiest first. */
export default function TopicsSection({ customer }: { customer: Customer }) {
  const [days, setDays] = usePersisted<number>("todo-topics-window", 7);
  const [all, setAll] = useState(false);
  const { data: view } = useTopics(customer.id, all ? 0 : days);
  const { addTopic } = useHubMutations(customer.id);
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const window = WINDOWS.find((w) => w.days === days) ?? WINDOWS[1];
  const topics = view?.topics ?? [];

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="section-title">Where things stand</h2>
        <div className="segmented ml-auto">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              className="filter-tab"
              aria-pressed={!all && days === w.days}
              onClick={() => {
                setAll(false);
                setDays(w.days);
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(!adding)}>
          <Plus size={14} /> Topic
        </button>
      </div>

      {adding && (
        <form
          className="anim-rise mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addTopic.mutate(
              { name: name.trim() },
              {
                onSuccess: () => {
                  setName("");
                  setAdding(false);
                  setAll(true);
                },
                onError: (err) => toast(err.message, "error"),
              }
            );
          }}
        >
          <input className="field field-sm flex-1" autoFocus placeholder="A thread they keep raising, e.g. SSO rollout" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
            Add
          </button>
        </form>
      )}

      {view && (
        <p className="mb-3 text-sm text-muted">
          {all ? (
            <>
              All {view.total} topics.{" "}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => setAll(false)}>
                Back to {window.label.toLowerCase()}
              </button>
            </>
          ) : (
            <>
              {topics.length ? `${topics.length} topic${topics.length === 1 ? "" : "s"} with updates ${window.phrase}` : `No topic updates ${window.phrase}`}
              {view.quiet > 0 && (
                <>
                  {" · "}
                  <button type="button" className="underline-offset-2 hover:underline" onClick={() => setAll(true)}>
                    {view.quiet} quieter
                  </button>
                </>
              )}
            </>
          )}
        </p>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {topics.map((t) => (
          <TopicCardView key={t.id} topic={t} since={view?.since ?? null} others={topics} customerId={customer.id} />
        ))}
      </div>
      {view && !topics.length && !all && (
        <p className="rounded-[12px] border border-dashed border-edge px-4 py-6 text-center text-sm text-faint">
          Claude adds updates here as it logs meetings. Widen the window to see older threads.
        </p>
      )}

      {customer.overview?.trim() && <EarlierOverview customer={customer} />}
    </section>
  );
}

function TopicCardView({ topic, since, others, customerId }: { topic: TopicCard; since: string | null; others: TopicCard[]; customerId: number }) {
  const { updateTopic, addTopicUpdate, deleteTopic, mergeTopic } = useHubMutations(customerId);
  const { toast } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(topic.name);
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState(false);
  const fail = (e: Error) => toast(e.message, "error");

  // On the card: everything from today, or else just the latest update. The rest is on the topic's page.
  const updates = visibleUpdates(topic);
  const today = updates.filter((u) => u.happened_on === todayIso());
  const shown = today.length ? today : updates.slice(0, 1);
  const total = topic.updates_total - (topic.updates.length - updates.length);
  const more = total - shown.length;

  return (
    <article className={`well flex flex-col p-4 ${topic.status === "resolved" ? "opacity-75" : ""}`}>
      <header className="flex items-start gap-2">
        {renaming ? (
          <input
            className="field field-sm min-w-0 flex-1 font-medium"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name.trim() !== topic.name) updateTopic.mutate({ id: topic.id, name: name.trim() }, { onError: (e) => { setName(topic.name); fail(e); } });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(topic.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <Link to={`/topics/${topic.id}`} className="min-w-0 flex-1 font-medium leading-snug hover:underline" title="Open the full timeline">
            {topic.name}
          </Link>
        )}
        {!!topic.window_count && since && (
          <span className="tag tabular" title="Updates in this window">
            {topic.window_count} new
          </span>
        )}
        <button
          type="button"
          className={`tag ${STATUS_TAG[topic.status]} cursor-pointer`}
          title={`Mark ${STATUS_LABEL[NEXT[topic.status]].toLowerCase()}`}
          onClick={() => updateTopic.mutate({ id: topic.id, status: NEXT[topic.status] })}
        >
          {STATUS_LABEL[topic.status]}
        </button>
        <div className="relative">
          <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label={`${topic.name} options`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={14} />
          </button>
          {menu && (
            <div className="popover anim-pop-origin-top-right absolute right-0 top-8 z-20 w-60 p-1" onMouseLeave={() => setMenu(false)}>
              <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-fg/[0.06]" onClick={() => { setMenu(false); setRenaming(true); }}>
                Rename
              </button>
              {others.filter((o) => o.id !== topic.id).length > 0 && (
                <label className="block px-2 py-1.5 text-xs text-muted">
                  <span className="mb-1 flex items-center gap-1.5">
                    <GitMerge size={12} /> Merge into…
                  </span>
                  <select
                    className="field field-sm w-full"
                    value=""
                    onChange={(e) => {
                      const into = Number(e.target.value);
                      if (into) mergeTopic.mutate({ id: topic.id, into_id: into }, { onSuccess: (t) => toast(`Merged into “${t.name}”`, "success"), onError: fail });
                      setMenu(false);
                    }}
                  >
                    <option value="">Pick a topic</option>
                    {others.filter((o) => o.id !== topic.id).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-danger hover:bg-fg/[0.06]"
                onClick={() => {
                  setMenu(false);
                  deleteTopic.mutate(topic.id, { onError: fail });
                }}
              >
                <Trash2 size={13} /> Delete topic and its timeline
              </button>
            </div>
          )}
        </div>
      </header>

      <StandBox topic={topic} customerId={customerId} />

      {/* Today's updates, or the latest one. */}
      {shown.length > 0 && (
        <ol className="mt-3">
          {shown.map((u, i) => (
            <TimelineEntry key={u.id} update={u} last={i === shown.length - 1} customerId={customerId} />
          ))}
        </ol>
      )}
      {more > 0 && (
        <Link to={`/topics/${topic.id}`} className="mt-1 flex items-center gap-1 self-start text-xs text-muted hover:text-fg">
          <History size={12} /> Full timeline · {total} update{total === 1 ? "" : "s"}
          <ChevronRight size={12} />
        </Link>
      )}

      <form
        className="mt-auto pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          addTopicUpdate.mutate({ id: topic.id, body: note.trim() }, { onSuccess: () => setNote(""), onError: fail });
        }}
      >
        <input className="field field-sm w-full" placeholder="Add an update…" value={note} onChange={(e) => setNote(e.target.value)} />
      </form>
    </article>
  );
}

/** The updates to show. (Entries seeded from a topic's old summary stay, labelled as such:
    hiding them left topics that counted as updated with nothing to show.) */
export function visibleUpdates(topic: Topic & { updates: TopicUpdate[] }) {
  return topic.updates;
}

/** Where things stand: the current picture, rewritten as it changes. Click to edit. */
export function StandBox({ topic, customerId, large }: { topic: Topic; customerId: number; large?: boolean }) {
  const { updateTopic } = useHubMutations(customerId);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [stand, setStand] = useState(topic.stand);
  return (
    <div className={`mt-2 rounded-[10px] bg-fg/[0.035] ${large ? "px-4 py-3" : "px-3 py-2"}`}>
      {editing ? (
        <textarea
          className={`w-full resize-y bg-transparent leading-relaxed outline-none ${large ? "" : "text-sm"}`}
          rows={large ? 4 : 3}
          autoFocus
          value={stand}
          onChange={(e) => setStand(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (stand.trim() !== topic.stand.trim()) updateTopic.mutate({ id: topic.id, stand }, { onError: (e) => toast(e.message, "error") });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setStand(topic.stand);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" className="block w-full text-left" onClick={() => { setStand(topic.stand); setEditing(true); }} aria-label={`Edit where ${topic.name} stands`}>
          {topic.stand.trim() ? (
            <Markdown className={large ? "" : "text-sm"}>{topic.stand}</Markdown>
          ) : (
            <p className="text-sm text-faint">Where does this stand? Claude fills this in from meetings.</p>
          )}
        </button>
      )}
      {topic.stand_updated_at && !editing && (
        <p className="mt-1 text-[0.6875rem] text-faint">
          {topic.stand_source === "mcp" ? "Claude" : "You"} · {ago(topic.stand_updated_at)}
        </p>
      )}
    </div>
  );
}

export function TimelineEntry({ update, last, faded = false, customerId }: { update: TopicUpdate; last: boolean; faded?: boolean; customerId: number }) {
  const openMeeting = useOpenMeeting();
  const { deleteTopicUpdate } = useHubMutations(customerId);
  return (
    <li className={`group relative flex gap-3 pb-3 ${faded ? "opacity-60" : ""}`}>
      {/* the rail */}
      {!last && <span className="absolute left-[4px] top-3 h-full w-px bg-[color:var(--edge)]" aria-hidden="true" />}
      <span className={`relative mt-[6px] h-[9px] w-[9px] shrink-0 rounded-full border-2 ${update.meeting_id ? "border-accent bg-accent/30" : "border-fg/30 bg-tile"}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-faint">
          <span className="tabular" title={update.happened_on}>
            {relativeDay(update.happened_on)}
          </span>
          {update.meeting_id && (
            <button type="button" className="truncate text-muted hover:text-fg hover:underline" onClick={() => openMeeting(update.meeting_id!)}>
              {update.meeting_title ?? "Meeting"}
            </button>
          )}
          {update.source === "migrated" && <span>from the old summary</span>}
          <button
            type="button"
            className="btn btn-quiet btn-xs btn-icon ml-auto h-5 w-5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
            title="Remove this update"
            aria-label="Remove this update"
            onClick={() => deleteTopicUpdate.mutate(update.id)}
          >
            <X size={11} />
          </button>
        </div>
        <Markdown className="text-sm">{update.body}</Markdown>
      </div>
    </li>
  );
}

/** The single overview from before topics took over. Read-only; Claude folds it into topics. */
function EarlierOverview({ customer }: { customer: Customer }) {
  const { updateCustomer } = useHubMutations(customer.id);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 rounded-[12px] border border-edge">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted hover:text-fg" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} className={`transition-transform duration-200 ease-out ${open ? "rotate-90" : ""}`} />
        Earlier overview
        <span className="text-xs text-faint">· from before topics; kept for reference</span>
      </button>
      {open && (
        <div className="anim-fade border-t border-edge px-4 py-3">
          <Markdown className="text-sm text-muted">{customer.overview}</Markdown>
          <button type="button" className="btn btn-quiet btn-xs mt-2" onClick={() => updateCustomer.mutate({ overview: "" })}>
            <Trash2 size={12} /> Remove it
          </button>
        </div>
      )}
    </div>
  );
}
