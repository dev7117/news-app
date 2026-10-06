import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

/** Local draft that saves itself: after a pause in typing, and immediately on flush()
    (blur, Esc, leaving the block). `status` drives a quiet "Saving… / Saved" hint. */
export function useAutosave(initial: string, save: (value: string) => void, delay = 700) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<"idle" | "dirty" | "saved">("idle");
  const saved = useRef(initial);
  const timer = useRef<number>();
  const latest = useRef(value);
  latest.current = value;
  const saveRef = useRef(save);
  saveRef.current = save;

  // A newer server value (another tab, Claude) replaces the draft unless it has unsaved edits.
  useEffect(() => {
    if (latest.current === saved.current) {
      setValue(initial);
      saved.current = initial;
    }
  }, [initial]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (latest.current !== saved.current) {
      saved.current = latest.current;
      saveRef.current(latest.current);
      setStatus("saved");
    }
  }, []);

  const change = (next: string) => {
    setValue(next);
    setStatus("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  };

  // Save what's pending if the component goes away mid-edit.
  useEffect(() => () => flush(), [flush]);

  return { value, change, flush, status };
}

/** A textarea that grows with its content. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoTextarea({ className = "", value, ...props }, outer) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(outer, () => ref.current!);
    useEffect(() => {
      const el = ref.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }, [value]);
    return <textarea ref={ref} rows={1} value={value} className={`resize-none overflow-hidden ${className}`} {...props} />;
  }
);

export function SaveHint({ status }: { status: "idle" | "dirty" | "saved" }) {
  if (status === "idle") return null;
  return <span className="text-xs text-faint">{status === "dirty" ? "Saving…" : "Saved"}</span>;
}
