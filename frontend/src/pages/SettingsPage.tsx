import { useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { machineIcon } from "../components/hub/RunButton";
import { useMutation } from "@tanstack/react-query";
import { SYNTAX_HELP } from "../components/QuickAdd";
import { type Area, api, queryClient, type Settings, useAgents, useMeta, useRunMutations } from "../lib/api";
import { ago } from "../lib/format";
import { ACCENT_PRESETS, type ThemeMode, useTheme } from "../theme";
import { useToast } from "../hooks/useToast";

export default function SettingsPage() {
  const { mode, setMode, accent, setAccent } = useTheme();
  const { data: meta } = useMeta();
  const { toast } = useToast();
  const origin = window.location.origin;
  const saveSettings = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>("/api/settings", { method: "PUT", json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta"] });
      toast("Saved", "success");
    },
  });

  const tokenArg = meta?.token_required ? ` \\\n  --header "Authorization: Bearer $TODO_API_TOKEN"` : "";
  const mcpCommand = `claude mcp add --transport http --scope user todo ${origin}/mcp${tokenArg}`;
  const ingestExample = `curl -X POST ${origin}/api/ingest \\
  -H "Authorization: Bearer $TODO_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"source": "jira-acme", "close_missing": true, "tasks": [
        {"external_id": "AC-142", "title": "Fix SSO redirect",
         "project": "Acme portal", "due_on": "2026-10-10",
         "external_url": "https://acme.atlassian.net/browse/AC-142"}]}'`;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <h1 className="page-title">Settings</h1>

      <Section title="Appearance">
        <Row label="Theme">
          <div className="segmented">
            {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
              <button key={m} type="button" className="filter-tab capitalize" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent">
          <div className="flex flex-wrap items-center gap-2">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                title={preset.name}
                aria-label={preset.name}
                aria-pressed={accent.toLowerCase() === preset.value}
                onClick={() => setAccent(preset.value)}
                className="grid h-7 w-7 place-items-center rounded-full text-white transition-transform duration-150 ease-out active:scale-90"
                style={{ background: preset.value }}
              >
                {accent.toLowerCase() === preset.value && <Check size={14} strokeWidth={3} />}
              </button>
            ))}
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="h-7 w-9 cursor-pointer rounded-md border border-[color:var(--line)] bg-transparent"
              aria-label="Custom accent"
            />
          </div>
        </Row>
      </Section>

      <Section title="Tasks">
        <Row label="Default area" hint="Used when a new task has no project and no @area.">
          <div className="segmented">
            {(["work", "personal"] as Area[]).map((a) => (
              <button
                key={a}
                type="button"
                className="filter-tab"
                aria-pressed={meta?.settings.default_area === a}
                onClick={() => saveSettings.mutate({ default_area: a })}
              >
                {a === "work" ? "Work" : "Personal"}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Review Claude's changes" hint="Claude's task edits wait in Review until you apply them.">
          <div className="segmented">
            {[true, false].map((on) => (
              <button
                key={String(on)}
                type="button"
                className="filter-tab"
                aria-pressed={meta?.settings.review_claude_changes === on}
                onClick={() => saveSettings.mutate({ review_claude_changes: on })}
              >
                {on ? "Review first" : "Apply immediately"}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Quick add">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {SYNTAX_HELP.map(([token, meaning]) => (
              <div key={token} className="contents">
                <dt className="font-medium">{token}</dt>
                <dd className="text-muted">{meaning}</dd>
              </div>
            ))}
          </dl>
        </Row>
      </Section>

      <Section title="Connect Claude (MCP)">
        <p className="text-muted">
          Streamable HTTP at <code className="text-fg">{origin}/mcp</code>.{" "}
          {meta?.token_required
            ? "A bearer token is required: it's the API_TOKEN set on the Portainer stack."
            : "No token is configured, so anyone on the network can use it. Set API_TOKEN on the stack."}{" "}
          Run this on each machine whose Claude Code should see your tasks:
        </p>
        <CodeBlock text={mcpCommand} />
        <p className="text-sm text-muted">
          Then give Claude meeting notes. It logs the recap and topics on the customer's hub and proposes the task changes,
          which wait in Review for you. With calendar access it also syncs your upcoming customer meetings and writes prep.
        </p>
      </Section>

      <Machines origin={origin} />

      <Section title="Sync scripts">
        <p className="text-muted">
          Scripts push items from customer systems with <code className="text-fg">POST /api/ingest</code>. It upserts by{" "}
          <code className="text-fg">(source, external_id)</code> and is safe to run on a schedule: your triage (project,
          today, in progress) is kept, and items that close in the source close here.
        </p>
        <CodeBlock text={ingestExample} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="section-title border-b border-edge pb-2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-start">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="well relative">
      <pre className="overflow-x-auto p-4 pr-12 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
      <button
        type="button"
        className="btn btn-quiet btn-xs btn-icon absolute right-2 top-2 w-[26px]"
        aria-label="Copy"
        title="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function Machines({ origin }: { origin: string }) {
  const { data: agents = [] } = useAgents();
  const { removeAgent } = useRunMutations();
  return (
    <section id="machines" className="scroll-mt-20 space-y-4">
      <h2 className="section-title border-b border-edge pb-2">Machines</h2>
      <p className="text-muted">
        Customer hub tools run on your machines through <span className="text-fg">todo-agent</span>, a small background
        helper (launchd on the Mac, a systemd user service on Omarchy). It asks for the API token, and before running any
        new or changed command it asks you on that machine. Run this in a terminal on each one, naming the machine:
      </p>
      <CodeBlock text={`curl -fsSL ${origin}/agent/install.sh | sh -s -- "MacBook"`} />
      <p className="text-sm text-muted">
        Manage it there with <code className="text-fg">todo-agent status</code>, <code className="text-fg">approvals</code>,{" "}
        <code className="text-fg">forget</code> and <code className="text-fg">uninstall</code>.
      </p>
      {agents.length > 0 ? (
        <ul className="space-y-2">
          {agents.map((a) => (
            <li key={a.name} className="well flex items-center gap-3 px-4 py-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${a.online ? "bg-success" : "bg-fg/25"}`} />
              <span className="text-muted">{machineIcon(a)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted">
                  {a.platform === "macos" ? "macOS" : "Linux"} · agent {a.version || "?"} ·{" "}
                  {a.online ? "connected" : `last seen ${ago(a.last_seen)}`}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-xs btn-icon w-[26px]"
                title="Forget this machine (it reappears if its agent connects again)"
                aria-label={`Forget ${a.name}`}
                onClick={() => removeAgent.mutate(a.name)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-faint">No machines connected yet.</p>
      )}
    </section>
  );
}
