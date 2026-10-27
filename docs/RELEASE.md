# Release & Versioning

RunMusic uses one version number for the whole ecosystem (Android, iOS, Windows,
installer and OTA updates).

- **Version name**: `1.1.<workflow run number>` (e.g. `1.1.248`).
- **Build number** (`versionCode` / `CFBundleVersion`): total git commit count
  (e.g. `276`).

The version is **not committed** on every release. The workflow patches the
workspace before building, so `app.json`, `package.json`, `Cargo.toml` and
`installer.iss` keep the `1.1.0` baseline in git.

## Source of truth

`package.json` holds the baseline version. `scripts/version.mjs` propagates it to:

| File | Field |
|---|---|
| `app.json` | `expo.version`, `expo.android.versionCode`, `expo.ios.buildNumber` |
| `desktop/runmusic-win/Cargo.toml` | `[package] version` |
| `desktop/Cargo.lock` | `runmusic-win` package version |
| `desktop/installer.iss` | `#define MyAppVersion` |

```bash
npm run version:sync    # package.json -> every target
npm run version:check   # fail if a target drifted
npm run version:bump -- minor   # 1.1.0 -> 1.2.0 (only for minor/major work)
```

CI uses an extra command that also stamps the build number:

```bash
node scripts/version.mjs apply 1.1.248 --build 276
```

## Version assignment (CI)

On every push to `main`/`master`, the Android workflow:

1. sets `VERSION=1.1.${GITHUB_RUN_NUMBER}` and `BUILD=$(git rev-list --count HEAD)`;
2. runs `version.mjs apply $VERSION --build $BUILD` in the workspace;
3. publishes the OTA update with message `v<version> (<sha>)`;
4. builds the APK;
5. creates the GitHub release + tag `v<version>` for the pushed commit.

No version commit is pushed, so you never need to pull before pushing again.
One workflow run (one push) produces one version; if a push contains several
commits they share the same version. The patch comes from the workflow run
number, which is monotonic per workflow.

The Windows workflow uses its own workflow run number in the patch slot:
`VERSION=1.1.<Windows run number>` and tag `win-v1.1.<run number>` (independent
of both the Android run number and the commit count).
iOS is manual and attaches the IPA to the mobile release tag.

## runtimeVersion (OTA gate)

`expo.runtimeVersion` is **decoupled** from the app version and stays `"1.1"`.

`expo-updates` only delivers an OTA update to a binary whose `runtimeVersion`
matches. If it followed the app version, every patch bump would require a new
native install. Bump it manually only when native code changes (new native
module, SDK upgrade, permissions/native config):

```
1.1  -> current native line (expo-application added here)
1.2  -> next native change
```

The installed 1.0.0 binaries (runtime `1.0.0`) will not receive 1.1 OTA updates;
install the 1.1.0 APK once.

## What the app shows

Android system *App info* always shows the installed APK version (`versionName`
and `versionCode`); OTA cannot change it. The in-app *About* section shows both:

- **Version (OTA)** — JS bundle version (`EXPO_PUBLIC_APP_VERSION`, injected by CI);
- **Installed APK** — `expo-application` native version;
- **Build** — native `versionCode` / `CFBundleVersion`;
- **Runtime** — `Updates.runtimeVersion`;
- OTA id / last update time.

## Artifact naming

| Platform | File |
|---|---|
| Android APK | `RunMusic-1.1.248.apk` (beta: `RunMusic-1.1.248-beta.apk`) |
| iOS IPA | `RunMusic-1.1.248.ipa` |
| Windows installer | `RunMusic-Remote-Setup-1.1.6.exe` (+ stable alias) |
| Windows portable | `runmusic-win-1.1.6.exe` (+ stable alias `runmusic-win.exe`) |

The stable (`unversioned`) copies exist so a future auto-updater and direct
download links can use a fixed URL. The executable itself carries a VERSIONINFO
resource generated from `CARGO_PKG_VERSION`, visible in *Properties → Details*.

## Releases

### Android APK (automatic)

Push to `main`. The workflow publishes the OTA first, then builds the APK, tags
`v<version>` and creates the GitHub release with the versioned APK. Beta builds
use the `beta` branch and `v<version>-beta`.

### iOS IPA (manual)

Actions → **Build iOS IPA & Attach to Release**. The IPA is named with the tag
version and attached to the release for the same commit (or the latest mobile
release).

### Windows (manual)

Actions → **Build & Release Windows Client**. Creates `win-v1.1.<run number>`
(e.g. `win-v1.1.6`) and uploads the versioned installer and portable
executable.

### Google Play (manual)

Play builds must carry the same patched version. Either add an AAB build to the
CI workflow, or patch locally before running EAS:

```bash
node scripts/version.mjs apply 1.1.248 --build 276
eas build --platform android --profile production
```

`eas.json` production **does not** use `autoIncrement`; the `versionCode` is the
commit count. Never reuse a `versionCode` for Play, and never force-push `main`
(that could lower the commit count).

## OTA updates

CI publishes on every push to `main`:

```bash
eas update --branch production --platform android --environment production \
  -m "v1.1.248 (abc1234)"
```

`runtimeVersion` must match the installed binary. Publish manually (from the
repo root) with the same message format; `EXPO_PUBLIC_APP_VERSION` must be set
so the bundle reports the right version:

```bash
# PowerShell
$env:EXPO_PUBLIC_APP_VERSION = "1.1.248"
eas update --branch production --platform android --environment production -m "v1.1.248"
```

## Rollback

- **OTA**: publish a new update from the previous good commit (`eas update` with
  the older tree). Updates are immutable; do not try to delete the bad one.
- **Native**: publish a new APK/AAB with a higher `versionCode` (never lower) and
  attach it to a new release. Android does not allow downgrades; test through the
  Play internal track.
- **Windows**: upload the previous installer version again; the version number
  still increases in the file metadata only if rebuilt.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| APK still shows 1.0.0 | Installed binary predates the scheme; install a current APK. |
| About shows OTA 1.1.249 but APK 1.1.248 | Expected: JS updated over the air, native did not. |
| OTA not delivered after a native change | `runtimeVersion` differs from the installed binary; ship a new APK. |
| `version:check` fails locally | Run `npm run version:sync`. |
| New APK will not install over the old one | `versionCode` went backwards (commit count decreased, e.g. after a force-push). Rebuild from a newer commit or reinstall. |
