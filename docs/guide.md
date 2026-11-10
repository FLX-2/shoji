# Shoji guide

Everything Shoji does, in detail. For a quick look, start with the [README](../README.md). The [website](https://shoji-app.vercel.app/) answers common questions.

- [First run](#first-run)
- [What each part does](#what-each-part-does)
- [Threads and git](#threads-and-git)
- [Your data](#your-data)
- [The agent runtime on the command line](#the-agent-runtime-on-the-command-line)

## First run

The first time Shoji opens, one Welcome page connects Anthropic, your ChatGPT plan or Ollama, picks a starting stack and opens a project. Besides the projects Shoji already knows, it offers git projects you worked on in Claude Code or Codex, found from the folder each of their sessions ran in. Nothing else is read from them. The look is in Settings. The project must be a git repo with at least one commit, and git needs your `user.name` and `user.email` set so Shoji can commit under your name.

Connect any of these in Settings, under Models and keys:

- **Anthropic.** Paste an API key. Shoji's default stack runs on Anthropic's models.
- **ChatGPT.** With ChatGPT Plus or Pro, Continue with ChatGPT signs you in in the browser, and OpenAI's models run on your plan with no API key and no API bill. If the plan's limit is reached, the thread stops and says so; Shoji never switches to paid use by itself. Manage usage opens your ChatGPT settings.
- **OpenAI.** Paste an API key to run OpenAI's models at API prices.
- **OpenRouter.** Connect OpenRouter signs you in on OpenRouter's site and hands Shoji a key, billed to your OpenRouter credit. Stack then lists its models that can use tools, at OpenRouter's prices.
- **Ollama.** Install [Ollama](https://ollama.com) and pull a model that can use tools. Shoji finds it on this computer, at `OLLAMA_HOST` if you set it. It's free, and your code stays on this computer.

Stack lists a provider's models only once it's connected, and its presets include a ready stack for your ChatGPT plan, OpenAI and Ollama. When you start Shoji from a shell, it also uses `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `OPENROUTER_API_KEY`.

## What each part does

**Home.** Describe a task. Type @ to point at one of the project's files, and Plan reads it in full. Attach screenshots, PDFs or text files with the clip, or paste an image. Pick how much the task is worth: Draft moves Build and Review down one model, Max puts Build on the Plan model, and Balanced follows your stack. Once you've finished a few tasks, Home shows what a task usually costs at that setting.

**Threads.** Scout reads the code, Plan writes the steps, Build makes the change and Review judges it. Plan, Build and Review follow the project's own `AGENTS.md` and `CLAUDE.md` when it has them, and Plan also reads the `SHOJI.md` notes that setup can write. With Check the plan first on, the thread pauses after the plan so you can build it or ask for another. Every thread you start is listed beside the one on show, with where it got to and what it cost. Open any of them to read it again, or carry it on. Each thread has three views:

- **Conversation:** each step with its model, its work and what it cost.
- **Code:** every file the thread changed, with its diff. Click a line's number to comment on it, then send your comments to Build as one request for changes. Edit opens a changed file to fix something small by hand; Ctrl+S (Cmd+S) saves and Escape cancels.
- **Preview:** your project's dev server at 360, 768 or 1280 px. Start dev server runs the project's dev command (guessed from its package manager, such as `pnpm dev`, and remembered per project) in the thread's own copy, so the preview shows that thread's work, and Preview uses the address the server prints. Each server gets a free `PORT`, so several threads can preview at once. Stop server, or quitting Shoji, stops it and everything it started. You can also point Preview at a server you run yourself; that address is remembered per project and starts at `http://localhost:5173`.
- **Terminal:** your own shell (your login shell on macOS and Linux, PowerShell on Windows) in the thread's copy of the project. It keeps running while you look at the other views, and ends when the thread is committed or Shoji quits.

Ask a question about a thread's work at any point. The Scout model reads the code and answers in the conversation, and nothing in the project changes.

A role can run the project's checks at any time. Any other command, such as installing a package, waits for you to allow it once, always for that project, or not at all.

**MCP servers.** Add servers in Settings, under Tools, by pasting the JSON from a server's README (`{"mcpServers": {…}}`, with a `command` or a `url`). Each run starts them in the thread's copy of the project. Scout gets the tools that only look; Build gets them all. A tool that could change something waits for you, like a command. A server that can't be reached is named in the conversation, and the run goes on without it.

**Looking at pages.** Build can start the project's dev server in its copy and open a page in a headless browser at 360, 768 or 1280 px. It sees a screenshot, the page's title and any errors in its console, so it can check a change to what a page shows. It uses the dev command Preview uses, and Chrome, Edge, Chromium or Brave from this computer (or the browser `SHOJI_BROWSER` names), with a profile of its own that's deleted after. The server and the browser stop when the run ends. Turn it off in Settings, under Tools.

**Look review.** When Build looked at pages, Review sees each page before the change and after it, at 360 and 1280 px, and scores the look out of 10. A look under 8 goes back to Build within the usual fix rounds, and the review's line in the thread gives the score. Each page adds four small screenshots to the review. Turn it off in Settings, under Tools, with Let Review judge the look.

**Commands and skills.** Shoji reads the same files Claude Code does. Type / at the start of a task or a request to pick one of the project's commands (`.claude/commands/*.md`) or your own (`~/.claude/commands`). The command's text becomes the task, with what you type after it in place of `$ARGUMENTS`, or `$1`, `$2` and on. Skills (`.claude/skills/<name>/SKILL.md`, and your own in `~/.claude/skills`) are listed for Scout and Build by name and description, and a role reads one in full when the task calls for it. Commands and skills you keep out of git still reach a thread's copy of the project. Shoji doesn't run the `!` shell lines some commands hold.

**Scheduled tasks.** Turn on Repeat under the task box to run a task by itself every day, on weekdays or once a week at a set time, in the open project. Threads lists your scheduled tasks above your threads, where you can pause or remove one. A scheduled task runs while Shoji is open; a time missed while it was closed runs once when it next opens. It never pauses after the plan, and it's skipped, and says why, when it could take the day past your daily limit, since nobody may be there to say yes.

**Receipts.** What each thread cost, step by step, against running everything on one strong model. You can export a month as CSV.

**Stack.** Which model and effort takes each role, saved to `stack.lock` with its history. A trial replays your latest accepted tasks on another stack, in scratch copies of your project, and reports what changed. Watching compares this week with the four weeks before, and names a model that got slower, more expensive or worse at its role.

**Limits.** Each thread has a spending limit, and the runtime stops before any call that could take it past. A daily limit asks before a thread or trial could take the day past it.

## Threads and git

Each thread gets its own branch and its own copy of the project, so several threads can run at once while your own checkout stays as it is. When you start a task, Shoji makes a git worktree on a new branch named after it, such as `shoji/add-a-faq`, in Shoji's data folder. If that name is taken, it adds `-2`, `-3` and so on. The copy starts from your project's last commit, so changes you haven't committed stay out of it. It links to your installed packages (`node_modules`, `.venv`, `venv`, `vendor`) rather than installing them again, and gets a copy of your `.env` files. The project must be a git repo with at least one commit. When you request changes, the thread carries on in the same copy.

Code lists every file the thread changed, with its diff. Accept keeps a file's changes and stages it in git. Revert puts the file back as it was at the last commit, or deletes it if the thread created it. Shoji asks before it reverts. Both buttons are unavailable while a run is going.

Revert anything you don't want. Accept and commit then commits the rest as one commit on the thread's branch, using your own git name and email, so `user.name` and `user.email` must be set. The message is the task, followed by `Shoji-Models:` and `Shoji-Cost:` lines. The thread's copy is then put away, so you can check the branch out in your project.

Shoji never pushes on its own. Once a thread is committed, Push and open PR pushes its branch to the project's `origin` (or its only remote) with your own git sign-in, then opens the page for a pull request on GitHub, GitLab or Bitbucket. If git would need to ask for a password, the push stops and says so; sign in to your git host in a terminal once, then press it again. Merging is up to you.

## Your data

- Your API keys stay in the system keychain. Shoji sends each only to its own provider. A ChatGPT sign-in is kept in a file only your user can read, and signing out revokes it.
- Your code goes only to the model provider, and only what a role reads or you attach.
- **Private files** never go at all. By default those are env files and keys: `.env`, `.env.*` (but not `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*` and `.npmrc`. No role can read, change, list or search them, and the reviewer's diff leaves them out. Edit the list in Settings, under Data, with patterns as in `.gitignore`.
- MCP servers get only what a role sends their tools. Shoji passes a server the environment a program needs plus what you set in its `env`, never your API key. The JSON you paste, tokens included, stays on this computer.
- Receipts and run logs stay on your computer. There is no Shoji server, and Shoji sends no usage data.
- Once a day Shoji downloads the list of models and their prices from this repository, [`catalog/v2/models.json`](../catalog/v2/models.json), so a new model or price needs no new release. The download carries nothing about you or your work. Turn it off in Settings, under Data.
- When Shoji opens, it asks this repository's [releases](https://github.com/FLX-2/shoji/releases) whether a newer Shoji is out. If one is, a note at the foot of the window offers Restart to update, once nothing is running. The update is checked against Shoji's signing key before it installs. The check carries nothing about you or your work. Turn it off in Settings, under Data.

## The agent runtime on the command line

The loop that plans, builds and checks a change lives in `runtime/`. The app runs it as a separate program, so a crashed run never takes the window down. You can also run it on any git project from the command line, with an Anthropic API key in `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`. For other providers, `--stack-json` names each role's model, as `openai/…` or `ollama/…`, with OpenAI's key in `OPENAI_API_KEY`; Ollama needs none.

```sh
pnpm runtime --repo ../my-project --task "Add a dark mode toggle" --cap 0.50
```

`--stack haiku` runs every step on Haiku 5.5, which costs a fraction of a cent per task. `--help` lists every option, including `--attach`, `--allow` and `--private`. The runtime stops before any call that could take the thread past its `--cap`.
