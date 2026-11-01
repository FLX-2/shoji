// The link card: the hero's title, window and light at 1200 × 627, rendered from the built page.
// Serve dist/ on port 5300 first (python3 -m http.server 5300), then: node capture/share.cjs src/img/share.jpg
const { chromium } = require("playwright");
(async () => {
  const out = process.argv[2] || "src/img/share.png";
  const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1200, height: 627 }, deviceScaleFactor: 1 });
  await p.addInitScript(() => { try { localStorage.setItem("site.motion", "off"); } catch {} });
  await p.goto("http://localhost:5300/index.html");
  await p.addStyleTag({ content: `
    .nav, .intro, .rails { display: none !important; }
    .hero { margin-top: 0; padding-top: 0; }
    .hero .wrap { padding-top: 46px; }
    .title { margin-top: 0; --giant: 300px; font-size: 300px; margin-bottom: -86px; }
    .stage { padding-bottom: 0; }
    .win { width: 800px; }
    .glow::after { background: linear-gradient(180deg, rgba(6,5,5,0.35) 0%, rgba(6,5,5,0) 30%, rgba(6,5,5,0) 80%, rgba(6,5,5,0.5) 100%); }
  ` });
  await p.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.querySelectorAll(".hero img")).map((i) => i.decode().catch(() => {}))); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: out });
  await b.close();
})();
