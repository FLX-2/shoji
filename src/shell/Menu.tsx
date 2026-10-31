import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  /** Shown dimmer on the right, such as a shortcut. */
  hint?: string;
  run: () => void;
  disabled?: boolean;
  /** A step that can't be undone asks first, in the menu itself: the question and the button that does it. */
  confirm?: { ask: string; yes: string };
}

/** A line between groups of items. */
export const SEPARATOR = "sep" as const;
export type MenuEntry = MenuItem | typeof SEPARATOR;

interface MenuProps {
  /** Where it opens: the pointer for a right-click, or under a button. */
  at: { x: number; y: number };
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}

/** A short list of actions, from a right-click or a ⋯ button. Arrow keys move, Enter picks, Escape closes. */
export function Menu({ at, label, items, onClose }: MenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  const [asking, setAsking] = useState<MenuItem | null>(null);

  // Kept inside the window: it opens up or left when there's no room below or to the right.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(at.x, window.innerWidth - width - 8));
    const y = at.y + height + 8 > window.innerHeight ? Math.max(8, at.y - height) : at.y;
    setPlace({ x, y });
  }, [at.x, at.y, asking]);

  useEffect(() => {
    const first = box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    first?.focus();
  }, [asking]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const blur = () => onClose();
    document.addEventListener("mousedown", away);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [onClose]);

  const pick = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.confirm && asking !== item) return setAsking(item);
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      if (asking) setAsking(null);
      else onClose();
    } else if (e.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
    else if (e.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === "Home") buttons[0]?.focus();
    else if (e.key === "End") buttons.at(-1)?.focus();
    else if (e.key === "Tab") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // On the page itself, so no frosted pane around the button that opened it can clip it.
  return createPortal(
    <div
      ref={box}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {asking?.confirm ? (
        <div className="ask" role="group" aria-label={asking.confirm.ask}>
          <p>{asking.confirm.ask}</p>
          <div>
            <button type="button" className="btn sm" role="menuitem" onClick={() => pick(asking)}>
              {asking.confirm.yes}
            </button>
            <button type="button" className="btn sm ghost" role="menuitem" onClick={() => setAsking(null)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        items.map((item, i) =>
          item === SEPARATOR ? (
            <hr key={i} />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => pick(item)}
            >
              {item.label}
              {item.confirm && "…"}
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ),
        )
      )}
    </div>,
    document.body,
  );
}

/** Where a menu opens under the button that opened it. */
export function under(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.right - 200, y: r.bottom + 4 };
}
