import { useState, type ReactNode } from "react";

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
}: ComposerProps) {
  const [text, setText] = useState("");
  const ready = text.trim() !== "" && !blocked;
  const send = async () => {
    if (!ready) return;
    if ((await onSend(text.trim())) !== false) setText("");
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
        aria-label={label}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        rows={hero ? 3 : 2}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const images = [...e.clipboardData.files].filter((file) => file.type.startsWith("image/"));
          if (!onPasteImages || !images.length) return;
          e.preventDefault();
          onPasteImages(images);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && onCancel && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onCancel();
          }
        }}
      />
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
