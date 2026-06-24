const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const ENCODING = 'utf8';

// ---------------------------------------------------------------------------
// Valori implicite – tot ce ține de config se declară aici
// ---------------------------------------------------------------------------
const DEFAULTS = Object.freeze({
  general: {
    siteName: 'My App',
    language: 'ro',
    timezone: 'Europe/Bucharest',
    maintenanceMode: false,
  },
  billing: {
    currency: 'RON',
    taxRate: 0.19,
    invoicePrefix: 'INV-',
    paymentTermsDays: 30,
  },
  notifications: {
    email: {
      enabled: true,
      fromAddress: 'noreply@example.com',
      smtp: {
        host: 'localhost',
        port: 587,
        secure: false,
      },
    },
    push: { enabled: false },
  },
  security: {
    sessionTimeoutMinutes: 60,
    maxLoginAttempts: 5,
    mfaRequired: false,
  },
  features: {
    darkMode: false,
    betaAccess: false,
  },
});

// ---------------------------------------------------------------------------
// Evenimente pentru ca restul aplicației să poată reacționa la schimbări
// ---------------------------------------------------------------------------
class SettingsEmitter extends EventEmitter {}
const emitter = new SettingsEmitter();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep merge între două obiecte.
 * - `source` este obiectul de bază (imutabil, nu se modifică)
 * - `override` conține noile valori
 * - Array-urile se înlocuiesc complet (nu se concatenează)
 * - Valorile `null` din override șterg cheia din rezultat
 */
function deepMerge(source, override) {
  if (override === null) return null;
  if (typeof override !== 'object' || Array.isArray(override)) {
    return override;
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    source = {};
  }

  const result = { ...source };

  for (const key of Object.keys(override)) {
    const overrideVal = override[key];

    if (overrideVal === null) {
      delete result[key];
    } else if (
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result;
}

/**
 * Încarcă setările persistente de pe disc.
 * Returnează un obiect gol dacă fișierul nu există sau e corupt.
 */
function loadFromDisk() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, ENCODING);
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Salvează obiectul pe disc (sync, suprascrie).
 * Creează directorul `data/` dacă nu există.
 */
function saveToDisk(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), ENCODING);
}

// ---------------------------------------------------------------------------
// Operații publice
// ---------------------------------------------------------------------------

/**
 * Returnează setările complete (defaults + persistente, deep-merged).
 * Nu modifică fișierul de pe disc.
 *
 * @returns {Object} Setări complete
 */
function getSettings() {
  const persisted = loadFromDisk();
  return deepMerge(DEFAULTS, persisted);
}

/**
 * Actualizează setările printr-un deep-merge între ce există deja pe disc
 * și noile valori primite. Salvează rezultatul și notifică ascultătorii.
 *
 * @param {Object} partial - Obiect parțial cu setările de actualizat
 * @param {Object} [options]
 * @param {boolean} [options.mergeArrays=false] - dacă true, concatenează array-uri
 * @returns {Object} Setările complete după actualizare
 */
function updateSettings(partial, options = {}) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('updateSettings() așteaptă un obiect plain.');
  }

  const currentPersisted = loadFromDisk();
  const mergedPersisted = options.mergeArrays
    ? deepMergeWithArrays(currentPersisted, partial)
    : deepMerge(currentPersisted, partial);

  saveToDisk(mergedPersisted);

  const fullSettings = deepMerge(DEFAULTS, mergedPersisted);

  // Emitere eveniment
  emitter.emit('changed', {
    changedKeys: Object.keys(partial),
    fullSettings,
  });

  return fullSettings;
}

/**
 * Variantă de deepMerge care concatenează array-urile în loc să le înlocuiască.
 */
function deepMergeWithArrays(source, override) {
  if (override === null) return null;
  if (typeof override !== 'object' || Array.isArray(override)) {
    return override;
  }
  if (typeof source !== 'object' || Array.isArray(source)) {
    source = {};
  }

  const result = { ...source };

  for (const key of Object.keys(override)) {
    const overrideVal = override[key];

    if (overrideVal === null) {
      delete result[key];
    } else if (Array.isArray(overrideVal) && Array.isArray(result[key])) {
      result[key] = [...result[key], ...overrideVal];
    } else if (
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal) &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMergeWithArrays(result[key], overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result;
}

/**
 * Resetează setările la valorile implicite (șterge fișierul persistent).
 * @returns {Object} Setările default
 */
function resetSettings() {
  if (fs.existsSync(SETTINGS_FILE)) {
    fs.unlinkSync(SETTINGS_FILE);
  }
  emitter.emit('reset', { fullSettings: { ...DEFAULTS } });
  return { ...DEFAULTS };
}

/**
 * Expune emițătorul pentru abonare la schimbări.
 * Exemplu: settingsModel.on('changed', ({ fullSettings }) => { ... })
 */
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
  updateSettings,
  resetSettings,
  on,
  off,
  DEFAULTS,
};