import { useEffect, useState, type ReactNode } from "react";

/** A copy button that says Copied for a moment after. On its own it's a small icon, shown on hover beside what it copies.
 *  Given children, the button is the text it copies, so a sentence like "Committed 4e1b9c2 on shoji/x" keeps its own
 *  spacing, and Copied rises over the text instead. */
export function Copy({ text, what, children }: { text: string; what: string; children?: ReactNode }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={children ? "copy as" : "copy"}
      data-done={done || undefined}
      aria-label={done ? "Copied" : children ? `Copy ${what}, ${text}` : `Copy ${what}`}
      title={`Copy ${what}`}
      onClick={(e) => {
        // Inside a summary, a click would also fold its details.
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(
          () => setDone(true),
          () => {},
        );
      }}
    >
      {children ? (
        <>
          {children}
          {done && (
            <span className="said" aria-hidden="true">
              Copied
            </span>
          )}
        </>
      ) : done ? (
        "Copied"
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" />
        </svg>
      )}
    </button>
  );
}
