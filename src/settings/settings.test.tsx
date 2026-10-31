import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import App from "../App";
import { fakeBridge } from "../test/fakeBridge";

describe("Settings", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("forgets the key only after asking", async () => {
    const fake = fakeBridge({ saved: true, fromEnv: false });
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Models and keys" }));

    fireEvent.click(await screen.findByRole("button", { name: "Forget" }));
    expect(fake.calls.forgot).toBe(0);
    expect(screen.getByText("Forget the saved key?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Forget the saved key?")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Forget" }).length).toBe(1);

    // Ask again, then confirm.
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(screen.getByText("Forget the saved key?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    });
    expect(fake.calls.forgot).toBe(1);
    expect(await screen.findByPlaceholderText("sk-ant-…")).toBeTruthy();
  });

  it("lists commands always allowed in a project, and asks about one again once it's taken off", async () => {
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({ allowedCommands: { "/work/pricing-page": ["npm install", "npx prettier --write ."] } }),
    );
    render(<App bridge={fakeBridge().bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Tools and commands" }));
    expect(screen.getByText("npm install")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Ask again" })[0]);
    expect(screen.queryByText("npm install")).toBeNull();
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands).toEqual({
      "/work/pricing-page": ["npx prettier --write ."],
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask again" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).allowedCommands).toEqual({});
  });

  it("keeps the private files the person lists from every run, and can go back to the defaults", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    const box = screen.getByRole("textbox", { name: /Private files/ });
    expect((box as HTMLTextAreaElement).value).toBe(DEFAULT_PRIVATE.join("\n"));
    expect(screen.queryByRole("button", { name: "Use the defaults" })).toBeNull();

    fireEvent.change(box, { target: { value: ".env\n\n  secrets/  \n" } });
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).privateFiles).toEqual([".env", "secrets/"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    const task = screen.getByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Add a toggle" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].privateFiles).toEqual([".env", "secrets/"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Use the defaults" }));
    expect(JSON.parse(localStorage.getItem("shoji.prefs")!).privateFiles).toEqual(DEFAULT_PRIVATE);
  });

  it("takes MCP servers pasted as JSON, says what's wrong, and gives them to each thread's runs", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ repo: "/work/pricing-page", planFirst: false }));
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Tools and commands" }));
    const box = screen.getByRole("textbox", { name: /^MCP servers/ });
    fireEvent.change(box, { target: { value: '{"mcpServers": {"github": {"command": "npx"' } });
    expect(screen.getByRole("alert").textContent).toMatch(/^That isn't valid JSON yet/);
    fireEvent.change(box, { target: { value: '{"mcpServers": {"my github": {"command": "npx"}}}' } });
    expect(screen.getByRole("alert").textContent).toBe(
      `"my github" can't be a server's name: use letters, digits, - and _.`,
    );

    const pasted = {
      mcpServers: {
        github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { TOKEN: "t" } },
        docs: { url: "https://docs.example.com/mcp" },
      },
    };
    fireEvent.change(box, { target: { value: JSON.stringify(pasted, null, 2) } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("npx -y @modelcontextprotocol/server-github")).toBeTruthy();
    expect(screen.getByText("https://docs.example.com/mcp")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    const task = await screen.findByRole("textbox", { name: "Task" });
    fireEvent.change(task, { target: { value: "Close issue 7" } });
    await act(async () => {
      fireEvent.keyDown(task, { key: "Enter" });
    });
    expect(fake.calls.starts[0].mcpServers).toEqual(pasted);
  });

  it("lets Build look at pages with the project's dev command, until it's turned off", async () => {
    localStorage.setItem(
      "shoji.prefs",
      JSON.stringify({
        repo: "/work/pricing-page",
        planFirst: false,
        devCommands: { "/work/pricing-page": "pnpm dev" },
      }),
    );
    const fake = fakeBridge();
    render(<App bridge={fake.bridge} />);
    const send = async (text: string) => {
      const task = await screen.findByRole("textbox", { name: "Task" });
      fireEvent.change(task, { target: { value: text } });
      await act(async () => {
        fireEvent.keyDown(task, { key: "Enter" });
      });
    };
    await send("Restyle the pricing table");
    expect(fake.calls.starts[0].devCommand).toBe("pnpm dev");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Tools and commands" }));
    fireEvent.click(screen.getByRole("switch", { name: "Let Build look at pages" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Home" }));
    });
    await send("Restyle the footer");
    expect(fake.calls.starts[1].devCommand).toBeUndefined();
  });

  it("shows one page at a time, and the key's page when Home asks for a key", async () => {
    localStorage.setItem("shoji.prefs", JSON.stringify({ setupDone: true }));
    render(<App bridge={fakeBridge({ saved: false, fromEnv: false }).bridge} />);
    const add = await screen.findByRole("button", { name: "Add it in Settings" });
    await act(async () => {
      fireEvent.click(add);
    });
    const pages = screen.getByRole("navigation", { name: "Settings pages" });
    expect(within(pages).getByRole("button", { current: "page" }).textContent).toBe("Models and keys");
    expect(screen.getByRole("heading", { level: 1, name: "Models and keys" })).toBeTruthy();
    expect(screen.getByPlaceholderText("sk-ant-…")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Status bar" })).toBeNull();

    fireEvent.click(within(pages).getByRole("button", { name: "Interface" }));
    expect(screen.getByRole("switch", { name: "Status bar" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("sk-ant-…")).toBeNull();
    expect(within(pages).getByRole("button", { name: "Run setup again" })).toBeTruthy();
  });
});
