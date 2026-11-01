// Builds the site from src/ with the words in site.json, so the name and links live in one place.
//   node build.mjs            → dist/index.html, the site, plus its images and film (what Vercel serves)
//   node build.mjs --preview  → also dist/artifact.html, the same page as a fragment for the private preview
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "site.json"), "utf8"));
const words = { name: cfg.name, word: cfg.word, tagline: cfg.tagline, github: cfg.github, download: cfg.download };

let src = readFileSync(join(here, "src/index.html"), "utf8");
src = src.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in words)) throw new Error(`site.json has nothing for {{${k}}}`);
  return words[k];
});

const cut = (tag) => {
  const m = src.match(new RegExp(`<!--${tag}-->([\\s\\S]*?)<!--/${tag}-->`));
  if (!m) throw new Error(`src/index.html has no ${tag} part`);
  return m[1].trim();
};
const head = cut("head"), body = cut("body");
const title = `${cfg.name} · ${cfg.tagline.replace(/\.$/, "")}`;
// Link cards need absolute addresses. On Vercel the page's own address is the project's production
// domain (its custom domain once one is added); elsewhere SITE_URL, then site.json. It ends in a slash.
const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const url = new URL(process.env.SITE_URL || (vercel ? `https://${vercel}` : cfg.url)).href.replace(/\/?$/, "/");
const card = `${url}img/share.jpg`;
const description = `${cfg.name} is a free desktop app for building software with AI. Opus plans, Sonnet builds, Haiku reviews, and every task leaves a receipt.`;

const out = join(here, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<link rel="icon" href="img/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="img/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${cfg.name}">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${card}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="627">
<meta property="og:image:alt" content="The ${cfg.word} wordmark behind the app's window, in red-orange light.">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#060505">
${head}
</head>
<body>
${body}
</body>
</html>
`);
// The preview's frame adds its own document around the page, so the fragment carries only its title and parts.
if (process.argv.includes("--preview")) writeFileSync(join(out, "artifact.html"), `<title>${cfg.name} launch site</title>
<meta name="claude:viewport-fit-sides" content="cover">
${head}
${body}
`);
cpSync(join(here, "src/img"), join(out, "img"), { recursive: true });
cpSync(join(here, "src/film"), join(out, "film"), { recursive: true });
console.log(`built ${cfg.name} into dist/ for ${url}`);
