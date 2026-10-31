# Shoji

A Tauri 2 desktop app: a React and TypeScript front end in `src/`, the Rust shell in `src-tauri/`, and the agent runtime in `runtime/`. The runtime is TypeScript compiled with Bun, and runs the plan, build, check and review loop.

## Commands

- `pnpm test`, `pnpm typecheck` and `pnpm build` must pass before every push. CI runs them, then builds the app on macOS, Windows and Linux.
- `pnpm tauri dev` runs the app. It needs Bun, which compiles the runtime into the sidecar the app bundles (`pnpm sidecar`). On Linux it also needs `libwebkit2gtk-4.1-dev` and `libdbus-1-dev`.
- `pnpm runtime --repo <path> --task "…" --stack haiku --cap 0.05` runs the runtime live on a git project.
- `pnpm review-check` asks the review seat to judge diffs with planted bugs and clean controls (`runtime/eval/`). It calls a model, so run it on Haiku with a cap and keep its results in `runtime/eval/results/`.
- `pnpm estimate-check` compares Receipts' one-model estimate with the routing spike's real Opus runs (`src/receipts/fixtures/spike.json`). It calls no model.
- Runtime tests use `ScriptedProvider` in `runtime/test/helpers.ts` to answer as each role. They never call a model.

## Design

- The visual reference is the [Shoji board](https://claude.ai/artifact/QmS9N3LtJjXorvwgz7LE6D), drawn with the [Zone design system](https://claude.ai/artifact/SLqCMkNxsJ3gPiBLvZ2rSx). The old prototype is retired. A UI change starts on the board, or updates it in the same PR. A change to the tokens or a shared component updates Zone too.
- The Zone tokens live in `src/styles/tokens.css`. Use those variables and don't add new colours.
- Zone has two themes, Dark (the darkroom) and Light (paper), set on `<html data-theme>`. Every colour must come from a token so both turn over: draw faint lines and fills in `rgba(var(--ink-rgb), a)`, never in literal white or black.
- Red (`--safe`) only means running or spending. Inside the app the mark is drawn without its red seal.
- Green (`--good`) and a softer red (`--bad`) only mark how something came out: passed or failed, added or removed. Use them on small marks and short words, never on surfaces. The Windows Close button's hover red is the system's own.
- Motion uses the duration and easing tokens. Every effect must be able to be turned off in Settings.
- Every element must earn its place. Don't add stray numbers, placeholders or controls that do nothing yet.
- Keep corners small and rounding light.
- Structure is bento: panes, groups and figures meet on hairlines with square joins. Controls are lifted: a choice sits in a 5px tray (`.seg`) and the pick rises as a 3px `--z3` tile, like the thread's Conversation and Code switch. Switches and toggled chips use the same tile. White fill is only for the button that moves the work on.

## Models and money

- The default stack: Opus 5.5 plans, Sonnet 5.5 builds, Haiku 5.5 scouts and reviews.
- The maintainer's API key has a small budget. Tests must replay recorded responses, never call a model. Live development runs use Haiku 5.5 only, with a hard spending cap.
- In cloud sessions the key is `SHOJI_API_KEY`. Never print it.
