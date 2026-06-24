'use strict';

// ---------------------------------------------------------------------------
// db.js — Boxing Champions SQLite Database Module
// Schema: settings, coaches, events, event_photos, schedule, subscriptions,
//         products, orders, messages, achievements.
// All queries use prepared statements (better-sqlite3).
// Initialisation with hardcoded seed data.
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, 'boxing.db');

// ---------------------------------------------------------------------------
// Singleton database connection
// ---------------------------------------------------------------------------
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

// ---------------------------------------------------------------------------
// Schema initialisation
// ---------------------------------------------------------------------------
function createSchema(database) {
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

    CREATE TABLE IF NOT EXISTS seo (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      page        TEXT    NOT NULL UNIQUE,
      title       TEXT    NOT NULL DEFAULT '',
      description TEXT    NOT NULL DEFAULT '',
      keywords    TEXT    NOT NULL DEFAULT '',
      og_image    TEXT    NOT NULL DEFAULT '',
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ---------------------------------------------------------------------------
// Seed hardcoded data (only if tables are empty)
// ---------------------------------------------------------------------------
function seedData(database) {
  // --- Settings ---
  const settingsCount = database.prepare('SELECT COUNT(*) AS cnt FROM settings').get();
  if (settingsCount.cnt === 0) {
    const insertSetting = database.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?)'
    );
    const defaults = {
      club_name: 'Boxing Champions',
      slogan: 'Where Champions Are Forged',
      email: 'contact@boxing-champions.com',
      phone: '+40 721 234 567',
      address: 'Strada Sportului nr. 10, București, România',
      facebook: 'https://facebook.com/boxingchampions',
      instagram: 'https://instagram.com/boxingchampions',
      tiktok: 'https://tiktok.com/@boxingchampions',
      hero_badge: 'New Season 2026 — Join the Legacy',
      about_text: 'Cel mai bun club de box din România. Tradiție, disciplină și excelență din 1998.',
    };
    const insertMany = database.transaction(() => {
      for (const [key, value] of Object.entries(defaults)) {
        insertSetting.run(key, value);
      }
    });
    insertMany();
  }

  // --- Coaches ---
  const coachesCount = database.prepare('SELECT COUNT(*) AS cnt FROM coaches').get();
  if (coachesCount.cnt === 0) {
    const insertCoach = database.prepare(
      `INSERT INTO coaches (name, specialization, certifications, photo, quote, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    );
    const coaches = [
      {
        name: 'Mihai „Iron" Ionescu',
        specialization: 'Box Profesionist',
        certifications: 'Centură Neagră, Certificare AIBA, Campion Național 2015',
        photo: '',
        quote: 'Fiecare lovitură pe care o primești e o lecție; fiecare pe care o dai e un pas spre victorie.',
      },
      {
        name: 'Andreea „Golden Glove" Popa',
        specialization: 'Box Feminin & Fitness',
        certifications: 'Campionat European Argint 2018, Certificare K1, Nutriție Sportivă',
        photo: '',
        quote: 'Forța nu vine din pumni, ci din inimă și minte.',
      },
      {
        name: 'Vlad „The Storm" Marinescu',
        specialization: 'Box pentru Copii & Tineret',
        certifications: 'Pedagogie Sportivă, Certificare WBC Youth Coach, 10 ani experiență',
        photo: '',
        quote: 'Campioni nu se nasc, se construiesc prin muncă și dedicare.',
      },
    ];
    const insertMany = database.transaction(() => {
      for (const c of coaches) {
        insertCoach.run(c.name, c.specialization, c.certifications, c.photo, c.quote);
      }
    });
    insertMany();
  }

  // --- Events ---
  const eventsCount = database.prepare('SELECT COUNT(*) AS cnt FROM events').get();
  if (eventsCount.cnt === 0) {
    const insertEvent = database.prepare(
      `INSERT INTO events (title, event_date, location, description, active)
       VALUES (?, ?, ?, ?, 1)`
    );
    const insertPhoto = database.prepare(
      `INSERT INTO event_photos (event_id, url, caption, sort_order)
       VALUES (?, ?, ?, ?)`
    );
    const events = [
      {
        title: 'Gala de Box — Trofeul Campionilor 2025',
        event_date: '2025-06-15',
        location: 'Sala Polivalentă, București',
        description:
          'O seară de neuitat cu meciuri de excepție între cei mai buni pugiliști ai clubului. Invitați speciali din toată Europa.',
        photos: [
          { url: 'images/event-gala.jpg', caption: 'Intrarea în arenă', sort_order: 0 },
          { url: 'images/event-arena.jpg', caption: 'Meciul principal', sort_order: 1 },
          { url: 'images/event-ceremony.jpg', caption: 'Ceremonia de premiere', sort_order: 2 },
        ],
      },
      {
        title: 'Sparring Night — Open Challenge 2025',
        event_date: '2025-04-20',
        location: 'Sala de Antrenament Boxing Champions',
        description:
          'Seară de sparring deschis publicului. Membrii clubului și-au testat abilitățile în meciuri amicale intense.',
        photos: [
          { url: 'images/event-gala.jpg', caption: 'Sparring round 1', sort_order: 0 },
          { url: 'images/event-coaching.jpg', caption: 'Coaching ringside', sort_order: 1 },
        ],
      },
      {
        title: 'Cupa „Tinerelor Talente" 2025',
        event_date: '2025-03-10',
        location: 'Sala Sporturilor, Cluj-Napoca',
        description:
          'Competiție dedicată tinerilor boxeri cu vârste între 12 și 16 ani. Clubul nostru a participat cu 8 sportivi.',
        photos: [
          { url: 'images/event-youth.jpg', caption: 'Echipa înainte de competiție', sort_order: 0 },
          { url: 'images/event-ceremony.jpg', caption: 'Premiul pentru cel mai bun club', sort_order: 1 },
        ],
      },
    ];
    const insertAll = database.transaction(() => {
      for (const ev of events) {
        const result = insertEvent.run(ev.title, ev.event_date, ev.location, ev.description);
        const eventId = result.lastInsertRowid;
        if (ev.photos) {
          for (const p of ev.photos) {
            insertPhoto.run(eventId, p.url, p.caption, p.sort_order);
          }
        }
      }
    });
    insertAll();
  }

  // --- Schedule ---
  const scheduleCount = database.prepare('SELECT COUNT(*) AS cnt FROM schedule').get();
  if (scheduleCount.cnt === 0) {
    const insertSlot = database.prepare(
      `INSERT INTO schedule (day, start_time, end_time, category, gender, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    );
    const slots = [
      // Luni
      { day: 'Luni', start_time: '09:00', end_time: '10:30', category: 'Copii (6-12 ani)', gender: 'Mixt' },
      { day: 'Luni', start_time: '11:00', end_time: '12:30', category: 'Feminin', gender: 'Feminin' },
      { day: 'Luni', start_time: '17:00', end_time: '18:30', category: 'Începători', gender: 'Masculin' },
      { day: 'Luni', start_time: '19:00', end_time: '21:00', category: 'Avansați', gender: 'Masculin' },
      // Marți
      { day: 'Marți', start_time: '09:00', end_time: '10:30', category: 'Copii (6-12 ani)', gender: 'Mixt' },
      { day: 'Marți', start_time: '11:00', end_time: '12:30', category: 'Fitness Box', gender: 'Feminin' },
      { day: 'Marți', start_time: '17:00', end_time: '18:30', category: 'Tehnică', gender: 'Mixt' },
      { day: 'Marți', start_time: '19:00', end_time: '21:00', category: 'Sparring', gender: 'Masculin' },
      // Miercuri
      { day: 'Miercuri', start_time: '09:00', end_time: '10:30', category: 'Copii (6-12 ani)', gender: 'Mixt' },
      { day: 'Miercuri', start_time: '11:00', end_time: '12:30', category: 'Feminin', gender: 'Feminin' },
      { day: 'Miercuri', start_time: '17:00', end_time: '18:30', category: 'Condiție fizică', gender: 'Mixt' },
      { day: 'Miercuri', start_time: '19:00', end_time: '21:00', category: 'Avansați', gender: 'Masculin' },
      // Joi
      { day: 'Joi', start_time: '09:00', end_time: '10:30', category: 'Copii (6-12 ani)', gender: 'Mixt' },
      { day: 'Joi', start_time: '11:00', end_time: '12:30', category: 'Fitness Box', gender: 'Feminin' },
      { day: 'Joi', start_time: '17:00', end_time: '18:30', category: 'Începători', gender: 'Masculin' },
      { day: 'Joi', start_time: '19:00', end_time: '21:00', category: 'Sparring', gender: 'Masculin' },
      // Vineri
      { day: 'Vineri', start_time: '09:00', end_time: '10:30', category: 'Copii (6-12 ani)', gender: 'Mixt' },
      { day: 'Vineri', start_time: '11:00', end_time: '12:30', category: 'Feminin', gender: 'Feminin' },
      { day: 'Vineri', start_time: '17:00', end_time: '18:30', category: 'Circuit Training', gender: 'Mixt' },
      { day: 'Vineri', start_time: '19:00', end_time: '21:00', category: 'Open Gym', gender: 'Mixt' },
    ];
    const insertMany = database.transaction(() => {
      for (const s of slots) {
        insertSlot.run(s.day, s.start_time, s.end_time, s.category, s.gender);
      }
    });
    insertMany();
  }

  // --- Subscriptions ---
  const subsCount = database.prepare('SELECT COUNT(*) AS cnt FROM subscriptions').get();
  if (subsCount.cnt === 0) {
    const insertSub = database.prepare(
      `INSERT INTO subscriptions (name, monthly_price, yearly_price, benefits, highlighted, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    );
    const subscriptions = [
      {
        name: 'Începător',
        monthly_price: 150,
        yearly_price: 1500,
        benefits: JSON.stringify([
          'Acces la toate antrenamentele de grup',
          'Evaluare fizică inițială',
          'Program flexibil Luni-Vineri',
          'Acces la vestiare și dușuri',
        ]),
        highlighted: 0,
      },
      {
        name: 'Avansați',
        monthly_price: 250,
        yearly_price: 2500,
        benefits: JSON.stringify([
          'Tot ce include abonamentul Începător',
          '2 ședințe individuale pe lună',
          'Program personalizat de nutriție',
          'Sparring supervizat',
          'Acces prioritar la evenimente',
        ]),
        highlighted: 1,
      },
      {
        name: 'Campioni',
        monthly_price: 400,
        yearly_price: 4000,
        benefits: JSON.stringify([
          'Tot ce include abonamentul Avansați',
          'Antrenamente nelimitate 1-la-1',
          'Plan complet de pregătire pentru competiții',
          'Echipament gratuit marca clubului',
          'Acces VIP la toate evenimentele',
          'Asigurare sportivă inclusă',
        ]),
        highlighted: 0,
      },
    ];
    const insertMany = database.transaction(() => {
      for (const s of subscriptions) {
        insertSub.run(s.name, s.monthly_price, s.yearly_price, s.benefits, s.highlighted);
      }
    });
    insertMany();
  }

  // --- Products — no seed data (admin adds products later) ---

  // --- Orders — no seed data ---

  // --- Messages — no seed data ---

  // --- Achievements ---
  const achCount = database.prepare('SELECT COUNT(*) AS cnt FROM achievements').get();
  if (achCount.cnt === 0) {
    const insertAch = database.prepare(
      `INSERT INTO achievements (key, value, label) VALUES (?, ?, ?)`
    );
    const achievements = [
      { key: 'championships', value: 47, label: 'Campionate' },
      { key: 'matches_won', value: 312, label: 'Meciuri Câștigate' },
      { key: 'active_members', value: 850, label: 'Membri Activi' },
      { key: 'years_experience', value: 28, label: 'Ani de Experiență' },
    ];
    const insertMany = database.transaction(() => {
      for (const a of achievements) {
        insertAch.run(a.key, a.value, a.label);
      }
    });
    insertMany();
  }

  // --- SEO ---
  const seoCount = database.prepare('SELECT COUNT(*) AS cnt FROM seo').get();
  if (seoCount.cnt === 0) {
    const insertSeo = database.prepare(
      `INSERT INTO seo (page, title, description, keywords, og_image) VALUES (?, ?, ?, ?, ?)`
    );
    const seoDefaults = [
      {
        page: 'home',
        title: 'Boxing Champions — Cel mai bun club de box din România',
        description: 'Boxing Champions: tradiție, disciplină și excelență din 1998. Antrenamente de box profesionist pentru toate vârstele.',
        keywords: 'box, club box, antrenamente box, București, box profesionist, sală box',
        og_image: 'images/og-home.jpg',
      },
      {
        page: 'about',
        title: 'Despre noi — Boxing Champions',
        description: 'Află povestea Boxing Champions, un club de box fondat în 1998, dedicat excelenței și disciplinei.',
        keywords: 'despre club box, istorie box, tradiție box, București',
        og_image: 'images/og-about.jpg',
      },
      {
        page: 'coaches',
        title: 'Antrenori — Boxing Champions',
        description: 'Cei mai buni antrenori de box din România. Experți în box profesionist, feminin și pentru copii.',
        keywords: 'antrenori box, coach box, instructor box, București',
        og_image: 'images/og-coaches.jpg',
      },
      {
        page: 'schedule',
        title: 'Orar — Boxing Champions',
        description: 'Vezi orarul complet al antrenamentelor de box. Program flexibil Luni-Vineri pentru toate categoriile.',
        keywords: 'orar box, program antrenamente, clase box, București',
        og_image: 'images/og-schedule.jpg',
      },
      {
        page: 'subscriptions',
        title: 'Abonamente — Boxing Champions',
        description: 'Alege abonamentul potrivit pentru tine. Prețuri accesibile pentru începători, avansați și campioni.',
        keywords: 'abonamente box, prețuri box, membership box, București',
        og_image: 'images/og-subscriptions.jpg',
      },
      {
        page: 'events',
        title: 'Evenimente — Boxing Champions',
        description: 'Participă la cele mai tari evenimente de box: gale, sparring night și competiții pentru tineri.',
        keywords: 'evenimente box, gale box, competiții box, sparring, București',
        og_image: 'images/og-events.jpg',
      },
      {
        page: 'shop',
        title: 'Magazin — Boxing Champions',
        description: 'Descoperă echipamentul oficial Boxing Champions. Produse premium pentru performanță maximă.',
        keywords: 'magazin box, echipament box, mănuși box, haine box',
        og_image: 'images/og-shop.jpg',
      },
      {
        page: 'contact',
        title: 'Contact — Boxing Champions',
        description: 'Contactează-ne pentru orice întrebare. Suntem aici să te ajutăm să devii campion.',
        keywords: 'contact box, adresă sală box, telefon box, București',
        og_image: 'images/og-contact.jpg',
      },
    ];
    const insertMany = database.transaction(() => {
      for (const s of seoDefaults) {
        insertSeo.run(s.page, s.title, s.description, s.keywords, s.og_image);
      }
    });
    insertMany();
  }
}

// ---------------------------------------------------------------------------
// Initialise: create schema + seed on first run
// ---------------------------------------------------------------------------
function init() {
  const database = getDb();
  createSchema(database);
  seedData(database);
  return database;
}

// ---------------------------------------------------------------------------
// === SETTINGS QUERIES ===
// ---------------------------------------------------------------------------

function getAllSettings() {
  const rows = getDb().prepare('SELECT * FROM settings ORDER BY key').all();
  const obj = {};
  for (const row of rows) {
    obj[row.key] = row.value;
  }
  return obj;
}

function getSetting(key) {
  return getDb().prepare('SELECT * FROM settings WHERE key = ?').get(key) || null;
}

function upsertSetting(key, value) {
  const stmt = getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  return stmt.run(key, value);
}

function updateSettingsBatch(settingsObj) {
  const stmt = getDb().prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const tx = getDb().transaction(() => {
    for (const [key, value] of Object.entries(settingsObj)) {
      stmt.run(key, String(value));
    }
  });
  tx();
  return getAllSettings();
}

// ---------------------------------------------------------------------------
// === COACHES QUERIES ===
// ---------------------------------------------------------------------------

function getAllCoaches() {
  return getDb().prepare('SELECT * FROM coaches ORDER BY id ASC').all();
}

function getActiveCoaches() {
  return getDb().prepare('SELECT * FROM coaches WHERE active = 1 ORDER BY id ASC').all();
}

function getCoachById(id) {
  return getDb().prepare('SELECT * FROM coaches WHERE id = ?').get(id) || null;
}

function createCoach({ name, specialization, certifications, photo, quote, active }) {
  const stmt = getDb().prepare(
    `INSERT INTO coaches (name, specialization, certifications, photo, quote, active)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    name || '',
    specialization || '',
    certifications || '',
    photo || '',
    quote || '',
    active !== undefined ? (active ? 1 : 0) : 1
  );
  return getCoachById(result.lastInsertRowid);
}

function updateCoach(id, { name, specialization, certifications, photo, quote, active }) {
  const existing = getCoachById(id);
  if (!existing) return null;

  const stmt = getDb().prepare(
    `UPDATE coaches SET
       name = ?, specialization = ?, certifications = ?, photo = ?, quote = ?,
       active = ?, updated_at = datetime('now')
     WHERE id = ?`
  );
  stmt.run(
    name ?? existing.name,
    specialization ?? existing.specialization,
    certifications ?? existing.certifications,
    photo ?? existing.photo,
    quote ?? existing.quote,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  );
  return getCoachById(id);
}

function deleteCoach(id) {
  return getDb().prepare('DELETE FROM coaches WHERE id = ?').run(id);
}

function toggleCoachActive(id) {
  const existing = getCoachById(id);
  if (!existing) return null;
  const newActive = existing.active ? 0 : 1;
  getDb().prepare(
    `UPDATE coaches SET active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newActive, id);
  return getCoachById(id);
}

// ---------------------------------------------------------------------------
// === EVENTS QUERIES ===
// ---------------------------------------------------------------------------

function getAllEvents() {
  const events = getDb().prepare(
    'SELECT * FROM events ORDER BY event_date DESC'
  ).all();
  // Attach photos to each event
  for (const event of events) {
    event.photos = getDb().prepare(
      'SELECT * FROM event_photos WHERE event_id = ? ORDER BY sort_order ASC'
    ).all(event.id);
  }
  return events;
}

function getActiveEvents() {
  const events = getDb().prepare(
    'SELECT * FROM events WHERE active = 1 ORDER BY event_date DESC'
  ).all();
  // Attach photos to each event
  for (const event of events) {
    event.photos = getDb().prepare(
      'SELECT * FROM event_photos WHERE event_id = ? ORDER BY sort_order ASC'
    ).all(event.id);
  }
  return events;
}

function getEventById(id) {
  const event = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!event) return null;
  event.photos = getDb().prepare(
    'SELECT * FROM event_photos WHERE event_id = ? ORDER BY sort_order ASC'
  ).all(event.id);
  return event;
}

function createEvent({ title, event_date, location, description, active }) {
  const stmt = getDb().prepare(
    `INSERT INTO events (title, event_date, location, description, active)
     VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    title || '',
    event_date || '',
    location || '',
    description || '',
    active !== undefined ? (active ? 1 : 0) : 1
  );
  return getEventById(result.lastInsertRowid);
}

function updateEvent(id, { title, event_date, location, description, active }) {
  const existing = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return null;

  const stmt = getDb().prepare(
    `UPDATE events SET
       title = ?, event_date = ?, location = ?, description = ?,
       active = ?, updated_at = datetime('now')
     WHERE id = ?`
  );
  stmt.run(
    title ?? existing.title,
    event_date ?? existing.event_date,
    location ?? existing.location,
    description ?? existing.description,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  );
  return getEventById(id);
}

function deleteEvent(id) {
  // event_photos cascade delete via FK
  return getDb().prepare('DELETE FROM events WHERE id = ?').run(id);
}

function toggleEventActive(id) {
  const existing = getDb().prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!existing) return null;
  const newActive = existing.active ? 0 : 1;
  getDb().prepare(
    `UPDATE events SET active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newActive, id);
  return getEventById(id);
}

// --- Event Photos ---

function addEventPhoto(eventId, { url, caption, sort_order }) {
  const stmt = getDb().prepare(
    `INSERT INTO event_photos (event_id, url, caption, sort_order) VALUES (?, ?, ?, ?)`
  );
  return stmt.run(eventId, url || '', caption || '', sort_order || 0);
}

function updateEventPhoto(photoId, { url, caption, sort_order }) {
  const existing = getDb().prepare('SELECT * FROM event_photos WHERE id = ?').get(photoId);
  if (!existing) return null;
  getDb().prepare(
    `UPDATE event_photos SET url = ?, caption = ?, sort_order = ? WHERE id = ?`
  ).run(
    url ?? existing.url,
    caption ?? existing.caption,
    sort_order ?? existing.sort_order,
    photoId
  );
  return getDb().prepare('SELECT * FROM event_photos WHERE id = ?').get(photoId);
}

function deleteEventPhoto(photoId) {
  return getDb().prepare('DELETE FROM event_photos WHERE id = ?').run(photoId);
}

function getEventPhotos(eventId) {
  return getDb().prepare(
    'SELECT * FROM event_photos WHERE event_id = ? ORDER BY sort_order ASC'
  ).all(eventId);
}

// ---------------------------------------------------------------------------
// === SCHEDULE QUERIES ===
// ---------------------------------------------------------------------------

function getAllSchedule() {
  const dayOrder = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
  const rows = getDb().prepare('SELECT * FROM schedule ORDER BY id ASC').all();
  rows.sort((a, b) => {
    const da = dayOrder.indexOf(a.day);
    const db2 = dayOrder.indexOf(b.day);
    if (da !== db2) return da - db2;
    return a.start_time.localeCompare(b.start_time);
  });
  return rows;
}

function getActiveSchedule() {
  const all = getAllSchedule();
  return all.filter((s) => s.active === 1);
}

function getScheduleById(id) {
  return getDb().prepare('SELECT * FROM schedule WHERE id = ?').get(id) || null;
}

function createSchedule({ day, start_time, end_time, category, gender, active }) {
  const stmt = getDb().prepare(
    `INSERT INTO schedule (day, start_time, end_time, category, gender, active)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    day || '',
    start_time || '',
    end_time || '',
    category || '',
    gender || 'Mixt',
    active !== undefined ? (active ? 1 : 0) : 1
  );
  return getScheduleById(result.lastInsertRowid);
}

function updateSchedule(id, { day, start_time, end_time, category, gender, active }) {
  const existing = getScheduleById(id);
  if (!existing) return null;

  getDb().prepare(
    `UPDATE schedule SET
       day = ?, start_time = ?, end_time = ?, category = ?, gender = ?,
       active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    day ?? existing.day,
    start_time ?? existing.start_time,
    end_time ?? existing.end_time,
    category ?? existing.category,
    gender ?? existing.gender,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  );
  return getScheduleById(id);
}

function deleteSchedule(id) {
  return getDb().prepare('DELETE FROM schedule WHERE id = ?').run(id);
}

function toggleScheduleActive(id) {
  const existing = getScheduleById(id);
  if (!existing) return null;
  const newActive = existing.active ? 0 : 1;
  getDb().prepare(
    `UPDATE schedule SET active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newActive, id);
  return getScheduleById(id);
}

// ---------------------------------------------------------------------------
// === SUBSCRIPTIONS QUERIES ===
// ---------------------------------------------------------------------------

function getAllSubscriptions() {
  return getDb().prepare('SELECT * FROM subscriptions ORDER BY id ASC').all();
}

function getActiveSubscriptions() {
  return getDb().prepare(
    'SELECT * FROM subscriptions WHERE active = 1 ORDER BY id ASC'
  ).all();
}

function getSubscriptionById(id) {
  return getDb().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) || null;
}

