import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { draftFor, keepDraft } from "./drafts";
import { commandAt, matchCommands, matchFiles, matchThreads, mentionAt, type SlashCommand } from "./mention";

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
  /** The commands a task can start with. Typing / first offers them, and a picked one starts the text. */
  commands?: SlashCommand[];
  /** Earlier threads, which typing @ offers after the files. A picked one goes into the text as @“its title”. */
  threads?: { id: number; title: string }[];
  /** Set while a run works: Stop takes Send's place, and what's written waits until the run ends. */
  onStop?: () => void;
  /** The run was asked to stop and hasn't yet. */
  stopping?: boolean;
  /** Text to start with, such as a task brought back to edit. */
  initial?: string;
  /** Where the composer is, such as "task" or a thread, to keep what's written there and not sent. */
  draft?: string;
  /** A second way to send, joined to Send's side, such as scheduling the task instead. */
  sendAlso?: ReactNode;
  /** What Send says it does, when not just sending. */
  sendLabel?: string;
  /** A task to offer in the empty box, which Tab places. */
  suggestion?: string;
}

/** One line of the list under the text: a file after @, or a command after a leading /. */
interface Offer {
  key: string;
  name: string;
  /** Shown beside the name, dimmer: the file's folder, or what the command does. */
  detail: string;
  /** What picking it puts in place of what was typed. */
  insert: string;
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
  commands,
  threads,
  onStop,
  stopping,
  initial = "",
  draft,
  sendAlso,
  sendLabel = "Send",
  suggestion,
}: ComposerProps) {
  const [text, setText] = useState(() => initial || (draft ? draftFor(draft) : ""));
  useEffect(() => {
    if (draft) keepDraft(draft, text);
  }, [draft, text]);
  const ready = text.trim() !== "" && !blocked && !onStop;
  const box = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  // Escape closes the list for the @ or / it was open on; typing another opens it again.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const command = commands?.length ? commandAt(text, caret) : null;
  const mention = !command && (files?.length || threads?.length) ? mentionAt(text, caret) : null;
  const typed = command ? { start: 0, query: command.query } : mention;
  const matches: Offer[] =
    !typed || typed.start === dismissed
      ? []
      : command
        ? matchCommands(commands!, command.query).map((c) => ({
            key: c.name,
            name: c.hint ? `/${c.name} ${c.hint}` : `/${c.name}`,
            detail: c.description,
            insert: `/${c.name} `,
          }))
        : [
            ...matchFiles(files ?? [], mention!.query).map((file) => {
              const cut = file.lastIndexOf("/") + 1;
              return {
                key: file,
                name: file.slice(cut),
                detail: cut > 0 ? file.slice(0, cut - 1) : "",
                insert: `@${file} `,
              };
            }),
            ...matchThreads(threads ?? [], mention!.query).map((t) => ({
              key: `thread-${t.id}`,
              name: t.title,
              detail: "Thread",
              insert: `@“${t.title}” `,
            })),
          ];
  const open = matches.length > 0;
  const picked = Math.min(active, matches.length - 1);
  const moveTo = useRef<number | null>(null);

  useEffect(() => setActive(0), [typed?.query]);
  useEffect(() => {
    if (moveTo.current === null || !box.current) return;
    box.current.setSelectionRange(moveTo.current, moveTo.current);
    setCaret(moveTo.current);
    moveTo.current = null;
  }, [text]);

  const choose = (offer: Offer) => {
    if (!typed) return;
    moveTo.current = typed.start + offer.insert.length;
    setText(text.slice(0, typed.start) + offer.insert + text.slice(caret));
  };
  const send = async () => {
    if (!ready) return;
    const sent = text.trim();
    if ((await onSend(sent)) !== false) {
      // Cleared here too, since sending can take the composer off screen before its text empties.
      if (draft) {
        keepDraft(draft, "");
        keepDraft(`last:${draft}`, sent);
      }
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
        placeholder={suggestion ? `${suggestion}  (Tab to use it)` : placeholder}
        value={text}
        autoFocus={autoFocus}
        rows={hero ? 3 : 2}
        aria-autocomplete={files || commands ? "list" : undefined}
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
              setDismissed(typed!.start);
              return;
            }
          }
          if (e.key === "Tab" && !e.shiftKey && text === "" && suggestion) {
            e.preventDefault();
            setText(suggestion);
          } else if (e.key === "ArrowUp" && text === "" && draft && draftFor(`last:${draft}`)) {
            // An empty box brings back what was last sent from it.
            e.preventDefault();
            setText(draftFor(`last:${draft}`));
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && onCancel && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {open && (
        <ul
          className={command ? "mentions commands" : "mentions"}
          id={listId}
          role="listbox"
          aria-label={command ? "Commands" : "Project files"}
        >
          {matches.map((offer, i) => (
            <li
              key={offer.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === picked}
              // Picking mustn't take the focus from the text.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(offer);
              }}
              onMouseMove={() => i !== picked && setActive(i)}
            >
              <b>{offer.name}</b>
              {offer.detail && <span>{offer.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {above}
      <div className="row">
        {children}
        {onStop ? (
          <button
            type="button"
            className="send stop"
            aria-label="Stop"
            title="Stop this run"
            onClick={onStop}
            disabled={stopping}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="1.5" />
            </svg>
          </button>
        ) : (
          <div className={sendAlso ? "sends" : "sends solo"}>
            {sendAlso}
            <button type="submit" className="send" aria-label={sendLabel} title={sendLabel} disabled={!ready}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
