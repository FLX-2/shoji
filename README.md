# Shoji

**The right model for every step.**

Shoji is a free desktop app for building software with AI. You describe a change, and a small team of models plans it, builds it and checks it, each model chosen for its step. You bring your own API keys and pay providers directly. Every finished task leaves a receipt showing which model ran each step and what it cost.

In a test on real tasks, routing each step to the right model cost 55% less per accepted change than running everything on one strong model, with the same acceptance rate.

## Status

Early. This is milestone 1: one thread that runs from plan to accepted change. Mac comes first. Windows and Linux build from the same code and get their polish later.

## Run it

You need [Node 22](https://nodejs.org), [pnpm](https://pnpm.io) and [Rust](https://rustup.rs). On Linux you also need the [Tauri system libraries](https://v2.tauri.app/start/prerequisites/).

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

Every push to a pull request also builds the app for Mac, Windows and Linux. The builds are attached to the CI run.

Builds aren't signed yet. The first time you open Shoji on a Mac, Control-click the app and choose Open. If macOS still blocks it, allow it under System Settings, Privacy & Security.

## License

[MIT](LICENSE)
