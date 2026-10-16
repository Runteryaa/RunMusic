const fs = require('fs');
const path = require('path');

const targetDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-ble-plx',
  'android',
  'build',
  'generated',
  'source',
  'codegen',
  'jni'
);

try {
  fs.mkdirSync(targetDir, { recursive: true });
  const cmakeFile = path.join(targetDir, 'CMakeLists.txt');
  const cmakeContent = `cmake_minimum_required(VERSION 3.13)
add_library(react_codegen_BlePlx INTERFACE)
`;
  fs.writeFileSync(cmakeFile, cmakeContent, 'utf8');
  console.log('[ensure-ble-plx-codegen] Created dummy CMakeLists.txt at:', cmakeFile);
} catch (err) {
  console.warn('[ensure-ble-plx-codegen] Could not create dummy CMakeLists.txt:', err.message);
}
