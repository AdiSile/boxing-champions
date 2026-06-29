// ---------------------------------------------------------------------------
// config/db.js
// Bază de date SQLite via sql.js (WASM) – inițializare asincronă, persistentă
// pe disc în fișierul database.sqlite.
//
// Oferă:
//   - initDb()          – funcție async care încarcă/crează baza de date
//   - getDb()           – returnează instanța DB sincron sau null dacă nu e inițializată
//   - saveDb()          – persistă baza de date pe disc
//   - closeDb()         – salvează și închide curat
//   - dbReady           – Promise care se rezolvă când DB este gata
//
// Wrapper-ează API-ul sql.js pentru a fi compatibil cu pattern-urile
// existente în proiect (stmt.get(), stmt.all(), stmt.run() cu spread params,
// db.transaction()).
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Stare internă
// ---------------------------------------------------------------------------

/** Instanța bazei de date sql.js (wrapper-uită) */
let _db = null;

/** Modulul SQL inițializat (referință pentru new SQL.Database) */
let _SQL = null;

/** Calea către fișierul de date SQLite */
const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

/** Promise care se rezolvă când DB este complet inițializată */
let _readyPromise = null;

/** Flag pentru a preveni salvări concurente */
let _saving = false;

/** Interval de auto-salvare (30 secunde) */
const AUTO_SAVE_INTERVAL = 30_000;

/** Referință către timer-ul de auto-salvare */
let _autoSaveTimer = null;

// ---------------------------------------------------------------------------
// Wrapper sql.js → compatibilitate cu API-ul better-sqlite3
// ---------------------------------------------------------------------------

/**
 * Wrapper pentru Statement (prepared statement).
 * Transformă API-ul sql.js (params ca array) în API-ul așteptat de
 * restul proiectului (params ca argumente variadice, ca better-sqlite3).
 */
class StatementWrapper {
  constructor(stmt) {
    this._stmt = stmt;
  }

  /**
   * Normalizează parametrii: acceptă spread params și îi convertește
   * într-un array pentru sql.js.
   */
  _normalizeParams(args) {
    if (args.length === 0) return [];
    // Dacă primul argument este deja un array, îl folosim direct
    if (args.length === 1 && Array.isArray(args[0])) return args[0];
    // Altfel, colectăm toate argumentele într-un array
    return args;
  }

  get(...args) {
    const params = this._normalizeParams(args);
    const result = this._stmt.get(params);
    this._stmt.free();
    return result || undefined;
  }

  all(...args) {
    const params = this._normalizeParams(args);
    const result = this._stmt.all(params);
    this._stmt.free();
    return result || [];
  }

  run(...args) {
    const params = this._normalizeParams(args);
    const result = this._stmt.run(params);
    this._stmt.free();
    // Asigurăm compatibilitate: better-sqlite3 returnează { changes, lastInsertRowid }
    return {
      changes: result.changes || 0,
      lastInsertRowid: result.lastInsertRowid || 0,
    };
  }
}

/**
 * Wrapper pentru Database.
 * Înfășoară db.prepare() și oferă db.transaction().
 */
class DatabaseWrapper {
  constructor(sqlDb) {
    this._sqlDb = sqlDb;
  }

  prepare(sql) {
    const stmt = this._sqlDb.prepare(sql);
    return new StatementWrapper(stmt);
  }

  exec(sql) {
    return this._sqlDb.run(sql);
  }

  /**
   * Transaction wrapper.
   * În sql.js, tranzacțiile se fac manual cu BEGIN/COMMIT/ROLLBACK.
   * Acest wrapper oferă un API similar cu better-sqlite3:
   *   const fn = db.transaction((...args) => { ... });
   *   fn(...args);
   */
  transaction(fn) {
    const self = this;
    return function (...args) {
      self._sqlDb.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        self._sqlDb.run('COMMIT');
        return result;
      } catch (err) {
        self._sqlDb.run('ROLLBACK');
        throw err;
      }
    };
  }

  /** Obține instanța nativă sql.js (pentru operații avansate) */
  getNative() {
    return this._sqlDb;
  }
}

