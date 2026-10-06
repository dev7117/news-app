import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { useIdeaMutations } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

/** Jot an idea straight into a customer or project (hub tab, project page). */
export default function IdeaCapture({ customerId, projectId, placeholder }: { customerId?: number; projectId?: number; placeholder?: string }) {
  const { create } = useIdeaMutations();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        create.mutate(
          { title: title.trim(), customer_id: customerId ?? null, project_id: projectId ?? null },
          { onSuccess: () => setTitle(""), onError: (err) => toast(err.message, "error") }
        );
      }}
    >
      <Lightbulb size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input
        className="field w-full pl-9"
        placeholder={placeholder ?? "Jot an idea…"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="New idea"
      />
    </form>
  );
}
