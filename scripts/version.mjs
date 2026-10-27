#!/usr/bin/env node
// Single source of truth for the RunMusic ecosystem version.
//
// `package.json` -> `expo.version` (mobile JS/OTA + versionName),
// `android.versionCode` / `ios.buildNumber`, `desktop/runmusic-win/Cargo.toml`,
// `desktop/Cargo.lock` and `desktop/installer.iss`.
//
// Usage:
//   node scripts/version.mjs sync              # propagate package.json -> targets
//   node scripts/version.mjs check             # verify every target is in sync
//   node scripts/version.mjs bump patch        # 1.1.0 -> 1.1.1, then sync
//   node scripts/version.mjs bump minor        # 1.1.0 -> 1.2.0, then sync
//   node scripts/version.mjs bump major        # 1.1.0 -> 2.0.0, then sync
//   node scripts/version.mjs bump patch --stage (also `git add` the files)
//
// `runtimeVersion` is intentionally NOT derived from the app version: it is
// the native ABI key that decides which OTA updates an installed binary can
// receive. Bump it by hand only when native code changes.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = {
  package: path.join(ROOT, 'package.json'),
  app: path.join(ROOT, 'app.json'),
  cargo: path.join(ROOT, 'desktop', 'runmusic-win', 'Cargo.toml'),
  lock: path.join(ROOT, 'desktop', 'Cargo.lock'),
  installer: path.join(ROOT, 'desktop', 'installer.iss'),
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function writeText(file, value) {
  fs.writeFileSync(file, value);
}

function parseVersion(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Gecersiz semver: "${version}" (beklenen x.y.z)`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Play Store / iOS build number: 1.1.0 -> 10100, 1.1.1 -> 10101. */
function versionCode(version) {
  const { major, minor, patch } = parseVersion(version);
  if (minor > 99 || patch > 99) {
    throw new Error(`versionCode formulu icin minor/patch < 100 olmali (${version})`);
  }
  return major * 10000 + minor * 100 + patch;
}

function bumpVersion(version, part) {
  const { major, minor, patch } = parseVersion(version);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Bilinmeyen parca: "${part}" (patch|minor|major)`);
}

function cargoTomlWithVersion(text, version) {
  const next = text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
  if (next === text) throw new Error('Cargo.toml icinde version satiri bulunamadi');
  return next;
}

function cargoLockWithVersion(text, version) {
  const next = text.replace(
    /(\[\[package\]\]\r?\nname = "runmusic-win"\r?\nversion = ")[^"]*(")/,
    `$1${version}$2`
  );
  if (next === text) throw new Error('Cargo.lock icinde runmusic-win paketi bulunamadi');
  return next;
}

function installerWithVersion(text, version) {
  const next = text.replace(/(#define MyAppVersion ")[^"]*(")/, `$1${version}$2`);
  if (next === text) throw new Error('installer.iss icinde MyAppVersion bulunamadi');
  return next;
}

function buildTargets(version) {
  const pkg = readJson(FILES.package);
  const app = readJson(FILES.app);
  const code = versionCode(version);

  app.expo.version = version;
  app.expo.android = { ...(app.expo.android ?? {}), versionCode: code };
  app.expo.ios = { ...(app.expo.ios ?? {}), buildNumber: String(code) };

  return {
    package: pkg,
    app,
    cargo: cargoTomlWithVersion(readText(FILES.cargo), version),
    lock: cargoLockWithVersion(readText(FILES.lock), version),
    installer: installerWithVersion(readText(FILES.installer), version),
  };
}

function writeTargets(targets) {
  writeJson(FILES.package, targets.package);
  writeJson(FILES.app, targets.app);
  writeText(FILES.cargo, targets.cargo);
  writeText(FILES.lock, targets.lock);
  writeText(FILES.installer, targets.installer);
}

function currentVersion() {
  return readJson(FILES.package).version;
}

function sync({ quiet = false } = {}) {
  const version = currentVersion();
  parseVersion(version);
  writeTargets(buildTargets(version));
  if (!quiet) console.log(`Senkronize edildi: ${version} (versionCode ${versionCode(version)})`);
}

function check({ quiet = false } = {}) {
  const version = currentVersion();
  parseVersion(version);

  const app = readJson(FILES.app);
  const problems = [];
  const code = versionCode(version);

  if (app.expo.version !== version) {
    problems.push(`app.json expo.version = ${app.expo.version}, beklenen ${version}`);
  }
  if (app.expo.android?.versionCode !== code) {
    problems.push(`app.json android.versionCode = ${app.expo.android?.versionCode}, beklenen ${code}`);
  }
  if (app.expo.ios?.buildNumber !== String(code)) {
    problems.push(`app.json ios.buildNumber = ${app.expo.ios?.buildNumber}, beklenen ${code}`);
  }
  const runtimeVersion = app.expo.runtimeVersion;
  if (typeof runtimeVersion !== 'string' || runtimeVersion.trim() === '') {
    problems.push('app.json runtimeVersion bos; native OTA anahtari tanimli olmali');
  }

  const cargo = readText(FILES.cargo);
  const cargoMatch = /^version\s*=\s*"([^"]*)"/m.exec(cargo);
  if (!cargoMatch || cargoMatch[1] !== version) {
    problems.push(`Cargo.toml version = ${cargoMatch?.[1]}, beklenen ${version}`);
  }

  const lock = readText(FILES.lock);
  const lockMatch = /\[\[package\]\]\r?\nname = "runmusic-win"\r?\nversion = "([^"]*)"/.exec(lock);
  if (!lockMatch || lockMatch[1] !== version) {
    problems.push(`Cargo.lock runmusic-win version = ${lockMatch?.[1]}, beklenen ${version}`);
  }

  const installer = readText(FILES.installer);
  const installerMatch = /#define MyAppVersion "([^"]*)"/.exec(installer);
  if (!installerMatch || installerMatch[1] !== version) {
    problems.push(`installer.iss MyAppVersion = ${installerMatch?.[1]}, beklenen ${version}`);
  }

  if (problems.length > 0) {
    console.error('Surum dosyalari uyusmuyor:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nDuzeltmek icin: node scripts/version.mjs sync');
    process.exit(1);
  }

  if (!quiet) console.log(`Surumler tutarli: ${version} (versionCode ${code}, runtime ${runtimeVersion})`);
}

function stage() {
  execFileSync(
    'git',
    ['add', FILES.package, FILES.app, FILES.cargo, FILES.lock, FILES.installer],
    { cwd: ROOT, stdio: 'inherit' }
  );
}

function main() {
  const [command, arg, ...flags] = process.argv.slice(2);

  if (command === 'sync') {
    sync();
    return;
  }
  if (command === 'check') {
    check();
    return;
  }
  if (command === 'bump') {
    if (!arg) throw new Error('Kullanim: bump <patch|minor|major> [--stage]');
    const version = bumpVersion(currentVersion(), arg);
    const pkg = readJson(FILES.package);
    pkg.version = version;
    writeJson(FILES.package, pkg);
    sync({ quiet: true });
    console.log(`Surum artirildi: ${version} (versionCode ${versionCode(version)})`);
    if (flags.includes('--stage')) stage();
    return;
  }

  console.error('Kullanim: node scripts/version.mjs <sync|check|bump>');
  console.error('  bump patch|minor|major [--stage]');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
