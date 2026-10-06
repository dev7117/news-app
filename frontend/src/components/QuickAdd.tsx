import { useRef, useState } from "react";
import { CornerDownLeft, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { STATUS_LABELS, useTaskMutations } from "../lib/api";
import { useQuickAddProvider } from "./autocomplete/providers";
import { useAutocomplete } from "./autocomplete/useAutocomplete";
import { useToast } from "../hooks/useToast";

export const SYNTAX_HELP: [string, string][] = [
  ["#project", "existing project (- for spaces)"],
  ["@work  @personal", "area"],
  ["!today", "on today"],
  ["!now", "today and in progress"],
  ["!idea", "save as an idea, not a task"],
  ["!high  !med  !low", "priority"],
  ["^fri  ^tomorrow  ^10/31", "due date"],
  ["+priya", "assign to someone"],
];

interface Props {
  source?: "app" | "intake";
  autoFocus?: boolean;
  placeholder?: string;
  onAdded?: () => void;
  large?: boolean;
  /** Token added to every entry, e.g. "!today" on the Today page or "#acme" on a project. */
  implied?: string;
}

export default function QuickAdd({ source = "app", autoFocus, placeholder, onAdded, large, implied }: Props) {
  const [text, setText] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ac = useAutocomplete({ value: text, onChange: setText, provider: useQuickAddProvider(), ref: input });
  const { quick } = useTaskMutations();
  const { toast } = useToast();
  const navigate = useNavigate();

  const submit = () => {
    let value = text.trim();
    if (!value || quick.isPending) return;
    // Put the implied token first so anything typed (another #project) wins.
    if (implied) value = `${implied} ${value}`;
    quick.mutate(
      { text: value, source },
      {
        onSuccess: (made) => {
          setText("");
          if (made.kind === "idea") {
            toast(`Saved idea${made.customer ? ` for ${made.customer}` : made.project ? ` in ${made.project}` : ""}`, "success", {
              action: { label: "Open", onClick: () => navigate(`/ideas/${made.id}`) },
            });
          } else {
            const where = made.today ? "Today" : made.project ?? STATUS_LABELS[made.status];
            toast(`Added to ${where}`, "success", {
              action: { label: "Open", onClick: () => navigate({ search: `?task=${made.id}` }) },
            });
          }
          onAdded?.();
          input.current?.focus();
        },
        onError: (error) => toast(error.message, "error"),
      }
    );
  };

  return (
    <div>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Plus
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <input
          id="quick-add"
          className={`field w-full pl-9 pr-24 ${large ? "h-12 text-base" : ""}`}
          placeholder={placeholder ?? "Add a task…  #project !today ^fri"}
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          {...ac.bind}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setShowHelp(true)}
          onBlur={() => {
            ac.bind.onBlur();
            setShowHelp(false);
          }}
          onKeyDown={(e) => {
            ac.onKeyDown(e);
            if (e.defaultPrevented) return;
            if (e.key === "Escape") {
              setText("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Add a task"
        />
        <button
          type="submit"
          className="btn btn-quiet btn-xs absolute right-1.5 top-1/2 -translate-y-1/2"
          disabled={!text.trim() || quick.isPending}
        >
          Add <CornerDownLeft size={13} />
        </button>
      </form>
      {ac.popup}
      {showHelp && !ac.open && (
        <div className="anim-fade mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-faint">
          {SYNTAX_HELP.map(([token, meaning]) => (
            <span key={token}>
              <span className="font-medium text-muted">{token}</span> {meaning}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
