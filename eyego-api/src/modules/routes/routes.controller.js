'use strict';

const routesService = require('./routes.service');
const { ok } = require('../../utils/response');

const listRoutes = async (req, res) => {
  const routes = await routesService.listRoutes();
  ok(res, { routes });
};

const getRoute = async (req, res) => {
  const route = await routesService.getRoute(req.params.id);
  ok(res, { route });
};

const getQuickRoutes = async (req, res) => {
  const routes = await routesService.getQuickRoutes();
  ok(res, { routes });
};

const getStops = async (req, res) => {
  const stops = await routesService.getStops(req.params.id);
  ok(res, { stops });
};

module.exports = { listRoutes, getRoute, getQuickRoutes, getStops };
