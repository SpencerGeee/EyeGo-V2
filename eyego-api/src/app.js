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
const routesRoutes = require('./modules/routes/routes.routes');
const tripsRoutes = require('./modules/trips/trips.routes');
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
const { yoga } = require('./graphql/index');

const app = express();

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

// ── API Routes ────────────────────────────────────────────────────
app.use('/v1/auth', authRoutes);
app.use('/v1/user', usersRoutes);
app.use('/v1/routes', routesRoutes);
app.use('/v1/trips', tripsRoutes);
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
      apiBase: process.env.APP_URL || '',
    };
    const html = cachedHtml.replace('window.__EYEGO_CONFIG__ || {}', JSON.stringify(config));
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  };
}

app.get('/track/:shortId', makePublicPageHandler('../public/tracking/index.html', 'shortId'));
app.get('/invite/:shareToken', makePublicPageHandler('../public/invite/index.html', 'shareToken'));

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
