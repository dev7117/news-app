import { Bot } from "lucide-react";
import { hueFor, initials } from "../CustomerArt";

/** Round initials, tinted from the name (same tint as their monogram everywhere). Agents get a bot. */
export default function Avatar({ name, size = 24, className = "", agent = false }: { name: string; size?: number; className?: string; agent?: boolean }) {
  if (agent) {
    return (
      <span
        className={`inline-grid shrink-0 place-items-center rounded-full bg-accent/10 text-accent ${className}`}
        style={{ width: size, height: size }}
        title={name}
        aria-hidden="true"
      >
        <Bot size={Math.max(11, size * 0.55)} />
      </span>
    );
  }
  return (
    <span
      className={`customer-art inline-grid shrink-0 rounded-full font-semibold ${className}`}
      style={{ "--h": hueFor(name), width: size, height: size, fontSize: Math.max(9, size * 0.38) } as React.CSSProperties}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
