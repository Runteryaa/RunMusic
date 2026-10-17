const fs = require('fs');
const path = require('path');

function patchFile(filePath, transforms) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  for (const { search, replace } of transforms) {
    if (typeof search === 'string' ? content.includes(search) : search.test(content)) {
      content = content.replace(search, replace);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch-swift-tools] Successfully patched ${filePath}`);
  }
}

function walkDir(dir, extFilter, fileCallback) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, extFilter, fileCallback);
    } else if (entry.isFile() && extFilter.test(entry.name)) {
      fileCallback(fullPath);
    }
  }
}

// 1. Patch Package.swift manifests
const packageSwiftFiles = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'),
  path.join(__dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift'),
];

for (const pkgFile of packageSwiftFiles) {
  patchFile(pkgFile, [
    { search: /swift-tools-version:\s*6\.2/g, replace: 'swift-tools-version: 6.0' },
    { search: /602\.0\.0-latest/g, replace: '600.0.0-latest' },
    { search: /,(\s*\))/g, replace: '$1' },
  ]);
}

// 2. Patch Swift sources in expo-modules-jsi for Swift 6.0 / 6.1 compatibility
const searchDirs = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources'),
  path.join(__dirname, '..', 'ios', 'Pods', 'expo-modules-jsi'),
];

for (const dir of searchDirs) {
  walkDir(dir, /\.swift$/, (swiftFile) => {
    patchFile(swiftFile, [
      // Swift 6.0/6.1 requires weak properties to be declared with 'var'
      { search: /\bweak\s+let\b/g, replace: 'weak var' },
      // Remove invalid trailing commas before closing parentheses in closures/argument lists
      { search: /,(\s*\))/g, replace: '$1' },
    ]);
  });
}

// 3. Patch RuntimeScheduler.h for Swift 6.1.2 Clang compatibility
const runtimeSchedulerHeaders = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'RuntimeScheduler.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Public', 'expo-modules-jsi', 'RuntimeScheduler.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Private', 'expo-modules-jsi', 'RuntimeScheduler.h'),
];

for (const header of runtimeSchedulerHeaders) {
  patchFile(header, [
    {
      search: /class\s+RuntimeScheduler\s*\{/g,
      replace: 'class SWIFT_SHARED_REFERENCE(retainRuntimeScheduler, releaseRuntimeScheduler) RuntimeScheduler {',
    },
    {
      search: /\}\s*SWIFT_SHARED_REFERENCE\(retainRuntimeScheduler,\s*releaseRuntimeScheduler\);/g,
      replace: '};',
    },
  ]);
}
