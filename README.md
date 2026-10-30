# Shoji

**The right model for every step.**

Shoji is a free desktop app for building software with AI. You describe a change, and a small team of models plans it, builds it and checks it, each model chosen for its step. You bring your own API keys and pay providers directly. Every finished task leaves a receipt showing which model ran each step and what it cost.

In a test on real tasks, routing each step to the right model cost 55% less per accepted change than running everything on one strong model, with the same acceptance rate.

## Status

Getting ready for a private beta. Everything below works today. Mac comes first. Windows and Linux build from the same code and get their polish later. Models come from Anthropic only for now; other providers come after the beta.

## Install

Download the installer for your system from [Releases](https://github.com/FLX-2/shoji/releases). The Mac build is for Apple silicon.

Builds aren't signed yet. The first time you open Shoji on a Mac, Control-click the app and choose Open. If macOS still blocks it, allow it under System Settings, Privacy & Security. On Windows, if SmartScreen stops the installer, choose More info, then Run anyway.

The first time Shoji opens, setup asks for your Anthropic API key, picks a stack, opens a project and lets you choose a look.

## What it does

**Home.** Describe a task. Attach screenshots, PDFs or text files with the clip, or paste an image. Pick how much the task is worth: Draft moves Build and Review down one model, Max puts Build on the Plan model, and Balanced follows your stack. Once you've finished a few tasks, Home shows what a task usually costs at that setting.

**Threads.** Scout reads the code, Plan writes the steps, Build makes the change and Review judges it. Plan, Build and Review follow the project's own `AGENTS.md` and `CLAUDE.md` when it has them, and Plan also reads the `SHOJI.md` notes that setup can write. With Check the plan first on, the thread pauses after the plan so you can build it or ask for another. Each thread has three views:

- **Conversation:** each step with its model, its work and what it cost.
- **Code:** every file the thread changed, with its diff.
- **Preview:** your project's dev server at 360, 768 or 1280 px. You run the dev server. The address is remembered per project and starts at `http://localhost:5173`.

A role can run the project's checks at any time. Any other command, such as installing a package, waits for you to allow it once, always for that project, or not at all.

**Receipts.** What each thread cost, step by step, against running everything on one strong model. You can export a month as CSV.

**Stack.** Which model and effort takes each role, saved to `stack.lock` with its history. A trial replays your latest accepted tasks on another stack, in scratch copies of your project, and reports what changed. Watching compares this week with the four weeks before, and names a model that got slower, more expensive or worse at its role.

**Limits.** Each thread has a spending limit, and the runtime stops before any call that could take it past. A daily limit asks before a thread or trial could take the day past it.

## Your data

- Your API key stays in the system keychain. Shoji sends it only to Anthropic.
- Your code goes only to the model provider, and only what a role reads or you attach.
- **Private files** never go at all. By default those are env files and keys: `.env`, `.env.*` (but not `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*` and `.npmrc`. No role can read, change, list or search them, and the reviewer's diff leaves them out. Edit the list in Settings, under Data, with patterns as in `.gitignore`.
- Receipts and run logs stay on your computer. There is no Shoji server, and Shoji sends no usage data.
- Once a day Shoji downloads the list of models and their prices from this repository, [`catalog/models.json`](catalog/models.json), so a new model or price needs no new release. The download carries nothing about you or your work. Turn it off in Settings, under Data.

## Threads and git

Each thread gets its own branch. When you start a task, Shoji moves your project onto a new branch named after it, such as `shoji/add-a-faq`. If that name is taken, it adds `-2`, `-3` and so on. The project must be a git repo, on a branch rather than a detached commit, with no uncommitted changes. That includes untracked files. Shoji refuses to start otherwise. When you request changes, the thread carries on in the same branch, and the project must still be on it.

Code lists every file the thread changed, with its diff. Accept keeps a file's changes and stages it in git. Revert puts the file back as it was at the last commit, or deletes it if the thread created it. Shoji asks before it reverts. Both buttons are unavailable while a run is going.

Revert anything you don't want. Accept and commit then commits the rest as one commit on the thread's branch, using your own git name and email, so `user.name` and `user.email` must be set. The message is the task, followed by `Shoji-Models:` and `Shoji-Cost:` lines.

Shoji never pushes. The commit and the branch stay on your machine. Merging or pushing is up to you.

## Build it yourself

You need [Node 22](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) and [Bun](https://bun.sh), which compiles the agent runtime that the app bundles. On Linux you also need the [Tauri system libraries](https://v2.tauri.app/start/prerequisites/) and `libdbus-1-dev` for the keychain.

```sh
pnpm install
pnpm tauri dev
```

Other commands:

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs the tests. They replay recorded model answers and never call a model |
| `pnpm typecheck` | Checks types |
| `pnpm tauri build` | Builds the installable app for this computer |

When you start Shoji from a shell, it also uses `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`.

Every push to a pull request also builds the app for Mac, Windows and Linux. The builds are attached to the CI run.

### The agent runtime

The loop that plans, builds and checks a change lives in `runtime/`. The app runs it as a separate program, so a crashed run never takes the window down. You can also run it on any git project from the command line, with an Anthropic API key in `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`.

```sh
pnpm runtime --repo ../my-project --task "Add a dark mode toggle" --cap 0.50
```

`--stack haiku` runs every step on Haiku 5.5, which costs a fraction of a cent per task. `--help` lists every option, including `--attach`, `--allow` and `--private`. The runtime stops before any call that could take the thread past its `--cap`.

### Releasing

Set the same version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, merge it, then push a tag for it, such as `v0.2.0`. The Release workflow builds each system and attaches the installers to a draft pre-release. Read the draft, then publish it.

## License

[MIT](LICENSE)
