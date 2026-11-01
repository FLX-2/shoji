# Shoji website

A static one-page site: `src/index.html` (page, styles and script in one file), `src/img/` (screens of the real app), `src/film/` (the release film and its poster).

## Build

```
node build.mjs
```

writes `dist/index.html` and copies the images and film next to it. No dependencies. `node build.mjs --preview` also writes `dist/artifact.html`, the same page as a fragment for the private Claude preview.

## Hosting

The site is live at https://shoji-app.vercel.app/ (the Vercel project `shoji-app`). Vercel serves it from this folder. `vercel.json` sets it up, so the project needs only its Root Directory set to `site`:

- Build: `node build.mjs`, no install step, and `dist/` is what's served.
- `skip-build.sh` is the Ignored Build Step. A push that changes nothing in `site/` doesn't redeploy it.
- Images and the film are cached for a day.

The film is about 14 MB and only loads when someone presses play. Vercel's free plan includes 100 GB of transfer a month, which is several thousand plays. If the launch goes past that, link the film from YouTube.

## The name and links

The page is written for after the release: every Download button leads to the download section, whose platform links open the latest GitHub release. `site.json` holds every word that changes: `name`, `word` (the lowercase wordmark), `tagline`, `url`, `github` and `download`. A rename is one edit here, then a rebuild.

Link previews (LinkedIn, X, Slack, iMessage) need absolute addresses, so the build writes the site's own address into the canonical link, `og:url` and `og:image`. On Vercel it is the project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`), which becomes the custom domain once one is added. Elsewhere it is `SITE_URL` if set, then `url` in `site.json`, which holds the live address.

## Link card and icons

- `src/img/share.jpg`, 1200 × 627 JPG (LinkedIn doesn't reliably read WebP): the hero's wordmark, window and light, rendered from the built page by `capture/share.cjs` with `dist/` served on port 5300. Re-render it after a rename.
- `src/img/icon.svg` (the mark with its seal) is the tab icon; `src/img/apple-touch-icon.png` is the app icon at 180 px.

## Screens and film

The screens are the real app, captured at 1280 × 800 and 2× from the film harness that made the launch films, which runs the app on a virtual clock (it is kept with the films, outside this repo). They show the name in the app's title bar, so recapture them after a rename, and swap the film.

| File | Performance and moment |
| --- | --- |
| `ready.webp`, `accept.webp` (crop) | `hero` at 21000 ms |
| `ready-paper.webp` | `hero` at 21000 ms in the paper theme |
| `running.webp` | `hero` at 14000 ms |
| `receipts.webp`, `receipt.webp` (crop) | `receipts` at 1500 ms |
| `stack.webp` (crop) | `presets` at 14000 ms |
| `trial.webp` (crop) | `trial` at 14000 ms |
| `agents.webp` (crop) | `agents` at 9000 ms |
| `limit.webp` (crop) | `limit` at 4500 ms |

The film is a web copy of the launch-day release film (end card "Available now"): two-pass x264 at 960 kb/s after `hqdn3d=1.5:1.5:4:4`, AAC 96 kb/s, `+faststart`. The poster is its frame at 2.6 s.