function createSubscription({ name, monthly_price, yearly_price, benefits, highlighted, active }) {
  const stmt = getDb().prepare(
    `INSERT INTO subscriptions (name, monthly_price, yearly_price, benefits, highlighted, active)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    name || '',
    monthly_price ?? 0,
    yearly_price ?? 0,
    typeof benefits === 'string' ? benefits : JSON.stringify(benefits || []),
    highlighted ? 1 : 0,
    active !== undefined ? (active ? 1 : 0) : 1
  );
  return getSubscriptionById(result.lastInsertRowid);
}

function updateSubscription(id, { name, monthly_price, yearly_price, benefits, highlighted, active }) {
  const existing = getSubscriptionById(id);
  if (!existing) return null;

  getDb().prepare(
    `UPDATE subscriptions SET
       name = ?, monthly_price = ?, yearly_price = ?, benefits = ?, highlighted = ?,
       active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    monthly_price ?? existing.monthly_price,
    yearly_price ?? existing.yearly_price,
    typeof benefits === 'string' ? benefits : JSON.stringify(benefits ?? JSON.parse(existing.benefits || '[]')),
    highlighted !== undefined ? (highlighted ? 1 : 0) : existing.highlighted,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  );
  return getSubscriptionById(id);
}

function deleteSubscription(id) {
  return getDb().prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
}

