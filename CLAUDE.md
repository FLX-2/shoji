# Shoji

A Tauri 2 desktop app: a React and TypeScript front end in `src/`, the Rust shell in `src-tauri/`, and the agent runtime in `runtime/`. The runtime is TypeScript compiled with Bun, and runs the plan, build, check and review loop.

## Commands

- `pnpm test`, `pnpm typecheck` and `pnpm build` must pass before every push. CI runs them, then builds the app on macOS, Windows and Linux.
- `pnpm tauri dev` runs the app. It needs Bun, which compiles the runtime into the sidecar the app bundles (`pnpm sidecar`). On Linux it also needs `libwebkit2gtk-4.1-dev` and `libdbus-1-dev`.
- `pnpm runtime --repo <path> --task "…" --stack haiku --cap 0.05` runs the runtime live on a git project.
- Runtime tests use `ScriptedProvider` in `runtime/test/helpers.ts` to answer as each role. They never call a model.

## Design

- The visual reference is the Shoji prototype. The Zone tokens in `src/styles/tokens.css` come from it. Use those variables and don't add new colours.
- Red (`--safe`) only means running or spending. Inside the app the mark is drawn without its red seal.
- Motion uses the duration and easing tokens. Every effect must be able to be turned off in Settings.
- Every element must earn its place. Don't add stray numbers, placeholders or controls that do nothing yet.
- Keep corners small and rounding light.

## Models and money

- The default stack: Opus 5.5 plans, Sonnet 5.5 builds, Haiku 5.5 scouts and reviews.
- The maintainer's API key has a small budget. Tests must replay recorded responses, never call a model. Live development runs use Haiku 5.5 only, with a hard spending cap.
- In cloud sessions the key is `SHOJI_API_KEY`. Never print it.
