// ---------------------------------------------------------------------------
// middleware/security.js
// Configurare Helmet, CSP cu nonces, CORS, rate limiting, request logging,
// X-Content-Type-Options, X-Frame-Options, HSTS.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const helmet = require('helmet');

// ---------------------------------------------------------------------------
// Rate Limiter în memorie (fără dependințe externe)
// ---------------------------------------------------------------------------
const rateLimitStore = new Map();

/**
 * Curăță periodic intrările expirate din store (la fiecare 5 minute).
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanupStore() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetTime <= now) {
      rateLimitStore.delete(key);
    }
  }
}

// Pornim curățarea periodică
setInterval(cleanupStore, CLEANUP_INTERVAL).unref();

/**
 * Rate limiter generic, configurabil.
 *
 * @param {Object} options
 * @param {number} options.windowMs       - fereastra de timp în milisecunde
 * @param {number} options.max            - numărul maxim de încercări în fereastră
 * @param {string} [options.message]      - mesaj de eroare
 * @param {number} [options.statusCode]   - codul HTTP de răspuns
 * @returns {Function} middleware Express
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minute default
    max = 10,
    message = 'Too many requests. Please try again later.',
    statusCode = 429,
  } = options;

  return function rateLimiterMiddleware(req, res, next) {
    // Cheia: IP + rută (pentru a izola limitele pe endpoint)
    const clientIp =
      req.ip ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    const key = `${clientIp}:${req.method}:${req.path}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime <= now) {
      // Fereastra nouă
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);

      // Setează headere informative
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - 1);
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

      return next();
    }

    if (entry.count >= max) {
      // Limită depășită
      const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

      return res.status(statusCode).json({
        error: message,
        retryAfter: retryAfterSec,
      });
    }

    // Incrementează contorul
    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', max - entry.count);
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    return next();
  };
}

// ---------------------------------------------------------------------------
// Rate limiter-e specifice
// ---------------------------------------------------------------------------

/**
 * Rate limiter pentru rutele de autentificare.
 * 5 încercări într-o fereastră de 15 minute per IP.
 */
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minute
  max: 5,
  message: 'Too many login attempts. Please try again later.',
  statusCode: 429,
});

/**
 * Rate limiter pentru ruta de contact (POST /api/contact).
 * 5 mesaje într-o fereastră de 10 minute per IP.
 */
const contactRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minute
  max: 5,
  message: 'Prea multe mesaje trimise. Încearcă din nou mai târziu.',
  statusCode: 429,
});

/**
 * Rate limiter pentru ruta de checkout (POST /api/checkout).
 * 10 cereri într-o fereastră de 5 minute per IP.
 */
const checkoutRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minute
  max: 10,
  message: 'Prea multe cereri de checkout. Încearcă din nou mai târziu.',
  statusCode: 429,
});

/**
 * Rate limiter pentru validare cod promoțional.
 * 20 cereri într-o fereastră de 1 minut per IP.
 */
const promoValidateRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minut
  max: 20,
  message: 'Prea multe validări de cod promoțional. Încearcă din nou mai târziu.',
  statusCode: 429,
});

/**
 * Rate limiter general pentru toate rutele API.
 * 200 cereri pe minut per IP.
 */
const globalApiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minut
  max: 200,
  message: 'Too many requests. Please slow down.',
  statusCode: 429,
});

// ---------------------------------------------------------------------------
// CORS Middleware
// ---------------------------------------------------------------------------

/**
 * Middleware CORS configurat corect.
 * Permite doar originea aplicației (same-origin) și metodele necesare.
 * Headerele de răspuns includ expunerea controlată a headerelor.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function corsMiddleware(req, res, next) {
  // Origin: Permitem doar aceeași origine (cea mai sigură abordare)
  // Dacă ai nevoie de origini specifice, configurează ALLOWED_ORIGINS în .env
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [];

  const requestOrigin = req.headers.origin;

  // Dacă există un Origin header, verificăm
  if (requestOrigin) {
    // Dacă nu sunt configurate origini speciale, permitem doar same-origin
    if (allowedOrigins.length > 0 && allowedOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    } else if (allowedOrigins.length === 0) {
      // Fără origini configurate explicit, folosim same-origin strict
      // Nu setăm Access-Control-Allow-Origin deloc pentru origini necunoscute
    }
  }

  // Headere expuse (doar cele necesare pentru frontend)
  res.setHeader('Access-Control-Expose-Headers',
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After');

  // Pentru cereri preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
      'Content-Type, X-CSRF-Token, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 ore
    return res.status(204).end();
  }

  // Permitem credențiale (cookies) pentru cereri cross-origin controlate
  if (requestOrigin && res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  next();
}

// ---------------------------------------------------------------------------
// Request Logger Middleware
// ---------------------------------------------------------------------------

/**
 * Loghează fiecare cerere HTTP cu metodă, path, status, durată și IP.
 * Evită logarea datelor sensibile.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const start = Date.now();
  const clientIp =
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '-';

  // Log la terminarea răspunsului
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const url = req.originalUrl || req.url;

    // Iconiță pentru status (colorare în terminal)
    let statusIcon = '·';
    if (status >= 500) statusIcon = '✗';
    else if (status >= 400) statusIcon = '✗';
    else if (status >= 300) statusIcon = '→';
    else if (status >= 200) statusIcon = '✓';

    // Nu logăm query string-uri care conțin parole, token-uri etc.
    const safeUrl = url.replace(/([?&])(password|token|secret|key|auth)=[^&]*/gi, '$1$2=***');

    console.log(
      `[${new Date().toISOString()}] ${statusIcon} ${method} ${safeUrl} ${status} ${duration}ms :: ${clientIp}`
    );
  });

  next();
}

