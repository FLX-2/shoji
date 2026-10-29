import { spawnSync } from "node:child_process";
import fs from "node:fs";

const note = (title: string, text: string) =>
  console.log(`::notice title=${title}::${text.replace(/%/g, "%25").replace(/\r?\n/g, "%0A")}`);
const root = process.argv[2];
const tag = process.argv[3] ?? "";
const real = fs.realpathSync(root);
note(`${tag} context`, `realpath ${JSON.stringify(real)} native ${JSON.stringify(fs.realpathSync.native(root))} version ${process.version} path keys ${JSON.stringify(Object.keys(process.env).filter((k) => /^path$/i.test(k)))}`);
const variants: [string, string, NodeJS.ProcessEnv | undefined][] = [
  ["realpath, spread env", real, { ...process.env, CI: "1", FORCE_COLOR: "0" }],
  ["realpath, no env", real, undefined],
  ["raw path, spread env", root, { ...process.env, CI: "1", FORCE_COLOR: "0" }],
  ["raw path, no env", root, undefined],
];
for (const [label, cwd, env] of variants) {
  const r = spawnSync("pnpm run typecheck", { cwd, shell: true, encoding: "utf8", windowsHide: true, env });
  note(`${tag} ${label}: exit ${r.status}`, `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-700));
}
