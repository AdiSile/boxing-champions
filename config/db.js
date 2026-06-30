// ---------------------------------------------------------------------------
// config/db.js
// Bază de date SQLite via better-sqlite3 – inițializare sincronă, fără
// wrapper-e, fără persistență manuală. API-ul nativ better-sqlite3 este
// expus direct: db.prepare(sql).get/all/run(...), db.transaction(fn),
// db.exec(sql), db.pragma(...).
//
// Fișierul bazei de date: ./boxing.db (în directorul de lucru al
// procesului Node – rădăcina proiectului).
//
// Oferă:
//   - initDb()                  – funcție sincronă care deschide/crează BD
//   - getDb()                   – returnează instanța Database sau null
//   - closeDb()                 – închide baza de date
//   - checkDatabaseConnection() – verifică rapid conexiunea
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// Stare internă
// ---------------------------------------------------------------------------

/** Instanța bazei de date better-sqlite3 */
let _db = null;

/** Calea către fișierul SQLite */
const DB_PATH = './boxing.db';

// ---------------------------------------------------------------------------
// Creare tabele
// ---------------------------------------------------------------------------

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
// Inițializare principală (sincronă)
// ---------------------------------------------------------------------------

/**
 * Inițializează baza de date better-sqlite3.
 *
 * Deschide/crează fișierul boxing.db, activează WAL mode și foreign keys,
 * creează tabelele și seed-uiește datele implicite.
 *
 * @returns {import('better-sqlite3').Database} Instanța bazei de date
 */
function initDb() {
  if (_db) return _db;

  console.log('[db] Se deschide/crează baza de date better-sqlite3...');

  _db = new Database(DB_PATH);

  // Optimizări și setări
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _createTables();
  _seedSettings();

  console.log('[db] Baza de date este gata.');

  return _db;
}

/**
 * Returnează instanța bazei de date better-sqlite3.
 *
 * Dacă initDb() nu a fost încă apelată, returnează null. Rutele
 * trebuie să verifice și să răspundă cu 503 dacă este null.
 *
 * @returns {import('better-sqlite3').Database|null}
 */
function getDb() {
  if (!_db) {
    console.warn('[db] Baza de date nu este încă inițializată — se returnează null.');
    return null;
  }
  return _db;
}

/**
 * Închide baza de date.
 */
function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
    console.log('[db] Baza de date a fost închisă.');
  }
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
  closeDb,
  checkDatabaseConnection,
  get _db() { return _db; },
};