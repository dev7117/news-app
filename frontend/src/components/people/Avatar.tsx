import { hueFor, initials } from "../CustomerArt";

/** Round initials, tinted from the name (same tint as their monogram everywhere). */
export default function Avatar({ name, size = 24, className = "" }: { name: string; size?: number; className?: string }) {
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
