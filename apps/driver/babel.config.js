module.exports = function (api) {
  api.cache(true);
  const isProd = process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
    ],
    plugins: [
      /**
       * ── CONSOLE CALLS ARE NOT FREE IN A RELEASE BUILD ─────────────────────
       *
       * 35 `console.*` calls in this app's source, all of them shipping. Hermes
       * does not strip them, and each one crosses the JS→native logging bridge
       * synchronously AND RETAINS ITS ARGUMENTS — so a logged object cannot be
       * collected while the entry holds it.
       *
       * That matters more here than in the rider app: the driver app logs on
       * the location path, and a driver's session is a whole shift. A retained
       * fix per GPS frame is the mechanism behind "it gets slower the longer I
       * drive", and no render optimisation touches it.
       *
       * Stripped in production ONLY. `error` and `warn` are kept deliberately —
       * they are the breadcrumbs a crash report is read through.
       */
      ...(isProd ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
      // Must stay LAST — the Reanimated plugin rewrites worklets and expects to
      // see the final AST.
      'react-native-reanimated/plugin',
    ],
  };
};
