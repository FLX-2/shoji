import { spawnSync } from "node:child_process";
import fs from "node:fs";

const root = process.argv[2];
const real = fs.realpathSync(root);
console.log("realpath:", JSON.stringify(real), "native:", JSON.stringify(fs.realpathSync.native(root)));
console.log("process.version:", process.version, "PATH key:", Object.keys(process.env).filter((k) => /^path$/i.test(k)));
const variants: [string, string, NodeJS.ProcessEnv | undefined][] = [
  ["realpath, spread env", real, { ...process.env, CI: "1", FORCE_COLOR: "0" }],
  ["realpath, no env", real, undefined],
  ["raw path, spread env", root, { ...process.env, CI: "1", FORCE_COLOR: "0" }],
  ["raw path, no env", root, undefined],
];
for (const [label, cwd, env] of variants) {
  const r = spawnSync("pnpm run typecheck", { cwd, shell: true, encoding: "utf8", windowsHide: true, env });
  console.log(`=== ${label}: exit ${r.status}`);
  console.log(`${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-700));
}
