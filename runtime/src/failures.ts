/**
 * The failures a check's output names, one line each, so Shoji can tell a test it broke from one
 * that was failing before it started. Reads the common test runners and the TypeScript compiler;
 * for anything else it finds nothing, and the check is judged as a whole.
 */
const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  // Vitest and Jest name a failing file or test after FAIL; Vitest adds "[ file ]", Jest a time.
  [/^\s*FAIL\s+(.+?)\s*$/gm, (m) => `FAIL ${m[1].replace(/\s+\[.*\]$/, "").replace(/\s+\([\d.]+\s*m?s\)$/, "")}`],
  // Jest names each failing test after a bullet, outside its console and suite errors.
  [/^\s*●\s+(?!Console\b|Test suite failed to run)(.+?)\s*$/gm, (m) => `● ${m[1]}`],
  // pytest, before its " - reason".
  [/^FAILED\s+(\S+)/gm, (m) => `FAILED ${m[1]}`],
  // cargo test and go test.
  [/^test\s+(\S+)\s+\.\.\.\s+FAILED\s*$/gm, (m) => `test ${m[1]}`],
  [/^\s*--- FAIL:\s+(\S+)/gm, (m) => `--- FAIL: ${m[1]}`],
  // tsc, by file and error code: the line moves when the file is edited, the error doesn't.
  [/^(\S[^(\n]*?)(?:\(\d+,\d+\)|:\d+:\d+)\s*[:-]\s*error\s+(TS\d+)/gm, (m) => `${m[1]} ${m[2]}`],
];

export function failingIn(output: string): string[] {
  const found = new Set<string>();
  for (const [pattern, name] of PATTERNS) for (const m of output.matchAll(pattern)) found.add(name(m));
  return [...found];
}
