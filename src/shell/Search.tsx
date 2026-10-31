import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchItem {
  id: string;
  /** The group it's listed under: Threads, Projects, Go to or Settings. */
  group: string;
  label: string;
  /** A second, quieter line, such as a thread's status. */
  detail?: string;
  /** The keys that do the same, shown on the right, so the palette teaches them. */
  keys?: string[];
  run: () => void;
}

/** Most items shown from one group. */
const MOST = 6;

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** The items whose label or detail holds every word typed, in their groups' order. */
export function matching(items: SearchItem[], query: string): SearchItem[] {
  const wanted = words(query);
  const groups = new Map<string, SearchItem[]>();
  for (const item of items) {
    const text = `${item.label} ${item.detail ?? ""}`.toLowerCase();
    if (!wanted.every((w) => text.includes(w))) continue;
    const group = groups.get(item.group) ?? [];
    if (group.length < MOST) groups.set(item.group, [...group, item]);
  }
  return [...groups.values()].flat();
}

interface SearchProps {
  items: SearchItem[];
  onClose: () => void;
}

/** Find a thread, project, view or setting by name, and go to it. */
export function Search({ items, onClose }: SearchProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(0);
  const found = useMemo(() => matching(items, query), [items, query]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setPicked(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [picked]);

  const go = (item: SearchItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="scrim top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search" role="dialog" aria-label="Search">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-list"
          aria-activedescendant={found[picked] ? `search-${found[picked].id}` : undefined}
          aria-label="Search threads, projects, views and settings"
          placeholder="Search, or type what to do"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setPicked((p) => Math.min(p + 1, found.length - 1));
            else if (e.key === "ArrowUp") setPicked((p) => Math.max(p - 1, 0));
            else if (e.key === "Enter") go(found[picked]);
            else return;
            e.preventDefault();
          }}
        />
        {found.length > 0 ? (
          <ul id="search-list" role="listbox" aria-label="Results" ref={list}>
            {found.map((item, i) => (
              <li key={item.id} role="presentation">
                {item.group !== found[i - 1]?.group && (
                  <span className="k" role="presentation">
                    {item.group}
                  </span>
                )}
                <div
                  id={`search-${item.id}`}
                  role="option"
                  aria-selected={i === picked}
                  onMouseMove={() => i !== picked && setPicked(i)}
                  onClick={() => go(item)}
                >
                  <b>{item.label}</b>
                  {item.detail && <span>{item.detail}</span>}
                  {item.keys && (
                    <span className="kbds" aria-hidden="true">
                      {item.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="none">Nothing matches "{query.trim()}".</p>
        )}
      </div>
    </div>
  );
}
