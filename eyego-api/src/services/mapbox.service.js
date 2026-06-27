'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');

// Ghana bounding box for coordinate validation
const GHANA_BOUNDS = {
  minLat: 4.5, maxLat: 11.5,
  minLng: -3.5, maxLng: 1.5,
};

function isWithinGhana(lat, lng) {
  return (
    lat >= GHANA_BOUNDS.minLat && lat <= GHANA_BOUNDS.maxLat &&
    lng >= GHANA_BOUNDS.minLng && lng <= GHANA_BOUNDS.maxLng
  );
}

async function getDirections(originLng, originLat, destLng, destLat) {
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    `${originLng},${originLat};${destLng},${destLat}` +
    `?geometries=geojson&overview=full&steps=false&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  const { data } = await axios.get(url, { timeout: 10000 });
  if (!data.routes?.length) throw new Error('No route found between these coordinates');

  const route = data.routes[0];
  return {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    geometry: route.geometry,
  };
}

async function forwardGeocode(query) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?types=place,locality,neighborhood,address&country=GH&limit=1&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  try {
    const { data } = await axios.get(url, { timeout: 5000 });
    if (!data.features?.length) return null;
    const f = data.features[0];
    return {
      name: f.place_name,
      lat: f.center[1],
      lng: f.center[0],
    };
  } catch (err) {
    logger.warn(`Mapbox forwardGeocode failed for "${query}": ${err.message}`);
    return null;
  }
}

async function reverseGeocode(lng, lat) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?types=address,place&country=GH&access_token=${env.MAPBOX_SECRET_TOKEN}`;

  const { data } = await axios.get(url, { timeout: 5000 });
  return data.features?.[0]?.place_name || `${lat}, ${lng}`;
}

module.exports = { getDirections, forwardGeocode, reverseGeocode, isWithinGhana };
