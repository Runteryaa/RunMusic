#!/usr/bin/env node
// Version helpers for the RunMusic ecosystem.
//
// The app version is NOT bumped in git anymore. The release workflows assign
// `MAJOR.MINOR.<workflow run number>` and `buildNumber = git commit count`,
// then patch the workspace before building. The files in git keep a baseline
// (1.1.0) so local builds and tooling stay valid.
//
// Usage:
//   node scripts/version.mjs sync                  # package.json -> targets
//   node scripts/version.mjs check                 # verify version strings
//   node scripts/version.mjs apply 1.1.248 --build 276
//   node scripts/version.mjs bump patch            # manual minor/major work
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

function bumpVersion(version, part) {
  const { major, minor, patch } = parseVersion(version);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Bilinmeyen parca: "${part}" (patch|minor|major)`);
}

/** Total commit count on the checked-out branch, used as Android versionCode / iOS buildNumber. */
function commitCount() {
  try {
    const out = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return Number(out);
  } catch {
    return 0;
  }
}

function cargoTomlWithVersion(text, version) {
  if (!/^version\s*=\s*"[^"]*"/m.test(text)) {
    throw new Error('Cargo.toml icinde version satiri bulunamadi');
  }
  return text.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`);
}

function cargoLockWithVersion(text, version) {
  const pattern = /(\[\[package\]\]\r?\nname = "runmusic-win"\r?\nversion = ")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('Cargo.lock icinde runmusic-win paketi bulunamadi');
  return text.replace(pattern, `$1${version}$2`);
}

function installerWithVersion(text, version) {
  const pattern = /(#define MyAppVersion ")[^"]*(")/;
  if (!pattern.test(text)) throw new Error('installer.iss icinde MyAppVersion bulunamadi');
  return text.replace(pattern, `$1${version}$2`);
}

function buildTargets(version, build) {
  const pkg = readJson(FILES.package);
  const app = readJson(FILES.app);
  pkg.version = version;
  app.expo.version = version;

  if (Number.isInteger(build) && build > 0) {
    app.expo.android = { ...(app.expo.android ?? {}), versionCode: build };
    app.expo.ios = { ...(app.expo.ios ?? {}), buildNumber: String(build) };
  }

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
  if (!quiet) console.log(`Senkronize edildi: ${version}`);
}

function apply(version, build) {
  parseVersion(version);
  writeTargets(buildTargets(version, build));
  console.log(`Uygulandi: ${version} (build ${build})`);
}

function check({ quiet = false } = {}) {
  const version = currentVersion();
  parseVersion(version);

  const app = readJson(FILES.app);
  const problems = [];

  if (app.expo.version !== version) {
    problems.push(`app.json expo.version = ${app.expo.version}, beklenen ${version}`);
  }

  const versionCode = app.expo.android?.versionCode;
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    problems.push(`app.json android.versionCode gecersiz: ${versionCode}`);
  }

  const buildNumber = app.expo.ios?.buildNumber;
  if (typeof buildNumber !== 'string' || buildNumber.trim() === '') {
    problems.push('app.json ios.buildNumber bos');
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

  if (!quiet) {
    console.log(
      `Surumler tutarli: ${version} (versionCode ${versionCode}, build ${buildNumber}, runtime ${runtimeVersion})`
    );
  }
}

function main() {
  const [command, arg, ...rest] = process.argv.slice(2);

  if (command === 'sync') {
    sync();
    return;
  }
  if (command === 'check') {
    check();
    return;
  }
  if (command === 'apply') {
    if (!arg) throw new Error('Kullanim: apply <x.y.z> [--build <n>]');
    const buildIndex = rest.indexOf('--build');
    const build = buildIndex >= 0 ? Number(rest[buildIndex + 1]) : commitCount();
    if (!Number.isInteger(build) || build <= 0) {
      throw new Error('Gecersiz build numarasi (--build <n>)');
    }
    apply(arg, build);
    return;
  }
  if (command === 'bump') {
    if (!arg) throw new Error('Kullanim: bump <patch|minor|major>');
    const next = bumpVersion(currentVersion(), arg);
    const pkg = readJson(FILES.package);
    pkg.version = next;
    writeJson(FILES.package, pkg);
    sync({ quiet: true });
    console.log(`Surum artirildi: ${next}`);
    return;
  }

  console.error('Kullanim: node scripts/version.mjs <sync|check|apply|bump>');
  console.error('  apply <x.y.z> [--build <n>]');
  console.error('  bump patch|minor|major');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
