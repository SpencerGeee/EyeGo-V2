'use strict';

/**
 * The release gate — the only lever that reaches a native build already
 * installed on a phone. See src/utils/app-version.js.
 *
 * Worth testing properly because every failure mode here is expensive in one
 * direction or the other: too strict and you strand paying drivers who cannot
 * update; too loose and the lever does not work on the day you need it.
 */

const PATH = '../src/utils/app-version';

/**
 * `settings` is mocked, not stubbed by hand.
 *
 * The first version of this file swapped `Module._load`, called the module,
 * and restored it in a `finally`. That looked right and was wrong:
 * `releaseGateFor` requires settings LAZILY, at call time, so by the time an
 * assertion ran the stub had already been put back and the gate was reading
 * the real settings module — which also drags in a database connection, and is
 * why jest would not exit afterwards. Four tests failed for a reason that had
 * nothing to do with the code under test, which is its own small lesson: a
 * brand-new suite's first red is suspect until the harness is proven.
 */
jest.mock('../src/config/settings', () => ({ get: jest.fn() }));

const settings = require('../src/config/settings');

/** Point the mocked settings at a value set, and hand back the module. */
function loadWith(values) {
  settings.get.mockImplementation((k) => values[k]);
  return require(PATH);
}

const GATED = {
  MIN_SUPPORTED_VERSION_RIDER: '1.5.0',
  MIN_SUPPORTED_VERSION_DRIVER: '2.0.0',
  STORE_URL_RIDER_ANDROID: 'https://play.google.com/store/apps/details?id=com.eyego.rider',
  STORE_URL_RIDER_IOS: 'https://apps.apple.com/app/id000000000',
  MAINTENANCE_MODE: false,
  MAINTENANCE_MESSAGE: '',
};

const headers = (app, version, platform = 'android') => ({
  headers: {
    ...(app ? { 'x-eyego-app': app } : {}),
    ...(version ? { 'x-eyego-version': version } : {}),
    ...(platform ? { 'x-eyego-platform': platform } : {}),
  },
});

describe('compareVersions', () => {
  const { compareVersions } = require(PATH);

  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.0.1', '1.0.0', 1],
    ['1.2', '1.2.0', 0],
    ['2.0.0', '10.0.0', -1],
  ])('compares %s to %s', (a, b, want) => {
    expect(Math.sign(compareVersions(a, b))).toBe(want);
  });

  it('compares numerically, not lexicographically', () => {
    // The classic version-compare bug: as strings, "1.10.0" < "1.9.0".
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('ignores a pre-release suffix', () => {
    // An internal build tagged -beta must not be gated out mid-test, and a
    // store build's tag is cosmetic.
    expect(compareVersions('1.0.0-beta.3', '1.0.0')).toBe(0);
  });

  it('treats unparseable input as the oldest possible version', () => {
    expect(compareVersions('abc', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('', '1.0.0')).toBeLessThan(0);
  });
});

describe('isUnsupported', () => {
  it('refuses a build below the minimum', () => {
    expect(loadWith(GATED).isUnsupported(headers('rider', '1.4.9'))).toBe(true);
  });

  it('allows the minimum itself', () => {
    expect(loadWith(GATED).isUnsupported(headers('rider', '1.5.0'))).toBe(false);
  });

  it('reads a different minimum per app', () => {
    const gate = loadWith(GATED);
    // 1.9.0 is fine for a rider and too old for a driver.
    expect(gate.isUnsupported(headers('rider', '1.9.0'))).toBe(false);
    expect(gate.isUnsupported(headers('driver', '1.9.0'))).toBe(true);
  });

  // ── The three fail-open cases. All deliberate; see the module's own note. ──

  it('fails open when no minimum is configured', () => {
    expect(loadWith({}).isUnsupported(headers('rider', '0.0.1'))).toBe(false);
  });

  it('fails open when the client sends no version', () => {
    // Builds that predate the header, and every non-app caller.
    expect(loadWith(GATED).isUnsupported(headers('rider', ''))).toBe(false);
  });

  it('fails open for a caller that is not one of our apps', () => {
    // The admin console and the e2e harness both call the API. Gating them
    // would break the console the moment a minimum was ever set.
    expect(loadWith(GATED).isUnsupported(headers('', '0.0.1'))).toBe(false);
    expect(loadWith(GATED).isUnsupported(headers('something-else', '0.0.1'))).toBe(false);
  });
});

describe('requireSupportedClient', () => {
  function runMiddleware(gate, req) {
    let statusCode = null;
    let body = null;
    let nexted = false;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
    };
    gate.requireSupportedClient(req, res, () => { nexted = true; });
    return { statusCode, body, nexted };
  }

  it('passes a supported build straight through', () => {
    const { nexted, statusCode } = runMiddleware(loadWith(GATED), headers('rider', '1.6.0'));
    expect(nexted).toBe(true);
    expect(statusCode).toBeNull();
  });

  it('answers 426 with the store URL for a stale build', () => {
    const { statusCode, body, nexted } = runMiddleware(loadWith(GATED), headers('rider', '1.0.0'));
    expect(nexted).toBe(false);
    expect(statusCode).toBe(426);
    expect(body.code).toBe('UPGRADE_REQUIRED');
    // The upgrade screen is useless without somewhere to send people.
    expect(body.data.storeUrl).toContain('play.google.com');
    expect(body.data.minVersion).toBe('1.5.0');
    expect(body.data.yourVersion).toBe('1.0.0');
  });

  it('picks the store URL matching the caller platform', () => {
    const { body } = runMiddleware(loadWith(GATED), headers('rider', '1.0.0', 'ios'));
    expect(body.data.storeUrl).toContain('apps.apple.com');
  });
});