// ---------------------------------------------------------------------------
// Persistență
// ---------------------------------------------------------------------------

/**
 * Salvează baza de date pe disc (sincron).
 * Folosește fs.writeFileSync pentru a bloca până la finalizare.
 */
function saveDbSync() {
  if (!_db) return;
  try {
    const data = _db.getNative().export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[db] Eroare la salvarea bazei de date:', err.message);
  }
}

/**
 * Salvează baza de date pe disc (asincron, non-blocking).
 * Folosește un flag pentru a preveni salvări concurente.
 */
function saveDb() {
  if (!_db || _saving) return;
  _saving = true;
  // Folosim setImmediate pentru a nu bloca event loop-ul
  setImmediate(() => {
    try {
      saveDbSync();
    } finally {
      _saving = false;
    }
  });
}

/**
 * Închide baza de date și oprește auto-salvarea.
 */
function closeDb() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  if (_db) {
    saveDbSync();
    _db.getNative().close();
    _db = null;
  }
  console.log('[db] Baza de date a fost închisă.');
}

// ---------------------------------------------------------------------------
// Creare tabele
// ---------------------------------------------------------------------------

/**
 * Creează toate tabelele necesare (dacă nu există deja).
 */
function _createTables() {
  const db = _db;

  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','coach')),
    phone TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    email_verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS coaches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    title TEXT,
    bio TEXT,
    photo TEXT,
    specialties TEXT DEFAULT '[]',
    certifications TEXT DEFAULT '[]',
    email TEXT,
    phone TEXT,
    social_links TEXT DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'general' CHECK(type IN ('seminar','workshop','camp','competition','general')),
    location TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    time TEXT,
    price REAL NOT NULL DEFAULT 0,
    capacity INTEGER,
    image TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id INTEGER REFERENCES coaches(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    day_of_week INTEGER NOT NULL CHECK(day_of_week >= 0 AND day_of_week <= 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    max_participants INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 30,
    features TEXT DEFAULT '[]',
    is_popular INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    price REAL NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'general',
    image TEXT,
    stock INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    order_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','completed','cancelled','refunded')),
    total_amount REAL NOT NULL DEFAULT 0,
    items TEXT NOT NULL DEFAULT '[]',
    billing_name TEXT,
    billing_email TEXT,
    billing_phone TEXT,
    billing_address TEXT,
    notes TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    replied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
    discount_value REAL NOT NULL DEFAULT 0,
    applies_to TEXT NOT NULL DEFAULT 'all' CHECK(applies_to IN ('all','plans','products','events')),
    start_date TEXT,
    end_date TEXT,
    usage_limit INTEGER,
    usage_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  console.log('[db] Tabelele au fost create/verificate.');
}

// ---------------------------------------------------------------------------
// Seed date implicite
// ---------------------------------------------------------------------------

/**
 * Inserează setările implicite (dacă nu există deja).
 */
function _seedSettings() {
  const db = _db;

  const settingsSeed = [
    ['site_name', 'Boxing Champions', 'Site title'],
    ['site_description', 'Club de box și arte marțiale - Performanță, disciplină și tradiție', 'Meta description'],
    ['admin_email', 'admin@boxingchampions.ro', 'Administrator email'],
    ['timezone', 'Europe/Bucharest', 'Default timezone'],
    ['locale', 'ro', 'Default locale'],
    ['items_per_page', '12', 'Pagination limit'],
    ['smtp_host', '', 'SMTP server host'],
    ['smtp_port', '587', 'SMTP port'],
    ['smtp_user', '', 'SMTP username'],
    ['smtp_pass', '', 'SMTP password'],
    ['maintenance_mode', '0', 'Site under maintenance'],
    ['social_facebook', 'https://facebook.com/boxingchampions', 'Facebook page URL'],
    ['social_instagram', 'https://instagram.com/boxingchampions', 'Instagram profile URL'],
    ['social_youtube', 'https://youtube.com/@boxingchampions', 'YouTube channel URL'],
    ['social_tiktok', '', 'TikTok profile URL'],
    ['social_twitter', '', 'Twitter/X profile URL'],
    ['contact_phone', '+40 722 123 456', 'Contact phone number'],
    ['contact_address', 'Str. Sportului nr. 10, București, Sector 1', 'Physical address'],
    ['contact_email', 'contact@boxingchampions.ro', 'Public contact email'],
  ];

  const stmt = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)'
  );

  for (const [key, value, description] of settingsSeed) {
    stmt.run(key, value, description);
  }

  console.log('[db] Setările implicite au fost inserate.');
}

