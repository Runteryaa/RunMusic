import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

/**
 * Version shown for the running JS bundle.
 *
 * CI injects `EXPO_PUBLIC_APP_VERSION` when it publishes an OTA update or builds
 * the APK, so the value always matches the release even after an OTA update.
 * Falls back to the app config version for local development builds.
 */
export const APP_VERSION =
  process.env.EXPO_PUBLIC_APP_VERSION || Constants.expoConfig?.version || '1.1.0';

/** Version of the installed native binary (APK/IPA). Does not change on OTA. */
export const NATIVE_APP_VERSION = Application.nativeApplicationVersion ?? null;

/** Native build number (Android versionCode / iOS CFBundleVersion). */
export const NATIVE_BUILD_VERSION = Application.nativeBuildVersion ?? null;

/** Native runtime key used to gate OTA updates (see docs/RELEASE.md). */
export const RUNTIME_VERSION = Updates.runtimeVersion ?? null;
