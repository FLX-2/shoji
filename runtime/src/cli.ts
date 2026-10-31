import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { readAttachments } from "./attachments";
import type { RuntimeEvent } from "./events";
import { hasChanges, isGitRepo } from "./git";
import { connectMcp, type Mcp, parseMcpServers, transportFor } from "./mcp";
import { applyCatalog, MODELS, parseCatalog } from "./models";
import { writeNotes, type NotesEvent } from "./notes";
import { runThread } from "./pipeline";
import { defaultChecks } from "./project";
import { AnthropicProvider } from "./provider";
import { answerQuestion } from "./question";
import { describeStacks, parseStack, type Stack, STACKS, type StackName } from "./stack";
import { describeBriefing, finished, runTrial, type TrialEvent, type TrialTask } from "./trial";
import { DEFAULT_PRIVATE, Workspace } from "./workspace";

const USAGE = `Usage: shoji-runtime --task "<what to change>" [options]
       shoji-runtime --trial-file <file> [options]
       shoji-runtime --notes [options]

Options:
  --repo <path>       Project folder, a git repository (default: current folder)
  --stack <name>      ${Object.keys(STACKS).join(", ")} (default: balanced)
  --stack-json <json> Each role's model and effort, as {"plan":{"model":…,"effort":…},…};
                      takes the place of --stack
  --cap <dollars>     Hard spending limit for this thread (default: 0.50)
  --check <command>   A command that must pass; repeat for more (default: the project's
                      typecheck, lint and test scripts)
  --changes <notes>   Build the person's requested changes on top of finished work,
                      skipping scout and plan; needs --plan-file
  --plan-file <file>  The plan of the work being changed, built or planned again
  --question <text>   Answer the person's question about the work in the project, changing
                      nothing; needs --plan-file. The stack's scout answers
  --plan-only         Stop once the plan is written, for the person to build or change
  --build             Build the plan in --plan-file, which the person approved, skipping
                      scout and plan
  --replan <notes>    Scout and plan again from the plan in --plan-file and the person's
                      notes on it
  --failing-before <command>
                      A check that failed before the thread's first build, for a --changes
                      run to leave alone; repeat for more
  --failing-test-before <name>
                      A failure one of those checks named then, so a new one still counts;
                      repeat for more
  --allow <command>   A command beyond the checks that may run without asking; repeat
                      for more. Any other command asks first: with --json, the run writes
                      an "ask" event and reads {"allow":true} or {"allow":false} on stdin
  --attach <file>     A screenshot, PDF or text file for every role to see with the task;
                      repeat for more
  --private <pattern> A file no role may read, change or list, as in .gitignore; repeat
                      for more. Without it, env files and keys are private. An empty
                      pattern keeps nothing private
  --trial-file <file> Replay accepted tasks on the stack instead of running one, each in a
                      scratch copy of the project at the parent of its accepted commit. The
                      file holds {"tasks":[{"task":…,"commit":<accepted>,"was":<dollars>},…]};
                      --cap covers the whole trial
  --notes             Have the stack's scout read the project and write SHOJI.md, the notes
                      Plan reads before every task. Git is told to ignore the file. A project
                      that already has one keeps it
  --models-json <json>
                      The downloaded model list, as {"version":1,"updated":…,"models":{…}};
                      adds models and updates prices over the built-in list
  --mcp-json <json>   MCP servers whose tools the roles may use, as {"mcpServers":{"name":
                      {"command":…,"args":[…],"env":{…}} or {"url":…}}}. Tools that say they
                      only read run at once; any other asks first, as a command does
  --log <file>        Append every event to a JSON lines file
  --json              Print events as JSON lines, for the app
  --allow-dirty       Run even if the project has uncommitted changes
  --base-url <url>    Anthropic API address (default: https://api.anthropic.com)

Stacks (model and effort for each role):
${describeStacks()}

The API key comes from SHOJI_API_KEY or ANTHROPIC_API_KEY.`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

let answers: AsyncIterator<string> | undefined;

/** Waits for the person's answer about a command: a JSON line from the app, or y or n at a terminal.
 *  An answer that never comes, because the input closed, is no. */
async function askPerson(command: string, json: boolean | undefined): Promise<boolean> {
  if (!json) process.stderr.write(`Allow \`${command}\` to run? [y/N] `);
  answers ??= readline.createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  const { value, done } = await answers.next();
  if (done) return false;
  if (!json) return /^\s*y(es)?\s*$/i.test(value);
  try {
    return (JSON.parse(value) as { allow?: unknown }).allow === true;
  } catch {
    return false;
  }
}

