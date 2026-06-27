// ---------------------------------------------------------------------------
// models/settingsModel.js
// Model key-value pentru setări, stocate în tabela SQLite `settings`.
//
// Oferă:
//   - getSettings()         – toate setările (obiect { key: value })
//   - getPublicSettings()   – setări publice (exclude chei sensibile)
//   - getSetting(key)       – o singură setare după cheie
//   - updateSetting(key, value, description) – upsert o singură setare
//   - updateSettings(partial) – actualizare multiplă (obiect { key: value })
//   - resetSettings()       – șterge toate setările și re-seed-uiește default-urile
//   - EventEmitter          – notificări la schimbare (changed, reset)
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Cheile considerate sensibile – nu se expun în răspunsul public GET */
const SENSITIVE_KEYS = new Set([
  'smtp_pass',
  'smtp_user',
]);

/** Valorile default pentru seed */
const DEFAULT_SETTINGS = Object.freeze([
  { key: 'site_name', value: 'Boxing Champions', description: 'Site title' },
  { key: 'site_description', value: 'Club de box și arte marțiale - Performanță, disciplină și tradiție', description: 'Meta description' },
  { key: 'admin_email', value: 'admin@boxingchampions.ro', description: 'Administrator email' },
  { key: 'timezone', value: 'Europe/Bucharest', description: 'Default timezone' },
  { key: 'locale', value: 'ro', description: 'Default locale' },
  { key: 'items_per_page', value: '12', description: 'Pagination limit' },
  { key: 'smtp_host', value: '', description: 'SMTP server host' },
  { key: 'smtp_port', value: '587', description: 'SMTP port' },
  { key: 'smtp_user', value: '', description: 'SMTP username' },
  { key: 'smtp_pass', value: '', description: 'SMTP password' },
  { key: 'maintenance_mode', value: '0', description: 'Site under maintenance' },
]);

// ---------------------------------------------------------------------------
// Evenimente
// ---------------------------------------------------------------------------

class SettingsEmitter extends EventEmitter {}
const emitter = new SettingsEmitter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Citește toate rândurile din tabela settings și returnează un obiect
 * { key: value, ... }.
 *
 * @returns {object}
 */
function readAllFromDb() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Returnează valoarea unei chei din DB sau undefined dacă nu există.
 *
 * @param {string} key
 * @returns {string|undefined}
 */
