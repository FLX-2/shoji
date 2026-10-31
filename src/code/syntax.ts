/** What a stretch of a line is, for colouring code in the Zone greys: a keyword, a string, a comment, a number,
 *  or plain text. */
export type Kind = "keyword" | "string" | "comment" | "number" | "plain";

export interface Piece {
  text: string;
  kind: Kind;
}

interface Language {
  keywords: Set<string>;
  /** What starts a comment that runs to the end of the line. */
  line?: string;
  /** A comment's start and end that may sit inside one line. */
  block?: [string, string];
  /** Backticks hold strings, as in JavaScript. */
  backticks?: boolean;
  /** What a word looks like, when it isn't a plain identifier. */
  word?: RegExp;
}

const words = (text: string) => new Set(text.split(/\s+/));

const JS = words(`abstract as async await break case catch class const continue debugger declare default delete do else
  enum export extends false finally for from function get if implements import in instanceof interface keyof let new
  null of private protected public readonly return satisfies set static super switch this throw true try type typeof
  undefined var void while with yield`);

const LANGUAGES: Record<string, Language> = {
  js: { keywords: JS, line: "//", block: ["/*", "*/"], backticks: true },
  rust: {
    keywords: words(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop
      match mod move mut pub ref return self Self static struct super trait true type unsafe use where while`),
    line: "//",
    block: ["/*", "*/"],
  },
  python: {
    keywords: words(`and as assert async await break class continue def del elif else except False finally for from
      global if import in is lambda None nonlocal not or pass raise return True try while with yield`),
    line: "#",
  },
  go: {
    keywords: words(`break case chan const continue default defer else fallthrough false for func go goto if import
      interface map nil package range return select struct switch true type var`),
    line: "//",
    block: ["/*", "*/"],
    backticks: true,
  },
  css: {
    keywords: words("@import @media @supports @keyframes @font-face !important"),
    block: ["/*", "*/"],
    word: /[@!]?[A-Za-z_-][\w-]*/y,
  },
  shell: {
    keywords: words("if then else elif fi for in do done while case esac function return export local"),
    line: "#",
  },
  json: { keywords: words("true false null") },
};

const BY_EXTENSION: Record<string, string> = {
  js: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  tsx: "js",
  mts: "js",
  cts: "js",
  rs: "rust",
  py: "python",
  go: "go",
  css: "css",
  scss: "css",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  json: "json",
};

/** The language a file's name says it holds, or null for one Shoji doesn't colour. */
export function languageOf(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? null;
}

const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER = /\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|0x[\da-fA-F]+/y;

/** Splits one line into pieces to colour. Each line stands alone, so a comment or string that spans lines is
 *  coloured only on the line it starts. */
export function highlight(line: string, language: string | null): Piece[] {
  const lang = language ? LANGUAGES[language] : undefined;
  if (!lang) return [{ text: line, kind: "plain" }];
  const pieces: Piece[] = [];
  const push = (text: string, kind: Kind) => {
    const last = pieces.at(-1);
    if (last && last.kind === kind) last.text += text;
    else pieces.push({ text, kind });
  };
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (lang.line && rest.startsWith(lang.line)) {
      push(rest, "comment");
      break;
    }
    if (lang.block && rest.startsWith(lang.block[0])) {
      const end = line.indexOf(lang.block[1], i + lang.block[0].length);
      const stop = end < 0 ? line.length : end + lang.block[1].length;
      push(line.slice(i, stop), "comment");
      i = stop;
      continue;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'" || (ch === "`" && lang.backticks)) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, line.length);
      push(line.slice(i, stop), "string");
      i = stop;
      continue;
    }
    // A word or number starts only where the one before it ended.
    const before = i > 0 ? line[i - 1] : " ";
    if (!/[\w$]/.test(before)) {
      NUMBER.lastIndex = i;
      const number = NUMBER.exec(line);
      if (number) {
        push(number[0], "number");
        i += number[0].length;
        continue;
      }
      const pattern = lang.word ?? WORD;
      pattern.lastIndex = i;
      const word = pattern.exec(line);
      if (word) {
        push(word[0], lang.keywords.has(word[0]) ? "keyword" : "plain");
        i += word[0].length;
        continue;
      }
    }
    push(ch, "plain");
    i++;
  }
  return pieces;
}
