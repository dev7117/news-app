/** Dates arrive as YYYY-MM-DD (local) or ISO timestamps (UTC). */

const DAY = 86_400_000;

function localDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** "Today", "Tomorrow", "Fri", "Oct 31", "Yesterday", "3 days ago". */
export function relativeDay(iso: string) {
  const diff = Math.round((localDate(iso).getTime() - startOfToday().getTime()) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return localDate(iso).toLocaleDateString(undefined, { weekday: "short" });
  if (diff < 0 && diff > -7) return `${-diff} days ago`;
  return localDate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: localDate(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** For a carried-over today flag: "since Thu". Empty when it was set today. */
export function carriedSince(todayOn: string | null) {
  if (!todayOn) return "";
  const diff = Math.round((startOfToday().getTime() - localDate(todayOn).getTime()) / DAY);
  if (diff <= 0) return "";
  if (diff === 1) return "since yesterday";
  if (diff < 7) return `since ${localDate(todayOn).toLocaleDateString(undefined, { weekday: "short" })}`;
  return `${diff} days`;
}

export function timestamp(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " · " +
        d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Due today", "Due Fri", "Due Oct 31", "Overdue · Yesterday". */
export function dueLabel(dueOn: string, overdue: boolean) {
  const day = relativeDay(dueOn);
  if (overdue) return `Overdue · ${day}`;
  return `Due ${day === "Today" || day === "Tomorrow" ? day.toLowerCase() : day}`;
}

/** "Tue, Oct 6 · 2:00 PM" for a scheduled meeting, "Tue, Oct 6" when there's no time. */
export function meetingWhen(m: { held_on: string; starts_at: string | null }) {
  const day = localDateLabel(m.held_on);
  if (!m.starts_at) return day;
  const time = new Date(m.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function localDateLabel(iso: string) {
  const rel = relativeDay(iso);
  if (rel === "Today" || rel === "Tomorrow" || rel === "Yesterday") return rel;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "3 days ago", "Oct 2", for a timestamp. */
export function ago(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
