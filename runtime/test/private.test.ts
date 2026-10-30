// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffOf } from "../src/git";
import { runTool } from "../src/tools";
import { DEFAULT_PRIVATE, Workspace } from "../src/workspace";
import { tempRepo } from "./helpers";

const PROJECT = {
  "src/app.ts": "export const app = 1;\n",
  ".env": "API_KEY=secret-value\n",
  ".env.example": "API_KEY=\n",
  "config/.env.local": "TOKEN=secret-value\n",
  "certs/server.pem": "-----BEGIN secret-value-----\n",
  "secrets/db.json": '{"password":"secret-value"}\n',
};

describe("private files", () => {
  it("reads patterns as .gitignore does: anywhere without a slash, the last match deciding", () => {
    const ws = new Workspace(tempRepo({}), [...DEFAULT_PRIVATE, "secrets/", "/config/prod.json", "**/fixtures/*.key"]);
    const hidden = (file: string) => ws.isPrivate(file);
    expect([".env", "config/.env.local", "certs/server.pem", "secrets/db.json", "config/prod.json"].every(hidden)).toBe(true);
    expect(hidden("fixtures/test.key") && hidden("a/b/fixtures/test.key")).toBe(true);
    expect([".env.example", "src/app.ts", "src/config/prod.json", "environment.ts"].some(hidden)).toBe(false);
    expect(new Workspace(tempRepo({}), [""]).isPrivate(".env")).toBe(false);
  });

  it("keeps them from every tool a role has", () => {
    const ws = new Workspace(tempRepo(PROJECT), [...DEFAULT_PRIVATE, "secrets"]);
    const tool = (name: string, input: Record<string, string>) => runTool(ws, [], name, input);

    expect(tool("read_file", { path: ".env" })).toBe("Error: .env is private: the person keeps it from models. Do the task without it.");
    expect(tool("read_file", { path: "./config/../.env" })).toMatch(/is private/);
    expect(tool("write_file", { path: "config/.env.local", content: "x" })).toMatch(/is private/);
    expect(tool("replace_in_file", { path: "secrets/db.json", old_text: "secret", new_text: "x" })).toMatch(/is private/);
    expect(fs.readFileSync(path.join(ws.root, "config/.env.local"), "utf8")).toBe(PROJECT["config/.env.local"]);

    expect(tool("list_files", { path: "." }).split("\n")).toEqual([".env.example", "src/app.ts"]);
    expect(tool("search", { pattern: "secret-value" })).not.toMatch(/secret-value/);
    expect(tool("read_file", { path: ".env.example" })).toMatch(/API_KEY=/);
  });

  it("leaves them out of the diff a reviewer reads, but not out of the person's", () => {
    const root = tempRepo({ "src/app.ts": "export const app = 1;\n" });
    const ws = new Workspace(root, DEFAULT_PRIVATE);
    fs.writeFileSync(path.join(root, "src/app.ts"), "export const app = 2;\n");
    fs.writeFileSync(path.join(root, ".env"), "API_KEY=secret-value\n");

    const reviewed = diffOf(root, (file) => ws.isPrivate(file));
    expect(reviewed).toMatch(/app = 2/);
    expect(reviewed).not.toMatch(/secret-value/);
    expect(diffOf(root)).toMatch(/secret-value/);
  });
});