// ---------------------------------------------------------------------------
// Inițializare principală
// ---------------------------------------------------------------------------

/**
 * Inițializează baza de date sql.js.
 *
 * Încarcă fișierul database.sqlite dacă există, altfel creează o bază nouă.
 * Creează tabelele și seed-uiește datele implicite.
 *
 * @returns {Promise<void>}
 */
async function initDb() {
  // Dacă deja avem o inițializare în curs, returnează promisiunea existentă
  if (_readyPromise) return _readyPromise;

  _readyPromise = (async () => {
    try {
      console.log('[db] Se încarcă sql.js (WASM)...');

      // Încărcare sql.js
      const initSqlJs = require('sql.js');
      _SQL = await initSqlJs({
        // sql.js va încărca automat fișierul WASM din node_modules/sql.js/dist/
      });

      console.log('[db] sql.js încărcat cu succes.');

      // Încărcare sau creare bază de date
      let sqlDb;
      if (fs.existsSync(DB_PATH)) {
        console.log(`[db] Se încarcă baza de date existentă: ${DB_PATH}`);
        const fileBuffer = fs.readFileSync(DB_PATH);
        sqlDb = new _SQL.Database(fileBuffer);
        console.log('[db] Baza de date existentă a fost încărcată.');
      } else {
        console.log('[db] Se creează o bază de date nouă.');
        sqlDb = new _SQL.Database();
      }

      // Wrapper-ează instanța sql.js
      _db = new DatabaseWrapper(sqlDb);

      // Creează tabelele (IF NOT EXISTS)
      _createTables();

      // Seed-uiește setările implicite
      _seedSettings();

      // Salvează inițial
      saveDbSync();

      // Configurează auto-salvarea periodică
      _autoSaveTimer = setInterval(() => {
        saveDb();
      }, AUTO_SAVE_INTERVAL);
      if (_autoSaveTimer.unref) _autoSaveTimer.unref();

      // Salvează la terminarea procesului
      process.on('exit', () => saveDbSync());
      process.on('SIGINT', () => { saveDbSync(); process.exit(0); });
      process.on('SIGTERM', () => { saveDbSync(); process.exit(0); });
      process.on('uncaughtException', (err) => {
        console.error('[db] Uncaught exception:', err);
        saveDbSync();
        process.exit(1);
      });

      console.log('[db] Baza de date este gata.');
    } catch (err) {
      console.error('[db] Eroare la inițializarea bazei de date:', err);
      _readyPromise = null;
      throw err;
    }
  })();

  return _readyPromise;
}

/**
 * Returnează instanța bazei de date (wrapper-uită).
 *
 * Dacă baza de date nu a fost încă inițializată (initDb() nu s-a rezolvat
 * sau a eșuat), returnează null. Rutele trebuie să verifice valoarea
 * returnată și să răspundă cu 503 Service Unavailable dacă este null.
 *
 * @returns {DatabaseWrapper|null} Instanța wrapper-uită sau null
 */
function getDb() {
  if (!_db) {
    console.warn('[db] Baza de date nu este încă inițializată — se returnează null.');
    return null;
  }
  return _db;
}

/**
 * Verifică conexiunea la baza de date.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
function checkDatabaseConnection() {
  if (!_db) {
    return { ok: false, error: 'Database not initialized' };
  }
  try {
    const row = _db.prepare('SELECT 1 AS ok').get();
    return { ok: !!(row && row.ok === 1) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  initDb,
  getDb,
  saveDb,
  closeDb,
  checkDatabaseConnection,
  get _db() { return _db; },
};