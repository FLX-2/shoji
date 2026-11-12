import type { ChatGPT } from "../stack/chatgpt";
import type { Ollama } from "../stack/ollama";
import { ChatGPTRow } from "./ChatGPTRow";
import { OpenRouterRow } from "./OpenRouterRow";
import type { OpenRouter } from "../stack/openrouter";
import { GeminiRow } from "./GeminiRow";
import type { Gemini } from "../stack/gemini";
import { OllamaRow } from "./OllamaRow";
import { useState } from "react";
import { type McpServer, parseMcpServers } from "../../runtime/src/mcpConfig";
import { DEFAULT_PRIVATE } from "../../runtime/src/private";
import type { Stack } from "../../runtime/src/stack";
import type { KeyedProvider, KeyStatus } from "../bridge";
import {
  AccentRow,
  BackgroundRow,
  DensityRow,
  FrostRow,
  MotionRow,
  OpaqueRow,
  SwitchRow,
  TextSizeRow,
  ThemeRow,
} from "../look/LookRows";
import { listedDay } from "../stack/catalog";
import { describeStack } from "../stack/lock";
import { fileName } from "../thread/useThread";
import { MoneyRow } from "./MoneyRow";
import { keyLabel, SHORTCUTS } from "./shortcuts";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
import type { Prefs } from "./prefs";

interface SettingsViewProps {
  page: SettingsPage;
  onPage: (page: SettingsPage) => void;
  prefs: Prefs;
  onChange: (change: Partial<Prefs>) => void;
  stack: Stack;
  onOpenStack: () => void;
  keyStatus: KeyStatus | null;
  ollama: Ollama;
  chatgpt: ChatGPT;
  onManageUsage: () => void;
  openaiKey: KeyStatus | null;
  openrouter: OpenRouter;
  gemini: Gemini;
  onSaveOpenAIKey: (key: string) => Promise<void>;
  onForgetOpenAIKey: () => Promise<void>;
  onSaveKey: (key: string) => Promise<void>;
  onForgetKey: () => Promise<void>;
  onRunSetup: () => void;
  /** Copies what a bug report needs, with no keys or code. */
  onCopyDiagnostics: () => void;
}

/** The pages of Settings, in the order the side lists them, under their groups. */
export const SETTINGS_PAGES = [
  { id: "look", group: "App", label: "Look", note: "Changes apply at once" },
  { id: "interface", group: "App", label: "Interface" },
  { id: "shortcuts", group: "App", label: "Shortcuts" },
  { id: "models", group: "Models", label: "Models and keys", note: "Changes apply to the next thread" },
  { id: "spending", group: "Models", label: "Spending" },
  { id: "tools", group: "Workspace", label: "Tools and commands" },
  { id: "data", group: "Workspace", label: "Data" },
] as const;

export type SettingsPage = (typeof SETTINGS_PAGES)[number]["id"];

const GROUPS = [...new Set(SETTINGS_PAGES.map((p) => p.group))];

