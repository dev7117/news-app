import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocus } from "./focus";

export type Area = "work" | "personal";
export type Status = "inbox" | "todo" | "in_progress" | "waiting" | "done" | "cancelled";

export interface Task {
  id: number;
  title: string;
  notes: string;
  status: Status;
  area: Area;
  project_id: number | null;
  project: string | null;
  customer_id: number | null;
  customer: string | null;
  priority: 0 | 1 | 2 | 3;
  due_on: string | null;
  today: boolean;
  today_on: string | null;
  overdue: boolean;
  waiting_on: string | null;
  source: string;
  external_id: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  updates?: TaskUpdate[];
  meetings?: { id: number; title: string; held_on: string; action: string }[];
  score?: number;
}

export interface TaskUpdate {
  id: number;
  kind: "created" | "change" | "note";
  body: string;
  source: string;
  created_at: string;
}

export interface Customer {
  id: number;
  name: string;
  notes: string;
  website: string | null;
  logo: string | null;
  overview: string;
  overview_source: string | null;
  overview_updated_at: string | null;
  archived: boolean;
  project_count: number;
  meeting_count: number;
  last_meeting_on: string | null;
  last_task_activity: string | null;
  open_count: number;
  in_progress_count: number;
  waiting_count: number;
  overdue_count: number;
}

export interface Meeting {
  id: number;
  customer_id: number;
  customer: string;
  project_id: number | null;
  project: string | null;
  status: "scheduled" | "held" | "cancelled";
  title: string;
  held_on: string;
  starts_at: string | null;
  ends_at: string | null;
  calendar_id: string | null;
  location: string | null;
  attendees: string;
  prep: string;
  summary: string;
  decisions: string;
  external_url: string | null;
  source: string;
  task_count: number;
  tasks?: (Task & { action: string })[];
}

export interface Topic {
  id: number;
  name: string;
  summary: string;
  status: "active" | "watching" | "resolved";
  mentions: number;
  last_mentioned_on: string | null;
}

export interface CustomerLink {
  id: number;
  customer_id: number;
  kind: "link" | "launcher";
  label: string;
  url: string | null;
  command: string | null;
  cwd: string | null;
  mode: "terminal" | "background";
  agent: string | null;
}

export interface Agent {
  name: string;
  platform: "macos" | "linux" | string;
  version: string;
  last_seen: string;
  online: boolean;
}

export type RunStatus = "queued" | "claimed" | "running" | "succeeded" | "failed" | "declined" | "expired" | "cancelled";

export interface LauncherRun {
  id: number;
  link_id: number | null;
  customer_id: number | null;
  customer: string | null;
  agent: string;
  label: string;
  command: string;
  mode: "terminal" | "background";
  status: RunStatus;
  exit_code: number | null;
  output: string;
  error: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const ACTIVE_RUN: RunStatus[] = ["queued", "claimed", "running"];

export interface CustomerHub {
  customer: Customer;
  projects: Project[];
  topics: Topic[];
  upcoming: Meeting[];
  meetings: Meeting[];
  links: CustomerLink[];
  next_up: Task[];
  recently_closed: Task[];
  today: string;
}

export interface DiffLine {
  op: "+" | "-" | " ";
  field: string;
  text: string;
}

export interface Change {
  id: number;
  seq: number;
  action: "create" | "update" | "note" | "complete" | "add_link";
  task_id: number | null;
  task_title: string | null;
  payload: { fields?: Record<string, unknown>; note?: string | null; label?: string; url?: string; customer_id?: number };
  reason: string;
  status: "pending" | "applied" | "rejected" | "failed";
  result_id: number | null;
  error: string | null;
  stale: string[];
  lines: DiffLine[];
}

export interface Proposal {
  id: number;
  source: string;
  summary: string;
  meeting_id: number | null;
  meeting_title: string | null;
  meeting_on: string | null;
  customer_id: number | null;
  customer: string | null;
  status: "pending" | "applied" | "partial" | "rejected";
  created_by: string;
  created_at: string;
  decided_at: string | null;
  change_count: number;
  changes?: Change[];
}

export interface Project {
  id: number;
  name: string;
  area: Area;
  customer_id: number | null;
  customer: string | null;
  description: string;
  archived: boolean;
  open_count: number;
  overdue_count: number;
  closed_count: number;
}

export interface TodayView {
  date: string;
  open: Task[];
  done: Task[];
}

export interface Counts {
  inbox: number;
  in_progress: number;
  waiting: number;
  today: number;
  overdue: number;
  open: number;
  review: number;
}

export interface Settings {
  default_area: Area;
  review_claude_changes: boolean;
}

export interface Meta {
  areas: Area[];
  statuses: { id: Status; label: string; closed: boolean }[];
  settings: Settings;
  token_required: boolean;
}

export const STATUS_LABELS: Record<Status, string> = {
  inbox: "Inbox",
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};

export const PRIORITY_LABELS = ["None", "Low", "Medium", "High"] as const;

export const isClosed = (status: Status) => status === "done" || status === "cancelled";

export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = typeof body.detail === "string" ? body.detail : body.detail?.[0]?.msg ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    // Claude, scripts and the bar change tasks behind the app's back: refetch on focus.
    queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 },
  },
});