/** The attached files, read now so one Shoji can't send stops the run before it spends. */
function attached(files: string[]) {
  try {
    return readAttachments(files);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function describe(event: RuntimeEvent): string | null {
  switch (event.type) {
    case "step":
      return event.status === "running" ? `${event.step} · ${MODELS[event.model].label}` : null;
    case "tool":
      return `  ${event.tool} ${event.target}`;
    case "call":
      return `  $${event.call.cost.toFixed(4)}  ${event.call.inputTokens} in, ${event.call.outputTokens} out, ${event.call.cacheReadTokens} cached`;
    case "checks":
      return event.results
        .map(
          (c) =>
            `  ${c.ok ? "passed" : c.failedBefore ? "failed, as it did before" : c.newFailures ? `failed, newly: ${c.newFailures.join(", ")}` : "failed"}: ${c.command}`,
        )
        .join("\n");
    case "escalate":
      return `  moving up to ${MODELS[event.to].label}: ${event.reason}`;
    case "ask":
      return null; // The question itself is asked on stderr.
    case "answer":
      return `  ${event.allowed ? "allowed" : "not allowed"}: ${event.command}`;
    case "mcp":
      return "error" in event
        ? `  couldn't reach the ${event.server} MCP server: ${event.error}`
        : `  ${event.server} MCP server: ${event.tools} tools`;
    case "result": {
      const r = event.result;
      const roles = Object.entries(r.costByRole)
        .map(([role, cost]) => `${role} $${cost.toFixed(4)}`)
        .join(", ");
      return `\n${r.status}${r.reason ? `: ${r.reason}` : ""}\ncost $${r.cost.toFixed(4)} (${roles})\n\n${r.review}`;
    }
  }
}

function describeTrial(event: TrialEvent): string | null {
  switch (event.type) {
    case "task":
      return `\nTask ${event.index + 1} of ${event.total}: ${event.task.split("\n")[0]}`;
    case "runtime":
      return event.event.type === "result" ? null : describe(event.event);
    case "outcome":
      return `${event.outcome.status}, $${event.outcome.cost.toFixed(4)} (was $${event.outcome.was.toFixed(4)})`;
    case "briefing":
      return `\n${describeBriefing(event.briefing)}`;
  }
}

function describeNotes(event: NotesEvent): string | null {
  if (event.type !== "notes") return describe(event);
  const r = event.result;
  if (r.status === "kept") return "The project already has a SHOJI.md, so it was kept.";
  return r.status === "ready" ? `\nWrote SHOJI.md for $${r.cost.toFixed(4)}.` : `\n${r.status}: ${r.reason}`;
}

function readTrialTasks(file: string): TrialTask[] {
  let tasks: unknown;
  try {
    tasks = JSON.parse(fs.readFileSync(file, "utf8")).tasks;
  } catch (e) {
    fail(`Couldn't read the trial file: ${e instanceof Error ? e.message : String(e)}`);
  }
  const valid = (t: Partial<TrialTask>) =>
    typeof t?.task === "string" && typeof t.commit === "string" && typeof t.was === "number";
  if (!Array.isArray(tasks) || tasks.length === 0 || !tasks.every(valid)) {
    fail('The trial file needs {"tasks":[{"task":…,"commit":<accepted>,"was":<dollars>},…]}.');
  }
  return tasks;
}

async function main() {
  const { values } = parseArgs({
    options: {
      task: { type: "string" },
      repo: { type: "string", default: process.cwd() },
      stack: { type: "string", default: "balanced" },
      "stack-json": { type: "string" },
      "models-json": { type: "string" },
      "mcp-json": { type: "string" },
      cap: { type: "string", default: "0.50" },
      check: { type: "string", multiple: true },
      changes: { type: "string" },
      "plan-only": { type: "boolean", default: false },
      build: { type: "boolean", default: false },
      replan: { type: "string" },
      question: { type: "string" },
      "plan-file": { type: "string" },
      "failing-before": { type: "string", multiple: true },
      "failing-test-before": { type: "string", multiple: true },
      attach: { type: "string", multiple: true },
      allow: { type: "string", multiple: true },
      private: { type: "string", multiple: true },
      "trial-file": { type: "string" },
      notes: { type: "boolean", default: false },
      log: { type: "string" },
      json: { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
      "base-url": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (!values.task && !values["trial-file"] && !values.notes) fail(USAGE);
  // Before the stack, which may name a model only the list knows.
  if (values["models-json"] !== undefined) {
    try {
      applyCatalog(parseCatalog(JSON.parse(values["models-json"])));
    } catch (e) {
      fail(`Couldn't use the model list: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let servers: ReturnType<typeof parseMcpServers> = [];
  if (values["mcp-json"] !== undefined) {
    try {
      servers = parseMcpServers(JSON.parse(values["mcp-json"]));
    } catch (e) {
      fail(`Couldn't use the MCP servers: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let stack: Stack;
  if (values["stack-json"] !== undefined) {
    try {
      stack = parseStack(values["stack-json"]);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  } else if (values.stack in STACKS) stack = STACKS[values.stack as StackName];
  else fail(`Unknown stack "${values.stack}". Choose ${Object.keys(STACKS).join(", ")}.`);
  const cap = Number(values.cap);
  if (!(cap > 0)) fail("--cap must be a positive number of dollars.");
  const apiKey = process.env.SHOJI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) fail("Set SHOJI_API_KEY or ANTHROPIC_API_KEY.");

  const continuing = [
    values.changes !== undefined,
    values.build,
    values.replan !== undefined,
    values.question !== undefined,
  ].filter(Boolean).length;
  if (continuing > 1) fail("Use one of --changes, --build, --replan and --question.");
  if (continuing && !values["plan-file"]) fail("--changes, --build, --replan and --question need --plan-file.");
  const plan = values["plan-file"] ? fs.readFileSync(values["plan-file"], "utf8") : "";
  const changes = values.changes !== undefined ? { notes: values.changes, plan } : undefined;
  const replan = values.replan !== undefined ? { notes: values.replan, plan } : undefined;

  const root = path.resolve(values.repo);
  if (!isGitRepo(root)) fail(`${root} isn't a git repository.`);
  const log = values.log ? fs.openSync(values.log, "a") : null;
  const write = (event: object, text: string | null) => {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    if (log !== null) fs.writeSync(log, `${line}\n`);
    if (values.json) process.stdout.write(`${line}\n`);
    else if (text) process.stdout.write(`${text}\n`);
  };
  const provider = new AnthropicProvider(apiKey, values["base-url"]);

  const privateFiles = values.private ?? DEFAULT_PRIVATE;

  if (values.notes) {
    const result = await writeNotes({
      root,
      privateFiles,
      seat: stack.scout,
      provider,
      cap,
      emit: (event) => write(event, describeNotes(event)),
    });
    process.exitCode = result.status === "ready" || result.status === "kept" ? 0 : 1;
    return;
  }
  if (values["trial-file"]) {
    const tasks = readTrialTasks(values["trial-file"]);
    const briefing = await runTrial({
      root,
      tasks,
      stack,
      provider,
      cap,
      privateFiles,
      checks: values.check ? () => values.check! : undefined,
      emit: (event) => write(event, describeTrial(event)),
    });
    process.exitCode = briefing.outcomes.some((o) => finished(o.status)) ? 0 : 1;
    return;
  }
  if (!values.task) fail(USAGE);
  // Later runs build on the thread's own uncommitted work, so only a fresh thread needs a clean project.
  if (!continuing && hasChanges(root) && !values["allow-dirty"]) {
    fail(
      values.json
        ? "The project has uncommitted changes. Commit or stash them, then start the thread again."
        : "The project has uncommitted changes. Commit or stash them, or pass --allow-dirty.",
    );
  }

  // Connected only for a task or a question, after every check that could stop the run first.
  const emit = (event: RuntimeEvent) => write(event, describe(event));
  const mcp: Mcp = await connectMcp(servers, emit, (server) => transportFor(server, root));
  try {
    if (values.question !== undefined) {
      const result = await answerQuestion({
        task: values.task,
        plan,
        question: values.question,
        seat: stack.scout,
        provider,
        workspace: new Workspace(root, privateFiles),
        cap,
        emit,
        mcp,
      });
      process.exitCode = result.status === "answered" ? 0 : 1;
      return;
    }

    const result = await runThread({
      task: values.task,
      stack,
      provider,
      workspace: new Workspace(root, privateFiles),
      checks: values.check ?? defaultChecks(root),
      cap,
      changes,
      planOnly: values["plan-only"],
      approved: values.build ? plan : undefined,
      replan,
      failingBefore: values["failing-before"],
      failingTestsBefore: values["failing-test-before"],
      ...(values.attach?.length && { attachments: attached(values.attach) }),
      allowed: values.allow,
      ask: (command) => askPerson(command, values.json),
      emit,
      mcp,
    });
    process.exitCode = result.status === "ready" || result.status === "planned" ? 0 : 1;
  } finally {
    await mcp.close();
  }
}

main();
