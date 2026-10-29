// Compiles the agent runtime into the sidecar program that the app bundles. Tauri looks for
// it as src-tauri/binaries/shoji-runtime-<target triple>, so the name carries the triple.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (\S+)$/m)[1];

const BUN_TARGETS = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "x86_64-pc-windows-msvc": "bun-windows-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
};
const target = BUN_TARGETS[triple];
if (!target) throw new Error(`Shoji can't build its runtime for ${triple} yet.`);

mkdirSync("src-tauri/binaries", { recursive: true });
const out = `src-tauri/binaries/shoji-runtime-${triple}${triple.includes("windows") ? ".exe" : ""}`;
execFileSync("bun", ["build", "runtime/src/cli.ts", "--compile", `--target=${target}`, "--outfile", out], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
