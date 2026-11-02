import { useEffect } from "react";

export interface Note {
  /** What just happened, in a few words. */
  text: string;
  /** Puts it back, for something that can be undone. */
  undo?: () => void;
  /** Set for something that went wrong, which stays until it's closed. */
  problem?: boolean;
  /** Stays until it's closed, for news that waits for the person. */
  stays?: boolean;
  /** The one thing to do about it, such as Restart to update. */
  action?: { label: string; run: () => void };
}

const SHOWN_FOR = 6000;
const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** A short note at the foot of the window after an action, with Undo when it can be undone. Ctrl+Z (⌘Z on a
 *  Mac) undoes it too, while the note is up and no text box has the keys. */
export function Toast({ note, onClose }: { note: Note; onClose: () => void }) {
  useEffect(() => {
    if (note.problem || note.stays) return;
    const timer = setTimeout(onClose, SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [note, onClose]);

  useEffect(() => {
    if (!note.undo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true'], .cm-editor")) return;
      e.preventDefault();
      onClose();
      note.undo!();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onClose]);

  return (
    <div className={note.problem ? "toast problem" : "toast"} role={note.problem ? "alert" : "status"}>
      <span>{note.text}</span>
      {note.action && (
        <button type="button" className="link" onClick={note.action.run}>
          {note.action.label}
        </button>
      )}
      {note.undo && (
        <button
          type="button"
          className="link"
          title={`Undo (${isMac ? "⌘Z" : "Ctrl+Z"})`}
          onClick={() => {
            onClose();
            note.undo!();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="x" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