// ---------------------------------------------------------------------------
// CSP Nonce Middleware
// ---------------------------------------------------------------------------

/**
 * Generează un nonce criptografic unic pentru fiecare cerere.
 * Nonce-ul este stocat în `res.locals.cspNonce` pentru a fi folosit în
 * template-uri și în headerele CSP.
 */
function nonceMiddleware(req, res, next) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  next();
}

// ---------------------------------------------------------------------------
// Configurare CSP cu nonces
// ---------------------------------------------------------------------------

/**
 * Returnează middleware-ul CSP configurat cu nonce-ul din cererea curentă.
 * Se folosește ca middleware Express: `app.use(cspMiddleware)`.
 *
 * IMPORTANT: middleware-ul `nonceMiddleware` trebuie apelat ÎNAINTE de acesta,
 * pentru ca `res.locals.cspNonce` să fie disponibil.
 *
 * Resursele permise reflectă DOAR ceea ce este efectiv folosit în aplicație:
 * - Font Awesome 6 CDN (css + fonturi)
 * - Stripe (checkout + API)
 * - Imagini locale și externe via HTTPS
 * - Script-uri inline cu nonce
 */
function cspMiddleware(req, res, next) {
  const nonce = res.locals?.cspNonce;

  // CSP bazat pe resursele efectiv utilizate în aplicație
  const directives = {
    'default-src': ["'self'"],

    // Script-uri: locale + Font Awesome + Stripe + inline cu nonce
    'script-src': [
      "'self'",
      "'unsafe-inline'",                     // necesar pentru script-uri inline în HTML static
      'https://cdnjs.cloudflare.com',       // Font Awesome 6 JS
      'https://js.stripe.com',               // Stripe.js (checkout)
      nonce ? `'nonce-${nonce}'` : '',
    ].filter(Boolean),

    // Stiluri: locale + Font Awesome + Google Fonts (dacă se folosește) + inline
    'style-src': [
      "'self'",
      "'unsafe-inline'",                     // necesar pentru stiluri inline dinamice
      'https://cdnjs.cloudflare.com',        // Font Awesome 6 CSS
      'https://fonts.googleapis.com',        // Google Fonts (dacă se adaugă)
    ],

    // Fonturi: locale + Font Awesome + Google Fonts
    'font-src': [
      "'self'",
      'data:',
      'https://cdnjs.cloudflare.com',        // Font Awesome 6 webfonts
      'https://fonts.gstatic.com',           // Google Fonts webfonts
    ],

    // Imagini: locale + data URI + orice HTTPS (Pexels, etc.)
    'img-src': [
      "'self'",
      'data:',
      'https:',                               // imagini externe (Pexels, placeholdere, etc.)
    ],

    // Media: doar locale (video, audio)
    'media-src': ["'self'"],

    // Frame-uri: Stripe checkout + Google Maps
    'frame-src': [
      "'self'",
      'https://js.stripe.com',
      'https://hooks.stripe.com',
      'https://www.google.com',              // Google Maps embed
    ],

    // Conexiuni dinamice (fetch/XHR): locale + Stripe API
    'connect-src': [
      "'self'",
      'https://api.stripe.com',
    ],

    // Restricții pentru plugin-uri și obiecte
    'object-src': ["'none'"],

    // Base URI
    'base-uri': ["'self'"],

    // Formular: doar self (form action)
    'form-action': ["'self'"],
  };

  // Aplică CSP-ul folosind helmet.contentSecurityPolicy (Helmet 8)
  return helmet.contentSecurityPolicy({
    directives,
    reportOnly: false,
  })(req, res, next);
}

// ---------------------------------------------------------------------------
// Configurare Helmet de bază (fără CSP – CSP se aplică separat cu nonce)
// ---------------------------------------------------------------------------

/**
 * Configurează Helmet pe aplicația Express.
 * CSP-ul este omis intenționat pentru a fi setat separat cu suport nonce.
 *
 * @param {Express} app - instanța Express
 */
function configureSecurity(app) {
  // Helmet cu toate headerele implicite, DAR fără CSP (îl gestionăm separat)
  app.use(
    helmet({
      contentSecurityPolicy: false,  // CSP gestionat manual cu nonce
      xFrameOptions: true,            // X-Frame-Options: DENY (implicit)
      xContentTypeOptions: true,      // X-Content-Type-Options: nosniff
    })
  );

  // Forțăm X-Frame-Options la DENY
  app.use(helmet.frameguard({ action: 'deny' }));

  // Forțăm X-Content-Type-Options explicit
  app.use(helmet.xContentTypeOptions());

  // Strict-Transport-Security (HSTS) – 1 an, include subdomenii
  app.use(
    helmet.hsts({
      maxAge: 31536000, // 1 an în secunde
      includeSubDomains: true,
      preload: false,   // setează true doar dacă domeniul e înregistrat în preload list
    })
  );

  // Ascunde headerul X-Powered-By (extra, nu face parte din Helmet)
  app.disable('x-powered-by');

  // Referrer-Policy
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

  // Permissions-Policy: restricționează API-urile browserului
  app.use(
    helmet.permittedCrossDomainPolicies({ permittedPolicies: 'none' })
  );
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Middleware-uri principale
  configureSecurity,
  nonceMiddleware,
  cspMiddleware,
  corsMiddleware,
  requestLogger,

  // Rate limiter-e specifice
  authRateLimiter,
  contactRateLimiter,
  checkoutRateLimiter,
  promoValidateRateLimiter,
  globalApiRateLimiter,

  // Factory pentru rate limiter-uri custom
  createRateLimiter,

  // Utilități (expuse pentru testare/debugging)
  _internals: {
    rateLimitStore,
    cleanupStore,
  },
};