import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useClosing } from "../lib/motion";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  viewportWide?: boolean;
}

// Rendered via a portal: an ancestor with backdrop-filter (the sticky header)
// becomes the containing block for position:fixed, which would clip the
// dialog to the header area.
export default function Modal({ title, onClose, children, wide, viewportWide }: ModalProps) {
  // Dismissals the modal owns (Esc, backdrop, ✕) play a short exit before
  // unmounting; exits are faster than entrances so closing never feels slow.
  const [closing, close] = useClosing(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [close]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stage/50 p-4 backdrop-blur-[2px] anim-fade"
      data-closing={closing || undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`popover anim-pop max-h-[88vh] overflow-y-auto overscroll-contain p-6 ${
          viewportWide
            ? "w-[95vw] max-w-none lg:w-[85vw] xl:w-[70vw]"
            : `w-full ${wide ? "max-w-4xl" : "max-w-lg"}`
        }`}
        data-closing={closing || undefined}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.011em]">{title}</h2>
          <button className="btn btn-quiet btn-sm btn-icon -mr-2" onClick={close} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
