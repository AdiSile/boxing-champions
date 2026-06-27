// ---------------------------------------------------------------------------
// server.js — Boxing Champions
// Punct principal de intrare Express
// Include: graceful shutdown, global error handler, rate limiting pe rute
// sensibile, request logging, CSP cu nonces, CORS, validare conexiune DB.
// ---------------------------------------------------------------------------

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initializeDatabase, closeDatabase, checkDatabaseConnection } = require('./config/db');
const {
  configureSecurity,
  nonceMiddleware,
  cspMiddleware,
  corsMiddleware,
  requestLogger,
  contactRateLimiter,
  checkoutRateLimiter,
  promoValidateRateLimiter,
  globalApiRateLimiter,
} = require('./middleware/security');
const { globalSanitize, requireJsonContentType, bodySizeLimit } = require('./middleware/validate');

// ---------------------------------------------------------------------------
// Inițializare bază de date (cu validare)
// ---------------------------------------------------------------------------
try {
  initializeDatabase();
  const health = checkDatabaseConnection();
  if (!health.ok) {
    console.error('[server] ❌ Baza de date nu răspunde:', health.error);
    process.exit(1);
  }
  console.log('[server] ✅ Baza de date conectată și validată.');
} catch (err) {
  console.error('[server] ❌ Eroare critică la inițializarea bazei de date:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Aplicația Express
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ===========================================================================
// MIDDLEWARE GLOBAL (ordinea contează!)
// ===========================================================================

// 1. Request logging — primul middleware pentru a capta toate cererile
app.use(requestLogger);

// 2. CORS — înainte de securitate pentru a procesa preflight
app.use(corsMiddleware);

// 3. Helmet + headere de securitate (fără CSP)
configureSecurity(app);

// 4. Rate limiting global (200 req/min per IP)
app.use('/api/', globalApiRateLimiter);

// 5. Parsare corp cerere + cookies
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// 6. Body size limit
app.use(bodySizeLimit());

// 7. Sanitizare globală input
app.use(globalSanitize);

// 8. Content-Type enforcement pentru metodele care trimit body
app.use(requireJsonContentType);

// 9. CSP cu nonces (pentru script-uri inline)
app.use(nonceMiddleware);
app.use(cspMiddleware);

// ---------------------------------------------------------------------------
// Fișiere statice — public/
// extensions: ['html'] permite URL-uri „curate” (ex: /contact → contact.html)
// fără a interfera cu rutele API, admin sau fallback-ul SPA.
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  extensions: ['html'],
}));

// ---------------------------------------------------------------------------
// Fișiere statice — admin/
// ---------------------------------------------------------------------------
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
}));

// Pentru ca /admin să servească login.html implicit
app.get('/admin', (_req, res) => {
  res.redirect('/admin/views/login.html');
});

// ---------------------------------------------------------------------------
// Rute API — fără rate limiting suplimentar (protejate de globalApiRateLimiter)
// ---------------------------------------------------------------------------
app.use(require('./routes/auth'));
app.use(require('./routes/settings'));
app.use(require('./routes/coaches'));
app.use(require('./routes/events'));
app.use(require('./routes/schedule'));
app.use(require('./routes/plans'));
app.use(require('./routes/products'));
app.use(require('./routes/orders'));
app.use(require('./routes/dashboard'));

// ---------------------------------------------------------------------------
// Rute cu rate limiting specific
// Aplicăm rate limiter-ul ca middleware pe prefixul de path, ÎNAINTE de router.
// Router-ele își definesc propriile prefixe /api/contact, /api/checkout etc.
// Astfel, rate limiter-ul rulează pe /api/contact/* înaintea procesării.
// ---------------------------------------------------------------------------

// Contact: max 5 mesaje la 10 minute per IP
app.use('/api/contact', contactRateLimiter);
app.use(require('./routes/contact'));

// Checkout + validare promoții: max 10 cereri la 5 minute per IP
app.use('/api/checkout', checkoutRateLimiter);
app.use(require('./routes/checkout'));

// Promoții: rate limiting pentru validare
app.use('/api/promotions', promoValidateRateLimiter);
app.use(require('./routes/promotions'));

// ---------------------------------------------------------------------------
// Fallback SPA — trimite index.html doar pentru rutele publice necunoscute
// Paginile statice (.html) sunt deja rezolvate de express.static cu
// extensions: ['html'], așa că aici ajung doar rutele fără corespondent real.
// ---------------------------------------------------------------------------
app.get('*', (req, res, next) => {
  // Nu interfera cu rutele API sau admin
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/')) {
    return next();
  }
  // Nu servi index.html pentru cereri ce par a fi fișiere statice (au extensie)
  if (path.extname(req.path) !== '') {
    return next();
  }
  // Trimite index.html ca fallback pentru rutele SPA (ex: /about, /despre)
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) next();
  });
});

// ===========================================================================
// GLOBAL ERROR HANDLER (Express)
// Prinde toate erorile propagate prin next(err)
// ===========================================================================
app.use((err, req, res, _next) => {
  // Log structurat al erorii
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 10);

  console.error(`[server][${requestId}] Unhandled error:`, {
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip || req.socket?.remoteAddress,
  });

  // Determină status code-ul
  const statusCode = err.status || err.statusCode || 500;

  // Nu expune detalii interne în producție
  const response = {
    error: statusCode === 500
      ? 'Internal server error.'
      : (err.expose ? err.message : 'An error occurred.'),
    code: err.code || 'INTERNAL_ERROR',
  };

  // În development, include stack-ul
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
});

// ---------------------------------------------------------------------------
// Pornire server
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`[server] 🥊 Boxing Champions running on http://localhost:${PORT}`);
  console.log(`[server] 🔧 Admin panel: http://localhost:${PORT}/admin/views/login.html`);
  console.log(`[server] 📡 Mediu: ${process.env.NODE_ENV || 'development'}`);
});

// ===========================================================================
// GRACEFUL SHUTDOWN
// Gestionăm semnalele SIGTERM și SIGINT pentru a închide serverul și
// conexiunile în mod controlat.
// ===========================================================================

/**
 * Închide serverul HTTP și baza de date în mod controlat.
 * @param {string} signal - semnalul care a declanșat shutdown-ul
 */
function gracefulShutdown(signal) {
  console.log(`\n[server] ⚠️  Primit semnal ${signal}. Închidere controlată...`);

  // Pas 1: Oprim acceptarea de noi conexiuni
  server.close((closeErr) => {
    if (closeErr) {
      console.error('[server] Eroare la închiderea serverului HTTP:', closeErr.message);
    } else {
      console.log('[server] ✅ Server HTTP închis.');
    }

    // Pas 2: Închidem baza de date
    try {
      closeDatabase();
      console.log('[server] ✅ Baza de date închisă.');
    } catch (dbErr) {
      console.error('[server] Eroare la închiderea bazei de date:', dbErr.message);
    }

    // Pas 3: Ieșim din proces
    console.log('[server] 👋 La revedere!');
    process.exit(closeErr ? 1 : 0);
  });

  // Timeout de siguranță: dacă serverul nu se închide în 10 secunde, forțăm
  setTimeout(() => {
    console.error('[server] ⚠️  Timeout la shutdown. Forțare închidere...');
    process.exit(1);
  }, 10000).unref();
}

// Ascultăm semnalele de shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Capturăm excepțiile neprinse pentru a evita crash-ul silențios
process.on('uncaughtException', (err) => {
  console.error('[server] ❌ Uncaught Exception:', err.message);
  console.error(err.stack);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] ❌ Unhandled Rejection:', reason);
  // Nu oprim serverul, dar logăm pentru debug
});

module.exports = app;