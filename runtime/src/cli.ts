import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { RuntimeEvent } from "./events";
import { hasChanges, isGitRepo } from "./git";
import { MODELS } from "./models";
import { runThread } from "./pipeline";
import { defaultChecks } from "./project";
import { AnthropicProvider } from "./provider";
import { describeStacks, parseStack, type Stack, STACKS, type StackName } from "./stack";
import { describeBriefing, finished, runTrial, type TrialEvent, type TrialTask } from "./trial";
import { Workspace } from "./workspace";

const USAGE = `Usage: shoji-runtime --task "<what to change>" [options]
       shoji-runtime --trial-file <file> [options]

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
  --plan-file <file>  The plan of the work being changed
  --trial-file <file> Replay accepted tasks on the stack instead of running one, each in a
                      scratch copy of the project at the parent of its accepted commit. The
                      file holds {"tasks":[{"task":…,"commit":<accepted>,"was":<dollars>},…]};
                      --cap covers the whole trial
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

function describe(event: RuntimeEvent): string | null {
  switch (event.type) {
    case "step":
      return event.status === "running" ? `${event.step} · ${MODELS[event.model].label}` : null;
    case "tool":
      return `  ${event.tool} ${event.target}`;
    case "call":
      return `  $${event.call.cost.toFixed(4)}  ${event.call.inputTokens} in, ${event.call.outputTokens} out, ${event.call.cacheReadTokens} cached`;
    case "checks":
      return event.results.map((c) => `  ${c.ok ? "passed" : "failed"}: ${c.command}`).join("\n");
    case "escalate":
      return `  moving up to ${MODELS[event.to].label}: ${event.reason}`;
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
      cap: { type: "string", default: "0.50" },
      check: { type: "string", multiple: true },
      changes: { type: "string" },
      "plan-file": { type: "string" },
      "trial-file": { type: "string" },
      log: { type: "string" },
      json: { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
      "base-url": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (!values.task && !values["trial-file"]) fail(USAGE);
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

  if (values.changes !== undefined && !values["plan-file"]) fail("--changes needs --plan-file.");
  const changes =
    values.changes !== undefined && values["plan-file"]
      ? { notes: values.changes, plan: fs.readFileSync(values["plan-file"], "utf8") }
      : undefined;

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

  if (values["trial-file"]) {
    const tasks = readTrialTasks(values["trial-file"]);
    const briefing = await runTrial({
      root,
      tasks,
      stack,
      provider,
      cap,
      checks: values.check ? () => values.check! : undefined,
      emit: (event) => write(event, describeTrial(event)),
    });
    process.exitCode = briefing.outcomes.some((o) => finished(o.status)) ? 0 : 1;
    return;
  }
  if (!values.task) fail(USAGE);
  // Changes build on the thread's own uncommitted work, so only a fresh thread needs a clean project.
  if (!changes && hasChanges(root) && !values["allow-dirty"]) {
    fail(
      values.json
        ? "The project has uncommitted changes. Commit or stash them, then start the thread again."
        : "The project has uncommitted changes. Commit or stash them, or pass --allow-dirty.",
    );
  }

  const result = await runThread({
    task: values.task,
    stack,
    provider,
    workspace: new Workspace(root),
    checks: values.check ?? defaultChecks(root),
    cap,
    changes,
    emit: (event) => write(event, describe(event)),
  });
  process.exitCode = result.status === "ready" ? 0 : 1;
}

main();
