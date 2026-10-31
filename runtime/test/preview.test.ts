// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Browser, findBrowser } from "../src/browser";
import type { RuntimeEvent } from "../src/events";
import { runThread } from "../src/pipeline";
import { localUrl, NO_PREVIEW, type Preview, previewFor } from "../src/preview";
import type { ModelRequest } from "../src/provider";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

// The browser Playwright keeps in some containers, when no Chrome is installed.
const BUNDLED = "/opt/pw-browsers/chromium";
const browser = process.env.SHOJI_BROWSER || (fs.existsSync(BUNDLED) ? BUNDLED : findBrowser());

/** A dev server that serves one page, prints its address as Vite does, and logs what it was asked for. */
const SERVER = `
const http = require("http");
http.createServer((req, res) => {
  require("fs").appendFileSync("asked.log", req.url + "\\n");
  if (req.url === "/favicon.ico") { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", "text/html");
  res.end('<title>Pricing</title><h1 style="font:40px sans-serif">Plans</h1><script>console.error("price missing")</script>');
}).listen(process.env.PORT, () => console.log("  \\u001b[32m➜\\u001b[0m  Local:   http://localhost:" + process.env.PORT + "/"));
`;

describe("reading a dev server's address", () => {
  it("finds the local address in coloured output", () => {
    expect(localUrl("  \u001b[32m➜\u001b[0m  Local:   http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(localUrl("ready on http://127.0.0.1:3000.")).toBe("http://127.0.0.1:3000");
    expect(localUrl("Network: http://192.168.1.4:5173/")).toBeUndefined();
  });
});

describe.skipIf(!browser)("looking at a page in a headless browser", () => {
  it("starts the dev server once and shows the page, its title and its console errors", async () => {
    const root = tempRepo({ "server.js": SERVER });
    const preview = previewFor(root, "node server.js", () => Browser.launch(browser!));
    try {
      const seen = await preview.look("/pricing", "768");
      expect(Array.isArray(seen)).toBe(true);
      const [text, image] = seen as [{ type: "text"; text: string }, { type: "image"; source: { data: string } }];
      expect(text.text).toMatch(/^http:\/\/localhost:\d+\/pricing at 768px wide\. Title: Pricing\n/);
      expect(text.text).toContain("- console.error: price missing");
      expect(image.source.data.startsWith("iVBORw0KGgo")).toBe(true);
      // A second look uses the same server.
      await preview.look("/", "1280");
      expect(fs.readFileSync(`${root}/asked.log`, "utf8")).toMatch(/^\/pricing\n(\/favicon\.ico\n)*\/\n/);
    } finally {
      await preview.close();
    }
  });
});

describe("a dev server that can't start", () => {
  it("tells the role why, and tries again on the next look", async () => {
    const root = tempRepo({ "a.txt": "a" });
    let launched = 0;
    const preview = previewFor(root, `node -e "console.log('Missing script: dev'); process.exit(3)"`, async () => {
      launched++;
      throw new Error("no browser");
    });
    const seen = await preview.look("/", "1280");
    expect(seen).toMatch(/ended \(exit code 3\) before it served a page:\nMissing script: dev/);
    expect(await preview.look("/", "1280")).toMatch(/exit code 3/);
    expect(launched).toBe(0);
    await preview.close();
  });
});

describe("Build looking at its work", () => {
  it("gets the look_at_page tool and sees the screenshot", async () => {
    const looks: string[] = [];
    const preview: Preview = {
      ...NO_PREVIEW,
      tools: previewFor(".", "x", async () => {
        throw new Error();
      }).tools,
      owns: (tool) => tool === "look_at_page",
      look: async (path, width) => {
        looks.push(`${path}@${width}`);
        return [
          { type: "text", text: "The greeting reads hello, shoji." },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo" } },
        ];
      },
    };
    const scripted = team(() => true);
    const results = (r: ModelRequest) => r.messages.filter((m) => m.role === "user" && Array.isArray(m.content)).length;
    const provider = new ScriptedProvider((request, index) => {
      if (roleOf(request) === "builder" && results(request) === 1) {
        return reply([{ tool: "look_at_page", input: { path: "/", width: "360" } }]);
      }
      return scripted.answer(request, index);
    });
    const events: RuntimeEvent[] = [];
    const result = await runThread({
      task: "Make the greeting say hello to Shoji.",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(tempRepo({ "src/hello.js": "export default 'hello';\n" })),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
      preview,
    });
    expect(result.status).toBe("ready");
    expect(looks).toEqual(["/@360"]);
    const builder = provider.requests.find((r) => roleOf(r) === "builder")!;
    expect(builder.tools?.map((t) => t.name)).toContain("look_at_page");
    expect(provider.requests.find((r) => roleOf(r) === "scout")!.tools?.map((t) => t.name)).not.toContain(
      "look_at_page",
    );
    expect(events).toContainEqual({ type: "tool", step: "build", tool: "look_at_page", target: "/ at 360px" });
    const sawImage = provider.requests.some((r) => JSON.stringify(r.messages).includes('"media_type":"image/png"'));
    expect(sawImage).toBe(true);
  });
});
