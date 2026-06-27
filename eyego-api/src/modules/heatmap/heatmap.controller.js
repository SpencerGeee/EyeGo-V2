'use strict';

const heatmapService = require('./heatmap.service');
const { ok } = require('../../utils/response');

const getDemand = async (req, res) => {
  const { lat, lng, radius } = req.query;
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const parsedRadius = parseFloat(radius) || 5;

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return res.status(400).json({ success: false, code: 'INVALID_PARAMS', message: 'lat and lng query params are required' });
  }

  const cells = await heatmapService.aggregateDemand({ lat: parsedLat, lng: parsedLng, radiusKm: parsedRadius });
  ok(res, { cells, centre: { lat: parsedLat, lng: parsedLng }, radiusKm: parsedRadius });
};

module.exports = { getDemand };
