import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, ChevronLeft, Pause, Play, Plus, Settings2, SquareTerminal, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CadenceDialog from "../components/cadence/CadenceDialog";
import { countdown, STATUS_LOOK, when } from "../components/cadence/format";
import { AutoTextarea, SaveHint, useAutosave } from "../components/notebook/autosave";
import { type AgendaTopic, type Cadence, type CadenceStep, useCadence, useCadenceMutations, useHub } from "../lib/api";
import { useToast } from "../hooks/useToast";

/** A cadence: its meetings (next ones and past), and the template every meeting's prep is made from. */
export default function CadencePage() {
  const id = Number(useParams().cadenceId);
  const { data: cadence, error } = useCadence(id);
  const { update } = useCadenceMutations();
  const [settings, setSettings] = useState(false);

  if (error) return <p className="py-16 text-center text-muted">{error.message}</p>;
  if (!cadence) return <div className="h-64" />;

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link to={`/customers/${cadence.customer_id}?tab=cadences`} className="btn btn-quiet btn-sm -ml-2 mb-4">
        <ChevronLeft size={13} /> {cadence.customer}
      </Link>
      <header className="mb-8 flex flex-wrap items-start gap-3">
        <CalendarClock size={22} className="mt-1.5 text-muted" />
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{cadence.name}</h1>
          <p className="mt-1 text-muted">
            {cadence.schedule_text} · {cadence.duration_min} min · prep starts {cadence.prep_days} day{cadence.prep_days === 1 ? "" : "s"} ahead
            {cadence.project && ` · tasks in ${cadence.project}`}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => update.mutate({ id, active: !cadence.active })}>
          {cadence.active ? <Pause size={14} /> : <Play size={14} />} {cadence.active ? "Pause" : "Resume"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettings(true)}>
          <Settings2 size={14} /> Settings
        </button>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-10">
          <Purpose cadence={cadence} />
          <AgendaEditor cadence={cadence} />
          <StepsEditor cadence={cadence} />
        </div>
        <Meetings cadence={cadence} />
      </div>

      {settings && <CadenceDialog customerId={cadence.customer_id} cadence={cadence} onClose={() => setSettings(false)} />}
    </div>
  );
}

