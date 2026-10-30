import { useEffect, useRef, useState } from "react";

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

interface PreviewViewProps {
  url: string;
  onUrl: (url: string) => void;
  /** Changes whenever a run ends, so the preview shows the latest work. */
  freshness: string;
}

/** The project's own dev server, at a phone's, a tablet's and a laptop's width. */
export function PreviewView({ url, onUrl, freshness }: PreviewViewProps) {
  const [typed, setTyped] = useState(url);
  const [width, setWidth] = useState<Width>(1280);
  const [reloads, setReloads] = useState(0);
  const [answering, setAnswering] = useState<boolean | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const local = isLocal(url);

  useEffect(() => setTyped(url), [url]);

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
        ) : answering === false ? (
          <p className="note">
            Nothing answers at {url}. Start the project's dev server, or change the address to the one it prints.
          </p>
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
