import ImageStrip, { withoutImages } from "../ImageStrip";
import { useImagePaste } from "../../lib/useImagePaste";
import { useMemo, useRef, useState } from "react";
import {
  CalendarClock, CheckCircle2, ChevronRight, CircleDot, ListPlus, ListX, MessageSquareText, Pencil,
  Sparkles, Square, SquareCheckBig, Sun, XCircle,
} from "lucide-react";
import { type Task, type TimelineEvent, useTaskMutations, useTimeline } from "../../lib/api";
import { timestamp } from "../../lib/format";
import { useOpenMeeting } from "../MeetingDialog";
import { useToast } from "../../hooks/useToast";
import { plainMentions, useMentionProvider } from "../autocomplete/providers";
import { useAutocomplete } from "../autocomplete/useAutocomplete";

const LOOK: Record<TimelineEvent["type"], { icon: React.ReactNode; tone: string }> = {
  created: { icon: <Sparkles size={11} />, tone: "bg-tile text-muted border-[color:var(--line)]" },
  note: { icon: <MessageSquareText size={11} />, tone: "bg-tile text-fg border-[color:var(--line)]" },
  status: { icon: <CircleDot size={11} />, tone: "bg-accent/15 text-accent border-accent/40" },
  completed: { icon: <CheckCircle2 size={12} />, tone: "bg-success text-white border-success" },
  cancelled: { icon: <XCircle size={11} />, tone: "bg-tile text-faint border-[color:var(--line)]" },
  today: { icon: <Sun size={11} />, tone: "bg-warning/15 text-warning border-warning/40" },
  change: { icon: <Pencil size={10} />, tone: "bg-tile text-faint border-[color:var(--edge)]" },
  subtask_added: { icon: <ListPlus size={11} />, tone: "bg-tile text-muted border-[color:var(--line)]" },
  subtask_done: { icon: <SquareCheckBig size={11} />, tone: "bg-success/15 text-success border-success/40" },
  subtask_reopened: { icon: <Square size={10} />, tone: "bg-tile text-muted border-[color:var(--line)]" },
  subtask_removed: { icon: <ListX size={11} />, tone: "bg-tile text-faint border-[color:var(--edge)]" },
  meeting: { icon: <CalendarClock size={11} />, tone: "bg-accent text-accent-ink border-accent" },
};

/** A note that came from a meeting is drawn as a meeting. */
const lookOf = (e: TimelineEvent) => LOOK[e.meeting_id && e.type === "note" ? "meeting" : e.type] ?? LOOK.change;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

interface Placed {
  event: TimelineEvent;
  x: number; // 0..100 (%)
  row: number;
}

/** Horizontal: blend real time with order, so bursts of activity don't pile into one dot,
    then lift markers that would still overlap onto a second or third row. */
function place(events: TimelineEvent[], end: number): Placed[] {
  if (!events.length) return [];
  const start = new Date(events[0].at).getTime();
  const span = Math.max(end - start, 60_000);
  const rowEnds: number[] = [];
  return events.map((event, i) => {
    const byTime = (new Date(event.at).getTime() - start) / span;
    const byOrder = events.length === 1 ? 0 : i / (events.length - 1);
    const x = 2 + 92 * (0.55 * byTime + 0.45 * byOrder);
    let row = rowEnds.findIndex((last) => x - last >= 3.2);
    if (row === -1) row = Math.min(rowEnds.length, 2);
    rowEnds[row] = x;
    return { event, x, row };
  });
}

