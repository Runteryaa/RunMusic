This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

### Publishing an OTA update (Android production)

```bash
eas update --branch production --platform android --environment production -m "<message>"
```

- `--environment production` is **required** (SDK 55+); the project already defines `EAS_SKIP_AUTO_FINGERPRINT=1`.
- On Windows, `hermesc` can fail with `Failed to open file ...\Temp\expo-bundler-*\index.hbc*: permission denied` (exit code 6) when writing bytecode under `%TEMP%`. Redirect the temp dir into the repo and retry:

  ```powershell
  $env:TEMP = "$PWD\.tmp-eas"; $env:TMP = $env:TEMP
  eas update --branch production --platform android --environment production -m "<message>"
  ```

  `.tmp-eas/` is gitignored. Leaving it behind makes the EAS publish report the commit with a trailing `*` (dirty tree), so delete it afterwards.

## Persisted data & schema migrations

User data lives in AsyncStorage and **survives OTA updates** (it is only lost on uninstall/install or a native build that changes the app's signing identity). Two rules keep it that way:

- **Always version the persist schema.** `useStore` sets `version` + `migrate`. Bump `PERSIST_VERSION` and extend `migrate` when the persisted shape changes; never rely on the default (unversioned) hydration to reshape old data.
- **Keep persisted values small.** `createJSONStorage` writes the whole store as a *single* `AsyncStorage.setItem`. Android rejects oversized single values, and the write failure is silent — new data simply stops being saved. Never persist re-derivable data (`candidates`, `parsedLines`) or duplicate one payload across many cache keys. `src/services/persistSanitize.ts` enforces this and `src/services/persistStorage.ts` trims as a safety net.

Verify changes to this logic with:

```bash
npx tsc scripts/verify-persist-migration.ts --ignoreConfig --outDir .tmp-verify \
  --module commonjs --target es2020 --moduleResolution bundler --skipLibCheck
node .tmp-verify/scripts/verify-persist-migration.js
```

## Versioning & releases

One version for the whole ecosystem. **You do not bump version files on every release.** `package.json` holds the baseline (`1.2.0`); the release workflow keeps its `major.minor` and sets `version = <major.minor>.<workflow run number>` plus `buildNumber = git commit count` in the workspace before building. To move to a new minor/major line, bump the baseline once (`npm run version:bump -- minor`) and commit it; use `npm run version:sync` / `npm run version:check` only when changing the baseline or debugging. `runtimeVersion` is intentionally decoupled from the app version (currently `"1.2"`): bump it only when native code changes, otherwise OTA updates stop reaching installed APKs. The Android workflow publishes the OTA before the Gradle/NDK setup so updates can be tested quickly. Full details: `docs/RELEASE.md`.

## Product scope (settled — do not propose again)

These decisions are final. Do not suggest, plan, or implement them, and do not bring them up as "next features" in recommendations.

- **No playlists.** No user-created playlists, playlist folders, playlist covers, playlist reordering, or "add to playlist" flows. The app is built around the device file library plus the transient up-next queue, and that model stays.
- **No album browsing.** No Albums tab, album grid, album cards, or album detail screen. The app currently has no such screen and will not get one. `album` remains a plain metadata field only: the editable field in `EditTrackModal`, the small album label under a track row on the artist page, `ReplayGainMode = 'album'`, and the scrobbler/stats payload. Those existing uses must not be removed.
- **No backup/restore.** No export/import of the store, statistics, metadata, or settings. Keep the persist versioning discipline (`PERSIST_VERSION` + `migrate`); do not add a separate backup layer.

When proposing improvements, draw from areas the app actually covers: player experience, lyrics (sync, editing, search, sharing), statistics and wrapped, library filtering/search/sort, artist profiles, audio effects, remote connection (Connecto), extensions, theming, and performance.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
