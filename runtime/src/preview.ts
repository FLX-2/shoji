import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import net from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import type { Browser, Look } from "./browser";
import { commandEnv } from "./commands";

/** How long a dev server may take to print its address. */
const SERVER_MS = 60_000;
export const WIDTHS = [360, 768, 1280];

const LOOK_AT_PAGE: Anthropic.Tool = {
  name: "look_at_page",
  description:
    "See a page of the project as the person would: open it from the project's dev server in a headless browser and get a screenshot, its title and any errors in its console. The dev server starts the first time, from the work as it is now. Use it to check a change to what a page shows.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "The page's path on the dev server, such as / or /pricing" },
      width: { type: "string", description: "The window's width in pixels: 360, 768 or 1280" },
    },
    required: ["path", "width"],
    additionalProperties: false,
  },
};

type Content = Exclude<Anthropic.ToolResultBlockParam["content"], undefined>;

/** The project's pages, which Build can look at. */
export interface Preview {
  tools: Anthropic.Tool[];
  owns(tool: string): boolean;
  look(path: string, width: string): Promise<Content>;
  /** The paths looked at so far, each once, in the order first seen. */
  looked(): string[];
  /** A page at a width, as a PNG, for the person rather than a role. Throws when the page can't be shown. */
  shoot(path: string, width: number): Promise<Look>;
  close(): Promise<void>;
}

export const NO_PREVIEW: Preview = {
  tools: [],
  owns: () => false,
  look: async () => "Error: there is no preview.",
  looked: () => [],
  shoot: async () => {
    throw new Error("There is no preview.");
  },
  close: async () => {},
};

const COLOURS = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

/** The first local address a line of a dev server's output names, as Preview reads it. */
export function localUrl(line: string): string | undefined {
  const found = line.replace(COLOURS, "").match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?[^\s'")\]]*/);
  return found?.[0].replace(/[.,;]+$/, "");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** Stops a server and everything it started. */
function stop(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/** Runs the dev command in the project and resolves to the address it prints. */
async function startServer(command: string, cwd: string): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(command, {
    cwd,
    shell: true,
    // Its own process group, so stopping it stops what it started.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...commandEnv(), PORT: String(await freePort()), BROWSER: "none" },
  });
  const said: string[] = [];
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${command} printed no local address within ${SERVER_MS / 1000} seconds.`)),
        SERVER_MS,
      );
      const hear = (chunk: Buffer) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line.trim()) said.push(line);
          const found = localUrl(line);
          if (found) {
            clearTimeout(timer);
            resolve(found);
          }
        }
      };
      child.stdout!.on("data", hear);
      child.stderr!.on("data", hear);
      child.on("error", (e) => (clearTimeout(timer), reject(e)));
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(
          new Error(`${command} ended (exit code ${code}) before it served a page:\n${said.slice(-15).join("\n")}`),
        );
      });
    });
    return { child, url };
  } catch (error) {
    stop(child);
    throw error;
  }
}

/** What a look returns to the role: what it found in words, then the screenshot. */
function shown(url: string, width: number, look: Look): Content {
  const problems = look.problems.length
    ? `Errors:\n${look.problems.map((p) => `- ${p}`).join("\n")}`
    : "No errors in the console.";
  return [
    { type: "text", text: `${url} at ${width}px wide. Title: ${look.title || "(none)"}\n${problems}` },
    { type: "image", source: { type: "base64", media_type: "image/png", data: look.png } },
  ];
}

/**
 * The preview of the project in `root`: its dev command starts once, the first time a role looks, and the browser
 * with it. A failure to start is told to the role, which carries on without it.
 */
export function previewFor(root: string, devCommand: string, launch: () => Promise<Browser>): Preview {
  let started: Promise<{ child: ChildProcess; url: string; browser: Browser }> | undefined;
  const start = async () => {
    const server = await startServer(devCommand, root);
    try {
      return { ...server, browser: await launch() };
    } catch (error) {
      stop(server.child);
      throw error;
    }
  };
  // A server that couldn't start is tried again next time, once Build may have fixed it.
  const ready = () =>
    (started ??= start().catch((error) => {
      started = undefined;
      throw error;
    }));
  const looked: string[] = [];
  return {
    tools: [LOOK_AT_PAGE],
    owns: (tool) => tool === LOOK_AT_PAGE.name,
    async look(path, width) {
      const px = WIDTHS.includes(Number(width)) ? Number(width) : 1280;
      const wanted = path || "/";
      if (!looked.includes(wanted)) looked.push(wanted);
      try {
        const { url, browser } = await ready();
        const page = new URL(wanted, url).href;
        return shown(page, px, await browser.look(page, px));
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    looked: () => [...looked],
    async shoot(path, width) {
      const { url, browser } = await ready();
      return browser.look(new URL(path || "/", url).href, width);
    },
    async close() {
      if (!started) return;
      const live = await started.catch(() => null);
      if (!live) return;
      await live.browser.close().catch(() => {});
      stop(live.child);
    },
  };
}
