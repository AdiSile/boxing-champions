const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDb();

  // ── settings ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      key         TEXT    NOT NULL UNIQUE,
      value       TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      updated_at  TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── users ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password      TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','coach')),
      avatar        TEXT    DEFAULT NULL,
      phone         TEXT    DEFAULT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      email_verified_at TEXT DEFAULT NULL,
      remember_token    TEXT DEFAULT NULL,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── coaches ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS coaches (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
      name          TEXT    NOT NULL,
      slug          TEXT    NOT NULL UNIQUE,
      title         TEXT    DEFAULT NULL,
      bio           TEXT    DEFAULT NULL,
      specialties   TEXT    DEFAULT '[]',
      certifications TEXT   DEFAULT '[]',
      photo         TEXT    DEFAULT NULL,
      email         TEXT    DEFAULT NULL,
      phone         TEXT    DEFAULT NULL,
      social_links  TEXT    DEFAULT '{}',
      is_active     INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── events ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      title         TEXT    NOT NULL,
      slug          TEXT    NOT NULL UNIQUE,
      description   TEXT    DEFAULT NULL,
      type          TEXT    DEFAULT 'general' CHECK(type IN ('seminar','workshop','camp','competition','general')),
      location      TEXT    DEFAULT NULL,
      start_date    TEXT    NOT NULL,
      end_date      TEXT    DEFAULT NULL,
      time          TEXT    DEFAULT NULL,
      price         REAL    DEFAULT 0,
      capacity      INTEGER DEFAULT NULL,
      image         TEXT    DEFAULT NULL,
      is_published  INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── schedule ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id      INTEGER DEFAULT NULL REFERENCES coaches(id) ON DELETE SET NULL,
      title         TEXT    NOT NULL,
      day_of_week   INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time    TEXT    NOT NULL,
      end_time      TEXT    NOT NULL,
      location      TEXT    DEFAULT NULL,
      max_participants INTEGER DEFAULT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── plans ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      slug          TEXT    NOT NULL UNIQUE,
      description   TEXT    DEFAULT NULL,
      price         REAL    NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      features      TEXT    DEFAULT '[]',
      is_popular    INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── products ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      slug          TEXT    NOT NULL UNIQUE,
      description   TEXT    DEFAULT NULL,
      price         REAL    NOT NULL,
      category      TEXT    DEFAULT 'general',
      image         TEXT    DEFAULT NULL,
      stock         INTEGER DEFAULT NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── orders ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
      order_number  TEXT    NOT NULL UNIQUE,
      status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','processing','completed','cancelled','refunded')),
      total_amount  REAL    NOT NULL DEFAULT 0,
      items         TEXT    NOT NULL DEFAULT '[]',
      billing_name  TEXT    DEFAULT NULL,
      billing_email TEXT    DEFAULT NULL,
      billing_phone TEXT    DEFAULT NULL,
      notes         TEXT    DEFAULT NULL,
      paid_at       TEXT    DEFAULT NULL,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── contact_messages ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL,
      subject       TEXT    DEFAULT NULL,
      message       TEXT    NOT NULL,
      is_read       INTEGER NOT NULL DEFAULT 0,
      replied_at    TEXT    DEFAULT NULL,
      created_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── promotions ────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      code          TEXT    NOT NULL UNIQUE,
      description   TEXT    DEFAULT NULL,
      discount_type TEXT    NOT NULL DEFAULT 'percentage' CHECK(discount_type IN ('percentage','fixed')),
      discount_value REAL   NOT NULL DEFAULT 0,
      applies_to    TEXT    DEFAULT 'all' CHECK(applies_to IN ('all','plans','products','events')),
      start_date    TEXT    DEFAULT NULL,
      end_date      TEXT    DEFAULT NULL,
      usage_limit   INTEGER DEFAULT NULL,
      usage_count   INTEGER NOT NULL DEFAULT 0,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── Seed: default settings ────────────────────────────────
  const seedSettings = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)
  `);

  seedSettings.run('site_name', 'Boxing Champions', 'Site title');
  seedSettings.run('site_description', 'Club de box și arte marțiale - Performanță, disciplină și tradiție', 'Meta description');
  seedSettings.run('admin_email', 'admin@boxingchampions.ro', 'Administrator email');
  seedSettings.run('timezone', 'Europe/Bucharest', 'Default timezone');
  seedSettings.run('locale', 'ro', 'Default locale');
  seedSettings.run('items_per_page', '12', 'Pagination limit');
  seedSettings.run('smtp_host', '', 'SMTP server host');
  seedSettings.run('smtp_port', '587', 'SMTP port');
  seedSettings.run('smtp_user', '', 'SMTP username');
  seedSettings.run('smtp_pass', '', 'SMTP password');
  seedSettings.run('maintenance_mode', '0', 'Site under maintenance');

  // ── Seed: admin user ─────────────────────────────────────
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@boxingchampions.ro');
  if (!existingAdmin) {
    const saltRounds = 10;
    const hashedPassword = bcrypt.hashSync('boxing2026', saltRounds);

    db.prepare(`
      INSERT INTO users (name, email, password, role, is_active, email_verified_at)
      VALUES (?, ?, ?, 'admin', 1, datetime('now'))
    `).run('Boxing Champions Admin', 'admin@boxingchampions.ro', hashedPassword);

    console.log('[DB] Admin user seeded: admin@boxingchampions.ro / boxing2026');
  }

  console.log('[DB] Database initialized successfully.');
  return db;
}

module.exports = { getDb, initializeDatabase };