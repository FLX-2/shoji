import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "./mcpConfig";

export { type McpServer, parseMcpServers } from "./mcpConfig";

export type McpEvent = { type: "mcp"; server: string; tools: number } | { type: "mcp"; server: string; error: string };

/** Longest tool result a role reads, in characters. */
const MOST_OUTPUT = 20_000;
/** How long a server may take to start and list its tools. */
const CONNECT_MS = 20_000;

/** The servers' tools, ready for roles to use. */
export interface Mcp {
  tools: Anthropic.Tool[];
  /** Tools that only look, by their own account, so any role may use them without asking. */
  readOnly: Anthropic.Tool[];
  owns(tool: string): boolean;
  isReadOnly(tool: string): boolean;
  /** The tool's name as the person reads it, such as "github: create_issue". */
  label(tool: string): string;
  call(tool: string, input: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

export const NO_MCP: Mcp = {
  tools: [],
  readOnly: [],
  owns: () => false,
  isReadOnly: () => false,
  label: (tool) => tool,
  call: async (tool) => `Error: there is no tool called ${tool}.`,
  close: async () => {},
};

/** How Shoji reaches a server: its command run in the project, or its address. */
export function transportFor(server: McpServer, cwd: string): Transport {
  if (server.url) {
    return new StreamableHTTPClientTransport(new URL(server.url), {
      ...(server.headers && { requestInit: { headers: server.headers } }),
    });
  }
  return new StdioClientTransport({
    command: server.command!,
    args: server.args ?? [],
    // Only the basics a program needs and what the person set, never Shoji's own key.
    env: { ...getDefaultEnvironment(), ...server.env },
    cwd,
    stderr: "ignore",
  });
}

const withTimeout = <T>(work: Promise<T>, ms: number, what: string) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} took too long`)), ms).unref?.()),
  ]);

/** The name a model sees, unique and within the API's rules. */
function toolName(server: string, tool: string, taken: Set<string>): string | null {
  const name = `mcp__${server}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
  if (taken.has(name)) return null;
  taken.add(name);
  return name;
}

/** What a tool call returned, as text a model reads. */
function resultText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  const parts = content.map((c: { type: string; text?: string; resource?: { text?: string; uri?: string } }) =>
    c.type === "text"
      ? (c.text ?? "")
      : c.type === "resource"
        ? (c.resource?.text ?? c.resource?.uri ?? "")
        : `[${c.type}]`,
  );
  let text = parts.join("\n").trim();
  if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent);
  if (text.length > MOST_OUTPUT) text = `${text.slice(0, MOST_OUTPUT)}\n…(cut at ${MOST_OUTPUT} characters)`;
  return result.isError ? `Error: ${text || "the tool failed"}` : text || "(no output)";
}

/**
 * Starts or calls each server and lists its tools. A server that can't be reached is reported and left out,
 * so the run goes on without it.
 */
export async function connectMcp(
  servers: McpServer[],
  emit: (event: McpEvent) => void,
  transport: (server: McpServer) => Transport,
): Promise<Mcp> {
  if (!servers.length) return NO_MCP;
  const clients: Client[] = [];
  const tools: Anthropic.Tool[] = [];
  const readOnly = new Set<string>();
  const owners = new Map<string, { client: Client; tool: string; label: string }>();
  const taken = new Set<string>();

  await Promise.all(
    servers.map(async (server) => {
      const client = new Client({ name: "shoji", version: "1" });
      try {
        await withTimeout(client.connect(transport(server)), CONNECT_MS, `Starting ${server.name}`);
        clients.push(client);
        const listed = await withTimeout(client.listTools(), CONNECT_MS, `Listing ${server.name}'s tools`);
        let count = 0;
        for (const tool of listed.tools) {
          const name = toolName(server.name, tool.name, taken);
          if (!name) continue;
          count++;
          const description = `From the ${server.name} MCP server. ${tool.description ?? tool.title ?? ""}`.trim();
          tools.push({
            name,
            description: description.slice(0, 1024),
            input_schema: { ...tool.inputSchema, type: "object" } as Anthropic.Tool.InputSchema,
          });
          if (tool.annotations?.readOnlyHint === true) readOnly.add(name);
          owners.set(name, { client, tool: tool.name, label: `${server.name}: ${tool.name}` });
        }
        emit({ type: "mcp", server: server.name, tools: count });
      } catch (error) {
        emit({ type: "mcp", server: server.name, error: error instanceof Error ? error.message : String(error) });
        await client.close().catch(() => {});
      }
    }),
  );

  return {
    tools,
    readOnly: tools.filter((t) => readOnly.has(t.name)),
    owns: (tool) => owners.has(tool),
    isReadOnly: (tool) => readOnly.has(tool),
    label: (tool) => owners.get(tool)?.label ?? tool,
    call: async (tool, input) => {
      const owner = owners.get(tool);
      if (!owner) return `Error: there is no tool called ${tool}.`;
      try {
        return resultText(await owner.client.callTool({ name: owner.tool, arguments: input }));
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    close: async () => {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
    },
  };
}
