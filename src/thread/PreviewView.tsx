import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { ComparedPage, ComparedShot } from "../../runtime/src/compare";
import { serverRunning, type Server } from "./useServers";

/** The widths the spec asks for: a phone, a tablet and a laptop. */
export const WIDTHS = [360, 768, 1280] as const;
type Width = (typeof WIDTHS)[number];

/** Vite's own port, which most new projects use. */
export const DEFAULT_PREVIEW = "http://localhost:5173";

/** Only this computer's dev server is previewed: the app's content policy allows nothing else. */
export function isLocal(address: string): boolean {
  try {
    const url = new URL(address);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Lines of a server's output shown when it stops or hasn't printed its address yet. */
const SHOWN_LINES = 12;

interface PreviewViewProps {
  /** The address saved for the project. A server Shoji started shows at the address it printed instead. */
  url: string;
  onUrl: (url: string) => void;
  /** Changes whenever a run ends, so the preview shows the latest work. */
  freshness: string;
  /** The dev server Shoji started in this thread's copy, if it did. */
  server?: Server;
  /** The command that starts the project's dev server. */
  command: string;
  onStartServer: (command: string) => void;
  onStopServer: () => void;
  /** The pages the work changed, before it and after it, once a run has compared them. */
  compare?: { pages: ComparedPage[]; problem?: string };
  /** Shows the comparison at a page when it changes to a new time, as when the conversation asks for it. */
  compareAsk?: { page: number; at: number } | null;
  readShot: (path: string) => Promise<string>;
}

/** The project's own dev server, at a phone's, a tablet's and a laptop's width. */
export function PreviewView({
  url: saved,
  onUrl,
  freshness,
  server,
  command,
  onStartServer,
  onStopServer,
  compare,
  compareAsk,
  readShot,
}: PreviewViewProps) {
  const serving = serverRunning(server);
  const url = serving && server?.url ? server.url : saved;
  const [typed, setTyped] = useState(url);
  const [typedCommand, setTypedCommand] = useState(command);
  const [width, setWidth] = useState<Width>(1280);
  const [reloads, setReloads] = useState(0);
  const [answering, setAnswering] = useState<boolean | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const local = isLocal(url);
  // Live is the dev server; Before and after is the comparison a run made, while there is one.
  const [mode, setMode] = useState<"live" | "compare">(compareAsk ? "compare" : "live");
  const [page, setPage] = useState(compareAsk?.page ?? 0);
  const comparing = mode === "compare" && !!compare;
  useEffect(() => {
    if (!compareAsk) return;
    setMode("compare");
    setPage(compareAsk.page);
  }, [compareAsk]);

  useEffect(() => setTyped(url), [url]);
  useEffect(() => setTypedCommand(command), [command]);
  const output = server?.lines.slice(-SHOWN_LINES).join("\n");

  // A server that isn't running refuses the connection; one that is answers, whatever it says.
  useEffect(() => {
    if (!local) return;
    let current = true;
    setAnswering(null);
    fetch(url, { mode: "no-cors", cache: "no-store" }).then(
      () => current && setAnswering(true),
      () => current && setAnswering(false),
    );
    return () => {
      current = false;
    };
  }, [url, local, reloads, freshness]);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) =>
      setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Shrunk to fit, never enlarged, so 1280 px of page still lays out as 1280 px.
  const scale = room ? Math.min(1, room.width / width) : 1;

  const shown = compare?.pages[Math.min(page, compare.pages.length - 1)];
  const shot = shown?.shots.find((s) => s.width === width);

  return (
    <div className="preview">
      <div className="pvbar">
        {compare && (
          <div className="seg" role="radiogroup" aria-label="Show">
            <button type="button" role="radio" aria-checked={!comparing} onClick={() => setMode("live")}>
              Live
            </button>
            <button type="button" role="radio" aria-checked={comparing} onClick={() => setMode("compare")}>
              Before and after
            </button>
          </div>
        )}
        {comparing && compare.pages.length > 1 && (
          <div className="seg" role="radiogroup" aria-label="Page">
            {compare.pages.map((p, i) => (
              <button key={p.path} type="button" role="radio" aria-checked={shown === p} onClick={() => setPage(i)}>
                {p.path}
              </button>
            ))}
          </div>
        )}
        {comparing && compare.pages.length === 1 && <span className="pvpath">{compare.pages[0].path}</span>}
        {!comparing && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const next = typed.trim();
                if (next === url) setReloads((n) => n + 1);
                else onUrl(next);
              }}
            >
              <input
                className="url"
                aria-label="Dev server address"
                spellCheck={false}
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={() => typed.trim() !== url && onUrl(typed.trim())}
              />
            </form>
            <button type="button" className="btn sm ghost" onClick={() => setReloads((n) => n + 1)}>
              Reload
            </button>
            {serving && (
              <button type="button" className="btn sm ghost" onClick={onStopServer}>
                Stop server
              </button>
            )}
          </>
        )}
        <div className="seg" role="radiogroup" aria-label="Width">
          {WIDTHS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={width === w} onClick={() => setWidth(w)}>
              {w} px
            </button>
          ))}
        </div>
      </div>
      <div className="pvstage" ref={stage}>
        {comparing && shown ? (
          <div className="bawrap">
            {shot && <BeforeAfter key={shot.width} path={shown.path} shot={shot} room={room} readShot={readShot} />}
            {compare.problem && <p className="banote">{compare.problem}</p>}
          </div>
        ) : !local ? (
          <p className="note">
            Shoji previews this computer's dev server only, at an address on localhost or 127.0.0.1.
          </p>
        ) : serving && !server?.url ? (
          <div className="note">
            <p>Starting {server?.command} in this thread's copy…</p>
            {output && <pre className="pvlog">{output}</pre>}
          </div>
        ) : answering === false && !serving ? (
          <div className="note">
            <p>
              {server?.exit ? "The dev server stopped. " : ""}Nothing answers at {url}. Start the dev server in this
              thread's copy of the project, or change the address to one that's running.
            </p>
            {server?.error && <p role="alert">{server.error}</p>}
            {server?.exit && output && <pre className="pvlog">{output}</pre>}
            <form
              className="pvstart"
              onSubmit={(e) => {
                e.preventDefault();
                if (typedCommand.trim()) onStartServer(typedCommand.trim());
              }}
            >
              <input
                aria-label="Dev server command"
                placeholder="npm run dev"
                spellCheck={false}
                autoComplete="off"
                value={typedCommand}
                onChange={(e) => setTypedCommand(e.target.value)}
              />
              <button type="submit" className="btn sm" disabled={!typedCommand.trim()}>
                Start dev server
              </button>
            </form>
          </div>
        ) : (
          <div className="pvframe" style={{ width: width * scale }}>
            <iframe
              key={`${reloads}-${freshness}`}
              title={`Preview at ${width} px`}
              src={url}
              style={{
                width,
                height: room ? room.height / scale : "100%",
                transform: scale < 1 ? `scale(${scale})` : undefined,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** How tall a page's screenshot is, as the runtime takes it. */
const SHOT_HEIGHT = 800;

/** One width of a page before and after the work, one over the other, with a handle to drag between them. */
function BeforeAfter({
  path,
  shot,
  room,
  readShot,
}: {
  path: string;
  shot: ComparedShot;
  room: { width: number; height: number } | null;
  readShot: (path: string) => Promise<string>;
}) {
  const [split, setSplit] = useState(50);
  const [src, setSrc] = useState<{ before?: string; after?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setSrc(null);
    setError(null);
    const read = (file?: string) => (file ? readShot(file) : Promise.resolve(undefined));
    Promise.all([read(shot.before), read(shot.after)]).then(
      ([before, after]) => current && setSrc({ before, after }),
      (e) => current && setError(String(e)),
    );
    return () => {
      current = false;
    };
  }, [shot.before, shot.after, readShot]);

  if (error) return <p className="banote">Couldn't show the screenshots: {error}</p>;
  // Shrunk to fit the panel both ways, never enlarged.
  const scale = room ? Math.min(1, room.width / shot.width, (room.height - 18) / SHOT_HEIGHT) : 1;
  const both = !!(src?.before && src.after);
  return (
    <figure
      className="ba"
      style={{ width: shot.width * scale, height: SHOT_HEIGHT * scale, "--split": `${split}%` } as CSSProperties}
    >
      {src?.after && <img className="after" src={src.after} alt={`${path} after the work, at ${shot.width} px`} />}
      {src?.before && <img className="before" src={src.before} alt={`${path} before the work, at ${shot.width} px`} />}
      {both ? (
        <>
          <span className="lbl b">Before</span>
          <span className="lbl a">After</span>
          <span className="handle" aria-hidden="true" />
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            aria-label="Before and after"
            aria-valuetext={`${split}% before`}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        </>
      ) : (
        src && <span className={src.before ? "lbl b" : "lbl a"}>{src.before ? "Before" : "After"}</span>
      )}
    </figure>
  );
}
