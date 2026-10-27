# Release & Versioning

RunMusic uses one version number for the whole ecosystem (Android, iOS, Windows,
installer and OTA updates). The scheme is `MAJOR.MINOR.PATCH`; the first release
under this scheme is **1.1.0**.

## Source of truth

`package.json` holds the version. `scripts/version.mjs` propagates it to:

| File | Field |
|---|---|
| `app.json` | `expo.version`, `expo.android.versionCode`, `expo.ios.buildNumber` |
| `desktop/runmusic-win/Cargo.toml` | `[package] version` |
| `desktop/Cargo.lock` | `runmusic-win` package version |
| `desktop/installer.iss` | `#define MyAppVersion` |

```bash
npm run version:sync    # package.json -> every target
npm run version:check   # fail if a target drifted
npm run version:bump -- patch   # 1.1.0 -> 1.1.1 (then sync)
npm run version:bump -- minor   # 1.1.0 -> 1.2.0
npm run version:bump -- major   # 1.1.0 -> 2.0.0
```

Never edit the generated fields by hand.

## Automatic patch bump (CI)

You do **not** bump versions locally. On every push to `main`/`master`, the
Android workflow:

1. reads the current version;
2. if tag `v<version>` already exists, runs `version.mjs bump patch`;
3. publishes the OTA update with message `v<version> (<sha>)`;
4. builds the APK;
5. commits the synced version files (`chore(release): v<version>`), tags the
   commit and pushes both.

So the first push produces `v1.1.0`, the next `v1.1.1`, and so on. The workflow
pushes with `GITHUB_TOKEN`, which does not re-trigger workflows, so there is no
loop. One workflow run (one push) produces one patch increment, even if that push
contains several commits.

> Because CI pushes a release commit, pull before pushing the next change:
> `git pull --rebase`.

The Windows workflow follows the same rule with `win-v<version>` tags and bumps
the patch if that tag already exists. iOS is manual and attaches the IPA to the
mobile release tag.

## versionCode / buildNumber

```
versionCode = major * 10000 + minor * 100 + patch
1.1.0 -> 10100
1.1.1 -> 10101
```

`app.json` `android.versionCode` and `ios.buildNumber` are generated from the
version. `eas.json` production **does not** use `autoIncrement`, so the APK from
GitHub Actions and the Play Store AAB share the same, deterministic
`versionCode`. Play requires a strictly increasing `versionCode`; the CI patch
bump guarantees that (minor/patch must stay below 100).

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
| Android APK | `RunMusic-1.1.0.apk` (beta: `RunMusic-1.1.0-beta.apk`) |
| iOS IPA | `RunMusic-1.1.0.ipa` |
| Windows installer | `RunMusic-Remote-Setup-1.1.0.exe` (+ stable alias) |
| Windows portable | `runmusic-win-1.1.0.exe` (+ stable alias `runmusic-win.exe`) |

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

Actions → **Build & Release Windows Client**. Creates `win-v<version>` and
uploads the versioned installer and portable executable.

### Google Play (manual)

```bash
eas build --platform android --profile production
```

The AAB uses the same `versionCode` as `app.json`. After a successful upload,
the CI bump commit determines the next patch. Never reuse a `versionCode`.

## OTA updates

CI publishes on every push to `main`:

```bash
eas update --branch production --platform android --environment production \
  -m "v1.1.0 (abc1234)"
```

`runtimeVersion` must match the installed binary. Publish manually (from the
repo root) with the same message format; `EXPO_PUBLIC_APP_VERSION` must be set
so the bundle reports the right version:

```bash
# PowerShell
$env:EXPO_PUBLIC_APP_VERSION = "1.1.5"
eas update --branch production --platform android --environment production -m "v1.1.5"
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
| APK still shows 1.0.0 | Installed binary predates the scheme; install the 1.1.0 APK. |
| About shows OTA 1.1.3 but APK 1.1.0 | Expected: JS updated over the air, native did not. |
| OTA not delivered after a native change | `runtimeVersion` differs from the installed binary; ship a new APK. |
| CI fails with `Tag vX already exists` | Version was not bumped; CI handles this automatically. |
| `version:check` fails locally | Run `npm run version:sync`. |
