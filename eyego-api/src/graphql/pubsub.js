'use strict';

/**
 * Shared pub/sub instance for GraphQL subscriptions.
 *
 * Import this module in any service that needs to publish events:
 *   const pubSub = require('../../graphql/pubsub');
 *   pubSub.publish(`TRIP_STATUS:${tripId}`, { tripId, status, driverLat, driverLng, updatedAt });
 *
 * This in-process pub/sub is correct for a single-instance deployment.
 * When horizontally scaling, swap to graphql-redis-subscriptions:
 *   https://github.com/davidyaha/graphql-redis-subscriptions
 */

const { createPubSub } = require('graphql-yoga');

const pubSub = createPubSub();

module.exports = pubSub;
