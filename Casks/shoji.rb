# Written by scripts/packages.mjs when a release is published. Install with:
#   brew tap flx-2/shoji https://github.com/FLX-2/shoji
#   brew install --cask flx-2/shoji/shoji
cask "shoji" do
  arch arm: "aarch64", intel: "x64"

  version "0.5.0"
  sha256 arm:   "2f368d29e38d8c4a93adc8fa3897a7adc34322d6f2a82f61c09413361a952780",
         intel: "8492b3e731e454dc07a99d5282135fca1589721e46b6437826724ba6757fcca5"

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
