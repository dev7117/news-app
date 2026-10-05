import { AlertTriangle, Briefcase, Calendar, Folder, House, Lightbulb, Play, Sun, UserRound } from "lucide-react";
import { type Person, type Project, useAllPeople, useProjects } from "../../lib/api";
import Avatar from "../people/Avatar";
import type { Provider, Suggestion } from "./useAutocomplete";

const slug = (name: string) => name.trim().replace(/\s+/g, "-");
const matches = (text: string, query: string) => {
  const q = query.toLowerCase().replace(/[-_.]/g, " ").trim();
  return !q || text.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || text.toLowerCase().startsWith(q);
};

function peopleSuggestions(people: Person[], query: string, insert: (p: Person) => string): Suggestion[] {
  return people
    .filter((p) => !p.archived && (matches(p.name, query) || (p.email ?? "").toLowerCase().startsWith(query.toLowerCase())))
    .map((p) => ({
      key: `person-${p.id}`,
      label: p.name,
      detail: p.customer ?? p.title,
      icon: <Avatar name={p.name} size={18} />,
      insert: insert(p),
    }));
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dateSuggestions(query: string): Suggestion[] {
  const today = new Date();
  const label = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const plus = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
  const options: [string, string, Date][] = [
    ["today", "Today", today],
    ["tomorrow", "Tomorrow", plus(1)],
    ...Array.from({ length: 6 }, (_, i) => {
      const d = plus(i + 2);
      const day = WEEKDAYS[d.getDay()];
      return [day, d.toLocaleDateString(undefined, { weekday: "long" }), d] as [string, string, Date];
    }),
    ["week", "Next week (Monday)", plus(((8 - today.getDay()) % 7) || 7)],
  ];
  return options
    .filter(([token, name]) => !query || token.startsWith(query.toLowerCase()) || name.toLowerCase().startsWith(query.toLowerCase()))
    .map(([token, name, d]) => ({ key: token, label: name, detail: label(d), icon: <Calendar size={14} />, insert: `^${token}` }));
}

const FLAGS: [string, string, React.ReactNode][] = [
  ["today", "Do it today", <Sun size={14} />],
  ["now", "Today, and in progress", <Play size={14} />],
  ["high", "High priority", <AlertTriangle size={14} />],
  ["med", "Medium priority", <AlertTriangle size={14} />],
  ["low", "Low priority", <AlertTriangle size={14} />],
  ["idea", "Save as an idea, not a task", <Lightbulb size={14} />],
];

/** Everything quick add understands: #project @follower/@area +assignee ^date !flag. */
export function useQuickAddProvider(): Provider {
  const { data: projects = [] } = useProjects();
  const { data: people = [] } = useAllPeople();
  return (trigger, query) => {
    switch (trigger) {
      case "#":
        return projects
          .filter((p: Project) => matches(p.name, query) || matches(p.customer ?? "", query))
          .map((p) => ({ key: `p${p.id}`, label: p.name, detail: p.customer ?? (p.area === "work" ? "Work" : "Personal"), icon: <Folder size={14} />, insert: `#${slug(p.name)}` }));
      case "@":
        return [
          ...(["work", "personal"] as const)
            .filter((a) => a.startsWith(query.toLowerCase()))
            .map((a) => ({ key: a, label: a === "work" ? "Work" : "Personal", detail: "area", icon: a === "work" ? <Briefcase size={14} /> : <House size={14} />, insert: `@${a}` })),
          ...peopleSuggestions(people, query, (p) => `@${slug(p.name)}`).map((s) => ({ ...s, detail: "follows it" })),
        ];
      case "+":
        return peopleSuggestions(people, query, (p) => `+${slug(p.name)}`).map((s) => ({ ...s, detail: "assign to", icon: s.icon ?? <UserRound size={14} /> }));
      case "^":
        return dateSuggestions(query);
      case "!":
        return FLAGS.filter(([k]) => k.startsWith(query.toLowerCase())).map(([k, label, icon]) => ({ key: k, label, detail: `!${k}`, icon, insert: `!${k}` }));
      default:
        return null;
    }
  };
}

/** @mentions in notes: inserts @[Name](#person-id), which links to them and makes them a follower. */
export function useMentionProvider(): Provider {
  const { data: people = [] } = useAllPeople();
  return (trigger, query) =>
    trigger === "@" ? peopleSuggestions(people, query, (p) => `@[${p.name}](#person-${p.id})`) : null;
}

/** "@[Priya Shah](#person-3)" → "@Priya Shah", for places that show plain text. */
export const plainMentions = (text: string) => text.replace(/@\[([^\]]+)\]\(#person-\d+\)/g, "@$1");
