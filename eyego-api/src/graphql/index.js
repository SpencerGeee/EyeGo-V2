'use strict';

const { createYoga, createSchema } = require('graphql-yoga');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
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
        // Accepts both rider tokens (userId) and driver tokens (driverId)
        user = jwt.verify(token, env.JWT_SECRET);
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
