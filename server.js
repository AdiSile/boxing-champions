// ---------------------------------------------------------------------------
// server.js
// Boxing Champions — Punct principal de intrare Express
//
// Încarcă dotenv, inițializează baza de date sql.js (async), configurează
// middleware-urile de securitate și autentificare, montează rutele API,
// servește fișierele statice și oferă fallback SPA.
// ---------------------------------------------------------------------------

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { initDb, getDb, checkDatabaseConnection } = require('./config/db');
const {
  configureSecurity,
  nonceMiddleware,
  cspMiddleware,
  corsMiddleware,
  requestLogger,
  globalApiRateLimiter,
} = require('./middleware/security');
const { globalSanitize, requireJsonContentType, bodySizeLimit } = require('./middleware/validate');

// ---------------------------------------------------------------------------
// Rutere
// ---------------------------------------------------------------------------
const authRoutes = require('./routes/auth');
const { ensureAdminOnStartup } = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const coachesRoutes = require('./routes/coaches');
const eventsRoutes = require('./routes/events');
const scheduleRoutes = require('./routes/schedule');
const plansRoutes = require('./routes/plans');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const contactRoutes = require('./routes/contact');
const checkoutRoutes = require('./routes/checkout');
const promotionsRoutes = require('./routes/promotions');
const dashboardRoutes = require('./routes/dashboard');

// ---------------------------------------------------------------------------
// Aplicație Express
// ---------------------------------------------------------------------------
const app = express();

/** Portul din mediu sau 3000 implicit */
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Trust proxy – necesar pentru rate limiting corect în spatele unui proxy
// ---------------------------------------------------------------------------
app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// Middleware-uri generale (înainte de rute)
// ---------------------------------------------------------------------------

// Parsează body-ul JSON
app.use(express.json({ limit: '1mb' }));

// Parsează URL-encoded (pentru formulare)
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Cookie parser (necesar pentru auth JWT)
app.use(cookieParser());

// Logare cereri HTTP
app.use(requestLogger);

// Validare Content-Type pentru cereri cu corp (mod lenient – permite Content-Type lipsă;
// verificarea strictă este aplicată individual pe rutele API care au nevoie)
app.use(requireJsonContentType());

// Limită dimensiune body
app.use(bodySizeLimit());

// Sanitizare globală a input-ului
app.use(globalSanitize);

// ---------------------------------------------------------------------------
// Securitate (Helmet, CSP, CORS, HSTS, X-Frame-Options, etc.)
// ---------------------------------------------------------------------------

// Configurează Helmet de bază (fără CSP)
configureSecurity(app);

// Nonce per cerere (necesar pentru CSP)
app.use(nonceMiddleware);

// CSP cu nonce
app.use(cspMiddleware);

// CORS
app.use(corsMiddleware);

// Rate limiting global pentru toate rutele API
app.use('/api', globalApiRateLimiter);

// ---------------------------------------------------------------------------
// Fișiere statice
// ---------------------------------------------------------------------------

// Public – fișiere accesibile direct (CSS, JS, imagini, video, HTML)
app.use(express.static(path.join(__dirname, 'public'), {
  index: false, // Nu servi automat index.html – gestionăm noi fallback-ul SPA
  dotfiles: 'deny',
  setHeaders: (res, filePath) => {
    // Cache pentru resurse statice (1 an pentru asset-uri cu hash în nume)
    if (filePath.match(/\.(js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico|mp4|webm)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.match(/\.(html)$/i)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// Admin – panou de administrare (protejat de auth pe rutele API)
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  index: false,
  dotfiles: 'deny',
}));

// ---------------------------------------------------------------------------
// Rute API
// ---------------------------------------------------------------------------

// Autentificare
app.use(authRoutes);

// Setări
app.use(settingsRoutes);

// Antrenori
app.use(coachesRoutes);

// Evenimente
app.use(eventsRoutes);

// Program
app.use(scheduleRoutes);

// Abonamente
app.use(plansRoutes);

// Produse
app.use(productsRoutes);

// Comenzi
app.use(ordersRoutes);

// Contact
app.use(contactRoutes);

// Checkout (Stripe)
app.use(checkoutRoutes);

// Promoții
app.use(promotionsRoutes);

// Dashboard admin
app.use(dashboardRoutes);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  const dbStatus = checkDatabaseConnection();
  res.json({
    status: dbStatus.ok ? 'healthy' : 'degraded',
    database: dbStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ---------------------------------------------------------------------------
// Catch-all SPA fallback – returnează index.html pentru rutele frontend
// Nu interferă cu rutele API sau admin
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

// ---------------------------------------------------------------------------
// Error handler global
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  console.error('[server] Eroare neprevăzută:', err);

  // Dacă header-ele au fost deja trimise, delegăm handler-ului Express implicit
  if (res.headersSent) {
    return;
  }

  const statusCode = err.status || err.statusCode || 500;
  const message = err.expose
    ? err.message
    : (statusCode === 500 ? 'Internal server error.' : err.message);

  res.status(statusCode).json({
    error: message,
    code: err.code || 'INTERNAL_ERROR',
  });
});

// ---------------------------------------------------------------------------
// Pornire server (după inițializarea bazei de date)
// ---------------------------------------------------------------------------

async function startServer() {
  try {
    // Inițializează baza de date (async – sql.js WASM)
    console.log('[server] Se inițializează baza de date...');
    await initDb();
    console.log('[server] Baza de date este pregătită.');

    // Asigură existența contului de admin
    ensureAdminOnStartup();

    // Verifică rapid conexiunea la DB
    const dbCheck = checkDatabaseConnection();
    if (!dbCheck.ok) {
      console.error('[server] Verificarea bazei de date a eșuat:', dbCheck.error);
      process.exit(1);
    }

    // Pornește serverul
    app.listen(PORT, () => {
      console.log(`[server] Boxing Champions rulează pe http://localhost:${PORT}`);
      console.log(`[server] Mod: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[server] API: http://localhost:${PORT}/api/health`);
      console.log(`[server] Admin: http://localhost:${PORT}/admin/views/login.html`);
    });
  } catch (err) {
    console.error('[server] Eroare fatală la pornire:', err);
    process.exit(1);
  }
}

// Pornește serverul
startServer();