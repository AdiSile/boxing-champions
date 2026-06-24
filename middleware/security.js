// ---------------------------------------------------------------------------
// middleware/security.js
// Configurare Helmet, CSP cu nonces, X-Content-Type-Options, X-Frame-Options,
// rate limiting pe auth
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
// Rate limiter specific pentru autentificare
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
// Configurare Helmet + CSP cu nonces
// ---------------------------------------------------------------------------

/**
 * Returnează middleware-ul CSP configurat cu nonce-ul din cererea curentă.
 * Se folosește ca middleware Express: `app.use(cspMiddleware)`.
 *
 * IMPORTANT: middleware-ul `nonceMiddleware` trebuie apelat ÎNAINTE de acesta,
 * pentru ca `res.locals.cspNonce` să fie disponibil.
 */
function cspMiddleware(req, res, next) {
  const nonce = res.locals?.cspNonce;

  // CSP cu nonce: permite inline scripts doar dacă au nonce-ul corect
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      'https://cdnjs.cloudflare.com',   // Font Awesome
      'https://js.stripe.com',           // Stripe checkout
      'https://maps.googleapis.com',     // Google Maps (dacă se folosește)
      nonce ? `'nonce-${nonce}'` : '',
    ].filter(Boolean),
    'style-src': [
      "'self'",
      "'unsafe-inline'",                 // necesar pentru stiluri inline dinamice
      'https://cdnjs.cloudflare.com',
      'https://fonts.googleapis.com',
    ],
    'font-src': [
      "'self'",
      'https://cdnjs.cloudflare.com',
      'https://fonts.gstatic.com',
    ],
    'img-src': [
      "'self'",
      'data:',
      'https:',                          // imagini externe (Pexels, etc.)
    ],
    'media-src': [
      "'self'",
    ],
    'frame-src': [
      "'self'",
      'https://js.stripe.com',
      'https://hooks.stripe.com',
      'https://www.google.com',          // Google Maps embed
    ],
    'connect-src': [
      "'self'",
      'https://api.stripe.com',
      'https://maps.googleapis.com',
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
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
  // Helmet cu toate headerele implicite, DAR fără CSP (îl setăm separat)
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP gestionat manual cu nonce
      xFrameOptions: true,           // X-Frame-Options: DENY (implicit)
      xContentTypeOptions: true,     // X-Content-Type-Options: nosniff
    })
  );

  // Forțăm X-Frame-Options la DENY (implicit în Helmet, dar explicit aici)
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
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  // Middleware-uri principale
  configureSecurity,
  nonceMiddleware,
  cspMiddleware,
  authRateLimiter,

  // Factory pentru rate limiter-uri custom
  createRateLimiter,

  // Utilități (expuse pentru testare/debugging)
  _internals: {
    rateLimitStore,
    cleanupStore,
  },
};