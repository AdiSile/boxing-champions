// ---------------------------------------------------------------------------
// routes/settings.js
// Setări aplicație: GET /api/settings (public) și PUT /api/settings (admin)
//
// GET  – returnează toate setările (defaults + persistente, deep-merged).
// PUT  – actualizează setările prin deep-merge; necesită autentificare admin.
//        Acceptă un obiect parțial – doar cheile trimise se modifică.
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const settingsModel = require('../models/settingsModel');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare (sincronizat cu routes/auth.js) */
const TOKEN_COOKIE = 'token';

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
    throw new Error('[settings] JWT_SECRET nu este definit în variabilele de mediu.');
  }
  return secret;
}

/**
 * Verifică token-ul JWT din cookie și returnează payload-ul decodificat.
 * Returnează null dacă token-ul lipsește, este invalid sau expirat.
 *
 * @param {object} req - Cererea Express
 * @returns {{ sub: number, email: string, role: string }|null}
 */
function verifyRequestToken(req) {
  const token = req.cookies?.[TOKEN_COOKIE];

  if (!token) return null;

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });

    if (!payload || !payload.sub || payload.type !== 'access') {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifică dacă payload-ul conține rolul specificat.
 *
 * @param {object|null} payload
 * @param {string} role
 * @returns {boolean}
 */
function hasRole(payload, role) {
  return payload !== null && payload.role === role;
}

// ---------------------------------------------------------------------------
// GET /api/settings
// Public – returnează setările complete ale aplicației.
// ---------------------------------------------------------------------------

router.get('/api/settings', (req, res) => {
  try {
    const settings = settingsModel.getSettings();

    return res.json(settings);
  } catch (err) {
    console.error('[settings] GET error:', err.message);
    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// Admin only – actualizează setările prin deep-merge.
// Acceptă un obiect JSON parțial; doar cheile trimise se modifică.
// ---------------------------------------------------------------------------

router.put('/api/settings', (req, res) => {
  try {
    // ------------------------------------------------------------------
    // 1. Autentificare
    // ------------------------------------------------------------------
    const payload = verifyRequestToken(req);

    if (!payload) {
      return res.status(401).json({
        error: 'Authentication required.',
        code: 'AUTH_REQUIRED',
      });
    }

    // ------------------------------------------------------------------
    // 2. Autorizare – doar admin
    // ------------------------------------------------------------------
    if (!hasRole(payload, 'admin')) {
      return res.status(403).json({
        error: 'Insufficient permissions. Admin access required.',
        code: 'FORBIDDEN',
      });
    }

    // ------------------------------------------------------------------
    // 3. Validare body
    // ------------------------------------------------------------------
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length === 0
    ) {
      return res.status(400).json({
        error: 'Request body must be a non-empty JSON object.',
        code: 'INVALID_BODY',
      });
    }

    // ------------------------------------------------------------------
    // 4. Actualizare (deep-merge) prin model
    // ------------------------------------------------------------------
    const updated = settingsModel.updateSettings(req.body);

    return res.json({
      message: 'Settings updated successfully.',
      settings: updated,
    });
  } catch (err) {
    console.error('[settings] PUT error:', err.message);

    if (err instanceof TypeError) {
      return res.status(400).json({
        error: err.message,
        code: 'INVALID_BODY',
      });
    }

    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

module.exports = router;