// The person's MCP servers as they configure them. Kept apart from the MCP client, so the app can read the
// same configuration without bundling the client.

/** An MCP server the person added: a command Shoji starts, or an address it calls. */
export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

const NAME = /^[A-Za-z0-9_-]{1,32}$/;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const stringMap = (value: unknown): value is Record<string, string> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string");

/**
 * MCP servers from the JSON the person pasted, in the shape server READMEs give:
 * {"mcpServers": {"github": {"command": "npx", "args": [...], "env": {...}}}}, or the inner map alone.
 * Throws with what's wrong, in words the person can act on.
 */
export function parseMcpServers(value: unknown): McpServer[] {
  const root = value && typeof value === "object" && "mcpServers" in value ? value.mcpServers : value;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new Error('Give the servers as {"mcpServers": {"name": {"command": …}}}.');
  }
  return Object.entries(root).map(([name, server]) => {
    if (!NAME.test(name)) throw new Error(`"${name}" can't be a server's name: use letters, digits, - and _.`);
    if (!server || typeof server !== "object") throw new Error(`${name} needs a command or a url.`);
    const s = server as Record<string, unknown>;
    if (typeof s.url === "string") {
      if (!/^https?:\/\//.test(s.url)) throw new Error(`${name}'s url must start with http:// or https://.`);
      if (s.headers !== undefined && !stringMap(s.headers)) throw new Error(`${name}'s headers must be text.`);
      return { name, url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    }
    if (typeof s.command !== "string" || !s.command.trim()) throw new Error(`${name} needs a command or a url.`);
    if (s.args !== undefined && !strings(s.args)) throw new Error(`${name}'s args must be a list of text.`);
    if (s.env !== undefined && !stringMap(s.env)) throw new Error(`${name}'s env values must be text.`);
    return {
      name,
      command: s.command,
      ...(s.args ? { args: s.args } : {}),
      ...(s.env ? { env: s.env } : {}),
    };
  });
}
