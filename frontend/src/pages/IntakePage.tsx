import QuickAdd from "../components/QuickAdd";
import TaskRow from "../components/TaskRow";
import { useTasks } from "../lib/api";

/** Bare capture page for a popup window or a phone home-screen shortcut: /intake. */
export default function IntakePage() {
  const { data: inbox = [] } = useTasks({ status: ["inbox"], limit: 8 });
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))]">
      <h1 className="section-title mb-3">Capture</h1>
      <QuickAdd source="intake" autoFocus large placeholder="What needs doing?" />
      {inbox.length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-1 px-3">In the inbox</h2>
          <div className="-mx-1">
            {inbox.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