function readOneFromDb(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

/**
 * Upsert o singură setare.
 *
 * @param {string} key
 * @param {string} value
 * @param {string} [description]
 */
function writeOneToDb(key, value, description = '') {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(`
    INSERT INTO settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
      updated_at = excluded.updated_at
  `).run(key, String(value), description || '', now);
}

/**
 * Seed-uiește valorile default în DB (doar dacă cheia nu există deja).
 */
function seedDefaults() {
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)
  `);

  for (const setting of DEFAULT_SETTINGS) {
    insertStmt.run(setting.key, setting.value, setting.description);
  }
}

// ---------------------------------------------------------------------------
// Operații publice
// ---------------------------------------------------------------------------

/**
 * Returnează toate setările ca obiect { key: value, ... }.
 *
 * @returns {object}
 */
function getSettings() {
  return readAllFromDb();
}

/**
 * Returnează o singură setare după cheie.
 *
 * @param {string} key
 * @returns {string|undefined}
 */
function getSetting(key) {
  if (!key || typeof key !== 'string') return undefined;
  return readOneFromDb(key);
}

/**
 * Returnează setările publice (exclude cheile sensibile).
 *
 * @returns {object}
 */
function getPublicSettings() {
  const all = readAllFromDb();
  const result = {};
  for (const [key, value] of Object.entries(all)) {
    if (!SENSITIVE_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Actualizează o singură setare (upsert).
 * Emite evenimentul 'changed' după salvare.
 *
 * @param {string} key
 * @param {string} value
 * @param {string} [description]
 * @returns {{ key: string, value: string }}
 */
function updateSetting(key, value, description = '') {
  if (!key || typeof key !== 'string' || key.length === 0) {
    throw new TypeError('updateSetting() așteaptă o cheie validă (string non-gol).');
  }
  if (value === undefined || value === null) {
    throw new TypeError('updateSetting() așteaptă o valoare non-null.');
  }

  writeOneToDb(key, String(value), description);

  const fullSettings = readAllFromDb();

  emitter.emit('changed', {
    changedKeys: [key],
    fullSettings,
  });

  return { key, value: String(value) };
}

/**
 * Actualizează mai multe setări deodată.
 * Primește un obiect { key: value, ... }.
 * Emite un singur eveniment 'changed' după toate actualizările.
 *
 * @param {object} partial - Obiect { key: value }
 * @returns {object} Setările complete după actualizare
 */
function updateSettings(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('updateSettings() așteaptă un obiect plain { key: value, ... }.');
  }

  const keys = Object.keys(partial);
  if (keys.length === 0) {
    return readAllFromDb();
  }

  for (const key of keys) {
    writeOneToDb(key, String(partial[key]));
  }

  const fullSettings = readAllFromDb();

  emitter.emit('changed', {
    changedKeys: keys,
    fullSettings,
  });

  return fullSettings;
}

/**
 * Resetează toate setările: șterge tot din DB și re-seed-uiește default-urile.
 * Emite evenimentul 'reset'.
 *
 * @returns {object} Setările default
 */
function resetSettings() {
  const db = getDb();
  db.prepare('DELETE FROM settings').run();
  seedDefaults();

  const defaultObj = {};
  for (const s of DEFAULT_SETTINGS) {
    defaultObj[s.key] = s.value;
  }

  emitter.emit('reset', { fullSettings: defaultObj });

  return defaultObj;
}

/**
 * Expune emițătorul pentru abonare la schimbări.
 *
 * @param {string} event
 * @param {Function} listener
 */
function on(event, listener) {
  return emitter.on(event, listener);
}

/**
 * Dezabonare.
 *
 * @param {string} event
 * @param {Function} listener
 */
function off(event, listener) {
  return emitter.off(event, listener);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  getSettings,
  getSetting,
  getPublicSettings,
  updateSetting,
  updateSettings,
  resetSettings,
  on,
  off,
  DEFAULT_SETTINGS,
  SENSITIVE_KEYS,
};
### routes/settings.js
// ---------------------------------------------------------------------------
// routes/settings.js
// Setări aplicație: GET /api/settings (public) și PUT /api/settings (admin)
//
// GET  – returnează setările publice (fără chei sensibile).
// PUT  – actualizează o singură setare per cerere (key + value).
//        Necesită autentificare admin.
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// Validare: schema settingsUpdateSchema din middleware/validate.js
// ---------------------------------------------------------------------------

const express = require('express');
const settingsModel = require('../models/settingsModel');
const {
  authenticate,
  authorize,
  csrfProtection,
} = require('../middleware/auth');
const {
  validate,
  settingsUpdateSchema,
} = require('../middleware/validate');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/settings
// Public – returnează setările publice (fără chei sensibile).
// ---------------------------------------------------------------------------

router.get('/api/settings', (req, res) => {
  try {
    const settings = settingsModel.getPublicSettings();

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
// Admin only – actualizează o singură setare (key + value).
// Middleware: authenticate → csrfProtection → authorize('admin') → validate
// Body: { key: string, value: string }
// ---------------------------------------------------------------------------

router.put(
  '/api/settings',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(settingsUpdateSchema),
  (req, res) => {
    try {
      const { key, value } = req.body;

      // Actualizare per cheie
      const result = settingsModel.updateSetting(key, value);

      return res.json({
        message: 'Settings updated successfully.',
        setting: result,
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
  }
);

module.exports = router;