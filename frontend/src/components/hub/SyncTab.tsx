import { useEffect, useState } from "react";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  type Project,
  type SourceFilters,
  type SyncFeed,
  type SyncSource,
  useCustomerSync,
  useCustomerSyncMutations,
} from "../../lib/api";
import { ago } from "../../lib/format";
import { useToast } from "../../hooks/useToast";

type Field = { key: keyof SourceFilters; label: string; placeholder: string; list?: boolean; wide?: boolean };

const SOURCES: { id: SyncSource; label: string; hint: string; example: string; fields: Field[] }[] = [
  {
    id: "gmail",
    label: "Gmail",
    hint: "Threads with these domains or people, or a search",
    example: "Acme mail",
    fields: [
      { key: "domains", label: "Domains", placeholder: "acme.com, acme.io", list: true },
      { key: "addresses", label: "Addresses", placeholder: "dana@partner.com", list: true },
      { key: "labels", label: "Labels", placeholder: "Clients/Acme", list: true },
      { key: "query", label: "Search", placeholder: "subject:(renewal OR invoice) -from:noreply" },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    hint: "Their meetings: attendee domains or words in the title",
    example: "Acme meetings",
    fields: [
      { key: "domains", label: "Attendee domains", placeholder: "acme.com", list: true },
      { key: "title_patterns", label: "Title words", placeholder: "Acme, ACME weekly", list: true },
    ],
  },
  {
    id: "jira",
    label: "Jira",
    hint: "One JQL (or projects) per feed",
    example: "ACME open issues",
    fields: [
      { key: "site", label: "Site", placeholder: "acme.atlassian.net" },
      { key: "projects", label: "Projects", placeholder: "ACME, OPS", list: true },
      { key: "jql", label: "JQL", placeholder: "project = ACME AND assignee = currentUser() AND statusCategory != Done", wide: true },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    hint: "Channels, plus mentions and DMs from their people",
    example: "#acme-shared",
    fields: [
      { key: "channels", label: "Channels", placeholder: "#acme-shared", list: true },
      { key: "users", label: "Their people", placeholder: "Dana Ruiz", list: true },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    hint: "Channels and chats",
    example: "Acme Teams",
    fields: [
      { key: "channels", label: "Channels", placeholder: "Acme / General", list: true },
      { key: "chats", label: "Chats", placeholder: "Acme project chat", list: true },
    ],
  },
];
const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s])) as Record<SyncSource, (typeof SOURCES)[number]>;

const toText = (filters: SourceFilters, fields: Field[]) =>
  Object.fromEntries(fields.map((f) => {
    const v = filters[f.key];
    return [f.key, Array.isArray(v) ? v.join(", ") : v ?? ""];
  })) as Record<string, string>;

