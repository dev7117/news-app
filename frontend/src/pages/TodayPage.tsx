import { useState } from "react";
import { CalendarClock, ChevronRight, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import CustomerArt from "../components/CustomerArt";
import { useOpenMeeting } from "../components/MeetingDialog";
import QuickAdd from "../components/QuickAdd";
import { EmptyState, SortableTasks } from "../components/TaskList";
import TaskRow from "../components/TaskRow";
import { type Meeting, useCounts, useTasks, useTaskMutations, useToday, useUpcoming } from "../lib/api";
import { meetingWhen, todayIso } from "../lib/format";

export default function TodayPage() {
  const { data: view } = useToday();
  const { data: counts } = useCounts();
  const { reorder } = useTaskMutations();
  const [showDone, setShowDone] = useState(false);
  const { data: dueSoon = [] } = useTasks({ status: ["inbox", "todo", "waiting"] });
  const today = todayIso();
  // Not on today yet, but due by today: suggest them.
  const suggestions = dueSoon.filter((t) => !t.today && t.due_on && t.due_on <= today);
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="eyebrow">{date}</p>
        <h1 className="page-title">Today</h1>
      </header>
      <div className="mb-8">
        <QuickAdd placeholder="Add to today…  #project ^fri !high" implied="!today" />
      </div>

      {view && view.open.length === 0 && view.done.length === 0 ? (
        <EmptyState icon={<Sun size={18} />} title="Nothing on today">
          Pick tasks with the sun button, or add one with <span className="font-medium">!today</span>.
          {counts && counts.inbox > 0 && ` ${counts.inbox} in the inbox to triage.`}
        </EmptyState>
      ) : (
        view && (
          <section className="mb-8">
            <SortableTasks tasks={view.open} onReorder={(ids) => reorder.mutate(ids)} />
            {view.done.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  className="btn btn-quiet btn-xs"
                  aria-expanded={showDone}
                  onClick={() => setShowDone(!showDone)}
                >
                  <ChevronRight
                    size={13}
                    className={`transition-transform duration-200 ease-out ${showDone ? "rotate-90" : ""}`}
                  />
                  Done today <span className="tabular">{view.done.length}</span>
                </button>
                {showDone && (
                  <div className="anim-rise -mx-1 mt-1">
                    {view.done.map((task) => (
                      <TaskRow key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      )}

      <ComingUp />

      {suggestions.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title mb-1 px-3">
            Due, not on today <span className="tabular text-sm font-normal text-faint">{suggestions.length}</span>
          </h2>
          <div className="-mx-1">
            {suggestions.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Customer meetings in the next 7 days, so there's time to prep. */
function ComingUp() {
  const { data: meetings = [] } = useUpcoming(7);
  const { data: counts } = useCounts();
  const open = useOpenMeeting();
  if (!meetings.length && !counts?.review) return null;
  return (
    <section className="mb-8">
      <h2 className="section-title mb-2 flex items-center gap-2 px-3">
        <CalendarClock size={16} className="text-muted" /> Coming up
      </h2>
      {!!counts?.review && (
        <Link to="/review" className="mx-1 mb-2 flex items-center gap-2 rounded-[10px] bg-accent/[0.08] px-3 py-2 text-sm hover:bg-accent/[0.12]">
          <span className="font-medium text-accent">{counts.review} proposal{counts.review === 1 ? "" : "s"} from Claude</span>
          <span className="text-muted">waiting for your review</span>
        </Link>
      )}
      <div className="-mx-1">
        {meetings.map((m: Meeting) => (
          <button
            key={m.id}
            type="button"
            className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-fg/[0.04]"
            onClick={() => open(m.id)}
          >
            <CustomerArt customer={{ id: m.customer_id, name: m.customer, logo: null }} className="h-8 w-8 shrink-0 rounded-[8px]" textClass="text-[0.6875rem]" />
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <span className="font-medium">{m.customer}</span> <span className="text-muted">· {m.title}</span>
              </div>
              <div className="text-xs text-muted">{meetingWhen(m)}</div>
            </div>
            {m.prep ? <span className="tag tag-accent">Prep ready</span> : <span className="tag">No prep</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
