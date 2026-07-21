const dark = require('./eyego-dark.json');
const light = require('./eyego-light.json');
// Driver-app dark variant — same base/landuse/building/label treatment as
// `dark`, but the highway accent is brand-blue instead of rider's brand-green
// (the driver app is blue-themed; light mode's highway accent is already
// blue for both apps, so no separate driver-light variant is needed).
const darkDriver = require('./eyego-dark-driver.json');

// Default export stays the dark style JSON object itself, unchanged, for
// existing `import eyegoDarkStyle from '@eyego/map-styles'` consumers.
// The extra named exports are attached as non-enumerable so they're invisible
// to JSON.stringify (the native map component stringifies this object
// directly) — an enumerable self-reference here would both corrupt the style
// spec with unknown top-level keys and throw a circular-structure error.
module.exports = dark;
Object.defineProperty(module.exports, 'eyegoDarkStyle', { value: dark, enumerable: false });
Object.defineProperty(module.exports, 'eyegoLightStyle', { value: light, enumerable: false });
Object.defineProperty(module.exports, 'eyegoDriverDarkStyle', { value: darkDriver, enumerable: false });
