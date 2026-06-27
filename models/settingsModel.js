// ---------------------------------------------------------------------------
// models/settingsModel.js
// Model key-value pentru setări, stocate în tabela SQLite `settings`.
//
// Oferă:
//   - getSettings()         – toate setările (obiect { key: value })
//   - getPublicSettings()   – setări publice (exclude chei sensibile)
//   - getSetting(key)       – o singură setare după cheie
//   - updateSetting(key, value, description) – upsert o singură setare
//   - updateSettings(partial) – actualizare multiplă (suportă nested)
//   - flattenObject(obj)    – aplatizează obiecte nested → flat { key: value }
//   - resetSettings()       – șterge toate setările și re-seed-uiește default-urile
//   - EventEmitter          – notificări la schimbare (changed, reset)
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  'smtp_pass',
  'smtp_user',
]);

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
 * Aplatizează un obiect nested într-un obiect flat cu chei concatenate prin "_".
 * De exemplu: { site: { name: "X", desc: "Y" }, smtp: { host: "H" } }
 * devine: { site_name: "X", site_desc: "Y", smtp_host: "H" }
 *
 * Acceptă și obiecte deja flat (le returnează ca atare).
 * Valorile non-obiect sunt convertite la string.
 *
 * @param {object} obj - Obiectul de aplatizat (poate fi nested sau flat)
 * @param {string} [prefix] - Prefixul curent (folosit recursiv)
 * @returns {object} Obiect flat { key: value }
 */
function flattenObject(obj, prefix = '') {
  const result = {};

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return result;
  }

  for (const [key, value] of Object.entries(obj)) {
    const flatKey = prefix ? `${prefix}_${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = flattenObject(value, flatKey);
      for (const [nestedKey, nestedValue] of Object.entries(nested)) {
        result[nestedKey] = nestedValue;
      }
    } else {
      if (Array.isArray(value)) {
        result[flatKey] = JSON.stringify(value);
      } else if (value === null) {
        result[flatKey] = '';
      } else {
        result[flatKey] = String(value);
      }
    }
  }

  return result;
}

function readAllFromDb() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

function readOneFromDb(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : undefined;
}

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

function getSettings() {
  return readAllFromDb();
}

function getSetting(key) {
  if (!key || typeof key !== 'string') return undefined;
  return readOneFromDb(key);
}

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
 * Primește un obiect { key: value, ... } FLAT sau NESTED.
 * Obiectele nested sunt automat aplatizate: { site: { name: "X" } } → { site_name: "X" }.
 * Emite un singur eveniment 'changed' după toate actualizările.
 *
 * @param {object} partial - Obiect { key: value } (flat sau nested)
 * @returns {object} Setările complete după actualizare
 */
function updateSettings(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('updateSettings() așteaptă un obiect plain { key: value, ... } (flat sau nested).');
  }

  // Aplatizează automat obiectele nested
  const flat = flattenObject(partial);

  const keys = Object.keys(flat);
  if (keys.length === 0) {
    return readAllFromDb();
  }

  for (const key of keys) {
    writeOneToDb(key, String(flat[key]));
  }

  const fullSettings = readAllFromDb();

  emitter.emit('changed', {
    changedKeys: keys,
    fullSettings,
  });

  return fullSettings;
}

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

function on(event, listener) {
  return emitter.on(event, listener);
}

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
  flattenObject,
  on,
  off,
  DEFAULT_SETTINGS,
  SENSITIVE_KEYS,
};