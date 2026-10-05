import { Check } from "lucide-react";

interface Props {
  checked: boolean;
  onChange: () => void;
  label: string;
}

/** Round completion checkbox. Accent-filled when done. */
export default function Checkbox({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-[background-color,border-color,transform] duration-150 ease-out active:scale-90 ${
        checked ? "border-accent bg-accent text-accent-ink" : "border-[color:var(--line)] bg-tile hover:border-fg/40"
      }`}
    >
      {checked && <Check size={12} strokeWidth={3} className="anim-pop" />}
    </button>
  );
}
