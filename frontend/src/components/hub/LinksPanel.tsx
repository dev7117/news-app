import { useState } from "react";
import { Bot, ExternalLink, Link2, Pencil, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import Modal from "../Modal";
import { type CustomerLink, useAgents, useHubMutations } from "../../lib/api";
import { useToast } from "../../hooks/useToast";
import RunButton from "./RunButton";
import RunHistory from "./RunHistory";

/** Compact list for the overview rail. */
export function LinksList({ links, onManage }: { links: CustomerLink[]; onManage: () => void }) {
  const urls = links.filter((l) => l.kind === "link");
  const launchers = links.filter((l) => l.kind === "launcher");
  return (
    <div className="space-y-3">
      {urls.length > 0 && (
        <ul className="-mx-2">
          {urls.map((link) => (
            <li key={link.id}>
              <a
                href={link.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-fg/[0.05]"
              >
                <Link2 size={14} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{link.label}</span>
                <ExternalLink size={12} className="shrink-0 text-faint" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {launchers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {launchers.map((link) => (
            <RunButton key={link.id} link={link} />
          ))}
        </div>
      )}
      {!links.length && <p className="text-sm text-faint">No links or tools yet.</p>}
      <button type="button" className="btn btn-quiet btn-xs -ml-2" onClick={onManage}>
        Manage links & tools
      </button>
    </div>
  );
}

/** Full management tab. */
export default function LinksPanel({ customerId, links }: { customerId: number; links: CustomerLink[] }) {
  const [editing, setEditing] = useState<Partial<CustomerLink> | null>(null);
  const urls = links.filter((l) => l.kind === "link");
  const launchers = links.filter((l) => l.kind === "launcher");

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-title">Links</h2>
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setEditing({ kind: "link" })}>
            <Plus size={14} /> Link
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">Their Jira, shared drive, status page, contract… Claude can propose links too.</p>
        <div className="space-y-2">
          {urls.map((link) => (
            <Row key={link.id} link={link} onEdit={() => setEditing(link)} customerId={customerId}>
              <Link2 size={15} className="shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <a href={link.url ?? undefined} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">
                  {link.label}
                </a>
                <div className="truncate text-xs text-faint">{link.url}</div>
              </div>
            </Row>
          ))}
          {!urls.length && <p className="text-sm text-faint">None yet.</p>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="section-title">Desktop tools</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => setEditing({ kind: "launcher", mode: "terminal" })}
          >
            <Plus size={14} /> Tool
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          Commands that run on your Mac or Omarchy desktop through todo-agent (
          <Link to="/settings#machines" className="underline underline-offset-4">Settings → Machines</Link>).{" "}
          <span className="text-fg">Interactive</span> opens a terminal (CLI logins), <span className="text-fg">Headless</span>{" "}
          runs in the background and sends its output back here (e.g. <code className="text-fg">claude -p "…"</code>). A
          new or changed command asks for approval on that machine first. Commands get{" "}
          <code className="text-fg">TODO_CUSTOMER</code>, <code className="text-fg">TODO_CUSTOMER_ID</code> and{" "}
          <code className="text-fg">TODO_URL</code>.
        </p>
        <div className="space-y-2">
          {launchers.map((link) => (
            <Row key={link.id} link={link} onEdit={() => setEditing(link)} customerId={customerId} footer={<RunHistory linkId={link.id} />}>
              <RunButton link={link} variant="primary" label={false} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{link.label}</span>
                  <span className="tag">
                    {link.mode === "terminal" ? <SquareTerminal size={11} /> : <Bot size={11} />}
                    {link.mode === "terminal" ? "Interactive" : "Headless"}
                  </span>
                  {link.agent && <span className="tag">{link.agent}</span>}
                </div>
                <code className="block truncate text-xs text-faint">
                  {link.cwd ? `${link.cwd} $ ` : "$ "}
                  {link.command}
                </code>
              </div>
            </Row>
          ))}
          {!launchers.length && <p className="text-sm text-faint">None yet.</p>}
        </div>
      </section>

      {editing && <LinkDialog customerId={customerId} link={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Row({
  link,
  onEdit,
  customerId,
  children,
  footer,
}: {
  link: CustomerLink;
  onEdit: () => void;
  customerId: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { deleteLink } = useHubMutations(customerId);
  return (
    <div className="well group px-3 py-2.5">
    <div className="flex items-center gap-3">
      {children}
      <div className="flex shrink-0 gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
        <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label={`Edit ${link.label}`} title="Edit" onClick={onEdit}>
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-xs btn-icon w-[26px]"
          aria-label={`Delete ${link.label}`}
          title="Delete"
          onClick={() => deleteLink.mutate(link.id)}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
    {footer}
    </div>
  );
}

function LinkDialog({ customerId, link, onClose }: { customerId: number; link: Partial<CustomerLink>; onClose: () => void }) {
  const { createLink, updateLink } = useHubMutations(customerId);
  const { toast } = useToast();
  const launcher = link.kind === "launcher";
  const [form, setForm] = useState({
    label: link.label ?? "",
    url: link.url ?? "",
    command: link.command ?? "",
    cwd: link.cwd ?? "",
    mode: link.mode ?? "terminal",
    agent: link.agent ?? "",
  });
  const { data: agents = [] } = useAgents();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <Modal title={`${link.id ? "Edit" : "New"} ${launcher ? "desktop tool" : "link"}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const body = launcher
            ? { label: form.label, command: form.command, cwd: form.cwd || null, mode: form.mode as CustomerLink["mode"], agent: form.agent || null }
            : { label: form.label, url: form.url };
          const done = { onSuccess: onClose, onError: (err: Error) => toast(err.message, "error") };
          if (link.id) updateLink.mutate({ id: link.id, ...body }, done);
          else createLink.mutate({ kind: launcher ? "launcher" : "link", url: null, command: null, cwd: null, mode: "terminal", ...body }, done);
        }}
      >
        <label className="block">
          <span className="eyebrow mb-1.5 block">Label</span>
          <input className="field w-full" value={form.label} onChange={set("label")} required autoFocus placeholder={launcher ? "Sync Jira" : "Jira board"} />
        </label>
        {launcher ? (
          <>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Command</span>
              <textarea
                className="field min-h-[72px] w-full resize-y font-mono text-[0.8125rem]"
                value={form.command}
                onChange={set("command")}
                required
                placeholder={'claude -p "Review open Acme Jira tickets and propose todo updates"'}
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Working directory</span>
              <input className="field w-full font-mono text-[0.8125rem]" value={form.cwd} onChange={set("cwd")} placeholder="~/Work/acme (optional)" />
            </label>
            <div>
              <span className="eyebrow mb-1.5 block">How</span>
              <div className="segmented">
                {(["terminal", "background"] as const).map((mode) => (
                  <button key={mode} type="button" className="filter-tab" aria-pressed={form.mode === mode} onClick={() => setForm({ ...form, mode })}>
                    {mode === "terminal" ? <SquareTerminal size={13} /> : <Bot size={13} />}
                    {mode === "terminal" ? "Interactive" : "Headless"}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {form.mode === "terminal"
                  ? "Opens a terminal window you can type in (logins, prompts). The session is recorded here."
                  : "Runs in the background; output streams back here and you get a notification when it's done."}
              </p>
            </div>
            <label className="block">
              <span className="eyebrow mb-1.5 block">Run on</span>
              <select className="field w-full" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })}>
                <option value="">Ask each time (or the only machine online)</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} ({a.platform === "macos" ? "Mac" : "Linux"}){a.online ? "" : " · offline"}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="block">
            <span className="eyebrow mb-1.5 block">URL</span>
            <input className="field w-full" value={form.url} onChange={set("url")} required placeholder="https://acme.atlassian.net/jira/…" />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!form.label.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
