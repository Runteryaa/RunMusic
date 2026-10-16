const fs = require('fs');
const path = require('path');

const bleAndroidDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-ble-plx',
  'android'
);

const cmakeContent = `cmake_minimum_required(VERSION 3.13)
project(react_codegen_BlePlx)
file(WRITE \${CMAKE_CURRENT_BINARY_DIR}/dummy.cpp "// dummy\\n")
add_library(react_codegen_BlePlx STATIC \${CMAKE_CURRENT_BINARY_DIR}/dummy.cpp)
`;

const dirsToCreate = [
  path.join(bleAndroidDir, 'dummy-cmake'),
  path.join(bleAndroidDir, 'build', 'generated', 'source', 'codegen', 'jni'),
];

for (const dir of dirsToCreate) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), cmakeContent, 'utf8');
    console.log('[ensure-ble-plx-codegen] Wrote STATIC CMakeLists.txt to:', dir);
  } catch (err) {
    console.warn('[ensure-ble-plx-codegen] Warning for', dir, ':', err.message);
  }
}
