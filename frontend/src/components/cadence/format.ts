import type { OccurrenceStatus } from "../../lib/api";

/** "Thu, Oct 8 · 9:00 AM" */
export function when(startsAt: string) {
  const d = new Date(startsAt);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** "in 3 days", "tomorrow", "in 2h", "today", "2 days ago" */
export function countdown(startsAt: string) {
  const ms = new Date(startsAt).getTime() - Date.now();
  const hours = ms / 3_600_000;
  if (hours < 0) return hours > -2 ? "now" : `${Math.round(-hours / 24) || 1} day${Math.round(-hours / 24) > 1 ? "s" : ""} ago`;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 12) return `in ${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return days <= 1 ? "tomorrow" : `in ${days} days`;
}

export const STATUS_LOOK: Record<OccurrenceStatus, { label: string; tag: string }> = {
  upcoming: { label: "Prepping", tag: "tag-warning" },
  ready: { label: "Ready", tag: "tag-success" },
  held: { label: "Held", tag: "" },
  skipped: { label: "Skipped", tag: "" },
};
