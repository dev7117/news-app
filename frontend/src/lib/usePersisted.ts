import { useCallback, useState } from "react";

/** useState remembered per browser (view mode, grouping, collapsed lanes). Storage can be unavailable. */
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    },
    [key]
  );
  return [value, set] as const;
}
