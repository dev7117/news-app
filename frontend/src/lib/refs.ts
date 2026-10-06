/** A source ref (gmail:<thread>, jira:ACME-7, gcal:<event>#item…) as a short label. */
export function refLabel(ref: string): { kind: string; id: string } {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  const KIND: Record<string, string> = { gmail: "Gmail", gcal: "Calendar", jira: "Jira", slack: "Slack", teams: "Teams" };
  const label = KIND[kind] ?? kind;
  if (kind === "jira") return { kind: label, id };
  if (kind === "gcal") return { kind: label, id: id.includes("#") ? id.split("#")[1].replace(/-/g, " ") : "event" };
  if (kind === "gmail") return { kind: label, id: "thread" };
  if (kind === "slack" || kind === "teams") return { kind: label, id: "thread" };
  return { kind: label, id: id.length > 18 ? `${id.slice(0, 16)}…` : id };
}
