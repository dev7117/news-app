import { X } from "lucide-react";
import { Link } from "react-router-dom";
import { type Task, useAllPeople, usePeopleMutations, useTaskMutations } from "../../lib/api";
import { useToast } from "../../hooks/useToast";
import Avatar from "./Avatar";

/** Task side panel: who's doing it, and who follows it (stays yours; shows on their page). */
export default function PeopleFields({ task }: { task: Task }) {
  const { data: people = [] } = useAllPeople();
  const { patch } = useTaskMutations();
  const { setFollowers } = usePeopleMutations();
  const { toast } = useToast();
  const fail = { onError: (e: Error) => toast(e.message, "error") };
  const followerIds = task.followers.map((p) => p.id);
  const candidates = people.filter((p) => !followerIds.includes(p.id) && p.id !== task.assignee_id);

  return (
    <>
      <div>
        <div className="eyebrow mb-1.5">Assigned to</div>
        <div className="flex items-center gap-2">
          {task.assignee && (
            <Link to={`/people/${task.assignee_id}`} title={`Open ${task.assignee}`}>
              <Avatar name={task.assignee} size={26} />
            </Link>
          )}
          <select
            className="field field-sm min-w-0 flex-1"
            value={task.assignee_id ?? ""}
            onChange={(e) => patch.mutate({ id: task.id, assignee_id: e.target.value ? Number(e.target.value) : null }, fail)}
          >
            <option value="">Me</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.customer ? ` · ${p.customer}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div className="eyebrow mb-1.5" title="They see it on their page, e.g. to discuss in a 1:1. @mentioning someone in the task adds them.">
          Followers
        </div>
        {task.followers.length > 0 && (
          <ul className="mb-1.5 space-y-1">
            {task.followers.map((p) => (
              <li key={p.id} className="group flex items-center gap-2 text-sm">
                <Avatar name={p.name} size={20} />
                <Link to={`/people/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.name}
                </Link>
                <button
                  type="button"
                  className="btn btn-quiet btn-xs btn-icon w-[22px] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                  aria-label={`Remove ${p.name}`}
                  title="Remove"
                  onClick={() => setFollowers.mutate({ taskId: task.id, personIds: followerIds.filter((id) => id !== p.id) }, fail)}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <select
          className="field field-sm w-full"
          value=""
          onChange={(e) =>
            e.target.value && setFollowers.mutate({ taskId: task.id, personIds: [...followerIds, Number(e.target.value)] }, fail)
          }
        >
          <option value="">{people.length ? "Add a follower…" : "No people yet (People page)"}</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.customer ? ` · ${p.customer}` : ""}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
