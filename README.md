# Shoji

**The right model for every step.**

Shoji is a free desktop app for building software with AI. You describe a change, and a small team of models plans it, builds it and checks it, each model chosen for its step. You bring your own API keys and pay providers directly. Every finished task leaves a receipt showing which model ran each step and what it cost.

In a test on real tasks, routing each step to the right model cost 55% less per accepted change than running everything on one strong model, with the same acceptance rate.

## Status

Early. This is milestone 1: one thread that runs from plan to accepted change. Mac comes first. Windows and Linux build from the same code and get their polish later.

## Threads

Each thread gets its own branch. When you start a task, Shoji moves your project onto a new branch named after it, such as `shoji/add-a-faq`. If that name is taken, it adds `-2`, `-3` and so on. The project must be a git repo, on a branch rather than a detached commit, with no uncommitted changes. That includes untracked files. Shoji refuses to start otherwise. When you request changes, the thread carries on in the same branch, and the project must still be on it.

Code lists every file the thread changed, with its diff. Accept keeps a file's changes and stages it in git. Revert puts the file back as it was at the last commit, or deletes it if the thread created it. Shoji asks before it reverts. Both buttons are unavailable while a run is going.

Revert anything you don't want. Accept and commit then commits the rest as one commit on the thread's branch, using your own git name and email, so `user.name` and `user.email` must be set. The message is the task, followed by `Shoji-Models:` and `Shoji-Cost:` lines.

Shoji never pushes. The commit and the branch stay on your machine. Merging or pushing is up to you.

## Run it

You need [Node 22](https://nodejs.org), [pnpm](https://pnpm.io), [Rust](https://rustup.rs) and [Bun](https://bun.sh), which compiles the agent runtime that the app bundles. On Linux you also need the [Tauri system libraries](https://v2.tauri.app/start/prerequisites/) and `libdbus-1-dev` for the keychain.

```sh
pnpm install
pnpm tauri dev
```

Other commands:

| Command | What it does |
| --- | --- |
| `pnpm test` | Runs the tests |
| `pnpm typecheck` | Checks types |
| `pnpm tauri build` | Builds the installable app for this computer |

Shoji asks for your Anthropic API key in Settings and keeps it in the system keychain. When you start it from a shell, it also uses `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`. For a cheap first try, pick the Haiku stack in Settings.

### The agent runtime

The loop that plans, builds and checks a change lives in `runtime/`. The app runs it as a separate program, so a crashed run never takes the window down. You can also run it on any git project from the command line, with an Anthropic API key in `SHOJI_API_KEY` or `ANTHROPIC_API_KEY`.

```sh
pnpm runtime --repo ../my-project --task "Add a dark mode toggle" --cap 0.50
```

`--stack haiku` runs every step on Haiku 5.5, which costs a fraction of a cent per task. `--help` lists every option. The runtime stops before any call that could take the thread past its `--cap`.

Every push to a pull request also builds the app for Mac, Windows and Linux. The builds are attached to the CI run.

Builds aren't signed yet. The first time you open Shoji on a Mac, Control-click the app and choose Open. If macOS still blocks it, allow it under System Settings, Privacy & Security.

## License

[MIT](LICENSE)
