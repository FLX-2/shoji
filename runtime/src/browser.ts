import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** How long a browser may take to start, and a page to load. */
const START_MS = 20_000;
const LOAD_MS = 15_000;
/** Time after the load for a page's scripts to draw it. */
const SETTLE_MS = 800;
/** Most console errors kept from one page. */
const MOST_PROBLEMS = 20;

/** Where Chrome, Edge, Chromium and Brave install themselves on each system. */
function candidates(): string[] {
  if (process.platform === "darwin") {
    return [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Chromium.app/Contents/MacOS/Chromium",
      "Brave Browser.app/Contents/MacOS/Brave Browser",
    ].flatMap((app) => ["/Applications", path.join(os.homedir(), "Applications")].map((dir) => path.join(dir, app)));
  }
  if (process.platform === "win32") {
    const roots = [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(
      (r): r is string => !!r,
    );
    return [
      "Microsoft\\Edge\\Application\\msedge.exe",
      "Google\\Chrome\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ].flatMap((exe) => roots.map((root) => path.join(root, exe)));
  }
  const names = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
    "brave-browser",
  ];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return names.flatMap((name) => dirs.map((dir) => path.join(dir, name)));
}

/** A Chromium browser on this computer, or the one SHOJI_BROWSER names, or null when there's none. */
export function findBrowser(): string | null {
  const named = process.env.SHOJI_BROWSER;
  if (named) return fs.existsSync(named) ? named : null;
  return candidates().find((file) => fs.existsSync(file)) ?? null;
}

interface Message {
  id?: number;
  method?: string;
  params?: Record<string, any>;
  sessionId?: string;
  result?: Record<string, any>;
  error?: { message: string };
}

/** What a page showed: a PNG of it, its title, and the errors its console and network reported. */
export interface Look {
  png: string;
  title: string;
  problems: string[];
}

/** A headless browser, driven through the DevTools protocol, with a profile of its own that's deleted after. */
export class Browser {
  private next = 0;
  private pending = new Map<number, { resolve: (r: Record<string, any>) => void; reject: (e: Error) => void }>();
  private listeners = new Set<(m: Message) => void>();

  private constructor(
    private child: ChildProcess,
    private socket: WebSocket,
    private profile: string,
  ) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiting?.reject(new Error(message.error.message));
        else waiting?.resolve(message.result ?? {});
      } else for (const listen of this.listeners) listen(message);
    });
    socket.addEventListener("close", () => {
      for (const waiting of this.pending.values()) waiting.reject(new Error("The browser closed."));
      this.pending.clear();
    });
  }

  static async launch(executable: string): Promise<Browser> {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shoji-browser-"));
    const args = [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      // Chrome's sandbox refuses to start as root, as in a container.
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "about:blank",
    ];
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    try {
      const address = await new Promise<string>((resolve, reject) => {
        let said = "";
        const timer = setTimeout(() => reject(new Error("The browser took too long to start.")), START_MS);
        child.stderr!.on("data", (chunk) => {
          said += chunk;
          const found = said.match(/DevTools listening on (ws:\/\/\S+)/);
          if (found) {
            clearTimeout(timer);
            resolve(found[1]);
          }
        });
        child.on("error", (e) => (clearTimeout(timer), reject(e)));
        child.on(
          "exit",
          () => (
            clearTimeout(timer),
            reject(new Error(`The browser closed as it started. ${said.trim().slice(-300)}`))
          ),
        );
      });
      const socket = new WebSocket(address);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", () => reject(new Error("Couldn't reach the browser.")), { once: true });
      });
      child.stderr!.resume();
      return new Browser(child, socket, profile);
    } catch (error) {
      child.kill();
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      throw error;
    }
  }

  private send(method: string, params: object = {}, sessionId?: string): Promise<Record<string, any>> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }

  /** Opens a page at a width, waits for it to load and draw, and shows it. */
  async look(url: string, width: number, height = 800): Promise<Look> {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const problems: string[] = [];
    const note = (text: string) => problems.length < MOST_PROBLEMS && problems.push(text.slice(0, 500));
    let loaded = () => {};
    const load = new Promise<void>((resolve) => (loaded = resolve));
    const listen = (m: Message) => {
      if (m.sessionId !== sessionId || !m.params) return;
      const p = m.params;
      if (m.method === "Page.loadEventFired") loaded();
      else if (m.method === "Runtime.exceptionThrown") {
        note(`Uncaught: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "an error"}`);
      } else if (m.method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "assert")) {
        const said = (p.args ?? []).map(
          (a: { value?: unknown; description?: string }) => a.description ?? String(a.value ?? ""),
        );
        note(`console.error: ${said.join(" ")}`);
      } else if (m.method === "Log.entryAdded" && p.entry?.level === "error") {
        note(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ""}`);
      }
    };
    this.listeners.add(listen);
    try {
      await this.send("Page.enable", {}, sessionId);
      await this.send("Runtime.enable", {}, sessionId);
      await this.send("Log.enable", {}, sessionId);
      await this.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height, deviceScaleFactor: 1, mobile: width < 768 },
        sessionId,
      );
      const navigated = await this.send("Page.navigate", { url }, sessionId);
      if (navigated.errorText) note(`Couldn't load ${url}: ${navigated.errorText}`);
      else {
        const late = await Promise.race([load.then(() => false), delay(LOAD_MS).then(() => true)]);
        if (late) note(`The page was still loading after ${LOAD_MS / 1000} seconds.`);
        await delay(SETTLE_MS);
      }
      const title = await this.send(
        "Runtime.evaluate",
        { expression: "document.title", returnByValue: true },
        sessionId,
      );
      const shot = await this.send("Page.captureScreenshot", { format: "png" }, sessionId);
      return { png: shot.data, title: String(title.result?.value ?? ""), problems };
    } finally {
      this.listeners.delete(listen);
      await this.send("Target.closeTarget", { targetId }).catch(() => {});
    }
  }

  async close() {
    this.socket.close();
    this.child.kill();
    await new Promise((resolve) =>
      this.child.exitCode !== null || this.child.signalCode !== null ? resolve(null) : this.child.once("exit", resolve),
    );
    // The browser's helpers can still be writing to it for a moment after it exits.
    fs.rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());
