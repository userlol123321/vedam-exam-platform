// Ad-hoc code-sign the built .app so macOS doesn't treat it as corrupted.
// Runs after the app is unpacked (electron-builder `afterPack` hook) and
// before the DMG is created.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

exports.default = async function signAdHoc(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = context.appOutDir;
  if (!appPath || !fs.existsSync(appPath)) {
    console.warn("afterPack: no app bundle at", appPath);
    return;
  }

  const entries = fs.readdirSync(appPath);
  const appBundle = entries.find((e) => e.endsWith(".app"));
  const bundlePath = appBundle ? path.join(appPath, appBundle) : appPath;

  try {
    // macOS 26 stamps `com.apple.provenance` on files as they're written
    // locally; codesign rejects that residue, so strip it first.
    execFileSync("xattr", ["-cr", bundlePath], { stdio: "inherit" });
    // `-` = ad-hoc identity (no Apple Developer ID required). --deep also
    // signs the nested Electron frameworks/helpers so their signatures are
    // consistent with the bundle.
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--timestamp=none", bundlePath],
      { stdio: "inherit" }
    );
    console.log("✓ Ad-hoc signed:", bundlePath);
  } catch (err) {
    console.error("afterPack: codesign failed", err.message);
  }
};