import { useEffect, useRef, useState } from "react";
import { ChevronDown, Laptop, Monitor, Play } from "lucide-react";
import { type Agent, type CustomerLink, useAgents, useRunMutations } from "../../lib/api";
import { useToast } from "../../hooks/useToast";

export const machineIcon = (agent: Pick<Agent, "platform">) =>
  agent.platform === "macos" ? <Laptop size={13} /> : <Monitor size={13} />;

/** Runs a tool on a machine: its preferred one, the only one online, or one you pick. */
export default function RunButton({
  link,
  variant = "ghost",
  label = true,
}: {
  link: CustomerLink;
  variant?: "ghost" | "primary";
  label?: boolean;
}) {
  const { data: agents = [] } = useAgents();
  const { run } = useRunMutations();
  const { toast } = useToast();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const online = agents.filter((a) => a.online);
  const preferred = link.agent ? agents.find((a) => a.name === link.agent) : undefined;
  const direct = preferred ?? (online.length === 1 ? online[0] : undefined);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const start = (agent?: string) => {
    setMenu(false);
    run.mutate(
      { linkId: link.id, agent },
      {
        onSuccess: (r) =>
          toast(`Sent “${link.label}” to ${r.agent}`, "success"),
        onError: (e) => toast(e.message, "error"),
      }
    );
  };

  const title = !agents.length
    ? "No machine connected (Settings → Machines)"
    : direct
      ? `Run on ${direct.name}${direct.online ? "" : " (offline)"}`
      : "Run on…";

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        className={`btn btn-${variant} btn-sm ${label ? "" : "btn-icon"}`}
        title={`${title}\n${link.command ?? ""}`}
        aria-label={label ? undefined : `Run ${link.label}`}
        disabled={run.isPending || !online.length}
        onClick={() => (direct?.online ? start(direct.name) : setMenu(!menu))}
      >
        <Play size={13} />
        {label && link.label}
        {!direct?.online && online.length > 1 && <ChevronDown size={13} className="-mr-1 text-faint" />}
      </button>
      {menu && (
        <div className="popover anim-pop-origin-top-right absolute right-0 top-full z-30 mt-1 min-w-[180px] p-1" role="menu">
          <div className="px-2 pb-1 pt-1.5 text-xs text-muted">Run on</div>
          {agents.map((a) => (
            <button
              key={a.name}
              type="button"
              role="menuitem"
              disabled={!a.online}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-fg/[0.06] disabled:opacity-40"
              onClick={() => start(a.name)}
            >
              {machineIcon(a)} <span className="flex-1">{a.name}</span>
              {!a.online && <span className="text-xs text-faint">offline</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
