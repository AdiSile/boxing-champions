'use strict';

// ---------------------------------------------------------------------------
// server.js — Boxing Champions Express Server
//
// Security: helmet with CSP nonces, X-Content-Type-Options, X-Frame-Options,
//           rate limiting on auth routes, cookie-based JWT, prepared statements
//           for all SQL queries.
//
// Static files served from /public and /admin (with custom CSP for admin).
// API routes mounted via safeMount with graceful fallback if a module fails.
// ---------------------------------------------------------------------------

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Trust proxy for rate limiting behind reverse proxies
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ---------------------------------------------------------------------------
// Cookie parser (lightweight, no external dependency)
// ---------------------------------------------------------------------------
function cookieParser(req, _res, next) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      cookies[key] = decodeURIComponent(val);
    }
  });
  req.cookies = cookies;
  next();
}
app.use(cookieParser);

// ---------------------------------------------------------------------------
// Nonce generator for CSP
// ---------------------------------------------------------------------------
function nonce(_req, _res) {
  return crypto.randomBytes(16).toString('base64');
}

// ---------------------------------------------------------------------------
// Helmet with dynamic CSP nonce
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (req, res) => "'nonce-" + res.locals.nonce + "'"],
        styleSrc: [
          "'self'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
          "'unsafe-inline'",
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://images.pexels.com', 'https://*.pexels.com'],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'https://www.google.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// ---------------------------------------------------------------------------
// Attach nonce to response locals (middleware runs after helmet init)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.locals.nonce = nonce(req, res);
  next();
});

// ---------------------------------------------------------------------------
// Rate limiting on auth routes
// ---------------------------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe încercări de autentificare. Încearcă din nou peste 15 minute.' },
});

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
  },
}));

// Admin static files with nonce-aware serving
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  setHeaders(res, _filePath) {
    // Only set if nonce was generated
    if (res.locals.nonce) {
      res.setHeader('X-Nonce', res.locals.nonce);
    }
  },
}));

// ---------------------------------------------------------------------------
// Safe route mounting – wraps require in try/catch and provides a fallback
// ---------------------------------------------------------------------------
function safeMount(mountPath, modulePath) {
  try {
    const router = require(modulePath);
    app.use(mountPath, router);
    console.log(`[server] ✓ Mounted ${mountPath} -> ${modulePath}`);
  } catch (err) {
    console.error(`[server] ✗ Failed to mount ${mountPath} (${modulePath}):`, err.message);
    // Provide a fallback response so the server still runs
    app.use(mountPath, (_req, res) => {
      res.status(503).json({ error: 'Serviciu indisponibil temporar.' });
    });
  }
}

// ---------------------------------------------------------------------------
// Mount API routes
//
// Mount order is deliberate — Express matches prefixes in declaration order:
//
//  1. /api/auth        Auth routes (rate-limited, JWT in HttpOnly cookie)
//  2. /api/contact     Dedicated contact-form module (public POST + admin CRUD)
//  3. /api             Settings module — intercepts /api/settings before the
//                      general API router. Uses a scoped fallback: if
//                      routes/settings.js fails to load, only /api/settings
//                      returns 503; all other /api/* routes pass through to
//                      the general API router below.
//  4. /api             General API – public routes (coaches, events, schedule,
//                      subscriptions, products, achievements, messages,
//                      checkout) and admin routes (full CRUD for all entities).
//                      Provides backward-compatible fallback for /api/settings
//                      and /api/messages if the dedicated modules are absent.
// ---------------------------------------------------------------------------

// Auth routes (with rate limiting)
app.use('/api/auth', authLimiter);
safeMount('/api/auth', './routes/auth');

// Contact routes – mounted before the broad /api prefix so a failing
// settings module cannot shadow /api/contact with its fallback.
safeMount('/api/contact', './routes/contact');

// Settings routes – dedicated module, mounted at /api before the general
// API router so it owns /api/settings (public GET + admin PUT).
// Scoped fallback: only /api/settings gets 503 on failure.
try {
  const settingsRouter = require('./routes/settings');
  app.use('/api', settingsRouter);
  console.log('[server] ✓ Mounted /api -> ./routes/settings');
} catch (err) {
  console.error('[server] ✗ Failed to mount /api (./routes/settings):', err.message);
  app.use('/api/settings', (_req, res) => {
    res.status(503).json({ error: 'Serviciul de setări este indisponibil temporar.' });
  });
}

// General API routes – all remaining public & admin endpoints.
// Mounted after settings so /api/settings is already claimed by the
// dedicated module.  The legacy /api/settings and /api/messages routes
// inside routes/api.js serve as backward-compatible fallbacks.
safeMount('/api', './routes/api');

// ---------------------------------------------------------------------------
// HTML page serving
// ---------------------------------------------------------------------------
const PAGE_MAP = {
  '/': 'public/index.html',
  '/events': 'public/events.html',
  '/schedule': 'public/schedule.html',
  '/pricing': 'public/pricing.html',
  '/shop': 'public/shop.html',
  '/contact': 'public/contact.html',
  '/admin': 'admin/views/login.html',
  '/admin/dashboard': 'admin/views/dashboard.html',
};

Object.entries(PAGE_MAP).forEach(([route, filePath]) => {
  app.get(route, (_req, res) => {
    const fullPath = path.join(__dirname, filePath);
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).send('Page not found');
    }
  });
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta nu a fost găsită.' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Eroare internă a serverului.',
    details: isProduction ? undefined : err.message,
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
// Initialize database before listening
try {
  getDb();
  console.log('[server] Database initialized.');
} catch (err) {
  console.error('[server] Database initialization failed:', err.message);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`[server] Boxing Champions running on http://localhost:${PORT}`);
  console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;