export interface TaskFilters {
  status?: Status[];
  area?: Area;
  project_id?: number;
  no_project?: boolean;
  customer_id?: number;
  no_customer?: boolean;
  include_closed?: boolean;
  closed_since?: string;
  limit?: number;
}

function qs(filters: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === false) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta"), staleTime: 60_000 });
// Every list-shaped query is scoped to the device's focus (lib/focus.tsx): in Work, nothing
// personal is fetched at all, and vice versa.
export const useCounts = () => {
  const { area } = useFocus();
  return useQuery({
    queryKey: ["counts", area],
    queryFn: () => api<Counts>(`/api/counts${qs({ area })}`),
    refetchInterval: 30_000,
  });
};
export const useToday = () => {
  const { area } = useFocus();
  return useQuery({
    queryKey: ["today", area],
    queryFn: () => api<TodayView>(`/api/today${qs({ area })}`),
    refetchInterval: 30_000,
  });
};
export const useTasks = (filters: TaskFilters) => {
  const { area } = useFocus();
  const scoped = { ...filters, area: area ?? filters.area };
  return useQuery({ queryKey: ["tasks", scoped], queryFn: () => api<Task[]>(`/api/tasks${qs({ ...scoped })}`) });
};
export const useSearch = (q: string, includeClosed: boolean) => {
  const { area } = useFocus();
  return useQuery({
    queryKey: ["search", q, includeClosed, area],
    queryFn: () => api<Task[]>(`/api/search${qs({ q, include_closed: includeClosed, area })}`),
    enabled: q.trim().length > 1,
    placeholderData: (previous) => previous,
  });
};
export const useTask = (id: number | null) =>
  useQuery({ queryKey: ["task", id], queryFn: () => api<Task>(`/api/tasks/${id}`), enabled: id !== null });
export const useProjects = (includeArchived = false) =>
  useQuery({
    queryKey: ["projects", includeArchived],
    queryFn: () => api<Project[]>(`/api/projects${qs({ include_archived: includeArchived })}`),
  });

export const useCustomers = (includeArchived = false) =>
  useQuery({
    queryKey: ["customers", includeArchived],
    queryFn: () => api<Customer[]>(`/api/customers${qs({ include_archived: includeArchived })}`),
  });

/** Every write can move a task between views, so refresh all task-shaped data. */
export function useInvalidate() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      ["today", "tasks", "task", "counts", "search", "projects", "customers", "hub", "meetings", "meeting", "proposals", "runs"].map((key) =>
        client.invalidateQueries({ queryKey: [key] })
      )
    );
}

export type TaskPatch = Partial<
  Pick<Task, "title" | "notes" | "status" | "area" | "project_id" | "priority" | "due_on" | "today" | "waiting_on" | "external_url">
> & { note?: string };

