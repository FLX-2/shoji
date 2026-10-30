// @vitest-environment node
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../src/events";
import { connectMcp, type McpEvent, type McpServer, parseMcpServers } from "../src/mcp";
import { runThread } from "../src/pipeline";
import type { ModelRequest } from "../src/provider";
import { STACKS } from "../src/stack";
import { Workspace } from "../src/workspace";
import { CHECK, reply, roleOf, ScriptedProvider, team, tempRepo } from "./helpers";

/** An issue tracker as an MCP server, in memory: one tool that looks, one that changes things. */
function tracker() {
  const created: unknown[] = [];
  const server = new Server({ name: "tracker", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "find_issue",
        description: "Find an issue by its number.",
        inputSchema: { type: "object", properties: { number: { type: "string" } }, required: ["number"] },
        annotations: { readOnlyHint: true },
      },
      {
        name: "create_issue",
        description: "Open a new issue.",
        inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "find_issue") {
      return { content: [{ type: "text", text: `#${request.params.arguments?.number}: The greeting is too short.` }] };
    }
    created.push(request.params.arguments);
    return { content: [{ type: "text", text: "Opened #8." }] };
  });
  const transport = () => {
    const [client, ours] = InMemoryTransport.createLinkedPair();
    void server.connect(ours);
    return client;
  };
  return { transport, created };
}

describe("MCP servers from pasted JSON", () => {
  it("takes the shape server READMEs give, or the inner map", () => {
    const github = { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { TOKEN: "x" } };
    expect(parseMcpServers({ mcpServers: { github } })).toEqual([{ name: "github", ...github }]);
    expect(parseMcpServers({ docs: { url: "https://mcp.example.com/mcp" } })).toEqual([
      { name: "docs", url: "https://mcp.example.com/mcp" },
    ]);
  });

  it("says what's wrong with a server it can't use", () => {
    expect(() => parseMcpServers([])).toThrow(/mcpServers/);
    expect(() => parseMcpServers({ "my server": { command: "x" } })).toThrow(/can't be a server's name/);
    expect(() => parseMcpServers({ a: {} })).toThrow("a needs a command or a url.");
    expect(() => parseMcpServers({ a: { command: "x", args: "--flag" } })).toThrow(/args must be a list/);
    expect(() => parseMcpServers({ a: { command: "x", env: { PORT: 80 } } })).toThrow(/env values must be text/);
    expect(() => parseMcpServers({ a: { url: "file:///etc" } })).toThrow(/must start with http/);
  });
});

describe("connecting to MCP servers", () => {
  it("lists each server's tools under its own name, and leaves out one it can't reach", async () => {
    const { transport } = tracker();
    const events: McpEvent[] = [];
    const servers: McpServer[] = [
      { name: "tracker", command: "tracker" },
      { name: "broken", command: "nothing" },
    ];
    const mcp = await connectMcp(
      servers,
      (e) => events.push(e),
      (server) => {
        if (server.name === "broken") throw new Error("spawn nothing ENOENT");
        return transport();
      },
    );
    expect(mcp.tools.map((t) => t.name)).toEqual(["mcp__tracker__find_issue", "mcp__tracker__create_issue"]);
    expect(mcp.tools[0].description).toBe("From the tracker MCP server. Find an issue by its number.");
    expect(mcp.readOnly.map((t) => t.name)).toEqual(["mcp__tracker__find_issue"]);
    expect(mcp.label("mcp__tracker__create_issue")).toBe("tracker: create_issue");
    expect(events).toContainEqual({ type: "mcp", server: "tracker", tools: 2 });
    expect(events).toContainEqual({ type: "mcp", server: "broken", error: "spawn nothing ENOENT" });
    expect(await mcp.call("mcp__tracker__find_issue", { number: "7" })).toBe("#7: The greeting is too short.");
    await mcp.close();
  });
});

describe("roles using MCP tools", () => {
  /** The usual team, except Scout looks the issue up and Build opens one before writing the greeting. */
  function teamThatUsesTools() {
    const scripted = team(() => true);
    const results = (r: ModelRequest) => r.messages.filter((m) => m.role === "user" && Array.isArray(m.content)).length;
    return new ScriptedProvider((request, index) => {
      const role = roleOf(request);
      if (role === "scout" && results(request) === 0) {
        return reply([{ tool: "mcp__tracker__find_issue", input: { number: "7" } }]);
      }
      if (role !== "builder") return scripted.answer(request, index);
      const done = results(request);
      if (done === 0) return reply([{ tool: "mcp__tracker__create_issue", input: { title: "Say hello to Shoji" } }]);
      if (done === 1) {
        return reply([
          { tool: "write_file", input: { path: "src/hello.js", content: "export default 'hello, shoji';\n" } },
        ]);
      }
      return reply([{ text: "Changed the greeting." }]);
    });
  }

  async function run(ask: (command: string) => Promise<boolean>) {
    const { transport, created } = tracker();
    const mcp = await connectMcp([{ name: "tracker", command: "tracker" }], () => {}, transport);
    const provider = teamThatUsesTools();
    const events: RuntimeEvent[] = [];
    const result = await runThread({
      task: "Make the greeting say hello to Shoji, as issue #7 asks.",
      stack: STACKS.balanced,
      provider,
      workspace: new Workspace(tempRepo({ "src/hello.js": "export default 'hello';\n" })),
      checks: [CHECK],
      cap: 1,
      emit: (e) => events.push(e),
      ask,
      mcp,
    });
    await mcp.close();
    const offered = (role: string) =>
      provider.requests
        .find((r) => roleOf(r) === role)
        ?.tools?.map((t) => t.name)
        .filter((n) => n.startsWith("mcp__"));
    return { result, events, created, offered };
  }

  it("lets Scout look without asking, and asks before Build changes anything", async () => {
    const asked: string[] = [];
    const { result, events, created, offered } = await run(async (command) => (asked.push(command), true));
    expect(offered("scout")).toEqual(["mcp__tracker__find_issue"]);
    expect(offered("builder")).toEqual(["mcp__tracker__find_issue", "mcp__tracker__create_issue"]);
    expect(asked).toEqual(["tracker: create_issue"]);
    expect(events).toContainEqual({ type: "ask", step: "build", command: "tracker: create_issue", tool: true });
    expect(events).toContainEqual({
      type: "tool",
      step: "scout",
      tool: "mcp__tracker__find_issue",
      target: "tracker: find_issue",
    });
    expect(created).toEqual([{ title: "Say hello to Shoji" }]);
    expect(result.status).toBe("ready");
  });

  it("tells Build to do without a tool the person turned down", async () => {
    const { created, result } = await run(async () => false);
    expect(created).toEqual([]);
    expect(result.status).toBe("ready");
  });
});
