'use strict';

/**
 * A Prisma model mock that does not have to be kept in step by hand.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * Every suite here declared its mocks by listing the methods the service used
 * at the time:
 *
 *     const mockTrip = { findUnique: jest.fn(), update: jest.fn() };
 *
 * Which is fine until the service reaches for one more. Then the failure is
 * `tx.trip.updateMany is not a function` — a TypeError that names a Prisma
 * method, from a test whose subject has nothing to do with it. Between them
 * these suites failed on `walletTransaction.findFirst`, `rideGroup.update` and
 * `trip.updateMany`, and in each case the CODE had got more careful — an
 * idempotency guard, a conditional update — while the mock stayed where it was.
 *
 * A mock whose maintenance cost grows with the code it stands in for will
 * always lose that race.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 *
 * A Proxy that mints a `jest.fn()` the first time any method is touched, and
 * returns the same one thereafter — so `expect(mock.findUnique)` still works,
 * `mockResolvedValue` still works, and `jest.clearAllMocks()` still reaches it.
 *
 * Unstubbed methods resolve to `undefined`, which is what an un-mocked Prisma
 * call would do anyway. A test that cares sets a value; a test that does not is
 * no longer broken by a method it never mentions.
 */
function modelMock(initial = {}) {
  const fns = new Map();
  for (const [k, v] of Object.entries(initial)) fns.set(k, v);

  return new Proxy(
    {},
    {
      get(_target, prop) {
        // Jest and util.inspect probe objects with symbols; answering those
        // with a mock function makes assertion output unreadable.
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') return undefined; // never look thenable
        if (!fns.has(prop)) fns.set(prop, jest.fn());
        return fns.get(prop);
      },
      has: () => true,
      ownKeys: () => [...fns.keys()],
      getOwnPropertyDescriptor: (_t, prop) => ({
        value: fns.get(prop),
        enumerable: true,
        configurable: true,
      }),
    },
  );
}

/**
 * A whole client. Any model name is valid, so a service reaching for a table
 * the test never thought about gets a mock rather than
 * "Cannot read properties of undefined".
 *
 * `$transaction` runs the callback against the same client: these suites test
 * what was written, not isolation semantics no mock can honestly model.
 */
function prismaMock(models = {}) {
  const built = new Map();
  for (const [name, def] of Object.entries(models)) built.set(name, modelMock(def));

  const client = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined;
        if (prop === 'then') return undefined;
        if (prop === '$transaction') {
          return jest.fn((arg) => (typeof arg === 'function' ? arg(client) : Promise.all(arg)));
        }
        if (prop === '$queryRaw' || prop === '$executeRaw' || prop === '$disconnect' || prop === '$connect') {
          if (!built.has(prop)) built.set(prop, jest.fn());
          return built.get(prop);
        }
        if (!built.has(prop)) built.set(prop, modelMock());
        return built.get(prop);
      },
      has: () => true,
      ownKeys: () => [...built.keys()],
      getOwnPropertyDescriptor: (_t, prop) => ({
        value: built.get(prop),
        enumerable: true,
        configurable: true,
      }),
    },
  );

  return client;
}

module.exports = { modelMock, prismaMock };
