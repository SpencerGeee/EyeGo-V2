module.exports = function (api) {
  api.cache(true)
  // If you hit Hermes bytecode corruption (EXC_BAD_ACCESS in arrayPrototypeMap
  // on startup after JS changes), fix with:
  //   npx expo start -c && cd ios && rm -rf build && pod deintegrate && pod install;
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
