import { useEffect, useState } from "react";

/** A small copy button, shown on hover beside what it copies, that says Copied for a moment after. */
export function Copy({ text, what }: { text: string; what: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="copy"
      data-done={done || undefined}
      aria-label={done ? "Copied" : `Copy ${what}`}
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
      {done ? (
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