const fromText = (text: Record<string, string>, fields: Field[]): SourceFilters =>
  Object.fromEntries(
    fields
      .map((f) => [f.key, f.list ? (text[f.key] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : (text[f.key] ?? "").trim()] as const)
      .filter(([, v]) => (Array.isArray(v) ? v.length : v))
  ) as SourceFilters;

/** A name when none was typed: the source plus what the feed watches ("Jira · ACME", "Slack · #acme-alerts"),
 *  numbered if this client already has one by that name. */
function defaultName(source: SyncSource, filters: SourceFilters, taken: string[]) {
  const label = SOURCE[source].label;
  const what = [filters.projects, filters.channels, filters.chats, filters.domains, filters.title_patterns, filters.labels, filters.addresses]
    .find((v) => v && v.length)?.slice(0, 2).join(", ");
  const base = what ? `${label} · ${what}` : filters.jql || filters.query ? `${label} · query` : label;
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
  return name;
}

/** What the scheduled sync reads for this client (its feeds), its rules, and where each feed stopped. */
export default function SyncTab({ customerId, customerName, projects }: { customerId: number; customerName: string; projects: Project[] }) {
  const { data: sync } = useCustomerSync(customerId);
  const { save, addFeed } = useCustomerSyncMutations(customerId);
  const { toast } = useToast();
  const [rules, setRules] = useState("");
  const [adding, setAdding] = useState<SyncSource | null>(null);
  useEffect(() => sync && setRules(sync.rules), [sync]);
  if (!sync) return null;

  const routine = `/todo-sync ${customerName}`;
  const fail = (e: Error) => toast(e.message, "error");

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="section-title">Feeds</h2>
          <span className="text-sm text-muted">Each is one query against one source, with its own cursor. Add as many as you need.</span>
        </div>
        {sync.feeds.length === 0 && !adding && (
          <p className="well mb-3 p-4 text-sm text-muted">
            No feeds yet. Add one below, or say “set up sync for {customerName}” in Claude Code and it suggests them from your recent
            mail, tickets and channels.
          </p>
        )}
        <div className="space-y-3">
          {sync.feeds.map((feed) => (
            <FeedCard key={feed.id} customerId={customerId} feed={feed} />
          ))}
          {adding && (
            <NewFeed
              source={adding}
              taken={sync.feeds.map((f) => f.name)}
              onCancel={() => setAdding(null)}
              onSave={(body) => addFeed.mutate({ source: adding, ...body }, { onSuccess: () => setAdding(null), onError: fail })}
            />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <button key={s.id} type="button" className="btn btn-ghost btn-xs" onClick={() => setAdding(s.id)}>
              <Plus size={12} /> {s.label}
            </button>
          ))}
        </div>

        <section className="mt-8">
          <h2 className="section-title mb-2">Client rules</h2>
          <textarea
            className="field min-h-[110px] w-full resize-y text-sm"
            placeholder={"Markdown, for every feed. e.g.\n- Dana's asks are always tasks\n- Infra work goes under Portal\n- Ignore automated digests"}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sync.configured ? sync.enabled : true} onChange={(e) => save.mutate({ enabled: e.target.checked }, { onError: fail })} />
              Sync this client
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">New work goes in</span>
              <select
                className="field field-sm"
                value={sync.default_project_id ?? ""}
                onChange={(e) => save.mutate({ default_project_id: e.target.value ? Number(e.target.value) : null }, { onError: fail })}
              >
                <option value="">Claude picks</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={rules === sync.rules || save.isPending}
              onClick={() => save.mutate({ rules }, { onSuccess: () => toast("Rules saved", "success"), onError: fail })}
            >
              Save rules
            </button>
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="well p-4">
          <h2 className="eyebrow mb-2">Routine</h2>
          <p className="mb-2 text-sm text-muted">Schedule this in Claude Code on your Mac (todo-sync skill installed):</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[7px] border border-edge bg-fg/[0.03] px-2 py-1.5 text-sm">{routine}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label="Copy"
              title="Copy"
              onClick={() => navigator.clipboard.writeText(routine).then(() => toast("Copied", "success"))}
            >
              <Copy size={14} />
            </button>
          </div>
          <p className="mt-3 text-xs text-faint">One routine runs all of this client’s enabled feeds.</p>
        </section>
        <section className="well p-4">
          <h2 className="eyebrow mb-2">Already decided</h2>
          <p className="text-sm">
            <span className="tabular font-medium">{sync.ledger.tracked}</span> <span className="text-muted">items tracked as tasks</span>
          </p>
          <p className="text-sm">
            <span className="tabular font-medium">{sync.ledger.rejected}</span> <span className="text-muted">you rejected</span>
          </p>
          <p className="mt-2 text-xs text-faint">The sync won’t propose these again unless something new happens.</p>
        </section>
      </aside>
    </div>
  );
}

