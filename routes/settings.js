'use strict';

// ---------------------------------------------------------------------------
// routes/settings.js — Boxing Champions Settings Routes
//
// Public endpoint (no auth):
//   GET  /api/settings – public settings (key-value pairs)
//
// Admin endpoint (JWT required):
//   PUT  /api/settings – update settings (batch upsert)
//
// Allowed keys:
//   club_name, slogan, email, phone, address,
//   facebook, instagram, tiktok, hero_badge, about_text
// ---------------------------------------------------------------------------

const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Allowed settings keys and validation helpers
// ---------------------------------------------------------------------------

const ALLOWED_KEYS = [
  'club_name',
  'slogan',
  'email',
  'phone',
  'address',
  'facebook',
  'instagram',
  'tiktok',
  'hero_badge',
  'about_text',
];

function isString(s, maxLen = 5000) {
  return typeof s === 'string' && s.length <= maxLen;
}

function sanitizeString(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 2000);
}

// ---------------------------------------------------------------------------
// GET /api/settings – returns all settings as key-value object
// ---------------------------------------------------------------------------
router.get('/settings', (_req, res) => {
  try {
    const settings = db.getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[SETTINGS] GET /settings error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea setărilor.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings – update settings (JWT protected)
//
// Body (JSON): { "club_name": "...", "slogan": "..." }
// Only allowed keys are accepted. Each value must be a string ≤ 2000 chars.
// Returns the full updated settings object.
// ---------------------------------------------------------------------------
router.put('/settings', verifyToken, (req, res) => {
  try {
    const settingsObj = req.body;

    if (!settingsObj || typeof settingsObj !== 'object' || Array.isArray(settingsObj)) {
      return res.status(400).json({ error: 'Corpul trebuie să fie un obiect cu perechi cheie-valoare.' });
    }

    // Validate keys and values
    for (const [key, value] of Object.entries(settingsObj)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ error: `Cheia "${key}" nu este permisă.` });
      }
      if (typeof value !== 'string' || value.length > 2000) {
        return res.status(400).json({
          error: `Valoarea pentru "${key}" trebuie să fie un string de maximum 2000 de caractere.`,
        });
      }
    }

    // Sanitize all values
    const sanitized = {};
    for (const [key, value] of Object.entries(settingsObj)) {
      sanitized[key] = sanitizeString(value);
    }

    const updated = db.updateSettingsBatch(sanitized);
    return res.json(updated);
  } catch (err) {
    console.error('[SETTINGS] PUT /settings error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea setărilor.' });
  }
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
module.exports = router;