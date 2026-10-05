import { useState } from "react";
import { Plus, X } from "lucide-react";
import { type Topic, useHubMutations } from "../../lib/api";
import { relativeDay } from "../../lib/format";

const STATUS_TAG: Record<Topic["status"], string> = {
  active: "tag-accent",
  watching: "tag-warning",
  resolved: "tag-success",
};
const NEXT: Record<Topic["status"], Topic["status"]> = { active: "watching", watching: "resolved", resolved: "active" };

/** What the customer keeps raising. Claude maintains these from meetings; you can too. */
export default function TopicsPanel({ customerId, topics }: { customerId: number; topics: Topic[] }) {
  const { addTopic, updateTopic, deleteTopic } = useHubMutations(customerId);
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const visible = topics.filter((t) => showResolved || t.status !== "resolved");
  const resolvedCount = topics.length - topics.filter((t) => t.status !== "resolved").length;

  return (
    <div>
      {visible.length === 0 && <p className="mb-3 text-sm text-faint">Nothing tracked yet. Claude adds topics when it logs meetings.</p>}
      <ul className="space-y-3">
        {visible.map((topic) => (
          <li key={topic.id} className="group anim-fade">
            <div className="flex items-center gap-2">
              <span className="font-medium">{topic.name}</span>
              <button
                type="button"
                className={`tag ${STATUS_TAG[topic.status]} cursor-pointer`}
                title={`Mark ${NEXT[topic.status]}`}
                onClick={() => updateTopic.mutate({ id: topic.id, status: NEXT[topic.status] })}
              >
                {topic.status === "active" ? "Active" : topic.status === "watching" ? "Watching" : "Resolved"}
              </button>
              <span className="tabular text-xs text-faint">
                {topic.mentions}× {topic.last_mentioned_on ? `· ${relativeDay(topic.last_mentioned_on).toLowerCase()}` : ""}
              </span>
              <button
                type="button"
                className="btn btn-quiet btn-xs btn-icon ml-auto w-[26px] transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                aria-label={`Remove ${topic.name}`}
                title="Remove"
                onClick={() => deleteTopic.mutate(topic.id)}
              >
                <X size={13} />
              </button>
            </div>
            {topic.summary && <p className="mt-0.5 text-sm text-muted">{topic.summary}</p>}
          </li>
        ))}
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) addTopic.mutate({ name: draft.trim() }, { onSuccess: () => setDraft("") });
        }}
      >
        <input className="field field-sm min-w-0 flex-1" placeholder="Add a topic" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!draft.trim()} aria-label="Add topic">
          <Plus size={14} />
        </button>
      </form>
      {resolvedCount > 0 && (
        <button type="button" className="btn btn-quiet btn-xs -ml-2 mt-2" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? "Hide resolved" : `Show ${resolvedCount} resolved`}
        </button>
      )}
    </div>
  );
}