export function useTaskMutations() {
  const { area } = useFocus();
  const invalidate = useInvalidate();
  const client = useQueryClient();
  const onSuccess = () => invalidate();

  const patch = useMutation({
    mutationFn: ({ id, ...body }: TaskPatch & { id: number }) =>
      api<Task>(`/api/tasks/${id}`, { method: "PATCH", json: body }),
    onSuccess: (task) => {
      client.setQueryData(["task", task.id], task);
      return invalidate();
    },
  });
  const quick = useMutation({
    mutationFn: (body: { text: string; source?: string; notes?: string }) =>
      api<Task>("/api/tasks/quick", { method: "POST", json: { area, ...body } }),
    onSuccess,
  });
  const create = useMutation({
    mutationFn: (body: Partial<Task> & { title: string }) => api<Task>("/api/tasks", { method: "POST", json: body }),
    onSuccess,
  });
  const note = useMutation({
    mutationFn: ({ id, body, status }: { id: number; body: string; status?: Status }) =>
      api<Task>(`/api/tasks/${id}/updates`, { method: "POST", json: { body, status } }),
    onSuccess: (task) => {
      client.setQueryData(["task", task.id], task);
      return invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess,
  });
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api<unknown>("/api/today/order", { method: "PUT", json: { ids } }),
    onMutate: (ids) => {
      const view = client.getQueryData<TodayView>(["today", area]);
      if (view) {
        const byId = new Map(view.open.map((t) => [t.id, t]));
        client.setQueryData(["today", area], { ...view, open: ids.map((id) => byId.get(id)!).filter(Boolean) });
      }
    },
    onSuccess,
  });
  return { patch, quick, create, note, remove, reorder };
}

export function useProjectMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate();
  const create = useMutation({
    mutationFn: (body: { name: string; area: Area; customer?: string | number | null; description?: string }) =>
      api<Project>("/api/projects", { method: "POST", json: body }),
    onSuccess,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Omit<Project, "customer">> & { id: number; customer?: string | null }) =>
      api<Project>(`/api/projects/${id}`, { method: "PATCH", json: body }),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess,
  });
  return { create, update, remove };
}

export function useCustomerMutations() {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate();
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; name?: string; notes?: string; archived?: boolean }) =>
      api<Customer>(`/api/customers/${id}`, { method: "PATCH", json: body }),
    onSuccess,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<void>(`/api/customers/${id}`, { method: "DELETE" }),
    onSuccess,
  });
  return { update, remove };
}

export const useHub = (customerId: number) =>
  useQuery({ queryKey: ["hub", customerId], queryFn: () => api<CustomerHub>(`/api/customers/${customerId}/hub`) });
export const useMeetings = (customerId: number) =>
  useQuery({ queryKey: ["meetings", customerId], queryFn: () => api<Meeting[]>(`/api/customers/${customerId}/meetings`) });
export const useMeeting = (id: number | null) =>
  useQuery({ queryKey: ["meeting", id], queryFn: () => api<Meeting>(`/api/meetings/${id}`), enabled: id !== null });
export const useUpcoming = (days = 7) => {
  const { area } = useFocus();
  return useQuery({
    queryKey: ["meetings", "upcoming", days, area],
    queryFn: () => api<Meeting[]>(`/api/meetings/upcoming${qs({ days, area })}`),
    refetchInterval: 60_000,
  });
};
export const useProposals = (status?: Proposal["status"]) => {
  const { area } = useFocus();
  return useQuery({
    queryKey: ["proposals", status ?? "all", area],
    queryFn: () => api<Proposal[]>(`/api/proposals${qs({ status, area })}`),
    refetchInterval: 30_000,
  });
};
export const useProposal = (id: number) =>
  useQuery({ queryKey: ["proposals", "one", id], queryFn: () => api<Proposal>(`/api/proposals/${id}`) });

export const logoUrl = (c: Pick<Customer, "id" | "logo">) => (c.logo ? `/api/customers/${c.id}/logo?v=${c.logo}` : null);

