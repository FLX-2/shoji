import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { matchFiles, mentionAt } from "./mention";

interface ComposerProps {
  label: string;
  placeholder: string;
  /** Why sending isn't possible yet, if it isn't. */
  blocked?: boolean;
  /** Returns, or resolves to, false to keep the text, when sending was held back. */
  onSend: (text: string) => void | boolean | Promise<void | boolean>;
  /** Controls beside the send button, such as the project. */
  children?: ReactNode;
  hero?: boolean;
  autoFocus?: boolean;
  /** Closes the composer without sending. Escape calls it. */
  onCancel?: () => void;
  /** Takes images pasted into the box. Without it, a paste is only text. */
  onPasteImages?: (images: File[]) => void;
  /** Shown between the text and the controls, such as attached files. */
  above?: ReactNode;
  /** The project's files. Typing @ offers them, and a picked one goes into the text as @path. */
  files?: string[];
}

/** Where the person writes a task or the changes they want. Enter sends; Shift+Enter adds a line; Escape cancels, where that's offered. */
export function Composer({
  label,
  placeholder,
  blocked,
  onSend,
  children,
  hero,
  autoFocus,
  onCancel,
  onPasteImages,
  above,
  files,
}: ComposerProps) {
  const [text, setText] = useState("");
  const ready = text.trim() !== "" && !blocked;
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the list for the @ it was open on; typing another @ opens it again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const mention = files?.length ? mentionAt(text, caret) : null;
  const matches = mention && mention.start !== dismissed ? matchFiles(files!, mention.query) : [];
  const open = matches.length > 0;
  const picked = Math.min(active, matches.length - 1);
  const moveTo = useRef<number | null>(null);

  useEffect(() => setActive(0), [mention?.query]);
  useEffect(() => {
    if (moveTo.current === null || !box.current) return;
    box.current.setSelectionRange(moveTo.current, moveTo.current);
    setCaret(moveTo.current);
    moveTo.current = null;
  }, [text]);

  const choose = (file: string) => {
    if (!mention) return;
    const inserted = `@${file} `;
    moveTo.current = mention.start + inserted.length;
    setText(text.slice(0, mention.start) + inserted + text.slice(caret));
  };
  const send = async () => {
    if (!ready) return;
    if ((await onSend(text.trim())) !== false) {
      setText("");
      setDismissed(null);
    }
  };

  return (
    <form
      className={hero ? "composer hero" : "composer"}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={box}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        rows={hero ? 3 : 2}
        aria-autocomplete={files ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${picked}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={(e) => {
          const images = [...e.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (!onPasteImages || !images.length) return;
          e.preventDefault();
          onPasteImages(images);
        }}
        onKeyDown={(e) => {
          if (open && !e.nativeEvent.isComposing) {
            const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
            if (move) {
              e.preventDefault();
              setActive((picked + move + matches.length) % matches.length);
              return;
            }
            if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
              e.preventDefault();
              choose(matches[picked]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDismissed(mention!.start);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && onCancel && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {open && (
        <ul className="mentions" id={listId} role="listbox" aria-label="Project files">
          {matches.map((file, i) => {
            const cut = file.lastIndexOf("/") + 1;
            return (
              <li
                key={file}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === picked}
                // Picking mustn't take the focus from the text.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(file);
                }}
                onMouseMove={() => i !== picked && setActive(i)}
              >
                <b>{file.slice(cut)}</b>
                {cut > 0 && <span>{file.slice(0, cut - 1)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {above}
      <div className="row">
        {children}
        <button type="submit" className="send" aria-label="Send" disabled={!ready}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