function toggleSubscriptionActive(id) {
  const existing = getSubscriptionById(id);
  if (!existing) return null;
  const newActive = existing.active ? 0 : 1;
  getDb().prepare(
    `UPDATE subscriptions SET active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newActive, id);
  return getSubscriptionById(id);
}

// ---------------------------------------------------------------------------
// === PRODUCTS QUERIES ===
// ---------------------------------------------------------------------------

function getAllProducts() {
  return getDb().prepare('SELECT * FROM products ORDER BY id DESC').all();
}

function getActiveProducts() {
  return getDb().prepare(
    'SELECT * FROM products WHERE active = 1 AND stock > 0 ORDER BY id DESC'
  ).all();
}

function getProductsByCategory(category) {
  return getDb().prepare(
    'SELECT * FROM products WHERE active = 1 AND stock > 0 AND category = ? ORDER BY id DESC'
  ).all(category);
}

function getProductById(id) {
  return getDb().prepare('SELECT * FROM products WHERE id = ?').get(id) || null;
}

function createProduct({
  name, description, price, old_price, discount_label,
  contextual_label, category, image, stock, active,
}) {
  const stmt = getDb().prepare(
    `INSERT INTO products
       (name, description, price, old_price, discount_label, contextual_label, category, image, stock, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    name || '',
    description || '',
    price ?? 0,
    old_price ?? null,
    discount_label || '',
    contextual_label || '',
    category || '',
    image || '',
    stock ?? 0,
    active !== undefined ? (active ? 1 : 0) : 1
  );
  return getProductById(result.lastInsertRowid);
}

function updateProduct(id, {
  name, description, price, old_price, discount_label,
  contextual_label, category, image, stock, active,
}) {
  const existing = getProductById(id);
  if (!existing) return null;

  getDb().prepare(
    `UPDATE products SET
       name = ?, description = ?, price = ?, old_price = ?, discount_label = ?,
       contextual_label = ?, category = ?, image = ?, stock = ?,
       active = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    price ?? existing.price,
    old_price !== undefined ? old_price : existing.old_price,
    discount_label ?? existing.discount_label,
    contextual_label ?? existing.contextual_label,
    category ?? existing.category,
    image ?? existing.image,
    stock ?? existing.stock,
    active !== undefined ? (active ? 1 : 0) : existing.active,
    id
  );
  return getProductById(id);
}

function deleteProduct(id) {
  return getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
}

function toggleProductActive(id) {
  const existing = getProductById(id);
  if (!existing) return null;
  const newActive = existing.active ? 0 : 1;
  getDb().prepare(
    `UPDATE products SET active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newActive, id);
  return getProductById(id);
}

// ---------------------------------------------------------------------------
// === ORDERS QUERIES ===
// ---------------------------------------------------------------------------

function getAllOrders() {
  return getDb().prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
}

function getOrderById(id) {
  return getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id) || null;
}

