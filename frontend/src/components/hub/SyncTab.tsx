import { useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import {
  type CustomerSync,
  type Project,
  type SourceFilters,
  type SyncSource,
  useCustomerSync,
  useSaveCustomerSync,
} from "../../lib/api";
import { ago } from "../../lib/format";
import { useToast } from "../../hooks/useToast";

type Field = { key: keyof SourceFilters; label: string; placeholder: string; list?: boolean };

const SOURCES: { id: SyncSource; label: string; hint: string; fields: Field[] }[] = [
  {
    id: "gmail",
    label: "Gmail",
    hint: "Threads with these domains or people",
    fields: [
      { key: "domains", label: "Domains", placeholder: "acme.com, acme.io", list: true },
      { key: "addresses", label: "Addresses", placeholder: "dana@partner.com", list: true },
      { key: "labels", label: "Labels", placeholder: "Clients/Acme", list: true },
      { key: "query", label: "Extra query", placeholder: "-from:noreply" },
    ],
  },
  {
    id: "calendar",
    label: "Google Calendar",
    hint: "Their meetings: attendee domains or words in the title",
    fields: [
      { key: "domains", label: "Attendee domains", placeholder: "acme.com", list: true },
      { key: "title_patterns", label: "Title words", placeholder: "Acme, ACME weekly", list: true },
    ],
  },
  {
    id: "jira",
    label: "Jira",
    hint: "Issues assigned to you, reported or watched, in these projects",
    fields: [
      { key: "site", label: "Site", placeholder: "acme.atlassian.net" },
      { key: "projects", label: "Projects", placeholder: "ACME, OPS", list: true },
      { key: "jql", label: "Extra JQL", placeholder: "labels = customer" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    hint: "Mentions, DMs and threads you're in",
    fields: [
      { key: "channels", label: "Channels", placeholder: "#acme-shared", list: true },
      { key: "users", label: "Their people", placeholder: "Dana Ruiz", list: true },
    ],
  },
  {
    id: "teams",
    label: "Microsoft Teams",
    hint: "Mentions and chats",
    fields: [
      { key: "channels", label: "Channels", placeholder: "Acme / General", list: true },
      { key: "chats", label: "Chats", placeholder: "Acme project chat", list: true },
    ],
  },
];

type Draft = Record<SyncSource, Record<string, string> | null>;

const toDraft = (sync: CustomerSync): Draft =>
  Object.fromEntries(
    SOURCES.map((s) => {
      const spec = sync.sources[s.id];
      if (!spec) return [s.id, null];
      return [s.id, Object.fromEntries(s.fields.map((f) => {
        const v = spec[f.key];
        return [f.key, Array.isArray(v) ? v.join(", ") : v ?? ""];
      }))];
    })
  ) as Draft;

const fromDraft = (draft: Draft) =>
  Object.fromEntries(
    SOURCES.map((s) => {
      const d = draft[s.id];
      if (!d) return [s.id, null];
      return [s.id, Object.fromEntries(s.fields.map((f) => [
        f.key,
        f.list ? (d[f.key] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : (d[f.key] ?? "").trim() || undefined,
      ]))];
    })
  );

/** What the scheduled sync reads for this client, its rules, and where each source stopped. */
export default function SyncTab({ customerId, customerName, projects }: { customerId: number; customerName: string; projects: Project[] }) {
  const { data: sync } = useCustomerSync(customerId);
  const save = useSaveCustomerSync(customerId);
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rules, setRules] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!sync) return;
    setDraft(toDraft(sync));
    setRules(sync.rules);
    setProjectId(sync.default_project_id);
    setEnabled(sync.configured ? sync.enabled : true);
  }, [sync]);
  if (!sync || !draft) return null;

  const routine = `/todo-sync ${customerName}`;
  const setField = (source: SyncSource, key: string, value: string) =>
    setDraft({ ...draft, [source]: { ...(draft[source] ?? {}), [key]: value } });
  const submit = () =>
    save.mutate(
      { enabled, rules, default_project_id: projectId, sources: fromDraft(draft) },
      { onSuccess: () => toast("Sync settings saved", "success"), onError: (e) => toast(e.message, "error") }
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        {SOURCES.map((s) => {
          const on = draft[s.id] !== null;
          const state = sync.state[s.id];
          return (
            <section key={s.id} className={`well p-4 transition-opacity duration-150 ${on ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => setDraft({ ...draft, [s.id]: e.target.checked ? {} : null })}
                  />
                  {s.label}
                </label>
                <span className="text-xs text-muted">{s.hint}</span>
                {state?.last_run_at && (
                  <span className="ml-auto text-xs text-faint" title={state.cursor ? `Next run reads from ${state.cursor}` : undefined}>
                    <RefreshCw size={11} className="mr-1 inline" />
                    {ago(state.last_run_at)}
                    {state.last_summary ? ` · ${state.last_summary}` : ""}
                  </span>
                )}
              </div>
              {on && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {s.fields.map((f) => (
                    <label key={f.key} className="block">
                      <span className="eyebrow mb-1 block">{f.label}</span>
                      <input
                        className="field field-sm w-full"
                        placeholder={f.placeholder}
                        value={draft[s.id]?.[f.key] ?? ""}
                        onChange={(e) => setField(s.id, f.key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <section className="well p-4">
          <span className="eyebrow mb-1.5 block">Rules for this client</span>
          <textarea
            className="field min-h-[120px] w-full resize-y text-sm"
            placeholder={"Markdown. e.g.\n- Ignore automated Jira digests\n- Dana's asks are always tasks\n- Infra work goes under Portal"}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">The sync follows these over its defaults.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Sync this client
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">New work goes in</span>
            <select
              className="field field-sm"
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Claude picks</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary btn-sm ml-auto" onClick={submit} disabled={save.isPending}>
            Save
          </button>
        </div>
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
          <p className="mt-3 text-xs text-faint">
            Or say “set up sync for {customerName}” in Claude Code and it fills these in from your recent mail and tickets.
          </p>
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