function FeedFields({ source, text, setText }: { source: SyncSource; text: Record<string, string>; setText: (t: Record<string, string>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SOURCE[source].fields.map((f) => (
        <label key={f.key} className={`block ${f.wide ? "sm:col-span-2" : ""}`}>
          <span className="eyebrow mb-1 block">{f.label}</span>
          <input
            className={`field field-sm w-full ${f.key === "jql" || f.key === "query" ? "font-mono text-[0.8125rem]" : ""}`}
            placeholder={f.placeholder}
            value={text[f.key] ?? ""}
            onChange={(e) => setText({ ...text, [f.key]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function FeedCard({ customerId, feed }: { customerId: number; feed: SyncFeed }) {
  const { updateFeed, removeFeed } = useCustomerSyncMutations(customerId);
  const { toast } = useToast();
  const meta = SOURCE[feed.source];
  const [name, setName] = useState(feed.name);
  const [text, setText] = useState(() => toText(feed.filters, meta.fields));
  const [rules, setRules] = useState(feed.rules);
  const [confirm, setConfirm] = useState(false);
  const dirty =
    name !== feed.name || rules !== feed.rules || JSON.stringify(fromText(text, meta.fields)) !== JSON.stringify(fromText(toText(feed.filters, meta.fields), meta.fields));
  const fail = { onError: (e: Error) => toast(e.message, "error") };

  return (
    <section className={`well p-4 transition-opacity duration-150 ${feed.enabled ? "" : "opacity-60"}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tag">{meta.label}</span>
        <input
          className="min-w-0 flex-1 bg-transparent font-medium outline-none"
          value={name}
          aria-label="Feed name"
          onChange={(e) => setName(e.target.value)}
        />
        {feed.last_run_at && (
          <span className="text-xs text-faint" title={feed.cursor ? `Next run reads from ${feed.cursor}` : undefined}>
            <RefreshCw size={11} className="mr-1 inline" />
            {ago(feed.last_run_at)}
            {feed.last_summary ? ` · ${feed.last_summary}` : ""}
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={feed.enabled} onChange={(e) => updateFeed.mutate({ id: feed.id, enabled: e.target.checked }, fail)} />
          On
        </label>
        <button
          type="button"
          className={`btn btn-xs btn-icon w-[26px] ${confirm ? "btn-danger" : "btn-quiet"}`}
          aria-label={`Delete ${feed.name}`}
          title={confirm ? "Click again to delete" : "Delete feed"}
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              window.setTimeout(() => setConfirm(false), 3000);
              return;
            }
            removeFeed.mutate(feed.id, fail);
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      <FeedFields source={feed.source} text={text} setText={setText} />
      <label className="mt-3 block">
        <span className="eyebrow mb-1 block">Rules for this feed</span>
        <input className="field field-sm w-full" placeholder="e.g. Only P1s become tasks" value={rules} onChange={(e) => setRules(e.target.value)} />
      </label>
      {dirty && (
        <div className="anim-fade mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setName(feed.name);
              setText(toText(feed.filters, meta.fields));
              setRules(feed.rules);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={updateFeed.isPending}
            onClick={() => updateFeed.mutate({ id: feed.id, name, rules, filters: fromText(text, meta.fields) }, fail)}
          >
            Save
          </button>
        </div>
      )}
    </section>
  );
}

function NewFeed({
  source,
  taken,
  onCancel,
  onSave,
}: {
  source: SyncSource;
  taken: string[];
  onCancel: () => void;
  onSave: (body: { name: string; filters: SourceFilters; rules: string }) => void;
}) {
  const meta = SOURCE[source];
  const [name, setName] = useState("");
  const [text, setText] = useState<Record<string, string>>({});
  const [rules, setRules] = useState("");
  const filters = fromText(text, meta.fields);
  const ready = name.trim() !== "" || Object.keys(filters).length > 0;
  const fallback = defaultName(source, filters, taken);
  return (
    <section className="well anim-fade border-accent/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="tag tag-accent">New {meta.label} feed</span>
        <span className="text-xs text-muted">{meta.hint}</span>
      </div>
      <label className="mb-3 block">
        <span className="eyebrow mb-1 block">Name</span>
        <input
          className="field field-sm w-full"
          placeholder={`Optional: “${fallback}” if left empty`}
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <FeedFields source={source} text={text} setText={setText} />
      <label className="mt-3 block">
        <span className="eyebrow mb-1 block">Rules for this feed</span>
        <input className="field field-sm w-full" placeholder="Optional, e.g. Only P1s become tasks" value={rules} onChange={(e) => setRules(e.target.value)} />
      </label>
      <div className="mt-3 flex items-center justify-end gap-2">
        {!ready && <span className="mr-auto text-xs text-faint">Fill in at least one field.</span>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!ready}
          onClick={() => onSave({ name: name.trim() || fallback, filters, rules })}
        >
          Add feed
        </button>
      </div>
    </section>
  );
}
