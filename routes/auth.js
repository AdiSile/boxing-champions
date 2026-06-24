'use strict';

// ---------------------------------------------------------------------------
// routes/auth.js — Admin Authentication Routes
//
// POST /api/auth/login   – bcrypt password verification, JWT in
//                           HttpOnly / Secure / SameSite=Strict cookie
// GET  /api/auth/check   – verify JWT from cookie, return admin payload
//                           (always 200; success: false when unauthenticated)
// POST /api/auth/logout  – clear auth cookie
//
// Security: input validation, constant-time bcrypt comparison, short-lived
//           JWT with a strong secret, hardened cookie flags, no stack‑trace
//           leakage in production.
// ---------------------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const COOKIE_NAME = 'token';
const SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate an email string with a reasonable regex.
 * Returns true if the email passes basic format checks.
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  // RFC‑5322 simplified – good enough for admin login
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  return re.test(email.trim());
}

/**
 * Validate a password: must be a string, 8–128 chars.
 */
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

/**
 * Generate a signed JWT for an admin payload.
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Set the auth cookie with hardened flags.
 * `secure` is disabled in dev (no HTTPS) but enforced in production.
 */
function setAuthCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: ms(JWT_EXPIRES_IN),
    // Not accessible via document.cookie
  });
}

/**
 * Clear the auth cookie (used for logout).
 */
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

/**
 * Parse a duration string like '8h', '60m', '7d' into milliseconds.
 * Returns 0 for unknown formats.
 */
function ms(duration) {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(String(duration).trim());
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return value * (multipliers[unit] || 0);
}

/**
 * Extract the JWT from the cookie or Authorization header.
 * Returns the token string or null.
 */
function extractToken(req) {
  const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

// ---------------------------------------------------------------------------
// JWT verification middleware (exported for reuse by other route modules)
// ---------------------------------------------------------------------------
function verifyToken(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ success: false, redirect: '/login', message: 'Token lipsă. Autentifică-te din nou.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // { id, email, iat, exp }
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, redirect: '/login', message: 'Sesiunea a expirat. Autentifică-te din nou.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, redirect: '/login', message: 'Token invalid.' });
    }
    return res.status(500).json({ success: false, redirect: null, message: 'Eroare la verificarea token-ului.' });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/login
 *
 * Body (JSON):
 *   { "email": "...", "password": "..." }
 *
 * On success returns: { success: true, redirect: "/admin/dashboard", message: "Autentificare reușită.", admin: { id, email } }
 * Also sets the token cookie.
 *
 * Dacă nu există niciun admin în baza de date, creează automat un admin default
 * (independent de email-ul introdus):
 *   email: admin@boxingchampions.ro
 *   parola: boxing2026
 */
router.post('/login', (req, res) => {
  // --- 1. Input presence ---
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, redirect: null, message: 'Email și parolă obligatorii.' });
  }

  // --- 2. Input validation ---
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, redirect: null, message: 'Format email invalid.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ success: false, redirect: null, message: 'Parola trebuie să aibă între 8 și 128 de caractere.' });
  }

  // --- 3. Asigură existența unui admin în sistem (independent de cerere) ---
  const database = db.getDb();
  const adminCount = database.prepare('SELECT COUNT(*) AS cnt FROM admins').get();

  if (adminCount.cnt === 0) {
    const defaultEmail = process.env.ADMIN_EMAIL || 'admin@boxingchampions.ro';
    const defaultPassword = process.env.ADMIN_PASSWORD || 'boxing2026';
    const hash = bcrypt.hashSync(defaultPassword, SALT_ROUNDS);
    database.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run(defaultEmail, hash);
    console.log('[AUTH] Admin default creat:', defaultEmail);
  }

  // --- 4. Look up admin ---
  const normalizedEmail = email.trim().toLowerCase();
  const admin = db.getAdminByEmail(normalizedEmail);

  if (!admin) {
    // Use a generic message to avoid user enumeration
    return res.status(401).json({ success: false, redirect: null, message: 'Credențiale incorecte' });
  }

  // --- 5. Verify password (constant-time via bcrypt) ---
  let passwordOk = false;
  try {
    passwordOk = bcrypt.compareSync(password, admin.password);
  } catch {
    return res.status(500).json({ success: false, redirect: null, message: 'Eroare internă la verificarea parolei.' });
  }

  if (!passwordOk) {
    return res.status(401).json({ success: false, redirect: null, message: 'Credențiale incorecte' });
  }

  // --- 6. Issue JWT ---
  const payload = { id: admin.id, email: admin.email };
  let token;
  try {
    token = signToken(payload);
  } catch {
    return res.status(500).json({ success: false, redirect: null, message: 'Nu s-a putut genera token-ul.' });
  }

  // --- 7. Set cookie ---
  setAuthCookie(res, token);

  // --- 8. Respond ---
  return res.json({
    success: true,
    redirect: '/admin/dashboard',
    message: 'Autentificare reușită.',
    admin: {
      id: admin.id,
      email: admin.email,
    },
  });
});

/**
 * GET /api/auth/check
 *
 * Reads the JWT from cookie / Authorization header and returns the current
 * admin payload if the token is valid.
 *
 * Always returns HTTP 200.
 *   - Authenticated:   { success: true,  authenticated: true,  admin: { id, email } }
 *   - Unauthenticated: { success: false, authenticated: false, redirect: null, message: "..." }
 */
router.get('/check', (req, res) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(200).json({ success: false, authenticated: false, redirect: null, message: 'Token lipsă. Autentifică-te din nou.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.status(200).json({
      success: true,
      authenticated: true,
      admin: {
        id: decoded.id,
        email: decoded.email,
      },
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(200).json({ success: false, authenticated: false, redirect: null, message: 'Sesiunea a expirat. Autentifică-te din nou.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(200).json({ success: false, authenticated: false, redirect: null, message: 'Token invalid.' });
    }
    return res.status(200).json({ success: false, authenticated: false, redirect: null, message: 'Eroare la verificarea token-ului.' });
  }
});

/**
 * POST /api/auth/logout
 *
 * Clears the auth cookie. No JWT validation required — even an expired token
 * should be cleared from the client.
 */
router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true, redirect: '/admin', message: 'Deconectare reușită.' });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = router;
module.exports.verifyToken = verifyToken;