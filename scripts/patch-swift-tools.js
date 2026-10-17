const fs = require('fs');
const path = require('path');

const filesToPatch = [
  path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'),
  path.join(__dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift'),
];

for (const file of filesToPatch) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;

    if (content.includes('swift-tools-version: 6.2')) {
      content = content.replace(/swift-tools-version:\s*6\.2/g, 'swift-tools-version: 6.0');
      modified = true;
    }

    if (content.includes('602.0.0-latest')) {
      content = content.replace(/602\.0\.0-latest/g, '600.0.0-latest');
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`[patch-swift-tools] Successfully patched ${file} for Swift 6.0 compatibility`);
    } else {
      console.log(`[patch-swift-tools] ${file} already patched or does not contain 6.2`);
    }
  } else {
    console.log(`[patch-swift-tools] File not found: ${file}`);
  }
}
