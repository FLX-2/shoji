# Contributing to Shoji

Thanks for helping. Shoji is free and open source under the [MIT license](LICENSE), and contributions are welcome.

## Before you start

- **Bugs:** [open a bug report](https://github.com/FLX-2/shoji/issues/new?template=bug_report.yml) with the steps that cause it.
- **Ideas:** [open a feature request](https://github.com/FLX-2/shoji/issues/new?template=feature_request.yml) before you build anything large, so we can agree on the shape first.
- **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Set up

Follow [Build from source](README.md#build-from-source) in the README, then run the app with `pnpm tauri dev`.

The code lives in three places:

| Folder | What's there |
| --- | --- |
| `src/` | The React and TypeScript front end |
| `src-tauri/` | The Rust shell |
| `runtime/` | The agent runtime that plans, builds, checks and reviews. TypeScript, compiled with Bun into the sidecar the app bundles |
| `site/` | The website, a static page with no dependencies |

## Before you open a pull request

These must pass. CI runs them, then builds the app on macOS, Windows and Linux.

```sh
pnpm test
pnpm typecheck
pnpm build
```

- **Tests never call a model.** Runtime tests answer as each role through `ScriptedProvider` in `runtime/test/helpers.ts`. Add recorded answers rather than a live call.
- **Keep spending small.** If you run the runtime live, use Haiku with a hard cap: `pnpm runtime --repo <path> --task "…" --stack haiku --cap 0.05`.
- **Keep a pull request to one change**, and say in it what you checked.

## Design

Shoji's look is the Zone design system, and restraint is part of it.

- Colours come from the tokens in `src/styles/tokens.css`. Don't add new ones, and draw faint lines and fills from `--ink-rgb` so the dark and paper themes both turn over.
- Red only means running or spending. Green and the softer red only mark how something came out, on small marks and short words.
- Every motion uses the duration and easing tokens, and every effect can be turned off in Settings.
- Every element earns its place: no placeholders, stray numbers or controls that do nothing yet.

## Releasing

For maintainers. Set the same version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, merge it, then push a tag for it, such as `v0.2.0`. The Release workflow builds each system and attaches the installers to a draft release. Read the draft, then publish it. Publish it as a full release, not a pre-release: the website's download buttons and Shoji's update check both use GitHub's latest release, which skips pre-releases.

### Update signing

Shoji updates itself from the latest release. Each build is signed, and Shoji installs only an update whose signature matches the public key built into it. Set this up once, before the first release:

1. On your own computer, in this repository, run `pnpm tauri signer generate -w ~/.tauri/shoji.key` and choose a password. It writes the private key to `~/.tauri/shoji.key` and the public key to `~/.tauri/shoji.key.pub`.
2. In the repository's Settings, under Secrets and variables, Actions, add `TAURI_SIGNING_PRIVATE_KEY` with the whole contents of `shoji.key`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with its password.
3. Put the contents of `shoji.key.pub` in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and merge it.

Keep `shoji.key` and its password somewhere safe, such as a password manager. Never commit them. If the private key is lost, installed copies of Shoji can't update to anything signed with a new one, and everyone has to download the next release by hand.

With no public key set, the Release workflow warns and builds without update signing. With a public key but no secret, it stops.
