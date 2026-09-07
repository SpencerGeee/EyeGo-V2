module.exports = function (api) {
  api.cache(true)
  // If you hit Hermes bytecode corruption (EXC_BAD_ACCESS in arrayPrototypeMap
  // on startup after JS changes), fix with:
  //   npx expo start -c && cd ios && rm -rf build && pod deintegrate && pod install;
  const isProd = process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      /**
       * ── CONSOLE CALLS ARE NOT FREE IN A RELEASE BUILD ─────────────────────
       *
       * There are 46 `console.*` calls in this app's source and they all ship.
       * Hermes does not strip them, and each one is worse than it looks:
       *
       *   - it crosses the JS→native logging bridge, synchronously;
       *   - it RETAINS ITS ARGUMENTS. A logged object graph cannot be collected
       *     while the log entry holds it, so a `console.log(snapshot)` on a
       *     socket or GPS path pins a trip snapshot per frame. That is the kind
       *     of leak that shows up as "the app gets slower the longer I drive",
       *     which no amount of render optimisation will fix.
       *
       * Stripped in production ONLY — development keeps every one of them,
       * because the logs are how the dispatch and map paths get debugged.
       *
       * `error` and `warn` are DELIBERATELY KEPT. They are how a crash reaches
       * Sentry's breadcrumbs, and a release build that has thrown away its own
       * warnings is one nobody can diagnose.
       */
      ...(isProd ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
      // Must stay LAST — the Reanimated plugin rewrites worklets and expects to
      // see the final AST.
      'react-native-reanimated/plugin',
    ],
  };
};
