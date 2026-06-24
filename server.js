'use strict';

// =============================================================================
// Boxing Champions — Server Principal
// =============================================================================
// Express + SQLite (better-sqlite3) + Helmet + Rate Limiting + JWT Auth
// =============================================================================

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

// ---------------------------------------------------------------------------
// Inițializare bază de date (modulul db.js face schema, seed și admin default)
// ---------------------------------------------------------------------------
const db = require('./db');

// ---------------------------------------------------------------------------
// Rute API
// ---------------------------------------------------------------------------
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const contactRoutes = require('./routes/contact');
const settingsRoutes = require('./routes/settings');

// ---------------------------------------------------------------------------
// Aplicația Express
// ---------------------------------------------------------------------------
const app = express();

// ---------------------------------------------------------------------------
// Configurare port
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Generare nonce CSP per request (folosit pentru script-uri inline în admin)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

// ---------------------------------------------------------------------------
// Securitate — Helmet cu CSP care permite script-uri inline cu nonce
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com",
        (req, res) => `'nonce-${res.locals.nonce}'`,
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdnjs.cloudflare.com",
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  max: isProduction ? 500 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe cereri. Încearcă din nou mai târziu.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe încercări de autentificare. Încearcă din nou mai târziu.' },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 200 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe cereri API. Încearcă din nou mai târziu.' },
});

app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Parsare corp cereri — JSON și URL-encoded
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ---------------------------------------------------------------------------
// Parsare cookie-uri manuală (fără dependință cookie-parser)
// ---------------------------------------------------------------------------
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  });
  return cookies;
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

// ---------------------------------------------------------------------------
// Fișiere statice — public
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProduction ? '7d' : 0,
  etag: true,
}));

// ---------------------------------------------------------------------------
// Fișiere statice — admin (CSS, JS, imagini)
// ---------------------------------------------------------------------------
app.use('/admin/css', express.static(path.join(__dirname, 'admin', 'css'), {
  maxAge: isProduction ? '1d' : 0,
}));
app.use('/admin/js', express.static(path.join(__dirname, 'admin', 'js'), {
  maxAge: isProduction ? '1d' : 0,
}));
app.use('/admin/images', express.static(path.join(__dirname, 'admin', 'images'), {
  maxAge: isProduction ? '7d' : 0,
}));

// ---------------------------------------------------------------------------
// Rute API — aplicate cu rate limiting specific
// ---------------------------------------------------------------------------

// Auth routes (login, check, logout)
app.use('/api/auth', authLimiter, authRoutes);

// API public + admin
app.use('/api', apiLimiter, apiRoutes);

// Contact
app.use('/api/contact', apiLimiter, contactRoutes);

// Settings (public GET + admin PUT)
app.use('/api', apiLimiter, settingsRoutes);

// ---------------------------------------------------------------------------
// Admin Panel — pagini HTML
// ---------------------------------------------------------------------------

/**
 * GET /admin — pagina de login
 * Înlocuiește %NONCE% cu nonce-ul generat per request.
 */
app.get('/admin', (_req, res) => {
  const filePath = path.join(__dirname, 'admin', 'views', 'login.html');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Pagina de autentificare nu a fost găsită.');
  }
  let html = fs.readFileSync(filePath, 'utf-8');
  html = html.replace(/%NONCE%/g, res.locals.nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * GET /admin/login.html — aceeași pagină de login
 * Înlocuiește %NONCE% cu nonce-ul generat per request.
 */
app.get('/admin/login.html', (_req, res) => {
  const filePath = path.join(__dirname, 'admin', 'views', 'login.html');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Pagina de autentificare nu a fost găsită.');
  }
  let html = fs.readFileSync(filePath, 'utf-8');
  html = html.replace(/%NONCE%/g, res.locals.nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/**
 * GET /admin/dashboard — panoul de administrare (necesită JWT)
 * Înlocuiește %NONCE% cu nonce-ul generat per request.
 */
app.get('/admin/dashboard', (_req, res) => {
  const filePath = path.join(__dirname, 'admin', 'views', 'dashboard.html');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Pagina de administrare nu a fost găsită.');
  }
  let html = fs.readFileSync(filePath, 'utf-8');
  html = html.replace(/%NONCE%/g, res.locals.nonce);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ---------------------------------------------------------------------------
// Pagini publice HTML (pentru SPA-like navigation)
// ---------------------------------------------------------------------------
const publicPages = [
  'index', 'contact', 'events', 'pricing', 'schedule', 'shop',
];

publicPages.forEach((page) => {
  app.get(`/${page}`, (_req, res, next) => {
    const filePath = path.join(__dirname, 'public', `${page}.html`);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(filePath);
    }
    next();
  });
});

// Redirecționare home
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// 404 — pentru rute necunoscute
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  if (_req.accepts('html')) {
    return res.status(404).send(
      '<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><title>404 - Pagină negăsită</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#e0e0e0;">' +
      '<h1 style="color:#d4af37;">404</h1><p>Pagina căutată nu există.</p>' +
      '<a href="/" style="color:#d4af37;">Înapoi acasă</a></body></html>'
    );
  }
  return res.status(404).json({ error: 'Ruta nu a fost găsită.' });
});

// ---------------------------------------------------------------------------
// Error handler global
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[SERVER] Eroare:', err.message);
  if (!isProduction) {
    console.error(err.stack);
  }
  const status = err.status || 500;
  const message = isProduction
    ? 'Eroare internă a serverului.'
    : err.message || 'Eroare internă.';
  if (_req.accepts('html')) {
    return res.status(status).send(
      '<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><title>Eroare</title></head>' +
      '<body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#e0e0e0;">' +
      `<h1 style="color:#d4af37;">${status}</h1><p>${message}</p>` +
      '<a href="/" style="color:#d4af37;">Înapoi acasă</a></body></html>'
    );
  }
  return res.status(status).json({ error: message });
});

// ---------------------------------------------------------------------------
// Pornire server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🥊 Boxing Champions Server`);
  console.log(`   Mediu:      ${NODE_ENV}`);
  console.log(`   Port:       ${PORT}`);
  console.log(`   URL:        http://localhost:${PORT}`);
  console.log(`   Admin:      http://localhost:${PORT}/admin`);
  console.log(`   API:        http://localhost:${PORT}/api`);
  console.log(`   Bază date:  ${path.join(__dirname, 'boxing.db')}\n`);
});

module.exports = app;