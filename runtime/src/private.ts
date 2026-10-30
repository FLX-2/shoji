// No node imports here: the app's Settings shows these defaults too.

/** What Shoji keeps private unless the person says otherwise: env files and keys. */
export const DEFAULT_PRIVATE = [".env", ".env.*", "!.env.example", "*.pem", "*.key", "id_rsa*", "id_ed25519*", ".npmrc"];

export interface Rule {
  keep: boolean;
  regex: RegExp;
}

/** A .gitignore-style pattern as a test on a project-relative path: a pattern without a slash
 *  matches a file or folder of that name anywhere, `*` stays inside one folder, `**` crosses them. */
export function rule(line: string): Rule | null {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return null;
  const keep = pattern.startsWith("!");
  if (keep) pattern = pattern.slice(1);
  pattern = pattern.replace(/\/$/, "");
  const anchored = pattern.includes("/");
  pattern = pattern.replace(/^\//, "");
  const escape = (part: string) =>
    part
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");
  // "**/" is any number of folders, none included; any other "**" is anything at all.
  const body = pattern
    .split("**/")
    .map((part) => part.split("**").map(escape).join(".*"))
    .join("(?:.*/)?");
  return { keep, regex: new RegExp(`${anchored ? "^" : "(^|/)"}${body}(/|$)`) };
}
