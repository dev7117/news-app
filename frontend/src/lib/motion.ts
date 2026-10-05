import { useCallback, useState } from "react";

export const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Unmount after the closing animation so the exit plays. Pair with a `data-closing` attribute
    whose CSS runs the exit; reduced motion skips the wait. */
export function useClosing(onClosed: () => void, ms = 140) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClosed, reducedMotion() ? 0 : ms);
  }, [closing, onClosed, ms]);
  return [closing, close] as const;
}
