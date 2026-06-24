// ---------------------------------------------------------------------------
// routes/auth.js
// Autentificare: POST /api/auth/login (bcrypt + JWT în cookie access_token),
//                GET  /api/auth/check (verifică același cookie),
//                POST /api/auth/logout (șterge cookie-ul).
//
// Cookie-ul JWT se numește "access_token", HttpOnly, Secure, SameSite=Strict.
// La login, dacă autentificarea eșuează pentru contul de admin, admin-ul este
// recreat automat (din variabilele de mediu) și se reîncearcă autentificarea.
// ---------------------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('../config/db');
const { loginSchema, validate } = require('../middleware/validate');
const { authRateLimiter } = require('../middleware/security');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare */
const ACCESS_TOKEN_COOKIE = 'access_token';

/** Durata de viață a token-ului (15 minute) */
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '15m';

/** Algoritmul JWT */
const JWT_ALGORITHM = 'HS256';

/** Costul bcrypt pentru hash-ul parolei */
const BCRYPT_SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Opțiuni cookie – SINGLE SOURCE OF TRUTH
// ---------------------------------------------------------------------------

/** @type {import('express').CookieOptions} */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
};

// ---------------------------------------------------------------------------
// Helpers – JWT & timp
// ---------------------------------------------------------------------------

/**
 * Obține secretul JWT din variabilele de mediu.
 * @returns {string}
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[auth] JWT_SECRET nu este definit în variabilele de mediu.');
  }
  if (secret.length < 32) {
    throw new Error('[auth] JWT_SECRET este prea scurt (minim 32 caractere).');
  }
  return secret;
}

/**
 * Convertește un TTL (ex: "15m", "1h", "7d") în milisecunde.
 * @param {string} ttl
 * @returns {number}
 */
function ttlToMs(ttl) {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000;
  const value = parseInt(match[1], 10);
  const multipliers = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * (multipliers[match[2]] || multipliers.m);
}

/**
 * Semnează un access token JWT.
 * @param {object} user - { id, email, role }
 * @returns {string}
 */
function signAccessToken(user) {
  const secret = getJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
      jti: crypto.randomUUID(),
    },
    secret,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: ACCESS_TOKEN_TTL,
    }
  );
}

/**
 * Verifică și decodifică un token JWT.
 * @param {string} token
 * @param {object} [options]
 * @returns {{ payload: object|null, error: string|null }}
 */
function verifyToken(token, options = {}) {
  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, {
      algorithms: [JWT_ALGORITHM],
      ...options,
    });
    return { payload, error: null };
  } catch (err) {
    const errorMap = {
      TokenExpiredError: 'Token expired.',
      JsonWebTokenError: 'Invalid token.',
      NotBeforeError: 'Token not yet active.',
    };
    return { payload: null, error: errorMap[err.name] || 'Token verification failed.' };
  }
}

// ---------------------------------------------------------------------------
// Helpers – cookie
// ---------------------------------------------------------------------------

/**
 * Setează cookie-ul access_token pe răspuns.
 * @param {import('express').Response} res
 * @param {string} token
 */
function setAccessTokenCookie(res, token) {
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...COOKIE_OPTIONS,
    maxAge: ttlToMs(ACCESS_TOKEN_TTL),
  });
}

/**
 * Șterge cookie-ul access_token de pe răspuns.
 * @param {import('express').Response} res
 */
function clearAccessTokenCookie(res) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, COOKIE_OPTIONS);
}

// ---------------------------------------------------------------------------
// Helpers – admin
// ---------------------------------------------------------------------------

/**
 * Returnează credențialele admin-ului din mediu sau default-uri.
 * @returns {{ email: string, password: string, name: string }}
 */
function getAdminCredentials() {
  return {
    email: process.env.ADMIN_EMAIL || 'admin@boxingchampions.ro',
    password: process.env.ADMIN_PASSWORD || 'boxing2026',
    name: process.env.ADMIN_NAME || 'Boxing Champions Admin',
  };
}

/**
 * Creează sau reactivează contul de admin.
 * Dacă admin-ul există deja (după email), îi actualizează parola și îl reactivează.
 * Dacă nu există, îl creează.
 *
 * @returns {{ success: boolean, user: object|null, error: string|null }}
 */
