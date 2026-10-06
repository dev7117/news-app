import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { caretCoordinates } from "../../lib/caret";

export interface Suggestion {
  key: string;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  /** Replaces the typed token (trigger included). */
  insert: string;
}

/** Given the trigger character and what's typed after it, the suggestions (null = not handled). */
export type Provider = (trigger: string, query: string) => Suggestion[] | null;

interface Token {
  start: number;
  end: number;
  trigger: string;
  query: string;
}

const TRIGGERS = "#@+^!";

/** The token being typed at the caret, if it starts with a trigger character. */
function tokenAt(value: string, caret: number): Token | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const text = value.slice(start, caret);
  if (!text || !TRIGGERS.includes(text[0])) return null;
  // A trigger must start a word ("a+b" or an email isn't a token).
  return { start, end: caret, trigger: text[0], query: text.slice(1) };
}

/** Suggestions for #project, @person, +assignee, ^date, !flag (whatever the provider handles),
    in a popup at the caret. Wire `bind` onto the field and render `popup`. Arrow keys move,
    Enter / Tab pick, Esc closes. */
export function useAutocomplete<T extends HTMLInputElement | HTMLTextAreaElement>({
  value,
  onChange,
  provider,
  ref: externalRef,
}: {
  value: string;
  onChange: (value: string) => void;
  provider: Provider;
  /** The field's own ref, when it already has one (focus handling elsewhere). */
  ref?: React.RefObject<T>;
}) {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;
  const [token, setToken] = useState<Token | null>(null);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Where the caret goes after a pick: applied in the same commit as the new text, so a
  // keystroke typed right after can't land before it.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (pendingCaret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [value, ref]);
  const suggestions = token ? provider(token.trigger, token.query)?.slice(0, 8) ?? [] : [];
  const open = !!token && suggestions.length > 0;

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el || document.activeElement !== el) return setToken(null);
    const caret = el.selectionStart ?? el.value.length;
    const next = el.selectionEnd === caret ? tokenAt(el.value, caret) : null;
    setToken((prev) => (prev?.start === next?.start && prev?.query === next?.query ? prev : next));
  }, []);

  useEffect(() => setIndex(0), [token?.start, token?.query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el || !token) return setPos(null);
    const rect = el.getBoundingClientRect();
    const caret = caretCoordinates(el, token.start);
    setPos({
      top: Math.min(rect.top + caret.top + caret.height + 4, window.innerHeight - 40),
      left: Math.min(rect.left + caret.left, window.innerWidth - 280),
    });
  }, [open, token, value]);

  const pick = (s: Suggestion) => {
    const el = ref.current;
    if (!el || !token) return;
    const after = value.slice(token.end);
    const insert = s.insert + (after.startsWith(" ") ? "" : " ");
    pendingCaret.current = token.start + insert.length;
    onChange(value.slice(0, token.start) + insert + after);
    setToken(null);
  };

  /** Call first in the field's onKeyDown; if it handled the key, e.defaultPrevented is true. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if ((e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      pick(suggestions[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setToken(null);
    }
  };

  const bind = {
    ref,
    onKeyUp: (e: React.KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) || !open) recompute();
    },
    onClick: recompute,
    onBlur: () => setToken(null),
    onInput: recompute,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
  };

  const popup =
    open && pos
      ? createPortal(
          <ul
            role="listbox"
            className="popover anim-pop fixed z-[60] max-h-72 w-64 overflow-y-auto p-1"
            style={{ top: pos.top, left: Math.max(8, pos.left) }}
            onMouseDown={(e) => e.preventDefault()} // keep focus in the field
          >
            {suggestions.map((s, i) => (
              <li
                key={s.key}
                role="option"
                aria-selected={i === index}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  i === index ? "bg-fg/[0.07]" : "hover:bg-fg/[0.04]"
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(s)}
              >
                {s.icon && <span className="grid w-5 shrink-0 place-items-center text-muted">{s.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.detail && <span className="shrink-0 truncate text-xs text-faint">{s.detail}</span>}
              </li>
            ))}
          </ul>,
          document.body
        )
      : null;

  return { bind, onKeyDown, popup, open };
}
