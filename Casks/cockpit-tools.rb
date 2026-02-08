cask "cockpit-tools" do
  version "0.6.0"
  sha256 "5425e791b4cfdff2c2f60051457fb28c047215a63e267a64b73db745af953a03"

  url "https://github.com/jlcodes99/cockpit-tools/releases/download/v#{version}/Cockpit.Tools_#{version}_universal.dmg",
      verified: "github.com/jlcodes99/cockpit-tools/"
  name "Cockpit Tools"
  desc "Account manager for AI IDEs (Antigravity and Codex)"
  homepage "https://github.com/jlcodes99/cockpit-tools"

  auto_updates true

  app "Cockpit Tools.app"

  zap trash: [
    "~/Library/Application Support/com.jlcodes.cockpit-tools",
    "~/Library/Caches/com.jlcodes.cockpit-tools",
    "~/Library/Preferences/com.jlcodes.cockpit-tools.plist",
    "~/Library/Saved Application State/com.jlcodes.cockpit-tools.savedState",
  ]

  caveats <<~EOS
    If you encounter the "App is damaged" error, please run:
      sudo xattr -rd com.apple.quarantine "/Applications/Cockpit Tools.app"

    Or install with the --no-quarantine flag:
      brew install --cask --no-quarantine cockpit-tools
  EOS
end

