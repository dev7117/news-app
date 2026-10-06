import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useOpenMeeting } from "../MeetingDialog";
import { hueFor } from "../CustomerArt";
import { type Meeting, type Task, useMeetingsBetween } from "../../lib/api";
import { todayIso } from "../../lib/format";
import { usePersisted } from "../../lib/usePersisted";

const HEIGHT = 240; // px for the hour grid: a full week of meetings fits without scrolling the page

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hourOf = (m: Meeting) => {
  const d = new Date(m.starts_at!);
  return d.getHours() + d.getMinutes() / 60;
};
const endOf = (m: Meeting) => {
  if (m.ends_at) {
    const d = new Date(m.ends_at);
    return d.getHours() + d.getMinutes() / 60;
  }
  return hourOf(m) + 0.5;
};
const time = (m: Meeting) => new Date(m.starts_at!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** "9:00", "1:15": compact start time for inside a block. */
const shortTime = (m: Meeting) => {
  const d = new Date(m.starts_at!);
  return `${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, "0")}`;
};

interface Placed {
  meeting: Meeting;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** Side-by-side lanes for overlapping meetings within a day. */
function layout(meetings: Meeting[], start: number, pph: number): Placed[] {
  const timed = meetings.filter((m) => m.starts_at).sort((a, b) => hourOf(a) - hourOf(b));
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    cluster.forEach((p) => (p.lanes = lanes));
    cluster = [];
    laneEnds.length = 0;
  };
  for (const m of timed) {
    const s = hourOf(m);
    const e = Math.max(endOf(m), s + 0.25);
    if (s >= clusterEnd) close();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e;
    clusterEnd = Math.max(clusterEnd, e);
    const p = { meeting: m, top: (s - start) * pph + 1, height: Math.max(11, (e - s) * pph - 2), lane, lanes: 1 };
    cluster.push(p);
    placed.push(p);
  }
  close();
  return placed;
}

/** Re-render every minute, for "now" markers. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** The calendar at the bottom of Today: a day view (your day as a progress track) or the
    week grid. Mode and collapsed state are kept per browser. */
export default function Calendar({ tasks }: { tasks: Task[] }) {
  const [mode, setMode] = usePersisted<"day" | "week">("todo-calendar-mode", "day");
  const [collapsed, setCollapsed] = usePersisted("todo-week-collapsed", false);
  const [dayOffset, setDayOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const offset = mode === "day" ? dayOffset : weekOffset;
  const setOffset = mode === "day" ? setDayOffset : setWeekOffset;
  const now = useNow();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  const { data: dayMeetings = [] } = useMeetingsBetween(iso(day), iso(day));
  const week = useWeek(weekOffset);
  const { data: weekMeetings = [] } = useMeetingsBetween(iso(week[0]), iso(week[6]));
  const meetings = mode === "day" ? dayMeetings : weekMeetings;

  const title =
    mode === "day"
      ? dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : dayOffset === -1 ? "Yesterday" : day.toLocaleDateString(undefined, { weekday: "long" })
      : weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : weekOffset === -1 ? "Last week" : "Week";
  const label =
    mode === "day"
      ? day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
      : week[0].toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " – " +
        week[6].toLocaleDateString(undefined, { month: week[0].getMonth() === week[6].getMonth() ? undefined : "short", day: "numeric" });

  return (
    <section className="well overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button type="button" className="flex items-center gap-2 text-left" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <ChevronRight size={14} className={`text-faint transition-transform duration-200 ease-out ${collapsed ? "" : "rotate-90"}`} />
          <CalendarDays size={15} className="text-muted" />
          <span className="section-title">{title}</span>
          <span className="text-sm text-muted">{label}</span>
          <span className="tabular text-xs text-faint">
            {meetings.length} meeting{meetings.length === 1 ? "" : "s"}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="segmented" role="group" aria-label="Calendar view">
            {(["day", "week"] as const).map((m) => (
              <button key={m} type="button" className="filter-tab h-6 px-2 text-xs capitalize" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
          {offset !== 0 && (
            <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOffset(0)}>
              {mode === "day" ? "Today" : "This week"}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label={`Previous ${mode}`} onClick={() => setOffset(offset - 1)}>
            <ChevronLeft size={14} />
          </button>
          <button type="button" className="btn btn-quiet btn-xs btn-icon w-[26px]" aria-label={`Next ${mode}`} onClick={() => setOffset(offset + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </header>
      {!collapsed &&
        (mode === "day" ? (
          <DayTrack day={day} meetings={dayMeetings} now={now} dueCount={tasks.filter((t) => t.due_on === iso(day)).length} />
        ) : (
          <WeekGrid days={week} meetings={weekMeetings} tasks={tasks} now={now} />
        ))}
    </section>
  );
}

function useWeek(offset: number) {
  return useMemo(() => {
    const d = new Date();
    const back = (d.getDay() + 6) % 7;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back + offset * 7);
    return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }, [offset]);
}

/** The week: a column per weekday (weekends when used), meetings at their times. */
function WeekGrid({ days, meetings, tasks, now }: { days: Date[]; meetings: Meeting[]; tasks: Task[]; now: Date }) {
  const openMeeting = useOpenMeeting();

  const today = todayIso();

  const byDay = new Map<string, Meeting[]>();
  for (const m of meetings) byDay.set(m.held_on, [...(byDay.get(m.held_on) ?? []), m]);
  const dueByDay = new Map<string, Task[]>();
  for (const t of tasks) if (t.due_on) dueByDay.set(t.due_on, [...(dueByDay.get(t.due_on) ?? []), t]);
  // Weekends only when something's on them.
  const shown = days.filter((d, i) => i < 5 || byDay.has(iso(d)) || dueByDay.has(iso(d)));

  const timed = meetings.filter((m) => m.starts_at);
  const first = Math.min(8, ...timed.map((m) => Math.floor(hourOf(m))));
  const last = Math.max(18, ...timed.map((m) => Math.ceil(endOf(m))));
  const startHour = Math.max(0, first);
  const endHour = Math.min(24, last);
  const pph = HEIGHT / (endHour - startHour);
  const start = iso(days[0]);
  // Gridlines every 2 hours; no label on the bottom edge (it would hang off the grid).
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).filter((h) => (h - startHour) % 2 === 0);
  const labelled = hours.filter((h) => h < endHour);
  const nowHour = now.getHours() + now.getMinutes() / 60;
  return (
    <>
      {(
        <div key={start} className="overflow-x-auto overflow-y-hidden border-t border-edge">
          <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `40px repeat(${shown.length}, minmax(0, 1fr))` }}>
            {/* day headers */}
            <div />
            {shown.map((d) => {
              const key = iso(d);
              const due = dueByDay.get(key) ?? [];
              const isToday = key === today;
              return (
                <div key={key} className={`border-l border-edge px-2 py-1.5 ${isToday ? "bg-accent/[0.06]" : ""}`}>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xs ${isToday ? "font-semibold text-accent" : "text-muted"}`}>
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className={`tabular text-sm ${isToday ? "font-semibold text-accent" : ""}`}>{d.getDate()}</span>
                    {due.length > 0 && (
                      <span className="tag tag-warning ml-auto h-4 min-h-0 px-1.5 py-0 text-[0.625rem]" title={due.map((t) => t.title).join("\n")}>
                        {due.length} due
                      </span>
                    )}
                  </div>
                  {/* meetings with no time (recaps logged by date) */}
                  {(byDay.get(key) ?? []).filter((m) => !m.starts_at).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="cal-block mt-1 block w-full truncate rounded px-1.5 text-left text-[0.6875rem] leading-4"
                      style={{ "--h": hueFor(m.customer) } as React.CSSProperties}
                      data-held={m.status === "held" || undefined}
                      title={`${m.customer} · ${m.title}`}
                      onClick={() => openMeeting(m.id)}
                    >
                      {m.customer}
                    </button>
                  ))}
                </div>
              );
            })}

            {/* hour gutter */}
            <div className="relative border-t border-edge" style={{ height: HEIGHT }}>
              {labelled.map((h) => (
                <span key={h} className="absolute right-1.5 text-[0.625rem] leading-none tabular text-faint" style={{ top: (h - startHour) * pph + 2 }}>
                  {h === 0 || h === 24 ? "" : h <= 12 ? `${h}${h === 12 ? "p" : "a"}` : `${h - 12}p`}
                </span>
              ))}
            </div>

            {/* day columns */}
            {shown.map((d) => {
              const key = iso(d);
              const isToday = key === today;
              const placed = layout(byDay.get(key) ?? [], startHour, pph);
              return (
                <div key={key} className={`relative border-l border-t border-edge ${isToday ? "bg-accent/[0.04]" : ""}`} style={{ height: HEIGHT }}>
                  {hours.map((h) => (
                    <span key={h} className="absolute inset-x-0 border-t border-dashed border-[color:var(--edge)]" style={{ top: (h - startHour) * pph }} />
                  ))}
                  {isToday && nowHour >= startHour && nowHour <= endHour && (
                    <span className="absolute inset-x-0 z-10 border-t-2 border-danger/70" style={{ top: (nowHour - startHour) * pph }} aria-hidden="true">
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-danger/80" />
                    </span>
                  )}
                  {placed.map(({ meeting: m, top, height, lane, lanes }) => (
                    <button
                      key={m.id}
                      type="button"
                      className="cal-block absolute overflow-hidden whitespace-nowrap rounded px-1 text-left text-[0.65rem] leading-[11px] transition-[filter] hover:brightness-95 focus-visible:z-20"
                      style={{
                        "--h": hueFor(m.customer),
                        top,
                        height,
                        left: `calc(${(100 * lane) / lanes}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      } as React.CSSProperties}
                      data-held={m.status === "held" || undefined}
                      title={`${time(m)} · ${m.customer} · ${m.title}${m.status === "scheduled" ? (m.prep ? " · prep ready" : " · no prep yet") : " · recap"}`}
                      onClick={() => openMeeting(m.id)}
                    >
                      <span className="tabular opacity-75">{shortTime(m)} </span>
                      <span className="font-medium">{m.customer}</span>
                      {height > 26 && <span className="block truncate opacity-80">{m.title}</span>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

const fmtHour = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const base = `${((hh + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
  return base + (hh < 12 || hh === 24 ? "a" : "p");
};

const until = (minutes: number) =>
  minutes < 60 ? `${Math.max(1, Math.round(minutes))}m` : `${Math.floor(minutes / 60)}h${minutes % 60 >= 5 ? ` ${Math.round(minutes % 60)}m` : ""}`;

/** One day as a horizontal track: meetings at their times above a progress bar that fills
    from the start of the day to now, like the task timeline but for the clock. */
function DayTrack({ day, meetings, now, dueCount }: { day: Date; meetings: Meeting[]; now: Date; dueCount: number }) {
  const openMeeting = useOpenMeeting();
  const timed = meetings.filter((m) => m.starts_at).sort((a, b) => hourOf(a) - hourOf(b));
  const untimed = meetings.filter((m) => !m.starts_at);
  const startHour = Math.max(0, Math.min(8, ...timed.map((m) => Math.floor(hourOf(m)))));
  const endHour = Math.min(24, Math.max(18, ...timed.map((m) => Math.ceil(endOf(m)))));
  const span = endHour - startHour;
  const x = (h: number) => `${(100 * Math.min(Math.max(h - startHour, 0), span)) / span}%`;

  const isToday = iso(day) === iso(now);
  const isPast = !isToday && day < now;
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const progress = isToday ? Math.min(Math.max((nowHour - startHour) / span, 0), 1) : isPast ? 1 : 0;

  // Rows for overlapping meetings. A block is drawn wide enough for its time and customer to
  // read, so rows are laid out by that drawn width, not the meeting's real length.
  const MIN_DRAWN = Math.max(1.5, span / 7);
  const rowEnds: number[] = [];
  const placed = timed.map((m) => {
    const s = hourOf(m);
    const e = Math.max(endOf(m), s + 0.25);
    const drawnEnd = Math.min(Math.max(e, s + MIN_DRAWN), endHour);
    let row = rowEnds.findIndex((end) => end <= s + 0.01);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = drawnEnd;
    const state = !isToday ? (isPast ? "past" : "future") : e <= nowHour ? "past" : s <= nowHour ? "current" : "future";
    return { m, s, e, drawnEnd, row, state };
  });
  const rows = Math.max(1, rowEnds.length);

  const current = placed.find((p) => p.state === "current");
  const next = placed.find((p) => p.state === "future");
  const doneCount = placed.filter((p) => p.state === "past").length;
  const status = !isToday
    ? `${timed.length} meeting${timed.length === 1 ? "" : "s"}${dueCount ? ` · ${dueCount} task${dueCount === 1 ? "" : "s"} due` : ""}`
    : current
      ? `In ${current.m.customer} · ${current.m.title} · ends ${fmtHour(current.e)}`
      : next
        ? `Next: ${shortTime(next.m)} ${next.m.customer} in ${until((next.s - nowHour) * 60)}`
        : nowHour >= endHour
          ? "Day's done"
          : "No more meetings today";
  const ticks = Array.from({ length: span + 1 }, (_, i) => startHour + i);

  return (
    <div className="border-t border-edge px-4 pb-4 pt-3">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">{status}</span>
        {isToday && timed.length > 0 && (
          <span className="tabular text-xs text-faint">
            {doneCount} of {timed.length} done{dueCount ? ` · ${dueCount} task${dueCount === 1 ? "" : "s"} due today` : ""}
          </span>
        )}
        {untimed.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {untimed.map((m) => (
              <button key={m.id} type="button" className="tag hover:text-fg" onClick={() => openMeeting(m.id)}>
                {m.customer} · {m.title}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="overflow-x-auto overflow-y-hidden pb-1">
        <div className="relative min-w-[560px]">
          {/* meetings, in rows above the track */}
          <div className="relative" style={{ height: rows * 30 }}>
            {placed.map(({ m, s, drawnEnd, row, state }) => (
              <button
                key={m.id}
                type="button"
                className={`cal-block absolute flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-[6px] px-1.5 text-left text-[0.6875rem] transition-[opacity,filter] hover:brightness-95 ${
                  state === "past" ? "opacity-45" : ""
                } ${state === "current" ? "ring-2 ring-accent ring-offset-1 ring-offset-[rgb(var(--c-tile))]" : ""}`}
                style={{
                  "--h": hueFor(m.customer),
                  left: `calc(${x(s)} + 1px)`,
                  width: `calc(${(100 * (drawnEnd - s)) / span}% - 2px)`,
                  top: row * 30,
                  height: 26,
                } as React.CSSProperties}
                title={`${time(m)} · ${m.customer} · ${m.title}${m.status === "scheduled" ? (m.prep ? " · prep ready" : " · no prep yet") : " · recap"}`}
                onClick={() => openMeeting(m.id)}
              >
                <span className="shrink-0 tabular opacity-75">{shortTime(m)}</span>
                <span className="shrink-0 font-medium">{m.customer}</span>
                <span className="min-w-0 truncate opacity-70">· {m.title}</span>
              </button>
            ))}
            {timed.length === 0 && <p className="pt-1.5 text-sm text-faint">No meetings{isToday ? " today" : ""}.</p>}
          </div>

          {/* the day's progress */}
          <div className="relative mt-2 h-2 rounded-full bg-fg/[0.08]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-accent/70 transition-[width] duration-700 ease-out"
              style={{ width: `${progress * 100}%` }}
              role="progressbar"
              aria-label="How far through the day"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
            {placed.map(({ m, s }) => (
              <span key={m.id} className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-tile" style={{ left: x(s) }} />
            ))}
            {isToday && progress > 0 && progress < 1 && (
              <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${progress * 100}%` }}>
                <span className="block h-3.5 w-3.5 rounded-full border-2 border-tile bg-accent shadow" />
              </span>
            )}
          </div>

          {/* hour ticks, and now */}
          <div className="relative mt-1.5 h-4">
            {ticks.map((h) => (
              <span
                key={h}
                className={`absolute text-[0.625rem] tabular ${
                  h === startHour ? "" : h === endHour ? "-translate-x-full" : "-translate-x-1/2"
                } ${isToday && h <= nowHour ? "text-muted" : "text-faint"}`}
                style={{ left: x(h) }}
              >
                {(h - startHour) % (span > 12 ? 2 : 1) === 0 ? fmtHour(h) : ""}
              </span>
            ))}
            {isToday && progress > 0 && progress < 1 && (
              <span
                className={`absolute rounded bg-accent px-1 text-[0.625rem] font-medium leading-4 text-accent-ink ${
                  progress < 0.05 ? "" : progress > 0.95 ? "-translate-x-full" : "-translate-x-1/2"
                }`}
                style={{ left: `${progress * 100}%`, top: 0 }}
              >
                {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
