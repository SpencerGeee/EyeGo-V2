'use strict';

const typeDefs = /* GraphQL */ `
  type User {
    id: ID!
    name: String!
    phone: String!
    email: String
    profilePhoto: String
    preferredTier: String!
    walletBalance: Float!
    createdAt: String!
  }

  type Driver {
    id: ID!
    name: String!
    phone: String!
    profilePhoto: String
    walletBalance: Float!
  }

  type Route {
    id: ID!
    name: String!
    originName: String!
    destinationName: String!
  }

  type Trip {
    id: ID!
    shortId: String!
    status: String!
    tier: String!
    departureTime: String!
    route: Route
    driver: Driver
    availableSeats: Int!
    baseFare: Float!
    maxSeats: Int!
  }

  type Booking {
    id: ID!
    status: String!
    paymentStatus: String!
    fareAmount: Float!
    paymentMethod: String!
    seatNumber: Int
    createdAt: String!
    trip: Trip
  }

  type BookingConnection {
    items: [Booking!]!
    total: Int!
    page: Int!
    totalPages: Int!
  }

  type EarningsDay {
    date: String!
    amount: Float!
    trips: Int!
  }

  type EarningsBreakdown {
    total: Float!
    tripCount: Int!
    avgPerTrip: Float!
    period: String!
    breakdown: [EarningsDay!]!
  }

  type TripStatusUpdate {
    tripId: ID!
    status: String!
    driverLat: Float
    driverLng: Float
    updatedAt: String!
  }

  type Query {
    """Current authenticated user profile"""
    me: User

    """Rider's booking history with optional status filter and pagination"""
    myBookings(status: String, page: Int, limit: Int): BookingConnection!

    """Trip details by ID — uses DataLoader to batch DB calls"""
    trip(id: ID!): Trip

    """Driver earnings breakdown. period: TODAY | WEEK | MONTH (default: TODAY)"""
    earningsBreakdown(period: String): EarningsBreakdown!
  }

  type Subscription {
    """Real-time trip status updates. Emits immediately with current state, then streams changes."""
    tripStatus(tripId: ID!): TripStatusUpdate!
  }
`;

module.exports = { typeDefs };
