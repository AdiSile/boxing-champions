// ---------------------------------------------------------------------------
// server.js — Boxing Champions
// Punct principal de intrare Express
// ---------------------------------------------------------------------------

require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initializeDatabase } = require('./config/db');
const { configureSecurity, nonceMiddleware, cspMiddleware } = require('./middleware/security');
const { globalSanitize, requireJsonContentType, bodySizeLimit } = require('./middleware/validate');

// ---------------------------------------------------------------------------
// Inițializare bază de date
// ---------------------------------------------------------------------------
initializeDatabase();

// ---------------------------------------------------------------------------
// Aplicația Express
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Middleware de securitate
// ---------------------------------------------------------------------------
configureSecurity(app);

// ---------------------------------------------------------------------------
// Parsare corp cerere + cookies
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Sanitizare globală input
// ---------------------------------------------------------------------------
app.use(globalSanitize);

// ---------------------------------------------------------------------------
// CSP cu nonces (pentru script-uri inline)
// ---------------------------------------------------------------------------
app.use(nonceMiddleware);

// ---------------------------------------------------------------------------
// Fișiere statice — public/
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
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
// Rute API
// ---------------------------------------------------------------------------
app.use(require('./routes/auth'));
app.use(require('./routes/settings'));
app.use(require('./routes/coaches'));
app.use(require('./routes/events'));
app.use(require('./routes/schedule'));
app.use(require('./routes/plans'));
app.use(require('./routes/products'));
app.use(require('./routes/contact'));
app.use(require('./routes/orders'));
app.use(require('./routes/checkout'));
app.use(require('./routes/promotions'));

// ---------------------------------------------------------------------------
// Fallback SPA — trimite index.html doar pentru rutele publice necunoscute
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
  // Trimite index.html ca fallback pentru rutele SPA (ex: /about, /contact)
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) next();
  });
});

// ---------------------------------------------------------------------------
// Pornire server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] Boxing Champions running on http://localhost:${PORT}`);
  console.log(`[server] Admin panel: http://localhost:${PORT}/admin/views/login.html`);
});

module.exports = app;