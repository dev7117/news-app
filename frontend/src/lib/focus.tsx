import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Area } from "./api";

/** Work / Personal / Everything. Per device (localStorage), so switching the Omarchy bar
    to Personal at night never changes what the Mac's browser shows at work. A ?focus= link
    (the bar's "Open todo") sets it. */
export type Focus = Area | "all";

const KEY = "todo-focus";

function stored(): Focus {
  try {
    const value = localStorage.getItem(KEY);
    return value === "work" || value === "personal" ? value : "all";
  } catch {
    return "all";
  }
}

const FocusContext = createContext<{ focus: Focus; area: Area | undefined; setFocus: (f: Focus) => void }>({
  focus: "all",
  area: undefined,
  setFocus: () => {},
});

export function FocusProvider({ children, onChange }: { children: React.ReactNode; onChange?: () => void }) {
  const [focus, setFocusState] = useState<Focus>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("focus");
    if (fromUrl === "work" || fromUrl === "personal" || fromUrl === "all") {
      try {
        localStorage.setItem(KEY, fromUrl);
      } catch {
        /* private mode */
      }
      return fromUrl;
    }
    return stored();
  });

  // Drop ?focus= from the address bar once adopted.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("focus")) {
      url.searchParams.delete("focus");
      window.history.replaceState(null, "", url);
    }
  }, []);

  const setFocus = useCallback(
    (next: Focus) => {
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode */
      }
      setFocusState(next);
      onChange?.();
    },
    [onChange]
  );

  useEffect(() => {
    document.title = focus === "all" ? "Todo" : `Todo · ${focus === "work" ? "Work" : "Personal"}`;
  }, [focus]);

  return (
    <FocusContext.Provider value={{ focus, area: focus === "all" ? undefined : focus, setFocus }}>
      {children}
    </FocusContext.Provider>
  );
}

export const useFocus = () => useContext(FocusContext);
