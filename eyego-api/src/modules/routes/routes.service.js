'use strict';

const prisma = require('../../config/database');
const { NotFoundError } = require('../../utils/errors');

async function listRoutes() {
  return prisma.route.findMany({
    where: { isActive: true },
    include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } },
    orderBy: { name: 'asc' },
  });
}

async function getRoute(id) {
  const route = await prisma.route.findUnique({
    where: { id },
    include: { virtualStops: { where: { isActive: true }, orderBy: { sequence: 'asc' } } },
  });
  if (!route) throw new NotFoundError('Route');
  return route;
}

async function getQuickRoutes() {
  const routes = await prisma.route.findMany({
    where: { isActive: true },
    select: { id: true, name: true, originName: true, destinationName: true, distanceKm: true },
    orderBy: { name: 'asc' },
  });
  return routes;
}

async function getStops(routeId) {
  const stops = await prisma.virtualStop.findMany({
    where: { routeId, isActive: true },
    orderBy: { sequence: 'asc' },
  });
  return stops;
}

module.exports = { listRoutes, getRoute, getQuickRoutes, getStops };