export default function Timeline({ task }: { task: Task }) {
  const { data: events = [] } = useTimeline(task.id);
  const closed = task.status === "done" || task.status === "cancelled";
  const end = closed && task.completed_at ? new Date(task.completed_at).getTime() : Date.now();
  const placed = useMemo(() => place(events, end), [events, end]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const active = events.find((e) => e.id === selected) ?? events[events.length - 1];
  const openMeeting = useOpenMeeting();

  // A few date labels under the track: first, last, and evenly between, no repeats.
  const ticks = useMemo(() => {
    if (!placed.length) return [] as { x: number; label: string }[];
    const pick = placed.length <= 5 ? placed : [0, 0.25, 0.5, 0.75, 1].map((f) => placed[Math.round(f * (placed.length - 1))]);
    const seen = new Set<string>();
    return pick
      .map((p) => ({ x: p.x, label: day(p.event.at) }))
      .filter((t) => (seen.has(t.label) ? false : (seen.add(t.label), true)));
  }, [placed]);

  return (
    <section className="well p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="section-title">Timeline</h2>
        <span className="tabular text-sm text-faint">{events.length} events</span>
        <Legend />
      </div>

      <LogProgress task={task} />

      {events.length > 0 && (
        <>
          <div className="relative mt-6 overflow-x-auto pb-1" role="list" aria-label="Task timeline">
            <div className="relative min-w-[560px]" style={{ height: 28 * rows + 34 }}>
              {/* the track */}
              <div className="absolute inset-x-[2%] h-px bg-[color:var(--line)]" style={{ top: 28 * (rows - 1) + 13 }} />
              {!closed && (
                <div
                  className="absolute right-[1%] h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-[color:var(--line)]"
                  style={{ top: 28 * (rows - 1) + 9 }}
                  aria-hidden="true"
                />
              )}
              {placed.map(({ event, x, row }) => {
                const look = lookOf(event);
                const isActive = active?.id === event.id;
                const top = 28 * (rows - 1 - row) + 3;
                return (
                  <div key={event.id} role="listitem">
                    {row > 0 && (
                      <span className="absolute w-px bg-[color:var(--edge)]" style={{ left: `${x}%`, top: top + 20, height: 28 * row - 10 }} />
                    )}
                    <button
                      type="button"
                      className={`absolute grid h-5 w-5 -translate-x-1/2 place-items-center rounded-full border transition-transform duration-150 ease-out hover:scale-110 active:scale-95 ${look.tone} ${
                        isActive ? "ring-2 ring-accent/50 ring-offset-2 ring-offset-[rgb(var(--c-tile))]" : ""
                      }`}
                      style={{ left: `${x}%`, top }}
                      aria-label={`${event.title}, ${timestamp(event.at)}`}
                      aria-pressed={isActive}
                      title={`${event.title} · ${timestamp(event.at)}`}
                      onClick={() => setSelected(event.id)}
                    >
                      {look.icon}
                    </button>
                  </div>
                );
              })}
              {ticks.map((t) => (
                <span
                  key={t.label}
                  className="absolute -translate-x-1/2 whitespace-nowrap text-[0.6875rem] text-faint"
                  style={{ left: `${t.x}%`, top: 28 * rows + 12 }}
                >
                  {t.label}
                </span>
              ))}
              {!closed && (
                <span className="absolute right-0 whitespace-nowrap text-[0.6875rem] text-faint" style={{ top: 28 * rows + 12 }}>
                  Now
                </span>
              )}
            </div>
          </div>

          {active && (
            <div key={active.id} className="anim-fade mt-3 rounded-[10px] bg-fg/[0.03] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`grid h-5 w-5 place-items-center rounded-full border ${lookOf(active).tone}`}>{lookOf(active).icon}</span>
                <span className="font-medium">{active.meeting_title && active.type === "note" ? `From ${active.meeting_title}` : active.title}</span>
                <span className="tabular text-xs text-faint">{timestamp(active.at)}</span>
                <span className="truncate text-xs text-faint">· {active.source}</span>
                {active.meeting_id && (
                  <button type="button" className="btn btn-quiet btn-xs ml-auto" onClick={() => openMeeting(active.meeting_id!)}>
                    <CalendarClock size={12} /> Open meeting
                  </button>
                )}
              </div>
              {active.detail && withoutImages(active.detail) && (
                <p className="mt-1.5 whitespace-pre-wrap break-words pl-7 text-sm">{plainMentions(withoutImages(active.detail))}</p>
              )}
              <ImageStrip text={active.detail} className="mt-2 pl-7" />
            </div>
          )}

          <button type="button" className="btn btn-quiet btn-xs -ml-2 mt-3" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            <ChevronRight size={13} className={`transition-transform duration-200 ease-out ${showAll ? "rotate-90" : ""}`} />
            All events
          </button>
          {showAll && (
            <ol className="anim-rise mt-2 space-y-2.5 border-l border-edge pl-4">
              {[...events].reverse().map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[26px] top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border ${lookOf(e).tone}`}>
                    {lookOf(e).icon}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-faint">
                    <span className="font-medium text-muted">{e.title}</span>
                    <span className="tabular">{timestamp(e.at)}</span>
                    <span className="truncate">{e.source}</span>
                  </div>
                  {e.detail && withoutImages(e.detail) && (
                    <p className="whitespace-pre-wrap break-words text-sm">{plainMentions(withoutImages(e.detail))}</p>
                  )}
                  <ImageStrip text={e.detail} className="mt-1.5" />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function Legend() {
  const items: [TimelineEvent["type"], string][] = [
    ["meeting", "Meeting"],
    ["status", "Status"],
    ["subtask_done", "Subtask done"],
    ["note", "Note"],
    ["completed", "Completed"],
  ];
  return (
    <div className="ml-auto hidden flex-wrap items-center gap-3 text-[0.6875rem] text-faint md:flex">
      {items.map(([type, label]) => (
        <span key={type} className="inline-flex items-center gap-1">
          <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${LOOK[type].tone}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

function LogProgress({ task }: { task: Task }) {
  const { note } = useTaskMutations();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const mention = useAutocomplete<HTMLTextAreaElement>({ value: draft, onChange: setDraft, provider: useMentionProvider(), ref: field });
  const images = useImagePaste({ ref: field, value: draft, onChange: setDraft });
  const submit = () => {
    if (!draft.trim() || images.uploading) return;
    note.mutate({ id: task.id, body: draft.trim() }, { onSuccess: () => setDraft(""), onError: (e) => toast(e.message, "error") });
  };
  return (
    <div className="flex gap-2">
      <textarea
        {...mention.bind}
        {...images.handlers}
        className="field min-h-[36px] flex-1 resize-y"
        rows={1}
        placeholder="Log progress…  (@ to mention · paste a screenshot · Ctrl+Enter)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          mention.onKeyDown(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      {mention.popup}
      <button type="button" className="btn btn-ghost" disabled={!draft.trim() || note.isPending || images.uploading} onClick={submit}>
        Add
      </button>
    </div>
  );
}
