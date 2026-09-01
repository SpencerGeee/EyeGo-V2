'use strict';

const prisma = require('../config/database');

/**
 * ── /metrics, IN PROMETHEUS TEXT FORMAT, WITH NO DEPENDENCY ─────────────────
 *
 * `prom-client` is the obvious choice and is not used here. The exposition
 * format is a documented, stable, line-oriented text protocol — a name, some
 * labels, a number — and emitting it directly costs about eighty lines. Against
 * that: another package in the dependency tree of the service that takes
 * payments, another thing to keep patched, and a default registry that exports
 * Node heap internals nobody will ever act on.
 *
 * What is exported instead is the handful of numbers an operator would actually
 * be woken for. If this ever needs histograms with real quantiles, that is the
 * moment to reach for the library, and this file is what it replaces.
 *
 * ── COUNTERS ARE PROCESS-LOCAL ──────────────────────────────────────────────
 *
 * The HTTP counters below live in memory and reset when the process restarts.
 * That is correct for Prometheus, which handles counter resets natively — do
 * NOT try to persist them. The gauges are read from the database on scrape,
 * which is why the scrape interval should not be aggressive.
 */

/** name -> { help, type, values: Map<labelKey, number> } */
const counters = new Map();

function counter(name, help) {
  if (!counters.has(name)) counters.set(name, { help, type: 'counter', values: new Map() });
  return counters.get(name);
}

function labelKey(labels = {}) {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, '_')}"`).join(',');
}

/** Increment a counter. Never throws — a metric must not break a request. */
function inc(name, labels = {}, by = 1) {
  try {
    const c = counter(name, '');
    const k = labelKey(labels);
    c.values.set(k, (c.values.get(k) ?? 0) + by);
  } catch {
    /* metrics are never worth an exception */
  }
}

// The counters this service actually keeps. Declared up front so /metrics
// exports them as zero before the first event rather than omitting the series —
// a missing series and a series at zero look very different on a graph.
counter('eyego_http_requests_total', 'HTTP requests handled, by method, route family and status class.');
counter('eyego_http_errors_total', 'HTTP responses with a 5xx status.');

/**
 * Express middleware. Counts by ROUTE FAMILY, not by path.
 *
 * `/v1/trips/abc123/receipt` and `/v1/trips/def456/receipt` are the same
 * endpoint; counting raw paths would produce a new time series per trip id,
 * which is the classic way to make a Prometheus instance fall over.
 */
function httpMetrics(req, res, next) {
  res.on('finish', () => {
    const family = String(req.path || '')
      .split('/')
      .map((seg) => (/^[0-9a-f]{16,}$|^\d+$|^c[a-z0-9]{20,}$/i.test(seg) ? ':id' : seg))
      .join('/') || '/';

    const status = res.statusCode;
    inc('eyego_http_requests_total', {
      method: req.method,
      route: family.slice(0, 120),
      status: `${Math.floor(status / 100)}xx`,
    });
    if (status >= 500) inc('eyego_http_errors_total', { route: family.slice(0, 120) });
  });
  next();
}

/**
 * Gauges, read live.
 *
 * These are the ones worth alerting on: a match rate that has collapsed, a
 * dispatch queue that is not draining, drivers who have gone away. Each is one
 * indexed query; the scrape interval should be 30s or slower.
 */
async function gauges() {
  const since = new Date(Date.now() - 60 * 60 * 1000);

  const [onlineDrivers, activeTrips, requestedLastHour, matchedLastHour, unresolvedSos] =
    await Promise.all([
      prisma.driver.count({ where: { isOnline: true } }),
      prisma.trip.count({ where: { status: { in: ['DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'IN_PROGRESS'] } } }),
      prisma.analyticsEvent.count({ where: { type: 'RIDE_REQUESTED', at: { gte: since } } }),
      prisma.analyticsEvent.count({ where: { type: 'RIDE_MATCHED', at: { gte: since } } }),
      // `status`, not `resolvedAt`. The schema's own note records that
      // `resolvedAt` alone was the old shape and misrepresented which alerts
      // were still open — an acknowledged alert somebody is actively handling
      // has no resolvedAt either.
      prisma.sosEvent.count({ where: { status: { notIn: ['RESOLVED'] } } }),
    ]);

  return [
    ['eyego_drivers_online', 'Drivers currently marked online.', onlineDrivers],
    ['eyego_trips_active', 'Trips between assignment and completion.', activeTrips],
    ['eyego_rides_requested_1h', 'Ride requests in the last hour.', requestedLastHour],
    ['eyego_rides_matched_1h', 'Ride requests matched to a driver in the last hour.', matchedLastHour],
    // The one to alert on. A collapse here is invisible everywhere else until
    // riders start complaining.
    [
      'eyego_match_rate_1h',
      'Matched divided by requested over the last hour. -1 when there were no requests.',
      requestedLastHour > 0 ? Number((matchedLastHour / requestedLastHour).toFixed(4)) : -1,
    ],
    ['eyego_sos_unresolved', 'SOS events nobody has resolved.', unresolvedSos],
  ];
}

/** The whole exposition document. */
async function render() {
  const lines = [];

  for (const [name, c] of counters) {
    if (c.help) lines.push(`# HELP ${name} ${c.help}`);
    lines.push(`# TYPE ${name} counter`);
    if (c.values.size === 0) {
      lines.push(`${name} 0`);
    } else {
      for (const [k, v] of c.values) lines.push(k ? `${name}{${k}} ${v}` : `${name} ${v}`);
    }
  }

  try {
    for (const [name, help, value] of await gauges()) {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} gauge`);
      lines.push(`${name} ${value}`);
    }
  } catch (err) {
    // A database that cannot answer must not make the scrape fail — the HTTP
    // counters above are still worth having, and a scrape error looks like the
    // exporter is down rather than like the database is.
    lines.push('# HELP eyego_gauges_error Gauge collection failed on the last scrape.');
    lines.push('# TYPE eyego_gauges_error gauge');
    lines.push('eyego_gauges_error 1');
  }

  return lines.join('\n') + '\n';
}

module.exports = { inc, httpMetrics, render, gauges };
