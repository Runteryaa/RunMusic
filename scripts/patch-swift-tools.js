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
      // Swift 6.1 cannot instantiate move-only C++ push_back, use C++ helper instead
      {
        search: /for\s+propertyName\s+in\s+propertyNames\s*\{[\s\S]*?vector\.push_back[^\n]+\n\s*\}/g,
        replace: 'for propertyName in propertyNames {\n        expo.appendPropNameIdUtf8(&vector, iRuntime, std.string(propertyName))\n      }',
      },
      // Swift 6.1 Task.immediate and Task(name:) polyfill compatibility
      {
        search: /if\s+#available\(macOS\s*26\.0[^{]+\{[\s\S]*?return\s+Task\(name:[^}]+}/g,
        replace: 'return Task(priority: .high, operation: operation)',
      },
      // Use static factory methods on shared/immortal references for Swift 6.1 constructor compatibility
      { search: /expo\.RuntimeScheduler\(\)/g, replace: 'expo.RuntimeScheduler.create()' },
      { search: /expo\.RuntimeScheduler\(scheduler,\s*fn\)/g, replace: 'expo.RuntimeScheduler.create(scheduler, fn)' },
      { search: /expo\.HostFunctionClosure\(context,\s*call,\s*deallocate\)/g, replace: 'expo.HostFunctionClosure.create(context, call, deallocate)' },
      // Swift 6.1 region-based sending fix: pass raw pointer addresses as UInt scalars to avoid crossing isolation boundaries
      {
        search: /nonisolated\(unsafe\)\s+let\s+thisPtr\s*=\s*thisPtr\s*\n\s*nonisolated\(unsafe\)\s+let\s+argumentsPtr\s*=\s*argumentsPtr\s*\n\s*nonisolated\(unsafe\)\s+let\s+resultPtr\s*=\s*resultPtr/g,
        replace: 'let thisAddr = UInt(bitPattern: thisPtr)\n    let argsAddr = UInt(bitPattern: argumentsPtr)\n    let resAddr = UInt(bitPattern: resultPtr)',
      },
      {
        search: /return\s+forwardingSwiftErrorsToJS\(runtime:\s*runtime\)\s*\{\s*\n\s*let\s+this\s*=/g,
        replace: 'return forwardingSwiftErrorsToJS(runtime: runtime) {\n          let thisPtr = UnsafePointer<facebook.jsi.Value>(bitPattern: thisAddr)!\n          let argumentsPtr = UnsafePointer<facebook.jsi.Value>(bitPattern: argsAddr)\n          let resultPtr = UnsafeMutablePointer<facebook.jsi.Value>(bitPattern: resAddr)!\n          let this =',
      },
      {
        search: /return\s+forwardingSwiftErrorsToJS\(runtime:\s*runtime\)\s*\{\s*\n\s*let\s+arguments\s*=\s*JavaScriptValuesBuffer/g,
        replace: 'return forwardingSwiftErrorsToJS(runtime: runtime) {\n          let thisPtr = UnsafePointer<facebook.jsi.Value>(bitPattern: thisAddr)!\n          let argumentsPtr = UnsafePointer<facebook.jsi.Value>(bitPattern: argsAddr)\n          let resultPtr = UnsafeMutablePointer<facebook.jsi.Value>(bitPattern: resAddr)!\n          let arguments = JavaScriptValuesBuffer',
      },
      {
        search: /nonisolated\(unsafe\)\s+let\s+resultPtr\s*=\s*resultPtr\s*\n\s*return\s+withGuaranteedContext\(context\)\s*\{\s*\(context:\s*HostObjectContext,\s*runtime\)\s*in\s*\n\s*return\s+JavaScriptActor\.assumeIsolated\s*\{\s*\n\s*return\s+forwardingSwiftErrorsToJS\(runtime:\s*runtime\)\s*\{\s*\n\s*try\s+context\.get\(propertyName\)\.writeJSIValue\(to:\s*resultPtr\)/g,
        replace: 'let resAddr = UInt(bitPattern: resultPtr)\n      return withGuaranteedContext(context) { (context: HostObjectContext, runtime) in\n        return JavaScriptActor.assumeIsolated {\n          return forwardingSwiftErrorsToJS(runtime: runtime) {\n            let resultPtr = UnsafeMutablePointer<facebook.jsi.Value>(bitPattern: resAddr)!\n            try context.get(propertyName).writeJSIValue(to: resultPtr)',
      },
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

// 5. Patch HostObjectCallbacks.h with appendPropNameIdUtf8 helper
const hostObjectCallbacksHeaders = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI-Cxx', 'include', 'HostObjectCallbacks.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Public', 'expo-modules-jsi', 'HostObjectCallbacks.h'),
  path.join(__dirname, '..', 'ios', 'Pods', 'Headers', 'Private', 'expo-modules-jsi', 'HostObjectCallbacks.h'),
];

for (const header of hostObjectCallbacksHeaders) {
  if (!fs.existsSync(header)) continue;
  let content = fs.readFileSync(header, 'utf8');
  let modified = false;

  if (!content.includes('appendPropNameIdUtf8')) {
    const helper = `
inline void appendPropNameIdUtf8(HostObjectCallbacks::PropNameIds &vector, facebook::jsi::IRuntime &runtime, const std::string &name) {
  vector.push_back(facebook::jsi::PropNameID::forUtf8(runtime, name));
}
`;
    content = content.replace(
      /}\s*\/\/\s*namespace\s+expo/,
      `${helper}\n} // namespace expo`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(header, content, 'utf8');
    console.log(`[patch-swift-tools] Successfully patched ${header}`);
  }
}

// 6. Patch prebuilt xcframework tarballs and extracted .swiftinterface files for Swift 6.1.2 compatibility
const { execSync } = require('child_process');

function sanitizeSwiftInterfaceString(content) {
  let modified = false;
  if (content.includes('Apple Swift version 6.3')) {
    content = content.replace(/Apple Swift version 6\.3[^\n]*/g, 'Apple Swift version 6.1.2 (swiftlang-6.1.2.1.2 clang-1700.0.13.5)');
    content = content.replace(/-interface-compiler-version 6\.3[^\s]*/g, '-interface-compiler-version 6.1.2');
    modified = true;
  }
  if (content.includes('@_Concurrency.MainActor ExpoModulesCore.AnyArgument')) {
    content = content.replace(
      /extension\s+UIKit\.UIView\s*:\s*@_Concurrency\.MainActor\s+ExpoModulesCore\.AnyArgument/g,
      'extension UIKit.UIView : ExpoModulesCore.AnyArgument'
    );
    modified = true;
  }
  if (content.includes('@_Concurrency.MainActor')) {
    content = content.replace(/@_Concurrency\.MainActor/g, '@MainActor');
    modified = true;
  }
  return { content, modified };
}

function patchTarball(tbPath) {
  const tmpDir = path.join(path.dirname(tbPath), '.tmp_tb_patch_' + Date.now());
  try {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    execSync(`tar -xzf "${tbPath}" -C "${tmpDir}"`);

    let modifiedCount = 0;
    function walkAndPatch(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walkAndPatch(f);
        else if (e.name.endsWith('.swiftinterface')) {
          const raw = fs.readFileSync(f, 'utf8');
          const result = sanitizeSwiftInterfaceString(raw);
          if (result.modified) {
            fs.writeFileSync(f, result.content, 'utf8');
            modifiedCount++;
          }
        }
      }
    }
    walkAndPatch(tmpDir);

    if (modifiedCount > 0) {
      const topEntries = fs.readdirSync(tmpDir);
      const args = topEntries.map(e => `"${e}"`).join(' ');
      execSync(`tar -czf "${tbPath}" -C "${tmpDir}" ${args}`);
      console.log(`[patch-swift-tools] Patched and repacked ${path.basename(tbPath)} (${modifiedCount} interfaces)`);
    }
  } catch (err) {
    console.warn(`[patch-swift-tools] Warning: failed to patch tarball ${tbPath}:`, err.message);
  } finally {
    if (fs.existsSync(tmpDir)) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  }
}

function findAndPatchTarballs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findAndPatchTarballs(full);
    } else if (entry.name.endsWith('.tar.gz') && (full.includes('xcframeworks') || full.includes('artifacts'))) {
      patchTarball(full);
    }
  }
}

function patchSwiftInterfaces(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchSwiftInterfaces(full);
    } else if (entry.name.endsWith('.swiftinterface')) {
      const raw = fs.readFileSync(full, 'utf8');
      const result = sanitizeSwiftInterfaceString(raw);
      if (result.modified) {
        fs.writeFileSync(full, result.content, 'utf8');
        console.log(`[patch-swift-tools] Sanitized swiftinterface: ${full}`);
      }
    }
  }
}

// Patch all prebuilt tarballs in node_modules and ios/Pods
findAndPatchTarballs(path.join(__dirname, '..', 'node_modules'));
findAndPatchTarballs(path.join(__dirname, '..', 'ios', 'Pods'));

// Patch any extracted .swiftinterface files
patchSwiftInterfaces(path.join(__dirname, '..', 'ios', 'Pods'));
