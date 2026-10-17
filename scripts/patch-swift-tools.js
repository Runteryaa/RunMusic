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
      // Swift 6.1 move-only push_back into std::vector<facebook::jsi::PropNameID>
      { search: /vector\.push_back\((?:consuming:\s*)?propNameId\)/g, replace: 'vector.push_back(consume propNameId)' },
      // Swift 6.1 Task.immediate and Task(name:) polyfill compatibility
      {
        search: /if\s+#available\(macOS\s*26\.0[^{]+\{[\s\S]*?return\s+Task\(name:[^}]+}/g,
        replace: 'return Task(priority: .high, operation: operation)',
      },
      // Use static factory methods on shared/immortal references for Swift 6.1 constructor compatibility
      { search: /expo\.RuntimeScheduler\(\)/g, replace: 'expo.RuntimeScheduler.create()' },
      { search: /expo\.RuntimeScheduler\(scheduler,\s*fn\)/g, replace: 'expo.RuntimeScheduler.create(scheduler, fn)' },
      { search: /expo\.HostFunctionClosure\(context,\s*call,\s*deallocate\)/g, replace: 'expo.HostFunctionClosure.create(context, call, deallocate)' },
      // Classes with mutable weak var runtime conforming to Sendable must use @unchecked Sendable
      {
        search: /class\s+JavaScriptPropNameID\s*:\s*JavaScriptType\s*\{/g,
        replace: 'class JavaScriptPropNameID: JavaScriptType, @unchecked Sendable {',
      },
      {
        search: /class\s+JavaScriptError\s*:\s*Error\s*,\s*Sendable\s*\{/g,
        replace: 'class JavaScriptError: Error, @unchecked Sendable {',
      },
      {
        search: /class\s+JavaScriptValue\s*:\s*JavaScriptType\s*,\s*Equatable\s*,\s*Escapable\s*\{/g,
        replace: 'class JavaScriptValue: JavaScriptType, Equatable, Escapable, @unchecked Sendable {',
      },
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
  if (!fs.existsSync(header)) continue;
  let content = fs.readFileSync(header, 'utf8');
  let modified = false;

  // Remove SWIFT_RETURNS_RETAINED from constructors
  if (content.includes('SWIFT_RETURNS_RETAINED')) {
    content = content.replace(/SWIFT_RETURNS_RETAINED\s+RuntimeScheduler/g, 'RuntimeScheduler');
    modified = true;
  }

  // Add static factory methods
  if (!content.includes('static RuntimeScheduler *create(')) {
    const factoryMethods = `
  static RuntimeScheduler *create(void *scheduler, ScheduleFn fn) noexcept SWIFT_RETURNS_RETAINED {
    return new RuntimeScheduler(scheduler, fn);
  }

  static RuntimeScheduler *create() SWIFT_RETURNS_RETAINED {
    return new RuntimeScheduler();
  }
`;
    content = content.replace(/RuntimeScheduler\(\)\s*\{\}/, `RuntimeScheduler() {}${factoryMethods}`);
    modified = true;
  }

  // Forward-declare retain/release functions before class definition if not already present
  if (!content.includes('void retainRuntimeScheduler(expo::RuntimeScheduler')) {
    content = content.replace(
      'namespace expo {',
      'namespace expo { class RuntimeScheduler; }\nvoid retainRuntimeScheduler(expo::RuntimeScheduler *scheduler);\nvoid releaseRuntimeScheduler(expo::RuntimeScheduler *scheduler);\n\nnamespace expo {'
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(header, content, 'utf8');
    console.log(`[patch-swift-tools] Successfully patched ${header}`);
  }
}

// 4. Patch HostFunctionClosure.h for Swift 6.1.2 constructor compatibility
const hostFunctionClosureHeaders = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'HostFunctionClosure.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Public', 'expo-modules-jsi', 'HostFunctionClosure.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Private', 'expo-modules-jsi', 'HostFunctionClosure.h'),
];

for (const header of hostFunctionClosureHeaders) {
  if (!fs.existsSync(header)) continue;
  let content = fs.readFileSync(header, 'utf8');
  let modified = false;

  if (!content.includes('static HostFunctionClosure *create(')) {
    const factory = `
  static HostFunctionClosure *create(Context context, Closure closure, Deallocator deallocator) {
    return new HostFunctionClosure(context, closure, deallocator);
  }
`;
    content = content.replace(
      /explicit HostFunctionClosure\(Context context, Closure closure, Deallocator deallocator\)[^;]*;/,
      `$&${factory}`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(header, content, 'utf8');
    console.log(`[patch-swift-tools] Successfully patched ${header}`);
  }
}
