# Shoji

A Tauri 2 desktop app: a React and TypeScript front end in `src/`, and the Rust shell in `src-tauri/`.

## Commands

- `pnpm test`, `pnpm typecheck` and `pnpm build` must pass before every push. CI runs them, then builds the app on macOS, Windows and Linux.
- `pnpm tauri dev` runs the app. On Linux it needs `libwebkit2gtk-4.1-dev`.

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
