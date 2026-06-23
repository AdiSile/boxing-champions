'use strict';

// ---------------------------------------------------------------------------
// config/db.js — Database Configuration Module
//
// Re-exportă din modulul rădăcină db.js și asigură crearea tabelelor necesare.
// Modulul rădăcină db.js se ocupă de:
//   - Conectarea singleton la baza de date SQLite
//   - Crearea schemei (toate tabelele)
//   - Seed-ul datelor hardcodate (dacă tabelele sunt goale)
//   - Crearea tabelului admins și seed-ul admin-ului default
//
// Acest modul oferă un singur punct de intrare pentru configurarea bazei
// de date și expune o funcție suplimentară ensureTables() pentru
// verificarea existenței tabelelor.
// ---------------------------------------------------------------------------

const db = require('../db');

// ---------------------------------------------------------------------------
// Lista tabelelor necesare aplicației
// ---------------------------------------------------------------------------
const REQUIRED_TABLES = [
  'settings',
  'coaches',
  'events',
  'event_photos',
  'schedule',
  'subscriptions',
  'products',
  'orders',
  'messages',
  'achievements',
  'admins',
];

// ---------------------------------------------------------------------------
// Verifică existența tuturor tabelelor necesare
// ---------------------------------------------------------------------------
function ensureTables() {
  const database = db.getDb();

  const existing = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

  const missing = REQUIRED_TABLES.filter((t) => !existing.includes(t));

  if (missing.length > 0) {
    const msg = `[config/db] Tabele lipsă: ${missing.join(', ')}. Se reinițializează...`;
    console.warn(msg);

    // Re-execută schema și seed-ul prin re-importarea inițializării
    // Forțăm recrearea tabelelor lipsă
    database.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT    NOT NULL UNIQUE,
        value       TEXT    NOT NULL DEFAULT '',
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS coaches (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        specialization  TEXT    NOT NULL DEFAULT '',
        certifications  TEXT    NOT NULL DEFAULT '',
        photo           TEXT    NOT NULL DEFAULT '',
        quote           TEXT    NOT NULL DEFAULT '',
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        event_date  TEXT    NOT NULL,
        location    TEXT    NOT NULL DEFAULT '',
        description TEXT    NOT NULL DEFAULT '',
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS event_photos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id    INTEGER NOT NULL,
        url         TEXT    NOT NULL DEFAULT '',
        caption     TEXT    NOT NULL DEFAULT '',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS schedule (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        day         TEXT    NOT NULL,
        start_time  TEXT    NOT NULL,
        end_time    TEXT    NOT NULL,
        category    TEXT    NOT NULL DEFAULT '',
        gender      TEXT    NOT NULL DEFAULT 'Mixt',
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        monthly_price   REAL    NOT NULL DEFAULT 0,
        yearly_price    REAL    NOT NULL DEFAULT 0,
        benefits        TEXT    NOT NULL DEFAULT '[]',
        highlighted     INTEGER NOT NULL DEFAULT 0,
        active          INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS products (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT    NOT NULL,
        description       TEXT    NOT NULL DEFAULT '',
        price             REAL    NOT NULL DEFAULT 0,
        old_price         REAL    DEFAULT NULL,
        discount_label    TEXT    NOT NULL DEFAULT '',
        contextual_label  TEXT    NOT NULL DEFAULT '',
        category          TEXT    NOT NULL DEFAULT '',
        image             TEXT    NOT NULL DEFAULT '',
        stock             INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS orders (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name       TEXT    NOT NULL DEFAULT '',
        customer_email      TEXT    NOT NULL DEFAULT '',
        customer_phone      TEXT    NOT NULL DEFAULT '',
        items               TEXT    NOT NULL DEFAULT '[]',
        total               REAL    NOT NULL DEFAULT 0,
        status              TEXT    NOT NULL DEFAULT 'pending',
        stripe_session_id   TEXT    NOT NULL DEFAULT '',
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL DEFAULT '',
        email       TEXT    NOT NULL DEFAULT '',
        phone       TEXT    NOT NULL DEFAULT '',
        subject     TEXT    NOT NULL DEFAULT '',
        message     TEXT    NOT NULL DEFAULT '',
        is_read     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS achievements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT    NOT NULL UNIQUE,
        value       INTEGER NOT NULL DEFAULT 0,
        label       TEXT    NOT NULL DEFAULT '',
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS admins (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        email       TEXT    NOT NULL UNIQUE,
        password    TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  return {
    total: REQUIRED_TABLES.length,
    existing,
    missing,
    allPresent: missing.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Inițializare: verifică tabelele la primul import
// (modulul rădăcină ../db face deja schema + seed la require)
// ---------------------------------------------------------------------------
let tablesChecked = false;

function initConfig() {
  if (!tablesChecked) {
    const result = ensureTables();
    if (!result.allPresent) {
      console.warn(`[config/db] ${result.missing.length} tabel(e) recreate.`);
    }
    tablesChecked = true;
  }
}

// Execută verificarea o singură dată
initConfig();

// ---------------------------------------------------------------------------
// Re-exportă toate funcțiile din modulul rădăcină db.js
// ---------------------------------------------------------------------------
module.exports = {
  // --- Funcții adăugate de config/db ---
  ensureTables,
  getRequiredTables: () => [...REQUIRED_TABLES],

  // --- Re-export din db.js ---
  getDb: db.getDb,

  // Settings
  getAllSettings: db.getAllSettings,
  getSetting: db.getSetting,
  upsertSetting: db.upsertSetting,
  updateSettingsBatch: db.updateSettingsBatch,

  // Coaches
  getAllCoaches: db.getAllCoaches,
  getActiveCoaches: db.getActiveCoaches,
  getCoachById: db.getCoachById,
  createCoach: db.createCoach,
  updateCoach: db.updateCoach,
  deleteCoach: db.deleteCoach,
  toggleCoachActive: db.toggleCoachActive,

  // Events
  getAllEvents: db.getAllEvents,
  getActiveEvents: db.getActiveEvents,
  getEventById: db.getEventById,
  createEvent: db.createEvent,
  updateEvent: db.updateEvent,
  deleteEvent: db.deleteEvent,
  toggleEventActive: db.toggleEventActive,

  // Event Photos
  addEventPhoto: db.addEventPhoto,
  updateEventPhoto: db.updateEventPhoto,
  deleteEventPhoto: db.deleteEventPhoto,
  getEventPhotos: db.getEventPhotos,

  // Schedule
  getAllSchedule: db.getAllSchedule,
  getActiveSchedule: db.getActiveSchedule,
  getScheduleById: db.getScheduleById,
  createSchedule: db.createSchedule,
  updateSchedule: db.updateSchedule,
  deleteSchedule: db.deleteSchedule,
  toggleScheduleActive: db.toggleScheduleActive,

  // Subscriptions
  getAllSubscriptions: db.getAllSubscriptions,
  getActiveSubscriptions: db.getActiveSubscriptions,
  getSubscriptionById: db.getSubscriptionById,
  createSubscription: db.createSubscription,
  updateSubscription: db.updateSubscription,
  deleteSubscription: db.deleteSubscription,
  toggleSubscriptionActive: db.toggleSubscriptionActive,

  // Products
  getAllProducts: db.getAllProducts,
  getActiveProducts: db.getActiveProducts,
  getProductsByCategory: db.getProductsByCategory,
  getProductById: db.getProductById,
  createProduct: db.createProduct,
  updateProduct: db.updateProduct,
  deleteProduct: db.deleteProduct,
  toggleProductActive: db.toggleProductActive,

  // Orders
  getAllOrders: db.getAllOrders,
  getOrderById: db.getOrderById,
  createOrder: db.createOrder,
  updateOrderStatus: db.updateOrderStatus,
  deleteOrder: db.deleteOrder,

  // Messages
  getAllMessages: db.getAllMessages,
  getUnreadMessages: db.getUnreadMessages,
  getMessageById: db.getMessageById,
  createMessage: db.createMessage,
  markMessageRead: db.markMessageRead,
  deleteMessage: db.deleteMessage,

  // Achievements
  getAllAchievements: db.getAllAchievements,
  getAchievement: db.getAchievement,
  upsertAchievement: db.upsertAchievement,

  // Admin
  getAdminByEmail: db.getAdminByEmail,
};