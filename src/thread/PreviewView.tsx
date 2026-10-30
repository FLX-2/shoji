import { useEffect, useRef, useState } from "react";
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

  return (
    <div className="preview">
      <div className="pvbar">
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
        <div className="seg" role="radiogroup" aria-label="Width">
          {WIDTHS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={width === w} onClick={() => setWidth(w)}>
              {w} px
            </button>
          ))}
        </div>
      </div>
      <div className="pvstage" ref={stage}>
        {!local ? (
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
