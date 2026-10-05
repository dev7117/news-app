import { useState } from "react";
import { CalendarClock, ExternalLink, Pencil, Trash2, Users, Video } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import Modal from "./Modal";
import Markdown from "./Markdown";
import TaskRow from "./TaskRow";
import { type Meeting, useHubMutations, useMeeting } from "../lib/api";
import { meetingWhen, todayIso } from "../lib/format";
import { useToast } from "../hooks/useToast";

export function useOpenMeeting() {
  const [params, setParams] = useSearchParams();
  return (id: number) => {
    const next = new URLSearchParams(params);
    next.set("meeting", String(id));
    setParams(next);
  };
}

/** ?meeting=<id> anywhere opens it. */
export function MeetingFromUrl() {
  const [params, setParams] = useSearchParams();
  const id = Number(params.get("meeting"));
  if (!id) return null;
  return (
    <MeetingDialog
      meetingId={id}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("meeting");
        setParams(next);
      }}
    />
  );
}

function MeetingDialog({ meetingId, onClose }: { meetingId: number; onClose: () => void }) {
  const { data: meeting, error } = useMeeting(meetingId);
  return (
    <Modal title={meeting ? meeting.title : "Meeting"} onClose={onClose} wide>
      {error ? <p className="text-muted">{error.message}</p> : !meeting ? <div className="h-64" /> : <MeetingView meeting={meeting} onDeleted={onClose} />}
    </Modal>
  );
}

function MeetingView({ meeting, onDeleted }: { meeting: Meeting; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const scheduled = meeting.status === "scheduled";
  if (editing) return <MeetingForm customerId={meeting.customer_id} meeting={meeting} onDone={() => setEditing(false)} />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock size={14} /> {meetingWhen(meeting)}
        </span>
        {scheduled && <span className="tag tag-accent">Upcoming</span>}
        {meeting.status === "cancelled" && <span className="tag">Cancelled</span>}
        {meeting.project && <span className="tag">{meeting.project}</span>}
        {meeting.location && (
          <a
            href={meeting.location.startsWith("http") ? meeting.location : undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-fg"
          >
            <Video size={14} /> {meeting.location.startsWith("http") ? "Join" : meeting.location}
          </a>
        )}
        {meeting.external_url && (
          <a href={meeting.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
            <ExternalLink size={14} /> Notes / recording
          </a>
        )}
        <div className="ml-auto flex gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </button>
          <DeleteMeeting meeting={meeting} onDeleted={onDeleted} />
        </div>
      </div>
      {meeting.attendees && (
        <p className="flex items-start gap-1.5 text-sm text-muted">
          <Users size={14} className="mt-[3px] shrink-0" /> {meeting.attendees}
        </p>
      )}

      {(scheduled || meeting.prep) && (
        <Section title="Prep">
          {meeting.prep ? (
            <Markdown>{meeting.prep}</Markdown>
          ) : (
            <p className="text-sm text-faint">No prep yet. Claude writes it when it syncs your calendar.</p>
          )}
        </Section>
      )}
      {!scheduled && (
        <Section title="Recap">
          {meeting.summary ? <Markdown>{meeting.summary}</Markdown> : <p className="text-sm text-faint">No recap yet.</p>}
        </Section>
      )}
      {meeting.decisions && (
        <Section title="Decisions">
          <Markdown>{meeting.decisions}</Markdown>
        </Section>
      )}
      {!!meeting.tasks?.length && (
        <Section title="Tasks from this meeting">
          <div className="-mx-3">
            {meeting.tasks.map((task) => (
              <div key={task.id} className="relative">
                <TaskRow task={task} />
                <span className="pointer-events-none absolute right-24 top-1/2 hidden -translate-y-1/2 text-xs text-faint sm:block">
                  {task.action === "create" ? "created" : task.action === "complete" ? "completed" : "updated"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function DeleteMeeting({ meeting, onDeleted }: { meeting: Meeting; onDeleted: () => void }) {
  const { deleteMeeting } = useHubMutations(meeting.customer_id);
  const [confirm, setConfirm] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          window.setTimeout(() => setConfirm(false), 3000);
          return;
        }
        deleteMeeting.mutate(meeting.id, { onSuccess: onDeleted });
      }}
    >
      <Trash2 size={14} /> {confirm ? "Click again" : "Delete"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-2">{title}</h3>
      {children}
    </section>
  );
}

/** Create (no meeting) or edit a meeting's recap/prep by hand. */
export function MeetingForm({
  customerId,
  meeting,
  onDone,
}: {
  customerId: number;
  meeting?: Meeting;
  onDone: (meeting?: Meeting) => void;
}) {
  const { createMeeting, updateMeeting } = useHubMutations(customerId);
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: meeting?.title ?? "",
    held_on: meeting?.held_on ?? todayIso(),
    attendees: meeting?.attendees ?? "",
    prep: meeting?.prep ?? "",
    summary: meeting?.summary ?? "",
    decisions: meeting?.decisions ?? "",
    external_url: meeting?.external_url ?? "",
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [key]: e.target.value });
  const scheduled = meeting?.status === "scheduled";

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const done = {
          onSuccess: (saved: Meeting) => {
            toast(meeting ? "Meeting saved" : "Meeting logged", "success");
            onDone(saved);
          },
          onError: (error: Error) => toast(error.message, "error"),
        };
        if (meeting) updateMeeting.mutate({ id: meeting.id, ...form }, done);
        else createMeeting.mutate(form, done);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <label className="block">
          <span className="eyebrow mb-1.5 block">Title</span>
          <input className="field w-full" value={form.title} onChange={set("title")} required autoFocus={!meeting} />
        </label>
        <label className="block">
          <span className="eyebrow mb-1.5 block">Date</span>
          <input type="date" className="field w-full" value={form.held_on} onChange={set("held_on")} required />
        </label>
      </div>
      <label className="block">
        <span className="eyebrow mb-1.5 block">Attendees</span>
        <input className="field w-full" placeholder="Dana (CTO), Priya" value={form.attendees} onChange={set("attendees")} />
      </label>
      {(scheduled || meeting?.prep) && (
        <label className="block">
          <span className="eyebrow mb-1.5 block">Prep (markdown)</span>
          <textarea className="field min-h-[100px] w-full resize-y" value={form.prep} onChange={set("prep")} />
        </label>
      )}
      {!scheduled && (
        <>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Recap (markdown)</span>
            <textarea className="field min-h-[140px] w-full resize-y" value={form.summary} onChange={set("summary")} />
          </label>
          <label className="block">
            <span className="eyebrow mb-1.5 block">Decisions</span>
            <textarea className="field min-h-[60px] w-full resize-y" value={form.decisions} onChange={set("decisions")} />
          </label>
        </>
      )}
      <label className="block">
        <span className="eyebrow mb-1.5 block">Notes / recording link</span>
        <input className="field w-full" placeholder="https://" value={form.external_url} onChange={set("external_url")} />
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn btn-ghost" onClick={() => onDone()}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!form.title.trim()}>
          {meeting ? "Save" : "Log meeting"}
        </button>
      </div>
    </form>
  );
}
