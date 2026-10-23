# Fork Mac app

This fork is installed as a packaged app at `/Applications/T3 Code.app`, next to the official `T3 Code (Nightly).app`. The developer launches it from the Dock and Desktop. Do not replace it with a dev-server launcher.

## Isolation from Nightly

`scripts/install-fork-mac.sh` sets `LSEnvironment` in the installed app's `Info.plist`:

| Variable                       | Value                                       | Why                                                                                                                                    |
| ------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `T3CODE_HOME`                  | `~/.t3-fork`                                | Packaged builds otherwise use `~/.t3/userdata`, Nightly's live database.                                                               |
| `T3CODE_DESKTOP_USER_DATA_DIR` | `~/Library/Application Support/t3code-fork` | Packaged builds otherwise share Nightly's `t3code-v2` Chromium profile, whose single-instance lock makes the second app quit silently. |
| `T3CODE_DISABLE_AUTO_UPDATE`   | `1`                                         | The updater would replace the fork with upstream Beta.                                                                                 |

`~/.t3-fork` was seeded with a copy of `~/.t3/userdata` while Nightly was closed. Data flows one way. Never write back to `~/.t3/userdata`.

## Rebuild and reinstall

```sh
T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true npx pnpm@12.14.0 exec node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 --build-version 0.1.1-preview.YYYYMMDD.N
scripts/install-fork-mac.sh   # newest release/T3-Code-*-arm64.zip by default
```

To publish it for teammates, push the `fork` branch, then tag and release (`gh release create` with `--target` fails on this fork; push the tag first):

```sh
git tag fork-v0.1.1-YYYYMMDD.N && git push origin fork-v0.1.1-YYYYMMDD.N
gh release create fork-v0.1.1-YYYYMMDD.N --repo tejasPhaveri/t3code --verify-tag \
  release/T3-Code-*-YYYYMMDD.N-arm64.zip release/T3-Code-*-YYYYMMDD.N-arm64.dmg
```

`T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR` reuses `native/resource-monitor/target/aarch64-apple-darwin/release/t3-resource-monitor`, which was copied from the Nightly bundle because Rust is not installed.

## Installing on another Mac

Builds are published as GitHub releases on `tejasPhaveri/t3code` (Apple Silicon only). The zip is ad-hoc signed, so the install script, not a double-click on the dmg, is the supported path: it clears quarantine and re-signs. It refuses to replace an `/Applications/T3 Code.app` that is not the fork.

```sh
DIR="$(mktemp -d)"
gh release download --repo tejasPhaveri/t3code --pattern '*-arm64.zip' --dir "$DIR"   # latest release
curl -fsSL https://raw.githubusercontent.com/tejasPhaveri/t3code/fork/scripts/install-fork-mac.sh -o "$DIR/install.sh"
bash "$DIR/install.sh" "$DIR"/T3-Code-*-arm64.zip
open "/Applications/T3 Code.app"
```

Quit the fork before updating. Installs never update themselves: auto-update stays off because upstream's updater would replace the fork, and macOS only applies in-place updates to Developer ID-signed apps. Rerunning these steps is the update.

The fork starts with empty data in `~/.t3-fork`. To bring existing projects and threads, do this before its first launch with every T3 Code app quit: `mkdir -p ~/.t3-fork && cp -R ~/.t3/userdata ~/.t3-fork/userdata`. After each install macOS asks once for Keychain access; choose Always Allow.

## Traps

- **No dev watcher may run during a build.** `vp pack --watch` and `apps/desktop/scripts/dev-electron.mjs` rewrite `apps/desktop/dist-electron` and relaunch a `T3 Code (Dev)` window on every change. A build packaged mid-rewrite ships without `main.cjs`. That app then blocks on an error dialog nobody can see: a process with no window and no output. The install script refuses such a zip. `dev-electron.mjs` runs as plain `node scripts/dev-electron.mjs`, so a search for the repo path misses it. Find it by its working directory.
- **Keep `CFBundleName` as built (`T3 Code (Beta)`).** Electron finds its helper apps by that name. Renaming it fails with `Unable to find helper app`. Change `CFBundleDisplayName` instead.
- The menu bar and window title still say Beta and Nightly. The stage label comes from the version string, and the window title from the copied settings. Neither affects behavior.