function Meetings({ cadence }: { cadence: Cadence }) {
  const { prepare } = useCadenceMutations();
  const { toast } = useToast();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map((cadence.occurrences ?? []).map((o) => [o.id, o]));
  const past = (cadence.occurrences ?? []).filter((o) => o.held_on < today);

  return (
    <aside className="space-y-8">
      <section>
        <h2 className="section-title mb-3">Next meetings</h2>
        <ul className="space-y-2">
          {(cadence.upcoming ?? []).map((u) => {
            const occ = u.occurrence_id ? byId.get(u.occurrence_id) : undefined;
            return (
              <li key={u.starts_at} className="well flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{when(u.starts_at)}</div>
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    {countdown(u.starts_at)}
                    {occ && occ.prep.total > 0 && (
                      <span className="tabular">
                        · prep {occ.prep.done}/{occ.prep.total}
                      </span>
                    )}
                  </div>
                </div>
                {u.status && <span className={`tag ${STATUS_LOOK[u.status].tag}`}>{STATUS_LOOK[u.status].label}</span>}
                {u.occurrence_id ? (
                  <Link to={`/prep/${u.occurrence_id}`} className="btn btn-primary btn-xs">
                    Open prep
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    disabled={prepare.isPending}
                    title="Make this meeting's prep now"
                    onClick={() =>
                      prepare.mutate(
                        { id: cadence.id, starts_at: u.starts_at },
                        { onSuccess: (o) => navigate(`/prep/${o.id}`), onError: (e) => toast(e.message, "error") }
                      )
                    }
                  >
                    Prep early
                  </button>
                )}
              </li>
            );
          })}
          {!cadence.upcoming?.length && <p className="text-sm text-faint">No meetings in the next 60 days.</p>}
        </ul>
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Past meetings</h2>
          <ul className="overflow-hidden rounded-[12px] border border-edge">
            {past.map((o) => (
              <li key={o.id} className="border-b border-edge last:border-b-0">
                <Link to={`/prep/${o.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-fg/[0.03]">
                  <span className="min-w-0 flex-1 truncate">{when(o.starts_at)}</span>
                  {!!o.files && <span className="tag tabular">{o.files} files</span>}
                  <span className={`tag ${STATUS_LOOK[o.status].tag}`}>{STATUS_LOOK[o.status].label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function Purpose({ cadence }: { cadence: Cadence }) {
  const { update } = useCadenceMutations();
  const purpose = useAutosave(cadence.purpose, (value) => update.mutate({ id: cadence.id, purpose: value }));
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="section-title">Purpose</h2>
        <SaveHint status={purpose.status} />
      </div>
      <AutoTextarea
        className="field min-h-[84px] w-full resize-none leading-relaxed"
        placeholder="What this meeting is for, who's in it, and how to prep it. Claude reads this before prepping."
        value={purpose.value}
        onChange={(e) => purpose.change(e.target.value)}
        onBlur={purpose.flush}
      />
    </section>
  );
}

/** Keep a local draft of a list; reset it whenever the saved version changes. */
function useDraft<T>(saved: T[]) {
  const [draft, setDraft] = useState(saved);
  const key = JSON.stringify(saved);
  useEffect(() => setDraft(JSON.parse(key)), [key]);
  const dirty = JSON.stringify(draft) !== key;
  const move = (i: number, delta: number) => {
    const next = [...draft];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setDraft(next);
  };
  return { draft, setDraft, dirty, move, reset: () => setDraft(JSON.parse(key)) };
}

function AgendaEditor({ cadence }: { cadence: Cadence }) {
  const { update } = useCadenceMutations();
  const { toast } = useToast();
  const { draft, setDraft, dirty, move, reset } = useDraft<AgendaTopic>(cadence.agenda);
  const set = (i: number, patch: Partial<AgendaTopic>) => setDraft(draft.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="section-title">Agenda</h2>
        <span className="tabular text-sm text-faint">{draft.length}</span>
      </div>
      <p className="mb-3 text-sm text-muted">Each meeting gets these topics to fill with talking points. Guidance says what belongs under each.</p>
      <ol className="space-y-2">
        {draft.map((topic, i) => (
          <li key={i} className="well group flex items-start gap-2 p-2.5">
            <span className="tabular mt-1.5 w-5 shrink-0 text-center text-sm text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <input className="field field-sm w-full font-medium" placeholder="Topic" value={topic.title} onChange={(e) => set(i, { title: e.target.value })} />
              <input
                className="field field-sm w-full"
                placeholder="Guidance: what to cover, where the numbers come from…"
                value={topic.guidance}
                onChange={(e) => set(i, { guidance: e.target.value })}
              />
            </div>
            <RowTools i={i} total={draft.length} onMove={move} onRemove={() => setDraft(draft.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDraft([...draft, { title: "", guidance: "" }])}>
          <Plus size={14} /> Add topic
        </button>
        {dirty && (
          <>
            <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={reset}>
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                update.mutate(
                  { id: cadence.id, agenda: draft.filter((t) => t.title.trim()) },
                  { onSuccess: () => toast("Agenda saved; new meetings use it", "success"), onError: (e) => toast(e.message, "error") }
                )
              }
            >
              Save agenda
            </button>
          </>
        )}
      </div>
    </section>
  );
}

type StepDraft = Pick<CadenceStep, "title" | "instructions" | "link_id" | "due_hours_before" | "outputs"> & { id?: number };

function StepsEditor({ cadence }: { cadence: Cadence }) {
  const { setSteps } = useCadenceMutations();
  const { data: hub } = useHub(cadence.customer_id);
  const { toast } = useToast();
  const saved: StepDraft[] = (cadence.steps ?? []).map(({ id, title, instructions, link_id, due_hours_before, outputs }) => ({
    id, title, instructions, link_id, due_hours_before, outputs,
  }));
  const { draft, setDraft, dirty, move, reset } = useDraft<StepDraft>(saved);
  const tools = (hub?.links ?? []).filter((l) => l.kind === "launcher");
  const set = (i: number, patch: Partial<StepDraft>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="section-title">Prep steps</h2>
        <span className="tabular text-sm text-faint">{draft.length}</span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Each meeting gets these as tasks. A step can run one of {cadence.customer}'s desktop tools; files it writes to the outputs you list get attached to
        the meeting.
      </p>
      <ol className="space-y-2">
        {draft.map((step, i) => (
          <li key={step.id ?? `new-${i}`} className="well group flex items-start gap-2 p-3">
            <span className="tabular mt-1.5 w-5 shrink-0 text-center text-sm text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1 space-y-2">
              <input className="field field-sm w-full font-medium" placeholder="Step, e.g. Run the ops report" value={step.title} onChange={(e) => set(i, { title: e.target.value })} />
              <textarea
                className="field min-h-[60px] w-full resize-y text-sm"
                placeholder="Instructions: what to run or gather, and how. Claude follows these."
                value={step.instructions}
                onChange={(e) => set(i, { instructions: e.target.value })}
              />
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="flex items-center gap-2 text-sm">
                  <SquareTerminal size={14} className="shrink-0 text-muted" />
                  <select className="field field-sm min-w-0 flex-1" value={step.link_id ?? ""} onChange={(e) => set(i, { link_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">No desktop tool</option>
                    {tools.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  Due
                  <input
                    type="number"
                    min={0}
                    className="field field-sm w-[72px]"
                    value={step.due_hours_before}
                    onChange={(e) => set(i, { due_hours_before: Number(e.target.value) })}
                  />
                  hours before
                </label>
              </div>
              <textarea
                className="field min-h-[36px] w-full resize-y font-mono text-xs"
                rows={1}
                placeholder="Output files to attach, one per line: ~/reports/acme/*.pdf"
                value={step.outputs}
                onChange={(e) => set(i, { outputs: e.target.value })}
              />
            </div>
            <RowTools i={i} total={draft.length} onMove={move} onRemove={() => setDraft(draft.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => setDraft([...draft, { title: "", instructions: "", link_id: null, due_hours_before: 24, outputs: "" }])}
        >
          <Plus size={14} /> Add step
        </button>
        {dirty && (
          <>
            <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={reset}>
              Discard
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                setSteps.mutate(
                  { id: cadence.id, steps: draft.filter((s) => s.title.trim()) },
                  { onSuccess: () => toast("Prep steps saved; new meetings use them", "success"), onError: (e) => toast(e.message, "error") }
                )
              }
            >
              Save steps
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function RowTools({ i, total, onMove, onRemove }: { i: number; total: number; onMove: (i: number, d: number) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
      <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => onMove(i, -1)}>
        <ArrowUp size={13} />
      </button>
      <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label="Move down" title="Move down" disabled={i === total - 1} onClick={() => onMove(i, 1)}>
        <ArrowDown size={13} />
      </button>
      <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label="Remove" title="Remove" onClick={onRemove}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
