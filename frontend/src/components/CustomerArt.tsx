import { type Customer, logoUrl } from "../lib/api";

export function hueFor(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** Logo on a light tile, or a tinted monogram. Size it with className (aspect/width/radius). */
export default function CustomerArt({
  customer,
  className = "",
  textClass = "text-2xl",
}: {
  customer: Pick<Customer, "id" | "name" | "logo">;
  className?: string;
  textClass?: string;
}) {
  const src = logoUrl(customer);
  return (
    <div
      className={`customer-art ${className}`}
      data-logo={src ? "" : undefined}
      style={{ "--h": hueFor(customer.name) } as React.CSSProperties}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : <span className={`font-semibold tracking-[-0.02em] ${textClass}`}>{initials(customer.name)}</span>}
    </div>
  );
}
