// ---------------------------------------------------------------------------
// routes/auth.js
// Autentificare: POST /api/auth/login (bcrypt + JWT cookie), GET /api/auth/check
//
// Cookie-ul JWT se numește "token", HttpOnly, Secure, SameSite=Strict.
// Fără CSRF – simplu și direct, conform specificației.
// ---------------------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const { loginSchema, validate } = require('../middleware/validate');
const { authRateLimiter } = require('../middleware/security');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare */
const TOKEN_COOKIE = 'token';

/** Durata de viață a token-ului (15 minute) */
const TOKEN_TTL = '15m';

/** Algoritmul JWT */
const JWT_ALGORITHM = 'HS256';

// ---------------------------------------------------------------------------
// Helpers
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

      // 1. Caută utilizatorul în baza de date
      const db = getDb();
      const user = db.prepare(
        'SELECT id, name, email, password, role, is_active FROM users WHERE email = ?'
      ).get(email);

      // 2. Verificare generică – nu dezvălui dacă email-ul există sau nu
      if (!user || !user.is_active) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 3. Comparare parolă bcrypt
      const passwordMatch = await bcrypt.compare(password, user.password);

      if (!passwordMatch) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 4. Semnează JWT
      const secret = getJwtSecret();
      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        type: 'access',
      };

      const token = jwt.sign(payload, secret, {
        algorithm: JWT_ALGORITHM,
        expiresIn: TOKEN_TTL,
      });

      // 5. Setează cookie HttpOnly, Secure, SameSite=Strict
      res.cookie(TOKEN_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: ttlToMs(TOKEN_TTL),
      });

      // 6. Răspuns fără token în body (este în cookie)
      return res.json({
        message: 'Login successful.',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
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
    const token = req.cookies?.[TOKEN_COOKIE];

    // Fără token = neautentificat (nu eroare)
    if (!token) {
      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Verificare JWT
    const secret = getJwtSecret();
    let payload;

    try {
      payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
    } catch {
      // Token invalid sau expirat – ștergem cookie-ul
      res.clearCookie(TOKEN_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      });

      return res.json({
        authenticated: false,
        user: null,
      });
    }

    // Validare structură payload
    if (!payload || !payload.sub || payload.type !== 'access') {
      res.clearCookie(TOKEN_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      });

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
      res.clearCookie(TOKEN_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      });

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
// POST /api/auth/logout (bonus – șterge cookie-ul)
// ---------------------------------------------------------------------------

router.post('/api/auth/logout', (req, res) => {
  res.clearCookie(TOKEN_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
  });

  return res.json({
    message: 'Logged out successfully.',
  });
});

module.exports = router;