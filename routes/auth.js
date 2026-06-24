'use strict';

// ---------------------------------------------------------------------------
// routes/auth.js — Admin Authentication Routes
//
// POST /api/auth/login   – bcrypt password verification, JWT in
//                           HttpOnly / Secure / SameSite=Strict cookie
// GET  /api/auth/check   – verify JWT from cookie, return admin payload
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
const COOKIE_NAME = 'auth_token';
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

// ---------------------------------------------------------------------------
// JWT verification middleware (exported for reuse by other route modules)
// ---------------------------------------------------------------------------
function verifyToken(req, res, next) {
  // Read token from cookie first, then fall back to Authorization header
  const token =
    (req.cookies && req.cookies[COOKIE_NAME]) ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({ authenticated: false, error: 'Token lipsă. Autentifică-te din nou.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded; // { id, email, iat, exp }
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ authenticated: false, error: 'Sesiunea a expirat. Autentifică-te din nou.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ authenticated: false, error: 'Token invalid.' });
    }
    return res.status(500).json({ authenticated: false, error: 'Eroare la verificarea token-ului.' });
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
 * On success returns: { authenticated: true, success: true, admin: { id, email } }
 * Also sets the auth_token cookie.
 */
router.post('/login', (req, res) => {
  // --- 1. Input presence ---
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ authenticated: false, error: 'Email și parolă obligatorii.' });
  }

  // --- 2. Input validation ---
  if (!isValidEmail(email)) {
    return res.status(400).json({ authenticated: false, error: 'Format email invalid.' });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ authenticated: false, error: 'Parola trebuie să aibă între 8 și 128 de caractere.' });
  }

  // --- 3. Look up admin ---
  const normalizedEmail = email.trim().toLowerCase();
  const admin = db.getAdminByEmail(normalizedEmail);

  if (!admin) {
    // Use a generic message to avoid user enumeration
    return res.status(401).json({ authenticated: false, error: 'Email sau parolă incorecte.' });
  }

  // --- 4. Verify password (constant-time via bcrypt) ---
  let passwordOk = false;
  try {
    passwordOk = bcrypt.compareSync(password, admin.password);
  } catch {
    return res.status(500).json({ authenticated: false, error: 'Eroare internă la verificarea parolei.' });
  }

  if (!passwordOk) {
    return res.status(401).json({ authenticated: false, error: 'Email sau parolă incorecte.' });
  }

  // --- 5. Issue JWT ---
  const payload = { id: admin.id, email: admin.email };
  let token;
  try {
    token = signToken(payload);
  } catch {
    return res.status(500).json({ authenticated: false, error: 'Nu s-a putut genera token-ul.' });
  }

  // --- 6. Set cookie ---
  setAuthCookie(res, token);

  // --- 7. Respond ---
  return res.json({
    authenticated: true,
    success: true,
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
 * Protected: uses verifyToken middleware.
 *
 * Returns:
 *   200 { authenticated: true, admin: { id, email } }
 *   401 { authenticated: false, error: "..." }
 */
router.get('/check', verifyToken, (req, res) => {
  return res.json({
    authenticated: true,
    admin: {
      id: req.admin.id,
      email: req.admin.email,
    },
  });
});

/**
 * POST /api/auth/logout
 *
 * Clears the auth cookie. No JWT validation required — even an expired token
 * should be cleared from the client.
 */
router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  return res.json({ message: 'Deconectare reușită.' });
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = router;
module.exports.verifyToken = verifyToken;
