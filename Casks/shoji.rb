# Written by scripts/packages.mjs when a release is published. Install with:
#   brew tap flx-2/shoji https://github.com/FLX-2/shoji
#   brew install --cask flx-2/shoji/shoji
cask "shoji" do
  arch arm: "aarch64", intel: "x64"

  version "0.5.2"
  sha256 arm:   "eecd844b4d53d087d35e3adebb47ad67baa819d40d92aa3a94d76b029fa937f6",
         intel: "d60b4a18835e47d75494b7b67dcd1bb61cb5fcbfa4e0b6fa7645f618dcc468f7"

  url "https://github.com/FLX-2/shoji/releases/download/v#{version}/Shoji_#{version}_#{arch}.dmg"
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
