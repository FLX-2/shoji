import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

/** The most the API takes for one image. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** A text file longer than this is cut, so one log file can't eat the thread's budget. */
const MAX_TEXT_CHARS = 40_000;

const IMAGES: Record<string, Anthropic.Base64ImageSource["media_type"]> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** What the person attached to a task, ready to sit beside the prompt each role reads. */
export interface Attachments {
  /** The files' names, for the prompts' text. */
  names: string[];
  blocks: Anthropic.ContentBlockParam[];
}

/** Reads screenshots, PDFs and text files. Throws, naming the file, on anything it can't send. */
export function readAttachments(files: string[]): Attachments {
  const names: string[] = [];
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const file of files) {
    const name = path.basename(file);
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      throw new Error(`Shoji couldn't read the attached file ${name}.`);
    }
    const ext = path.extname(file).toLowerCase();
    if (IMAGES[ext]) {
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${name} is over 5 MB, the most a model takes for one image.`);
      blocks.push({ type: "image", source: { type: "base64", media_type: IMAGES[ext], data: bytes.toString("base64") } });
    } else if (ext === ".pdf") {
      if (bytes.length > MAX_PDF_BYTES) throw new Error(`${name} is over 20 MB, too large to attach.`);
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } });
    } else if (bytes.includes(0)) {
      throw new Error(`${name} isn't a screenshot, PDF or text file, so Shoji can't attach it.`);
    } else {
      const text = bytes.toString("utf8");
      const kept = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n… (cut here, ${text.length - MAX_TEXT_CHARS} more characters)` : text;
      blocks.push({ type: "text", text: `Attached file ${name}:\n${kept}` });
    }
    names.push(name);
  }
  return { names, blocks };
}

/** A prompt with the attachments before it, or the plain prompt when there are none. */
export function withAttachments(prompt: string, attachments?: Attachments): string | Anthropic.ContentBlockParam[] {
  if (!attachments?.blocks.length) return prompt;
  return [
    ...attachments.blocks,
    { type: "text", text: `${prompt}\n\nThe person attached ${attachments.names.join(", ")}, shown above.` },
  ];
}