function createOrder({ customer_name, customer_email, customer_phone, items, total, stripe_session_id }) {
  const stmt = getDb().prepare(
    `INSERT INTO orders (customer_name, customer_email, customer_phone, items, total, stripe_session_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  );
  const result = stmt.run(
    customer_name || '',
    customer_email || '',
    customer_phone || '',
    typeof items === 'string' ? items : JSON.stringify(items || []),
    total ?? 0,
    stripe_session_id || ''
  );
  return getOrderById(result.lastInsertRowid);
}

function updateOrderStatus(id, status) {
  const existing = getOrderById(id);
  if (!existing) return null;
  getDb().prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
  return getOrderById(id);
}

function deleteOrder(id) {
  return getDb().prepare('DELETE FROM orders WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// === MESSAGES QUERIES ===
// ---------------------------------------------------------------------------

function getAllMessages() {
  return getDb().prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
}

function getUnreadMessages() {
  return getDb().prepare(
    'SELECT * FROM messages WHERE is_read = 0 ORDER BY created_at DESC'
  ).all();
}

function getMessageById(id) {
  return getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;
}

function createMessage({ name, email, phone, subject, message }) {
  const stmt = getDb().prepare(
    `INSERT INTO messages (name, email, phone, subject, message)
     VALUES (?, ?, ?, ?, ?)`
  );
  return stmt.run(
    name || '',
    email || '',
    phone || '',
    subject || '',
    message || ''
  );
}

function markMessageRead(id) {
  return getDb().prepare(
    `UPDATE messages SET is_read = 1 WHERE id = ?`
  ).run(id);
}

function deleteMessage(id) {
  return getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// === ACHIEVEMENTS QUERIES ===
// ---------------------------------------------------------------------------

function getAllAchievements() {
  return getDb().prepare('SELECT * FROM achievements ORDER BY id ASC').all();
}

function getAchievement(key) {
  return getDb().prepare('SELECT * FROM achievements WHERE key = ?').get(key) || null;
}

function upsertAchievement(key, value, label) {
  const stmt = getDb().prepare(
    `INSERT INTO achievements (key, value, label, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, label = excluded.label, updated_at = excluded.updated_at`
  );
  return stmt.run(key, value, label || '');
}

// ---------------------------------------------------------------------------
// === SEO QUERIES ===
// ---------------------------------------------------------------------------

function getAllSeo() {
  return getDb().prepare('SELECT * FROM seo ORDER BY page ASC').all();
}

function getSeoByPage(page) {
  return getDb().prepare('SELECT * FROM seo WHERE page = ?').get(page) || null;
}

function upsertSeo(page, { title, description, keywords, og_image }) {
  const stmt = getDb().prepare(
    `INSERT INTO seo (page, title, description, keywords, og_image, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(page) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       keywords = excluded.keywords,
       og_image = excluded.og_image,
       updated_at = excluded.updated_at`
  );
  return stmt.run(page, title || '', description || '', keywords || '', og_image || '');
}

function updateSeoBatch(seoArray) {
  const stmt = getDb().prepare(
    `INSERT INTO seo (page, title, description, keywords, og_image, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(page) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       keywords = excluded.keywords,
       og_image = excluded.og_image,
       updated_at = excluded.updated_at`
  );
  const tx = getDb().transaction(() => {
    for (const s of seoArray) {
      stmt.run(s.page, s.title || '', s.description || '', s.keywords || '', s.og_image || '');
    }
  });
  tx();
  return getAllSeo();
}

// ---------------------------------------------------------------------------
// === ADMIN AUTH QUERIES ===
// ---------------------------------------------------------------------------

function getAdminByEmail(email) {
  const stmt = getDb().prepare('SELECT * FROM admins WHERE email = ?');
  try {
    return stmt.get(email) || null;
  } catch {
    // admins table may not exist yet
    return null;
  }
}

function createAdminsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedDefaultAdmin(database) {
  const bcrypt = require('bcrypt');
  const count = database.prepare('SELECT COUNT(*) AS cnt FROM admins').get();
  if (count.cnt === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@boxingchampions.ro';
    const password = process.env.ADMIN_PASSWORD || 'admin2026';
    const hash = bcrypt.hashSync(password, 12);
    database.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run(email, hash);
  }
}

// ---------------------------------------------------------------------------
// === INITIALIZATION (called once at module load) ===
// ---------------------------------------------------------------------------
const database = init();

// Also ensure admins table and default admin exist
createAdminsTable(database);
seedDefaultAdmin(database);

// ---------------------------------------------------------------------------
// === PUBLIC API ===
// ---------------------------------------------------------------------------

module.exports = {
  // DB instance (for direct access if needed)
  getDb,

  // Settings
  getAllSettings,
  getSetting,
  upsertSetting,
  updateSettingsBatch,

  // Coaches
  getAllCoaches,
  getActiveCoaches,
  getCoachById,
  createCoach,
  updateCoach,
  deleteCoach,
  toggleCoachActive,

  // Events
  getAllEvents,
  getActiveEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  toggleEventActive,

  // Event Photos
  addEventPhoto,
  updateEventPhoto,
  deleteEventPhoto,
  getEventPhotos,

  // Schedule
  getAllSchedule,
  getActiveSchedule,
  getScheduleById,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  toggleScheduleActive,

  // Subscriptions
  getAllSubscriptions,
  getActiveSubscriptions,
  getSubscriptionById,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  toggleSubscriptionActive,

  // Products
  getAllProducts,
  getActiveProducts,
  getProductsByCategory,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductActive,

  // Orders
  getAllOrders,
  getOrderById,
  createOrder,
  updateOrderStatus,
  deleteOrder,

  // Messages
  getAllMessages,
  getUnreadMessages,
  getMessageById,
  createMessage,
  markMessageRead,
  deleteMessage,

  // Achievements
  getAllAchievements,
  getAchievement,
  upsertAchievement,

  // SEO
  getAllSeo,
  getSeoByPage,
  upsertSeo,
  updateSeoBatch,

  // Admin
  getAdminByEmail,
};