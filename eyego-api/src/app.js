'use strict';

require('express-async-errors');
require('./config/env'); // validate env on startup

const sentry = require('./config/sentry');

const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const hpp = require('hpp');

const { defaultLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

// Routes
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
// NOTE: client-facing route-discovery API (/v1/routes) removed in the
// group/on-demand pivot. Routes are now an internal-only concept (trips reuse
// the Prisma Route model as ad-hoc rows). Do NOT re-mount routes.routes here.
const tripsRoutes = require('./modules/trips/trips.routes');
// On-demand rides — the single canonical dispatch path. `trips` remains for
// the group/bus product; lifecycle for BOTH lives on Trip.status either way.
const ridesRoutes = require('./modules/rides/rides.routes');
const bookingsRoutes = require('./modules/bookings/bookings.routes');
const paymentsRoutes = require('./modules/payments/payments.routes');
const driversRoutes = require('./modules/drivers/drivers.routes');
const walletRoutes = require('./modules/wallet/wallet.routes');
const riderWalletRoutes = require('./modules/wallet/rider.wallet.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const heatmapRoutes = require('./modules/heatmap/heatmap.routes');
const questsRoutes = require('./modules/quests/quests.routes');
const contactRoutes = require('./modules/contact/contact.routes');
const cancellationRoutes = require('./modules/cancellation/cancellation.routes');
const receiptsRoutes = require('./modules/receipts/receipts.routes');
const geoRoutes = require('./modules/geo/geo.routes');
const { yoga } = require('./graphql/index');

const app = express();

// Behind exactly one proxy (Render/Fly/Cloudflare/ngrok in front of us). This
// is what makes `req.protocol` say `https` rather than `http`, and it is what
// share links and rate-limit client IPs are derived from. Kept at 1 rather
// than `true` so a client cannot forge an arbitrary X-Forwarded-For chain.
app.set('trust proxy', 1);

// ── Error tracking (no-op without SENTRY_DSN) ───────────────────
sentry.initSentry(app);

// ── Security headers ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // API — not serving HTML
  crossOriginEmbedderPolicy: false,
}));

// ── CORS (safe defaults with env override) ──────────────────────
app.use(cors({
  origin: (() => {
    // In development, allow the Expo dev server plus well-known ports
    if (process.env.NODE_ENV !== 'production') {
      return [
        'http://localhost:3000',
        'http://localhost:5020',
        'http://localhost:8081',
        'http://localhost:19006',
        /^http:\/\/192\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/, // LAN Expo dev
      ];
    }
    const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
    if (envOrigins) return envOrigins.split(',').map((o) => o.trim());
    return ['https://eyego.app', 'https://driver.eyego.app', 'https://admin.eyego.app'];
  })(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Secret', 'X-Correlation-Id'],
}));

// ── Request size & dimension validation for image uploads ─────────
app.use('/v1/driver/documents', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    const rawLimit = 5 * 1024 * 1024; // 5MB max for uploads
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > rawLimit) {
      return res.status(413).json({ success: false, message: 'File too large. Max 5MB.' });
    }
  }
  next();
});

// ── Parsers ─────────────────────────────────────────────────────
// Raw body for Paystack webhook signature verification
app.use('/v1/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// ── Misc middleware ──────────────────────────────────────────────
app.use(hpp());
app.use(compression());

// ── Logging ─────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: (req) => req.url === '/health',
  })
);

// ── Correlation ID ───────────────────────────────────────────────
app.use((req, res, next) => {
  req.correlationId = require('crypto').randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
});

// ── Public origin ────────────────────────────────────────────────
// Share links follow the origin the API is actually being reached at, so a
// sideload/preview build hands out links that resolve for the recipient
// instead of links pointing at the baked-in APP_URL.
app.use(require('./utils/publicUrl').rememberPublicOrigin);

// ── Rate limiting ────────────────────────────────────────────────
app.use(defaultLimiter);

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'eyego-api',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

/**
 * Dispatch health. Separate from `/health` because it hits the database and
 * `/health` is polled by the load balancer.
 *
 * Answers the question nobody could answer before: is dispatch actually
 * working right now? Live trips by status, how many are stuck, and whether
 * the durable-timer worker is draining. An in-memory cascade that died with a
 * deploy left no trace anywhere — which is why stranded riders were reported
 * as a mystery instead of showing up as an alarm.
 */