export function useHubMutations(customerId: number) {
  const invalidate = useInvalidate();
  const onSuccess = () => invalidate();
  const base = `/api/customers/${customerId}`;
  return {
    updateCustomer: useMutation({
      mutationFn: (body: Partial<Pick<Customer, "name" | "notes" | "website" | "overview" | "archived">>) =>
        api<Customer>(base, { method: "PATCH", json: body }),
      onSuccess,
    }),
    uploadLogo: useMutation({
      mutationFn: (file: File) =>
        api<Customer>(`${base}/logo`, { method: "PUT", body: file, headers: { "Content-Type": file.type } }),
      onSuccess,
    }),
    fetchLogo: useMutation({ mutationFn: () => api<Customer>(`${base}/logo/fetch`, { method: "POST" }), onSuccess }),
    clearLogo: useMutation({ mutationFn: () => api<Customer>(`${base}/logo`, { method: "DELETE" }), onSuccess }),
    createMeeting: useMutation({
      mutationFn: (body: Partial<Meeting> & { title: string; held_on: string }) =>
        api<Meeting>(`${base}/meetings`, { method: "POST", json: body }),
      onSuccess,
    }),
    updateMeeting: useMutation({
      mutationFn: ({ id, ...body }: Partial<Meeting> & { id: number }) =>
        api<Meeting>(`/api/meetings/${id}`, { method: "PATCH", json: body }),
      onSuccess,
    }),
    deleteMeeting: useMutation({
      mutationFn: (id: number) => api<void>(`/api/meetings/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
    addTopic: useMutation({
      mutationFn: (body: { name: string; summary?: string; status?: Topic["status"] }) =>
        api<Topic[]>(`${base}/topics`, { method: "POST", json: body }),
      onSuccess,
    }),
    updateTopic: useMutation({
      mutationFn: ({ id, ...body }: Partial<Topic> & { id: number }) =>
        api<Topic>(`/api/topics/${id}`, { method: "PATCH", json: body }),
      onSuccess,
    }),
    deleteTopic: useMutation({
      mutationFn: (id: number) => api<void>(`/api/topics/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
    createLink: useMutation({
      mutationFn: (body: Omit<CustomerLink, "id" | "customer_id" | "agent"> & { agent?: string | null }) =>
        api<CustomerLink>(`${base}/links`, { method: "POST", json: body }),
      onSuccess,
    }),
    updateLink: useMutation({
      mutationFn: ({ id, ...body }: Partial<CustomerLink> & { id: number }) =>
        api<CustomerLink>(`/api/links/${id}`, { method: "PATCH", json: body }),
      onSuccess,
    }),
    deleteLink: useMutation({
      mutationFn: (id: number) => api<void>(`/api/links/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export function useDecideProposal() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, approve, edits }: { id: number; approve: number[] | "all" | "none"; edits?: Record<number, Record<string, unknown>> }) =>
      api<Proposal>(`/api/proposals/${id}/decide`, { method: "POST", json: { approve, edits: edits ?? {} } }),
    onSuccess: () => invalidate(),
  });
}

export function useCreateCustomer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; website?: string; notes?: string }) =>
      api<Customer>("/api/customers", { method: "POST", json: body }),
    onSuccess: () => invalidate(),
  });
}

export const useAgents = () =>
  useQuery({ queryKey: ["agents"], queryFn: () => api<Agent[]>("/api/agents"), refetchInterval: 15_000 });

/** A tool's recent runs; polls quickly while one is in flight. */
export const useLinkRuns = (linkId: number) =>
  useQuery({
    queryKey: ["runs", "link", linkId],
    queryFn: () => api<LauncherRun[]>(`/api/links/${linkId}/runs?limit=5`),
    refetchInterval: (query) => (query.state.data?.some((r) => ACTIVE_RUN.includes(r.status)) ? 2_000 : 30_000),
  });

export const useRun = (id: number | null) =>
  useQuery({
    queryKey: ["runs", "one", id],
    queryFn: () => api<LauncherRun>(`/api/runs/${id}`),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data && ACTIVE_RUN.includes(query.state.data.status) ? 1_500 : false),
  });

export function useRunMutations() {
  const client = useQueryClient();
  const onSuccess = () => client.invalidateQueries({ queryKey: ["runs"] });
  return {
    run: useMutation({
      mutationFn: ({ linkId, agent }: { linkId: number; agent?: string }) =>
        api<LauncherRun>(`/api/links/${linkId}/run`, { method: "POST", json: { agent: agent ?? null } }),
      onSuccess,
    }),
    cancel: useMutation({
      mutationFn: (id: number) => api<LauncherRun>(`/api/runs/${id}/cancel`, { method: "POST" }),
      onSuccess,
    }),
    removeAgent: useMutation({
      mutationFn: (name: string) => api<void>(`/api/agents/${encodeURIComponent(name)}`, { method: "DELETE" }),
      onSuccess: () => client.invalidateQueries({ queryKey: ["agents"] }),
    }),
  };
}