export function SettingsView({
  page,
  onPage,
  prefs,
  onChange,
  stack,
  onOpenStack,
  keyStatus,
  ollama,
  chatgpt,
  onManageUsage,
  openaiKey,
  openrouter,
  gemini,
  onSaveOpenAIKey,
  onForgetOpenAIKey,
  onSaveKey,
  onForgetKey,
  onRunSetup,
  onCopyDiagnostics,
}: SettingsViewProps) {
  const shown = SETTINGS_PAGES.find((p) => p.id === page) ?? SETTINGS_PAGES[0];
  return (
    <div className="split">
      <nav className="side" aria-label="Settings pages">
        <div className="mh">
          <h2 className="title">Settings</h2>
        </div>
        <div className="groups">
          {GROUPS.map((group) => (
            <section key={group} aria-label={group}>
              <h2 className="k">{group}</h2>
              <ul>
                {SETTINGS_PAGES.filter((p) => p.group === group).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-current={p.id === shown.id ? "page" : undefined}
                      onClick={() => onPage(p.id)}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="foot">
          <button
            type="button"
            className="btn sm"
            onClick={onRunSetup}
            title="Walk through models, stack, project and look again"
          >
            Run setup again
          </button>
        </div>
      </nav>

      <div className="spage">
        <div className="mh">
          <h1>{shown.label}</h1>
          {"note" in shown && <span className="note">{shown.note}</span>}
        </div>
        <div className="settings">
          <div className="swrap">
            {shown.id === "shortcuts" ? (
              <Shortcuts />
            ) : shown.id === "models" ? (
              <>
                <section className="sgroup" aria-labelledby="s-providers">
                  <h2 id="s-providers" className="k">
                    Providers
                  </h2>
                  <div className="card">
                    <KeyRow status={keyStatus} onSave={onSaveKey} onForget={onForgetKey} />
                    <ChatGPTRow chatgpt={chatgpt} onManageUsage={onManageUsage} />
                    <KeyRow
                      provider="openai"
                      status={openaiKey}
                      onSave={onSaveOpenAIKey}
                      onForget={onForgetOpenAIKey}
                    />
                    <OpenRouterRow openrouter={openrouter} />
                    <GeminiRow gemini={gemini} tier={prefs.geminiTier} onTier={(geminiTier) => onChange({ geminiTier })} />
                    <OllamaRow ollama={ollama} />
                  </div>
                </section>
                <section className="sgroup" aria-labelledby="s-threads">
                  <h2 id="s-threads" className="k">
                    How threads run
                  </h2>
                  <div className="card">
                    <div className="srow">
                      <div>
                        <b>Stack</b>
                        <span className="d">{describeStack(stack)}</span>
                      </div>
                      <button type="button" className="btn sm" onClick={onOpenStack}>
                        Change in Stack
                      </button>
                    </div>
                    <SwitchRow
                      label="Check the plan first"
                      description="Each thread pauses once its plan is written, so you can build it or change it first."
                      on={prefs.planFirst}
                      onToggle={() => onChange({ planFirst: !prefs.planFirst })}
                    />
                  </div>
                </section>
              </>
            ) : (
              <div className="card">
                {shown.id === "look" && (
                  <>
                    <ThemeRow prefs={prefs} onChange={onChange} />
                    <BackgroundRow prefs={prefs} onChange={onChange} />
                    <FrostRow prefs={prefs} onChange={onChange} />
                    <OpaqueRow prefs={prefs} onChange={onChange} />
                    <MotionRow prefs={prefs} onChange={onChange} />
                    <AccentRow prefs={prefs} onChange={onChange} />
                    <DensityRow prefs={prefs} onChange={onChange} />
                    <TextSizeRow prefs={prefs} onChange={onChange} />
                  </>
                )}
                {shown.id === "interface" && (
                  <>
                    <SwitchRow
                      label="Costs"
                      description="What a thread or trial has spent, while it runs and on the review bar. Receipts always shows them."
                      on={prefs.showCosts}
                      onToggle={() => onChange({ showCosts: !prefs.showCosts })}
                    />
                    <SwitchRow
                      label="Model names"
                      description="Which model takes each step of a thread, beside the step."
                      on={prefs.showModels}
                      onToggle={() => onChange({ showModels: !prefs.showModels })}
                    />
                    <SwitchRow
                      label="Open the side panel by itself"
                      description="In a thread, Code opens when Shoji edits a file, and Preview when it looks at a page or the dev server starts. Closing the panel keeps it closed until your next message."
                      on={prefs.autoPanel}
                      onToggle={() => onChange({ autoPanel: !prefs.autoPanel })}
                    />
                    <SwitchRow
                      label="Tell me when a thread needs me"
                      description="A notification when a thread asks to run a command or ends while you're looking elsewhere, and a count on Shoji's icon of the threads waiting for you."
                      on={prefs.notify}
                      onToggle={() => onChange({ notify: !prefs.notify })}
                    />
                    <SwitchRow
                      label="Status bar"
                      description="The project, branch, running cost and today's spend along the bottom of the window."
                      on={prefs.statusBar}
                      onToggle={() => onChange({ statusBar: !prefs.statusBar })}
                    />
                  </>
                )}
                {shown.id === "spending" && (
                  <>
                    <MoneyRow
                      id="s-cap"
                      label="Limit per thread"
                      description="Shoji stops a thread before any call that could take it past this."
                      value={prefs.cap}
                      onChange={(cap) => onChange({ cap })}
                    />
                    <MoneyRow
                      id="s-daily"
                      label="Daily limit"
                      description="Shoji asks before a thread or trial could take the day's spend past this. Scheduled tasks that would go past it are skipped."
                      value={prefs.dailyLimit}
                      onChange={(dailyLimit) => onChange({ dailyLimit })}
                    />
                  </>
                )}
                {shown.id === "tools" && (
                  <>
                    <McpRow prefs={prefs} onChange={onChange} />
                    <SwitchRow
                      label="Let Build look at pages"
                      description="Build can start the project's dev server in its copy and open a page in a headless browser, to see a change it made. It needs Chrome, Edge, Chromium or Brave on this computer. Each look adds a screenshot to the call's cost."
                      on={prefs.lookAtPages}
                      onToggle={() => onChange({ lookAtPages: !prefs.lookAtPages })}
                    />
                    {prefs.lookAtPages && (
                      <SwitchRow
                        label="Let Review judge the look"
                        description="When Build looked at pages, Review sees them before and after the change, at 360 and 1280 px, and scores the look out of 10. Under 8, Build gets its notes to fix. The screenshots add about a cent to each review on Haiku."
                        on={prefs.lookReview}
                        onToggle={() => onChange({ lookReview: !prefs.lookReview })}
                      />
                    )}
                    <AllowedRows prefs={prefs} onChange={onChange} />
                  </>
                )}
                {shown.id === "data" && (
                  <>
                    <PrivateRow prefs={prefs} onChange={onChange} />
                    <SwitchRow
                      label="Receipt in pull requests"
                      description="Push and open PR fills in the pull request's description with each step's model and cost, the total and Review's verdict, for you to change before you open it. No code, task or file names."
                      on={prefs.receiptInPR}
                      onToggle={() => onChange({ receiptInPR: !prefs.receiptInPR })}
                    />
                    <SwitchRow
                      label="Keep models current"
                      description={`Once a day Shoji downloads the list of models and their prices from its GitHub repository, so a new model or price needs no update. It sends nothing about you or your work. Prices as listed on ${listedDay()}.`}
                      on={prefs.updateModels}
                      onToggle={() => onChange({ updateModels: !prefs.updateModels })}
                    />
                    <SwitchRow
                      label="Check for updates"
                      description="When Shoji opens, it asks its GitHub releases whether a newer Shoji is out, and offers to install it. It sends nothing about you or your work, and installs nothing until you say."
                      on={prefs.checkUpdates}
                      onToggle={() => onChange({ checkUpdates: !prefs.checkUpdates })}
                    />
                    <div className="srow">
                      <div>
                        <b>Diagnostics</b>
                        <span className="d">
                          Shoji's version, your system, which providers are connected and the last error, to paste
                          into a bug report. No keys, code or tasks.
                        </span>
                      </div>
                      <button type="button" className="btn sm" onClick={onCopyDiagnostics}>
                        Copy diagnostics
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Every shortcut, in cards by where it works. */
function Shortcuts() {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return groups.map((group) => (
    <section key={group} className="keys" aria-label={group}>
      <h2 className="k">{group}</h2>
      <div className="card">
        {SHORTCUTS.filter((s) => s.group === group).map((s) => (
          <div className="srow" key={s.what}>
            <b>{s.what}</b>
            <span className="kbds">
              {s.keys.map((key) => (
                <kbd key={key}>{keyLabel(key, MAC)}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  ));
}

const KEY_ROWS = {
  anthropic: { name: "Anthropic", placeholder: "sk-ant-…" },
  openai: { name: "OpenAI", placeholder: "sk-…" },
  openrouter: { name: "OpenRouter", placeholder: "sk-or-…" },
  gemini: { name: "Gemini", placeholder: "AIza…" },
} as const;

function KeyRow({
  provider = "anthropic",
  status,
  onSave,
  onForget,
}: {
  provider?: KeyedProvider;
  status: KeyStatus | null;
  onSave: (key: string) => Promise<void>;
  onForget: () => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { name, placeholder } = KEY_ROWS[provider];
  const field = `s-key-${provider}`;
  const attempt = (work: Promise<void>) =>
    work.then(
      () => setError(null),
      (e) => setError(String(e)),
    );

  return (
    <div className="srow">
      <label htmlFor={field}>
        <b>{name} API key</b>
        <span className="d">
          {error ??
            (status?.saved
              ? `Saved in your system keychain. Shoji sends it only to ${name}.`
              : status?.fromEnv
                ? "Using the key from your shell. Save one here so Shoji has it however it opens."
                : provider === "openai"
                  ? "For OpenAI's models at API prices. Kept in your system keychain and sent only to OpenAI."
                  : `Kept in your system keychain. Shoji sends it only to ${name}.`)}
        </span>
      </label>
      {status?.saved ? (
        <span className="acts">
          {confirming ? (
            <>
              <span className="ask">Forget the saved key?</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setConfirming(false);
                  attempt(onForget());
                }}
              >
                Forget
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn sm" onClick={() => setConfirming(true)}>
              Forget
            </button>
          )}
        </span>
      ) : (
        <form
          className="keyform"
          onSubmit={(e) => {
            e.preventDefault();
            attempt(onSave(key).then(() => setKey("")));
          }}
        >
          <input
            id={field}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className="btn sm" disabled={!key.trim()}>
            Save
          </button>
        </form>
      )}
    </div>
  );
}

/** Commands the person chose to always allow, beyond the checks, for each project. Ask again
 *  takes one off, so Shoji asks about it next time. */
function AllowedRows({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  const forget = (repo: string, command: string) => {
    const left = (prefs.allowedCommands[repo] ?? []).filter((c) => c !== command);
    const { [repo]: _, ...others } = prefs.allowedCommands;
    onChange({ allowedCommands: left.length ? { ...others, [repo]: left } : others });
  };
  return Object.entries(prefs.allowedCommands).flatMap(([repo, commands]) =>
    commands.map((command) => (
      <div className="srow" key={`${repo}\n${command}`}>
        <div>
          <b>
            Always allowed in {fileName(repo)}: <code>{command}</code>
          </b>
          <span className="d">Shoji runs it without asking. Your checks always run.</span>
        </div>
        <button type="button" className="btn sm" onClick={() => forget(repo, command)}>
          Ask again
        </button>
      </div>
    )),
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Files no role may read, change or list, as .gitignore patterns. */
function PrivateRow({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  const [typed, setTyped] = useState(prefs.privateFiles.join("\n"));
  const defaults = prefs.privateFiles.join("\n") === DEFAULT_PRIVATE.join("\n");
  const use = (patterns: string[]) => {
    setTyped(patterns.join("\n"));
    onChange({ privateFiles: patterns });
  };
  return (
    <div className="srow private">
      <label htmlFor="s-private">
        <b>Private files</b>
        <span className="d">
          No role can read, change, list or search these, so they never reach a model, and the review's diff leaves them
          out. One pattern a line, as in .gitignore. A line starting with ! keeps a file shared.
        </span>
        {!defaults && (
          <button type="button" className="btn sm ghost" onClick={() => use(DEFAULT_PRIVATE)}>
            Use the defaults
          </button>
        )}
      </label>
      <textarea
        id="s-private"
        rows={Math.max(4, typed.split("\n").length)}
        spellCheck={false}
        autoComplete="off"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange({ privateFiles: lines(e.target.value) });
        }}
        onBlur={() => setTyped(prefs.privateFiles.join("\n"))}
      />
    </div>
  );
}

/** The person's MCP servers, or why the JSON they pasted can't be used, with nothing to say for none. */
export function readMcpServers(text: string): { servers: McpServer[]; problem?: string } {
  if (!text.trim()) return { servers: [] };
  try {
    return { servers: parseMcpServers(JSON.parse(text)) };
  } catch (e) {
    const problem = e instanceof SyntaxError ? `That isn't valid JSON yet: ${e.message}` : String((e as Error).message);
    return { servers: [], problem };
  }
}

const EXAMPLE = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" }
    }
  }
}`;

/** MCP servers, pasted as JSON in the shape their READMEs give. */
function McpRow({ prefs, onChange }: { prefs: Prefs; onChange: (change: Partial<Prefs>) => void }) {
  const { servers, problem } = readMcpServers(prefs.mcpServers);
  return (
    <div className="srow mcp">
      <label htmlFor="s-mcp">
        <b>MCP servers</b>
        <span className="d">
          Tools for every role from servers you add, such as GitHub, a database or your docs. Paste the JSON from a
          server's README. Shoji starts each server in the thread's copy of the project. Tools that only look run on
          their own; anything that could change something waits for you, like a command. What you paste stays on this
          computer.
        </span>
      </label>
      <textarea
        id="s-mcp"
        rows={Math.min(16, Math.max(6, prefs.mcpServers.split("\n").length))}
        spellCheck={false}
        autoComplete="off"
        placeholder={EXAMPLE}
        value={prefs.mcpServers}
        onChange={(e) => onChange({ mcpServers: e.target.value })}
      />
      {problem ? (
        <p className="d" role="alert">
          {problem}
        </p>
      ) : (
        servers.length > 0 && (
          <ul className="mcplist">
            {servers.map((s) => (
              <li key={s.name}>
                <b>{s.name}</b>
                <code>{s.url ?? [s.command, ...(s.args ?? [])].join(" ")}</code>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