app.get('/health/dispatch', async (_req, res) => {
  try {
    const snapshot = await require('./services/trip-health.service').snapshot();
    res.status(snapshot.healthy ? 200 : 503).json(snapshot);
  } catch (err) {
    res.status(503).json({ healthy: false, error: err.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────
app.use('/v1/auth', authRoutes);
app.use('/v1/user', usersRoutes);
app.use('/v1/trips', tripsRoutes);
app.use('/v1/rides', ridesRoutes);
app.use('/v1/bookings', bookingsRoutes);
app.use('/v1/payments', paymentsRoutes);
app.use('/v1/notifications', notificationsRoutes);
app.use('/v1/wallet', riderWalletRoutes);
// wallet must be mounted before /v1/driver so the more-specific path wins
app.use('/v1/driver/wallet', walletRoutes);
app.use('/v1/driver', driversRoutes);
app.use('/v1/heatmap', heatmapRoutes);
app.use('/v1/quests', questsRoutes);
app.use('/v1/contact', contactRoutes);
app.use('/v1/cancellation', cancellationRoutes);
app.use('/v1/receipts', receiptsRoutes);
// Geocoding + routing proxy — keeps MAPBOX_SECRET_TOKEN off the clients.
app.use('/v1/geo', geoRoutes);
app.use('/v1/admin', adminRoutes);

// ── GraphQL ───────────────────────────────────────────────────────
// Mounted alongside REST. Same JWT auth. GraphiQL available in non-production.
// Install deps first: npm install graphql-yoga dataloader
app.use('/graphql', yoga);

// ── Share-trip live tracking + invite pages (public, no auth) ───
// Serves the Mapbox web UIs with server-side config injected.
//
// CRASH-SAFETY: these HTML files were previously read with a top-level
// `fs.readFileSync` at module load — if either file was missing, requiring
// app.js threw and the ENTIRE API failed to boot. We now load lazily with a
// safe loader: a missing page degrades to a 503 for that one route instead of
// taking down the whole server.
const fs = require('fs');

function makePublicPageHandler(relPath, tokenParam) {
  const absPath = path.join(__dirname, relPath);
  let cachedHtml = null;
  try {
    cachedHtml = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    logger.error(`Public page missing at ${absPath} — route will 503 until it exists: ${err.message}`);
  }
  return (req, res) => {
    // Attempt a lazy re-read if it was missing at boot (e.g. added later).
    if (!cachedHtml) {
      try { cachedHtml = fs.readFileSync(absPath, 'utf8'); } catch { /* still missing */ }
    }
    if (!cachedHtml) {
      return res.status(503).type('text/plain').send('Tracking page is temporarily unavailable.');
    }
    const config = {
      [tokenParam]: req.params[tokenParam],
      // The origin the visitor actually reached us on. Baking APP_URL in here
      // pointed the page's own fetches at a host that, on a sideload/preview
      // build, was not the one serving the page.
      apiBase: require('./utils/publicUrl').publicBaseUrl(req),
    };
    const html = cachedHtml.replace('window.__EYEGO_CONFIG__ || {}', JSON.stringify(config));
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  };
}

app.get('/track/:shortId', makePublicPageHandler('../public/tracking/index.html', 'shortId'));
app.get('/invite/:shareToken', makePublicPageHandler('../public/invite/index.html', 'shareToken'));

/**
 * THE APPS' OWN MAP STYLE, served to the web pages.
 *
 * BUGFIX ("the maps don't tally with the rider app map at all — that misses the
 * consistency and brand, it should be the same one so everyone viewing it knows
 * it's eyego").
 *
 * Both public pages carried their own hand-written inline style object. Two
 * copies of a brand, edited independently, drifting — and the shared style in
 * `@eyego/map-styles` (the one both apps actually render) was the copy nobody
 * was looking at. A rider following a share link saw a different map from the
 * one they had just been using.
 *
 * Serving the real file makes the apps and the web the same map by construction.
 * Cached hard: it is a build artefact that changes only on deploy, and it is on
 * the critical path of a page whose load speed was itself reported.
 */
const MAP_STYLE_CACHE = new Map();
app.get('/map-style/:variant.json', (req, res) => {
  const variant = req.params.variant === 'light' ? 'eyego-light' : 'eyego-dark';
  if (!MAP_STYLE_CACHE.has(variant)) {
    /*
     * Read from disk rather than `require('@eyego/map-styles')`: the API does
     * not declare that workspace package as a dependency, so requiring it works
     * only by accident of hoisting and would throw in a deployed bundle. Both
     * layouts are tried — the monorepo checkout and a build that copies the
     * styles in next to the API.
     */
    const candidates = [
      path.join(__dirname, '../../packages/map-styles', `${variant}.json`),
      path.join(__dirname, '../map-styles', `${variant}.json`),
      path.join(__dirname, '../public/map-styles', `${variant}.json`),
    ];
    let loaded = null;
    for (const p of candidates) {
      try { loaded = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch { /* next */ }
    }
    if (!loaded) logger.error(`Map style ${variant} not found in: ${candidates.join(', ')}`);
    MAP_STYLE_CACHE.set(variant, loaded);
  }
  const style = MAP_STYLE_CACHE.get(variant);
  if (!style) {
    // The pages keep a minimal inline fallback, so this degrades the map rather
    // than breaking the page.
    return res.status(404).json({ error: 'style unavailable' });
  }
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.json(style);
});

// ── Admin Dashboard SPA ──────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, '../public')));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// ── 404 ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` });
});

// ── Sentry Express error handler (before our handler; no-op if disabled) ──
sentry.setupExpressErrorHandler(app);

// ── Global error handler (must be last) ────────────────────────────
app.use(errorHandler);

module.exports = app;
