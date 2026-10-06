import type { CadenceSchedule } from "../../lib/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// cron day-of-week numbers for Mon…Sun
const CRON_DOW = [1, 2, 3, 4, 5, 6, 0];
const NTH = [
  { v: 1, label: "1st" },
  { v: 2, label: "2nd" },
  { v: 3, label: "3rd" },
  { v: 4, label: "4th" },
  { v: -1, label: "Last" },
];

type Mode = "weekly" | "monthly" | "calendar" | "cron";

/** A weekly schedule is just cron underneath ("0 9 * * 4"); read it back if it's that simple. */
function weekly(cron: string): { days: number[]; time: string } | null {
  const m = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* ([\d,]+)$/);
  if (!m) return null;
  const days = m[3].split(",").map((d) => CRON_DOW.indexOf(Number(d) % 7)).filter((d) => d >= 0);
  return { days, time: `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}` };
}

export function modeOf(s: CadenceSchedule): Mode {
  if ("calendar" in s) return "calendar";
  if ("nth" in s) return "monthly";
  return weekly(s.cron) ? "weekly" : "cron";
}

/** Weekly (days + time), monthly (nth weekday), follow the calendar, or raw cron. */
export default function SchedulePicker({ value, onChange }: { value: CadenceSchedule; onChange: (s: CadenceSchedule) => void }) {
  const mode = modeOf(value);
  const week = "cron" in value ? weekly(value.cron) : null;
  const setWeekly = (days: number[], time: string) => {
    const [h, m] = time.split(":").map(Number);
    const dows = [...days].sort().map((d) => CRON_DOW[d]);
    onChange({ cron: `${m || 0} ${h || 0} * * ${dows.length ? dows.join(",") : "1"}` });
  };
  const switchTo = (next: Mode) => {
    if (next === mode) return;
    if (next === "weekly") onChange({ cron: "0 9 * * 4" });
    if (next === "monthly") onChange({ nth: 1, weekday: 1, time: "10:00" });
    if (next === "calendar") onChange({ calendar: "" });
    if (next === "cron") onChange({ cron: "cron" in value ? value.cron : "0 9 * * 1" });
  };

  return (
    <div className="space-y-3">
      <div className="segmented w-full">
        {(
          [
            ["weekly", "Weekly"],
            ["monthly", "Monthly"],
            ["calendar", "From calendar"],
            ["cron", "Cron"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className="filter-tab flex-1" aria-pressed={mode === id} onClick={() => switchTo(id)}>
            {label}
          </button>
        ))}
      </div>

      {mode === "weekly" && week && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                className={`btn btn-xs ${week.days.includes(i) ? "btn-primary" : "btn-ghost"}`}
                aria-pressed={week.days.includes(i)}
                onClick={() => {
                  const days = week.days.includes(i) ? week.days.filter((x) => x !== i) : [...week.days, i];
                  if (days.length) setWeekly(days, week.time);
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">at</span>
          <input type="time" className="field field-sm w-[120px]" value={week.time} onChange={(e) => setWeekly(week.days, e.target.value)} />
        </div>
      )}

      {mode === "monthly" && "nth" in value && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">The</span>
          <select className="field field-sm w-[90px]" value={value.nth} onChange={(e) => onChange({ ...value, nth: Number(e.target.value) })}>
            {NTH.map((n) => (
              <option key={n.v} value={n.v}>
                {n.label}
              </option>
            ))}
          </select>
          <select className="field field-sm w-[130px]" value={value.weekday} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i]}
              </option>
            ))}
          </select>
          <span className="text-muted">of the month at</span>
          <input type="time" className="field field-sm w-[120px]" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
        </div>
      )}

      {mode === "calendar" && "calendar" in value && (
        <label className="block">
          <input
            className="field w-full"
            placeholder="Text in the meeting's title, e.g. Weekly Ops"
            value={value.calendar}
            onChange={(e) => onChange({ calendar: e.target.value })}
          />
          <span className="mt-1 block text-xs text-faint">Uses this customer's meetings synced from your calendar whose title contains this.</span>
        </label>
      )}

      {mode === "cron" && "cron" in value && (
        <label className="block">
          <input className="field w-full font-mono" value={value.cron} onChange={(e) => onChange({ cron: e.target.value })} />
          <span className="mt-1 block text-xs text-faint">minute hour day-of-month month day-of-week, in your time zone. e.g. 30 8 * * 1-5</span>
        </label>
      )}
    </div>
  );
}
