import { useState } from "react";
import { Menu, under, type MenuEntry } from "../shell/Menu";
import { when } from "../thread/ThreadList";
import { folderName } from "./HomeView";
import type { Project } from "./projects";

interface ProjectListProps {
  projects: Project[];
  open: string | null;
  onOpen: (repo: string) => void;
  onAdd: () => void;
  /** The actions on a project's ⋯ menu and right-click. */
  menuFor?: (repo: string) => MenuEntry[];
}

/** The projects the person works in, to switch between them from Home. */
export function ProjectList({ projects, open, onOpen, onAdd, menuFor }: ProjectListProps) {
  const now = new Date();
  const [menu, setMenu] = useState<{ repo: string; at: { x: number; y: number } } | null>(null);
  return (
    <nav className="tlist" aria-label="Projects">
      <div className="mh">
        <h2 className="title">Projects</h2>
        <button type="button" className="add" aria-label="Open a project" title="Open a project" onClick={onAdd}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      </div>
      <div className="groups">
        <ul>
          {projects.map((p) => (
            <li
              key={p.repo}
              data-menu={menu?.repo === p.repo || undefined}
              onContextMenu={(e) => {
                if (!menuFor) return;
                e.preventDefault();
                setMenu({ repo: p.repo, at: { x: e.clientX, y: e.clientY } });
              }}
            >
              <button
                type="button"
                title={p.repo}
                aria-current={p.repo === open || undefined}
                onClick={() => p.repo !== open && onOpen(p.repo)}
              >
                <b>{folderName(p.repo)}</b>
                <span className="meta">
                  {p.running > 0 && <span>{p.running} running</span>}
                  {p.waiting > 0 && <span>{p.waiting === 1 ? "1 needs you" : `${p.waiting} need you`}</span>}
                  {!p.running && !p.waiting && p.last > 0 && <span>{when(p.last, now)}</span>}
                </span>
              </button>
              {menuFor && (
                <button
                  type="button"
                  className="more"
                  aria-label={`More for ${folderName(p.repo)}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.repo === p.repo}
                  onClick={(e) => setMenu(menu?.repo === p.repo ? null : { repo: p.repo, at: under(e.currentTarget) })}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="3.5" cy="8" r="1.1" />
                    <circle cx="8" cy="8" r="1.1" />
                    <circle cx="12.5" cy="8" r="1.1" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {menu && menuFor && (
        <Menu
          at={menu.at}
          label={`Actions for ${folderName(menu.repo)}`}
          items={menuFor(menu.repo)}
          onClose={() => setMenu(null)}
        />
      )}
    </nav>
  );
}
