import React, { createContext, useCallback, useContext } from "react";
import { Toaster, toast as sonner } from "sonner";
import { useTheme } from "../theme";

export type ToastKind = "success" | "error" | "info";

interface ToastOptions {
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{ toast: (message: string, kind?: ToastKind, options?: ToastOptions) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { resolvedDark } = useTheme();

  const toast = useCallback((message: string, kind: ToastKind = "info", options?: ToastOptions) => {
    const show = kind === "success" ? sonner.success : kind === "error" ? sonner.error : sonner;
    show(message, { duration: kind === "error" ? 8000 : 4000, action: options?.action });
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster
        theme={resolvedDark ? "dark" : "light"}
        position="bottom-right"
        // Sonner's own variables, pointed at the house tokens so toasts read as .popover surfaces.
        style={
          {
            "--normal-bg": "rgb(var(--c-tile))",
            "--normal-text": "rgb(var(--c-fg))",
            "--normal-border": "var(--edge)",
            "--border-radius": "12px",
          } as React.CSSProperties
        }
        toastOptions={{ style: { fontFamily: "inherit", boxShadow: "var(--shadow-pop)" } }}
      />
    </ToastContext.Provider>
  );
}
