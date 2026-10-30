import { Fragment, type ReactNode } from "react";

/** One block of a model's markdown, as Shoji draws it. */
export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; start: number; items: Item[] }
  | { type: "code"; text: string }
  | { type: "quote"; lines: string[] }
  | { type: "rule" };

export interface Item {
  lines: string[];
  /** A list indented under this item. */
  sub?: Extract<Block, { type: "list" }>;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+]|(\d{1,3})[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

/** Reads the markdown models write: headings, lists one level deep, code, quotes and rules.
 *  Anything else is a paragraph, and a single line break stays a line break. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const fence = line.trim().slice(0, 3);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (BULLET.test(line)) {
      const [list, next] = readList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">"))
        quote.push(lines[i++].trimStart().replace(/^>\s?/, ""));
      blocks.push({ type: "quote", lines: quote });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: "paragraph", lines: para });
  }
  return blocks;
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) || HEADING.test(line) || BULLET.test(line) || RULE.test(line) || line.trimStart().startsWith(">")
  );
}

/** A list from line `from`, with any deeper-indented list folded under the item above it. */
function readList(lines: string[], from: number): [Extract<Block, { type: "list" }>, number] {
  const first = lines[from].match(BULLET)!;
  const indent = first[1].length;
  const list: Extract<Block, { type: "list" }> = {
    type: "list",
    ordered: first[3] !== undefined,
    start: first[3] !== undefined ? Number(first[3]) : 1,
    items: [],
  };
  let i = from;
  while (i < lines.length) {
    const line = lines[i];
    const bullet = line.match(BULLET);
    if (!line.trim()) {
      // A blank line ends the list unless the next line carries it on.
      const next = lines[i + 1];
      const carries = next !== undefined && (next.match(BULLET)?.[1].length ?? -1) >= indent;
      if (!carries) break;
      i++;
      continue;
    }
    if (bullet && bullet[1].length > indent && list.items.length) {
      const [sub, next] = readList(lines, i);
      list.items[list.items.length - 1].sub = sub;
      i = next;
      continue;
    }
    if (bullet && bullet[1].length >= indent) {
      if ((bullet[3] !== undefined) !== list.ordered) break;
      list.items.push({ lines: [bullet[4]] });
      i++;
      continue;
    }
    if (bullet || startsBlock(line) || !/^\s/.test(line) || !list.items.length) break;
    // An indented line with no marker carries the item above it on.
    list.items[list.items.length - 1].lines.push(line.trim());
    i++;
  }
  return [list, i];
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|\[([^\]]+)\]\([^)]*\)/g;

/** Code, bold and italic inside a line. A link keeps its words; Shoji doesn't open pages. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const [whole, code, bold, em, link] = m;
    const key = out.length;
    if (code) out.push(<code key={key}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={key}>{inline(bold.slice(2, -2))}</strong>);
    else if (em) out.push(<em key={key}>{inline(em.slice(1, -1))}</em>);
    else out.push(link ?? whole);
    at = m.index + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function Lines({ lines }: { lines: string[] }) {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {inline(line)}
    </Fragment>
  ));
}

function List({ list }: { list: Extract<Block, { type: "list" }> }) {
  const items = list.items.map((item, i) => (
    <li key={i}>
      <Lines lines={item.lines} />
      {item.sub && <List list={item.sub} />}
    </li>
  ));
  return list.ordered ? <ol start={list.start === 1 ? undefined : list.start}>{items}</ol> : <ul>{items}</ul>;
}

/** A model's markdown, drawn as text: plans, briefs, reviews and the builder's summary. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `md ${className}` : "md"}>
      {parseBlocks(text).map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = block.level <= 2 ? "h3" : "h4";
            return <Tag key={i}>{inline(block.text)}</Tag>;
          }
          case "paragraph":
            return (
              <p key={i}>
                <Lines lines={block.lines} />
              </p>
            );
          case "list":
            return <List key={i} list={block} />;
          case "code":
            return <pre key={i}>{block.text}</pre>;
          case "quote":
            return (
              <blockquote key={i}>
                <Lines lines={block.lines} />
              </blockquote>
            );
          case "rule":
            return <hr key={i} />;
        }
      })}
    </div>
  );
}
