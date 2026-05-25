// app.config.js replaces app.json so the Mapbox SDK download token
// is never committed to source control. In CI it comes from an EAS secret;
// locally it falls back to the value stored in .env.local (gitignored).
const baseConfig = require('./app.json');

module.exports = ({ config }) => {
  const mapboxDownloadsToken =
    process.env.MAPBOX_DOWNLOADS_TOKEN ??
    // Local dev fallback — copy your token to .env.local and it stays out of git
    '';

  return {
    ...baseConfig.expo,
    plugins: baseConfig.expo.plugins.map((plugin) => {
      if (Array.isArray(plugin) && plugin[0] === '@rnmapbox/maps') {
        return [
          '@rnmapbox/maps',
          {
            ...plugin[1],
            // Override the hardcoded token with the env var when available
            RNMapboxMapsDownloadToken:
              mapboxDownloadsToken || plugin[1].RNMapboxMapsDownloadToken,
          },
        ];
      }
      return plugin;
    }),
  };
};
