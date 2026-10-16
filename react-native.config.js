module.exports = {
  dependencies: {
    'react-native-ble-plx': {
      platforms: {
        android: {
          cmakeListsPath: '../../../../scripts/dummy-ble-cmake/CMakeLists.txt',
        },
      },
    },
  },
};
