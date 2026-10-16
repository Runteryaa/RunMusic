const fs = require('fs');
const path = require('path');

const gradleFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-ble-plx',
  'android',
  'build.gradle'
);

if (fs.existsSync(gradleFile)) {
  let content = fs.readFileSync(gradleFile, 'utf8');
  if (/libraryName\s*=\s*["']BlePlx["']/.test(content)) {
    // Completely remove the libraryName line so regex /libraryName = ["'](.+)["']/ does not match
    content = content.replace(/^[^\n\r]*libraryName\s*=[^\n\r]*/gm, '');
    fs.writeFileSync(gradleFile, content, 'utf8');
    console.log('[patch-ble-plx] Successfully stripped libraryName from react-native-ble-plx/android/build.gradle');
  } else {
    console.log('[patch-ble-plx] libraryName not present or already stripped');
  }

  const verify = /libraryName = ["'](.+)["']/.test(fs.readFileSync(gradleFile, 'utf8'));
  console.log('[patch-ble-plx] Verification check (matches libraryName?):', verify);
} else {
  console.log('[patch-ble-plx] File not found:', gradleFile);
}
