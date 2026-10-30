import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalOpen, type TerminalSession } from "./useTerminals";

interface TerminalViewProps {
  session?: TerminalSession;
  /** What the terminal has printed so far, drawn again when the view opens. */
  history: () => string;
  /** Follows what it prints from now on, and returns the way to stop. */
  follow: (listen: (data: string) => void) => () => void;
  /** Opens a shell in the thread's copy at a size in characters. */
  onOpen: (cols: number, rows: number) => void;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  /** Motion is off, so the cursor doesn't blink. */
  still: boolean;
}

/** The colours of the Zone tokens, which the terminal can't read as CSS variables. */
function theme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: token("--solid", "#0f0e0d"),
    foreground: token("--z9", "#e3e0da"),
    cursor: token("--z9", "#e3e0da"),
    cursorAccent: token("--solid", "#0f0e0d"),
    selectionBackground: "rgba(255, 255, 255, 0.18)",
  };
}

/** The person's own shell in the thread's copy of the project. It keeps running while they look elsewhere. */
export function TerminalView({ session, history, follow, onOpen, onInput, onResize, still }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  // Read through refs, so the terminal is made once however often the parent draws.
  const handlers = useRef({ onOpen, onInput, onResize });
  handlers.current = { onOpen, onInput, onResize };
  const isOpen = terminalOpen(session);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const terminal = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace",
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: !still,
      scrollback: 5000,
      theme: theme(),
    });
    const fitter = new FitAddon();
    terminal.loadAddon(fitter);
    terminal.open(el);
    fitter.fit();
    terminal.write(history());
    term.current = terminal;
    fit.current = fitter;
    const typed = terminal.onData((data) => handlers.current.onInput(data));
    const stop = follow((data) => terminal.write(data));
    let size = `${terminal.cols}x${terminal.rows}`;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitter.fit();
            const now = `${terminal.cols}x${terminal.rows}`;
            if (now === size) return;
            size = now;
            handlers.current.onResize(terminal.cols, terminal.rows);
          });
    observer?.observe(el);
    terminal.focus();
    return () => {
      observer?.disconnect();
      stop();
      typed.dispose();
      terminal.dispose();
      term.current = null;
    };
  }, [follow, history, still]);

  // A shell opens when the view first shows, and again when the person asks for a new one.
  useEffect(() => {
    if (!session && term.current) handlers.current.onOpen(term.current.cols, term.current.rows);
  }, [session]);

  return (
    <div className="terminal">
      <div className="term" ref={host} />
      {!isOpen && session && (session.ended || session.error) && (
        <div className="termbar solid">
          <span>{session.error ?? "The shell ended."}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              term.current?.clear();
              if (term.current) handlers.current.onOpen(term.current.cols, term.current.rows);
            }}
          >
            Start a new shell
          </button>
        </div>
      )}
    </div>
  );
}
