import { when } from "../thread/ThreadList";
import { folderName } from "./HomeView";
import type { Project } from "./projects";

interface ProjectListProps {
  projects: Project[];
  open: string | null;
  onOpen: (repo: string) => void;
  onAdd: () => void;
}

/** The projects the person works in, to switch between them from Home. */
export function ProjectList({ projects, open, onOpen, onAdd }: ProjectListProps) {
  const now = new Date();
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
            <li key={p.repo}>
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
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