function recreateAdmin() {
  try {
    const db = getDb();
    const { email, password, name } = getAdminCredentials();

    // Verifică dacă tabela users există
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (!tableExists) {
      return { success: false, user: null, error: 'Tabela users nu există.' };
    }

    const hashedPassword = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);

    // Verifică dacă admin-ul există deja după email
    const existing = db.prepare(
      'SELECT id, name, email, role, is_active FROM users WHERE email = ?'
    ).get(email);

    if (existing) {
      // Actualizează parola și reactivează
      db.prepare(`
        UPDATE users
        SET password = ?, is_active = 1, role = 'admin', email_verified_at = datetime('now')
        WHERE id = ?
      `).run(hashedPassword, existing.id);

      console.log(`[auth] Admin recreat (actualizat): ${email}`);

      return {
        success: true,
        user: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: 'admin',
        },
        error: null,
      };
    }

    // Creează admin nou
    const result = db.prepare(`
      INSERT INTO users (name, email, password, role, is_active, email_verified_at)
      VALUES (?, ?, ?, 'admin', 1, datetime('now'))
    `).run(name, email, hashedPassword);

    console.log(`[auth] Admin recreat (nou): ${email}`);

    return {
      success: true,
      user: {
        id: result.lastInsertRowid,
        name,
        email,
        role: 'admin',
      },
      error: null,
    };
  } catch (err) {
    console.error('[auth] Eroare la recrearea admin-ului:', err.message);
    return { success: false, user: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Auto-creare admin la pornire (dacă nu există niciun admin)
// ---------------------------------------------------------------------------

/**
 * Asigură existența unui cont de administrator la pornirea serverului.
 */
function ensureAdminOnStartup() {
  try {
    const db = getDb();

    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (!tableExists) {
      return;
    }

    const existingAdmin = db.prepare(
      'SELECT id FROM users WHERE role = ? AND is_active = 1'
    ).get('admin');

    if (existingAdmin) {
      console.log('[auth] Admin există – skip auto-create la pornire.');
      return;
    }

    // Folosește aceeași funcție de recreare
    const result = recreateAdmin();
    if (result.success) {
      console.log('[auth] Admin auto-creat la pornire.');
    }
  } catch (err) {
    console.error('[auth] Eroare la ensureAdminOnStartup:', err.message);
  }
}

ensureAdminOnStartup();

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

router.post(
  '/api/auth/login',
  authRateLimiter,
  validate(loginSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      /**
       * Încearcă autentificarea cu credențialele date.
       * @returns {Promise<{ success: boolean, user: object|null }>}
       */
      async function attemptLogin() {
        const db = getDb();
        const user = db.prepare(
          'SELECT id, name, email, password, role, is_active FROM users WHERE email = ?'
        ).get(email);

        if (!user || !user.is_active) {
          return { success: false, user: null };
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return { success: false, user: null };
        }

        return {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        };
      }

      // 1. Prima încercare de autentificare
      let result = await attemptLogin();

      // 2. Dacă a eșuat și email-ul este cel de admin, recreăm admin-ul și reîncercăm
      if (!result.success) {
        const adminCreds = getAdminCredentials();

        if (email.toLowerCase() === adminCreds.email.toLowerCase()) {
          console.log('[auth] Autentificare admin eșuată – se reacrează admin-ul...');

          const recreation = recreateAdmin();

          if (recreation.success) {
            // Reîncearcă autentificarea după recreare
            result = await attemptLogin();

            if (!result.success) {
              // După recreare tot nu merge – eroare internă
              return res.status(500).json({
                error: 'Admin account recovery failed.',
                code: 'ADMIN_RECOVERY_FAILED',
              });
            }
          } else {
            console.error('[auth] Recrearea admin-ului a eșuat:', recreation.error);
            return res.status(500).json({
              error: 'Admin account recovery failed.',
              code: 'ADMIN_RECOVERY_FAILED',
            });
          }
        }
      }

      // 3. Dacă tot nu s-a autentificat, returnează eroare generică
      if (!result.success) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 4. Semnează JWT și setează cookie
      const token = signAccessToken(result.user);
      setAccessTokenCookie(res, token);

      // 5. Răspuns fără token în body
      return res.json({
        message: 'Login successful.',
        user: result.user,
      });
    } catch (err) {
      console.error('[auth] Login error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/auth/check
// ---------------------------------------------------------------------------

router.get('/api/auth/check', (req, res) => {
  try {
    const token = req.cookies?.[ACCESS_TOKEN_COOKIE];

    // Fără token = neautentificat
    if (!token) {
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Verificare JWT
    let secret;
    try {
      secret = getJwtSecret();
    } catch {
      console.error('[auth] Check: JWT_SECRET missing or invalid.');
      clearAccessTokenCookie(res);
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    const { payload, error } = verifyToken(token);

    if (error || !payload) {
      clearAccessTokenCookie(res);
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Validare structură payload
    if (!payload.sub || payload.type !== 'access') {
      clearAccessTokenCookie(res);
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Verificare utilizator în baza de date
    const db = getDb();
    const user = db.prepare(
      'SELECT id, name, email, role, is_active FROM users WHERE id = ?'
    ).get(payload.sub);

    if (!user || !user.is_active) {
      clearAccessTokenCookie(res);
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Autentificat cu succes
    return res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[auth] Check error:', err.message);
    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

router.post('/api/auth/logout', (req, res) => {
  clearAccessTokenCookie(res);

  return res.json({
    message: 'Logged out successfully.',
  });
});

module.exports = router;