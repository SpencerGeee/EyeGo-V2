'use strict';

const { createYoga, createSchema } = require('graphql-yoga');
const env = require('../config/env');
const { checkJwtBlacklist } = require('../middleware/auth');
const { typeDefs } = require('./schema');
const { resolvers } = require('./resolvers');
const { createDataLoaders } = require('./dataloaders');

const schema = createSchema({ typeDefs, resolvers });

/**
 * GraphQL endpoint mounted at /graphql alongside REST /v1/* routes.
 *
 * Authentication: pass the same Bearer token used for REST.
 * Playground: visit /graphql in a browser (disabled in production).
 *
 * Write operations (bookSeat, initiatePayment, cancelBooking) intentionally
 * stay on REST — idempotency keys, webhooks, and auditability are simpler there.
 */
const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: env.NODE_ENV !== 'production',
  landingPage: false,

  context: async ({ request }) => {
    const authHeader = request.headers.get('authorization');
    let user = null;

    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        // Rider and driver tokens alike: { userId, role }.
        // Must be JWT_ACCESS_SECRET (same as middleware/auth.js) — the env
        // schema has no JWT_SECRET, so the previous env.JWT_SECRET was
        // undefined and EVERY GraphQL request silently fell through to
        // anonymous.
        // The REST check, revocation included — a signed-out or deleted
        // account's token kept working here until it expired.
        const decoded = await checkJwtBlacklist(token);
        if (decoded.role === 'PASSENGER' || decoded.role === 'DRIVER') user = decoded;
      } catch {
        // Invalid/expired token — resolvers that require auth will throw
      }
    }

    return {
      user,
      // DataLoaders are per-request — never share across requests
      loaders: createDataLoaders(),
    };
  },

  // Silence yoga's default console logging; our morgan/winston handles it
  logging: false,
});

module.exports = { yoga };
