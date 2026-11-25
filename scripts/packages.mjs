// Points Homebrew, Scoop, the README and the website at a published release: writes Casks/shoji.rb and
// bucket/shoji.json, which `brew tap flx-2/shoji https://github.com/FLX-2/shoji` and
// `scoop bucket add shoji https://github.com/FLX-2/shoji` read from this repository, the README's download table,
// and the release in site/site.json, so every Download link opens its installer itself. The Packages workflow
// runs it when a release is published.
//
//   node scripts/packages.mjs v0.4.0 <folder with the release's .dmg and .msi files>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [tag, folder] = process.argv.slice(2);
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !folder) {
  console.error("Usage: node scripts/packages.mjs v0.4.0 <folder with the release's .dmg and .msi files>");
  process.exit(1);
}
const version = tag.slice(1);
const sha = (name) => createHash("sha256").update(readFileSync(join(folder, name))).digest("hex");
const arm = sha(`Shoji_${version}_aarch64.dmg`);
const intel = sha(`Shoji_${version}_x64.dmg`);
const msi = sha(`Shoji_${version}_x64_en-US.msi`);
const releases = "https://github.com/FLX-2/shoji/releases/download";

mkdirSync("Casks", { recursive: true });
writeFileSync(
  "Casks/shoji.rb",
  `# Written by scripts/packages.mjs when a release is published. Install with:
#   brew tap flx-2/shoji https://github.com/FLX-2/shoji
#   brew install --cask flx-2/shoji/shoji
cask "shoji" do
  arch arm: "aarch64", intel: "x64"

  version "${version}"
  sha256 arm:   "${arm}",
         intel: "${intel}"

  url "${releases}/v#{version}/Shoji_#{version}_#{arch}.dmg"
  name "Shoji"
  desc "Plans, builds and checks code changes with a team of AI models, each chosen for its step"
  homepage "https://shoji-app.vercel.app"

  # Shoji updates itself from its GitHub releases.
  auto_updates true
  depends_on macos: ">= :monterey"

  app "Shoji.app"

  # The builds aren't signed yet, so macOS would refuse to open one Homebrew downloaded. Installing from this tap
  # is the person's say-so, as Open in the Finder's menu is for a download.
  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Shoji.app"]
  end

  zap trash: [
    "~/Library/Application Support/app.shoji.desktop",
    "~/Library/Caches/app.shoji.desktop",
    "~/Library/WebKit/app.shoji.desktop",
  ]
end
`,
);

mkdirSync("bucket", { recursive: true });
writeFileSync(
  "bucket/shoji.json",
  `${JSON.stringify(
    {
      version,
      description: "Plans, builds and checks code changes with a team of AI models, each chosen for its step.",
      homepage: "https://shoji-app.vercel.app",
      license: "MIT",
      notes: "Shoji came from Scoop, so update it with: scoop update shoji",
      architecture: {
        "64bit": {
          url: `${releases}/v${version}/Shoji_${version}_x64_en-US.msi`,
          hash: msi,
          extract_dir: "PFiles\\Shoji",
        },
      },
      bin: "shoji.exe",
      shortcuts: [["shoji.exe", "Shoji"]],
    },
    null,
    2,
  )}\n`,
);
// The README's download table, between its downloads comments, links each installer itself.
const file = (name) => `${releases}/${tag}/${name}`;
const table = `<!-- downloads: scripts/packages.mjs writes this table when a release is published -->
| System | Download |
| --- | --- |
| macOS 12 or later | [Apple silicon](${file(`Shoji_${version}_aarch64.dmg`)}) (M chips) · [Intel](${file(`Shoji_${version}_x64.dmg`)}) |
| Windows 10 or 11 | [Installer](${file(`Shoji_${version}_x64-setup.exe`)}) · [.msi](${file(`Shoji_${version}_x64_en-US.msi`)}) |
| Linux | [AppImage](${file(`Shoji_${version}_amd64.AppImage`)}) · [.deb](${file(`Shoji_${version}_amd64.deb`)}) · [.rpm](${file(`Shoji-${version}-1.x86_64.rpm`)}) |

This is Shoji ${version}. Every version is on the [releases page](https://github.com/FLX-2/shoji/releases).
<!-- /downloads -->`;
const readme = readFileSync("README.md", "utf8");
const downloads = /<!-- downloads:[\s\S]*?<!-- \/downloads -->/;
if (!downloads.test(readme)) throw new Error("README.md has no downloads table to write.");
writeFileSync("README.md", readme.replace(downloads, table));

// The website builds its Download links from this, and a change to site/ redeploys it.
const site = JSON.parse(readFileSync("site/site.json", "utf8"));
writeFileSync("site/site.json", `${JSON.stringify({ ...site, release: tag }, null, 2)}\n`);

console.log(`Homebrew, Scoop, the README and the website now point to Shoji ${version}.`);
