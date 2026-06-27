// ---------------------------------------------------------------------------
// config/db.js — Boxing Champions
// Conexiune SQLite (better-sqlite3) cu validare, graceful shutdown,
// WAL mode, foreign keys și seed automat.
// ---------------------------------------------------------------------------

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

let db;

// ---------------------------------------------------------------------------
// Conexiune lazy + validare
// ---------------------------------------------------------------------------

function getDb() {
  if (!db) {
    try {
      db = new Database(DB_PATH);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -20000');

      const result = db.prepare('SELECT 1 AS ok').get();
      if (!result || result.ok !== 1) {
        throw new Error('Database connection validation failed.');
      }

      console.log('[DB] Conexiune la baza de date stabilită și validată.');
    } catch (err) {
      console.error('[DB] Eroare critică la conectarea la baza de date:', err.message);
      throw err;
    }
  }
  return db;
}

function checkDatabaseConnection() {
  if (!db) {
    try {
      getDb();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  try {
    const result = db.prepare('SELECT 1 AS ok').get();
    return { ok: result && result.ok === 1 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function closeDatabase() {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[DB] Conexiunea la baza de date a fost închisă.');
    } catch (err) {
      console.error('[DB] Eroare la închiderea bazei de date:', err.message);
    } finally {
      db = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Inițializare tabele + seed
// ---------------------------------------------------------------------------

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

  // ── Seed: coaches ─────────────────────────────────────────
  const seedCoaches = db.prepare(`
    INSERT OR IGNORE INTO coaches (name, slug, title, bio, specialties, certifications, photo, email, phone, social_links, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const coachesData = [
    ['Andrei Popescu', 'andrei-popescu', 'Antrenor Principal', 'Fost campion național la box, cu peste 15 ani de experiență în pregătirea sportivilor de performanță. Specializat în tehnici avansate de box și condiționare fizică.', '["Box olimpic","Tehnici avansate","Condiționare fizică"]', '["Federația Română de Box - Certificare Nivel 3","AIBA Coach Certificate"]', null, 'andrei@boxingchampions.ro', '+40722123456', '{"instagram":"https://instagram.com/andrei.popescu","facebook":"https://facebook.com/andrei.popescu"}', 0],
    ['Maria Ionescu', 'maria-ionescu', 'Antrenor Kickboxing', 'Multiplă campioană națională la kickboxing, Maria aduce o abordare dinamică și motivațională în antrenamentele sale. Specializată în tehnici de kickboxing și autoapărare.', '["Kickboxing","Autoapărare","Fitness funcțional"]', '["Federația Română de Kickboxing - Certificare Nivel 2","WAKO Instructor"]', null, 'maria@boxingchampions.ro', '+40723123456', '{"instagram":"https://instagram.com/maria.ionescu"}', 1],
    ['Dumitru Vasilescu', 'dumitru-vasilescu', 'Antrenor Juniori', 'Antrenor dedicat dezvoltării tinerelor talente. Peste 10 ani de experiență în lucrul cu copiii și juniorii, promovând disciplina și respectul prin sport.', '["Box juniori","Educație fizică","Dezvoltare mentală"]', '["Federația Română de Box - Certificare Nivel 2","Licență Educație Fizică și Sport"]', null, 'dumitru@boxingchampions.ro', '+40724123456', '{"facebook":"https://facebook.com/dumitru.vasilescu"}', 2],
    ['Elena Dumitrescu', 'elena-dumitrescu', 'Antrenor Fitness & Nutriție', 'Specialistă în fitness funcțional și nutriție sportivă. Combină antrenamentele de forță cu planuri nutriționale personalizate pentru rezultate optime.', '["Fitness funcțional","Nutriție sportivă","Yoga pentru sportivi"]', '["ISSA Certified Personal Trainer","Certificare Nutriție Sportivă"]', null, 'elena@boxingchampions.ro', '+40725123456', '{"instagram":"https://instagram.com/elena.dumitrescu","facebook":"https://facebook.com/elena.dumitrescu"}', 3],
  ];

  for (const coach of coachesData) {
    seedCoaches.run(coach[0], coach[1], coach[2], coach[3], coach[4], coach[5], coach[6], coach[7], coach[8], coach[9], coach[10]);
  }

  // ── Seed: plans (abonamente) ──────────────────────────────
  const seedPlans = db.prepare(`
    INSERT OR IGNORE INTO plans (name, slug, description, price, duration_days, features, is_popular, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const plansData = [
    ['Începător', 'incepator', 'Perfect pentru cei care vor să descopere boxul. Acces la toate clasele de grup pentru începători.', 150, 30, '["Acces clase grup începători","Program flexibil","Evaluare fizică inițială","1 ședință gratuită cu antrenorul"]', 0, 0],
    ['Avansat', 'avansat', 'Pentru sportivii cu experiență care vor să își depășească limitele. Include sparring și competiții.', 300, 30, '["Acces nelimitat la toate clasele","Sesiuni de sparring","Pregătire pentru competiții","Plan nutrițional personalizat","Acces sală forță"]', 1, 1],
    ['Premium', 'premium', 'Experiența completă Boxing Champions. Antrenamente personalizate, consiliere nutrițională și acces prioritar.', 500, 30, '["Tot din planul Avansat","Antrenamente 1-la-1 (4/lună)","Program personalizat","Consiliere nutrițională săptămânală","Acces prioritar evenimente","Kit echipament gratuit"]', 0, 2],
    ['Competiție', 'competitie', 'Pregătire intensivă pentru sportivii care participă la competiții naționale și internaționale.', 450, 30, '["Antrenamente zilnice","Sparring intensiv","Pregătire tactică","Suport medical","Însoțire la competiții","Analiză video"]', 0, 3],
  ];

  for (const plan of plansData) {
    seedPlans.run(plan[0], plan[1], plan[2], plan[3], plan[4], plan[5], plan[6], plan[7]);
  }

  // ── Seed: products ────────────────────────────────────────
  const seedProducts = db.prepare(`
    INSERT OR IGNORE INTO products (name, slug, description, price, category, image, stock, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const productsData = [
    ['Mănuși Box Profesionale', 'manusi-box-profesionale', 'Mănuși de box din piele premium, ideale pentru antrenamente și sparring. Cusături ranforsate și căptușeală absorbantă.', 249.99, 'gloves', null, 50],
    ['Cască Box Protecție', 'casca-box-protectie', 'Cască de protecție pentru sparring, cu vizibilitate maximă și ventilație superioară. Ajustare personalizată.', 189.99, 'headgear', null, 30],
    ['Bandaje Box Semi-Elastice', 'bandaje-box-semi-elastice', 'Bandaje semi-elastice de 4.5m, protecție optimă pentru încheieturi și pumni. Material respirabil.', 39.99, 'protection', null, 100],
    ['Pantaloni Scurți Box', 'pantaloni-scurti-box', 'Pantaloni scurți din satin premium, talie elastică și șiret. Design clasic de box.', 129.99, 'apparel', null, 40],
    ['Tricou Tehnic Boxing Champions', 'tricou-tehnic-boxing-champions', 'Tricou din material tehnic, respirabil și cu uscare rapidă. Logo Boxing Champions pe piept.', 89.99, 'apparel', null, 60],
    ['Sac Box 45kg', 'sac-box-45kg', 'Sac de box profesional, umplutură textilă compactă, piele sintetică rezistentă. Lanțuri și carabiniere incluse.', 599.99, 'equipment', null, 10],
    ['Coardă Sărit Viteză', 'coarda-sarit-viteza', 'Coardă de sărit profesională cu rulmenți de viteză și cablu din oțel ajustabil.', 79.99, 'accessories', null, 75],
    ['Proteză Dentală Box', 'proteza-dentara-box', 'Proteză dentală dublă, modelare la cald. Protecție maximă pentru maxilar și dinți.', 59.99, 'protection', null, 80],
  ];

  for (const product of productsData) {
    seedProducts.run(product[0], product[1], product[2], product[3], product[4], product[5], product[6]);
  }

  // ── Seed: events ──────────────────────────────────────────
  const seedEvents = db.prepare(`
    INSERT OR IGNORE INTO events (title, slug, description, type, location, start_date, end_date, time, price, capacity, image, is_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const eventsData = [
    ['Campionatul Intern al Clubului', 'campionatul-intern-2025', 'Competiție internă anuală pentru toți membrii clubului. Categorii de vârstă și greutate. Premii pentru câștigători.', 'competition', 'Sala Boxing Champions, București', '2025-06-15', '2025-06-16', '10:00', 0, 100, null],
    ['Workshop Tehnică Avansată cu Andrei Popescu', 'workshop-tehnica-avansata-2025', 'Workshop intensiv de o zi concentrat pe tehnici avansate de box: footwork, combinații de pumni și contraatac.', 'workshop', 'Sala Boxing Champions, București', '2025-05-20', '2025-05-20', '09:00', 150, 20, null],
    ['Seminar Autoapărare pentru Femei', 'seminar-autoaparare-femei-2025', 'Seminar gratuit de autoapărare dedicat femeilor. Tehnici de bază, prevenție și încredere în sine.', 'seminar', 'Sala Boxing Champions, București', '2025-07-10', '2025-07-10', '17:00', 0, 30, null],
    ['Box Camp de Vară Juniori', 'box-camp-vara-juniori-2025', 'Tabără de vară de o săptămână pentru juniori (8-16 ani). Box, jocuri, educație sportivă și distracție.', 'camp', 'Complexul Sportiv Snagov', '2025-08-01', '2025-08-07', '08:00', 800, 40, null],
  ];

  for (const event of eventsData) {
    seedEvents.run(event[0], event[1], event[2], event[3], event[4], event[5], event[6], event[7], event[8], event[9], event[10]);
  }

  // ── Seed: schedule ────────────────────────────────────────
  const existingSchedule = db.prepare('SELECT COUNT(*) as cnt FROM schedule').get();
  if (!existingSchedule || existingSchedule.cnt === 0) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const seedSchedule = db.prepare(`
      INSERT INTO schedule (coach_id, title, day_of_week, start_time, end_time, location, max_participants, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    // Luni
    seedSchedule.run(1, 'Box Tehnic - Începători', 1, '09:00', '10:30', 'Sala Principală', 20, now, now);
    seedSchedule.run(2, 'Kickboxing - Grupă Mixtă', 1, '11:00', '12:30', 'Sala 2', 20, now, now);
    seedSchedule.run(1, 'Box Tehnic - Avansați', 1, '17:00', '18:30', 'Sala Principală', 15, now, now);
    seedSchedule.run(3, 'Box Juniori (8-12 ani)', 1, '16:00', '17:00', 'Sala 2', 15, now, now);
    // Marți
    seedSchedule.run(4, 'Fitness Funcțional', 2, '07:00', '08:00', 'Sala Fitness', 25, now, now);
    seedSchedule.run(2, 'Kickboxing - Avansați', 2, '09:00', '10:30', 'Sala 2', 15, now, now);
    seedSchedule.run(1, 'Sparring Controlat', 2, '17:00', '18:30', 'Sala Principală', 12, now, now);
    seedSchedule.run(3, 'Box Juniori (13-16 ani)', 2, '16:00', '17:00', 'Sala 2', 15, now, now);
    // Miercuri
    seedSchedule.run(1, 'Box Tehnic - Începători', 3, '09:00', '10:30', 'Sala Principală', 20, now, now);
    seedSchedule.run(4, 'Yoga pentru Sportivi', 3, '11:00', '12:00', 'Sala Fitness', 20, now, now);
    seedSchedule.run(2, 'Kickboxing - Grupă Mixtă', 3, '17:00', '18:30', 'Sala 2', 20, now, now);
    seedSchedule.run(1, 'Antrenament Individual (programare)', 3, '18:30', '20:00', 'Sala Principală', 5, now, now);
    // Joi
    seedSchedule.run(4, 'Fitness Funcțional', 4, '07:00', '08:00', 'Sala Fitness', 25, now, now);
    seedSchedule.run(2, 'Autoapărare', 4, '09:00', '10:30', 'Sala 2', 20, now, now);
    seedSchedule.run(1, 'Box Tehnic - Avansați', 4, '17:00', '18:30', 'Sala Principală', 15, now, now);
    seedSchedule.run(3, 'Box Juniori (8-12 ani)', 4, '16:00', '17:00', 'Sala 2', 15, now, now);
    // Vineri
    seedSchedule.run(1, 'Box Tehnic - Toate Nivelele', 5, '09:00', '10:30', 'Sala Principală', 25, now, now);
    seedSchedule.run(4, 'Fitness & Nutriție', 5, '11:00', '12:00', 'Sala Fitness', 20, now, now);
    seedSchedule.run(2, 'Kickboxing - Sparring', 5, '17:00', '18:30', 'Sala 2', 12, now, now);
    seedSchedule.run(3, 'Box Juniori (13-16 ani)', 5, '16:00', '17:00', 'Sala 2', 15, now, now);
    // Sâmbătă
    seedSchedule.run(1, 'Antrenament Weekend - Box', 6, '09:00', '11:00', 'Sala Principală', 25, now, now);
    seedSchedule.run(4, 'Fitness Funcțional Weekend', 6, '11:00', '12:00', 'Sala Fitness', 20, now, now);

    console.log('[DB] Schedule seeded: 22 weekly classes.');
  }

  // ── Seed: promotions ──────────────────────────────────────
  const seedPromotions = db.prepare(`
    INSERT OR IGNORE INTO promotions (code, description, discount_type, discount_value, applies_to, start_date, end_date, usage_limit, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const promotionsData = [
    ['WELCOME20', '20% reducere pentru noii membri la primul abonament', 'percentage', 20, 'plans', '2025-01-01', '2025-12-31', 100],
    ['BOXER10', '10% reducere la orice produs din shop', 'percentage', 10, 'products', '2025-01-01', '2025-12-31', 200],
    ['CAMP2025', '100 RON reducere la tabăra de vară pentru juniori', 'fixed', 100, 'events', '2025-05-01', '2025-08-01', 30],
  ];

  for (const promo of promotionsData) {
    seedPromotions.run(promo[0], promo[1], promo[2], promo[3], promo[4], promo[5], promo[6], promo[7], promo[8]);
  }

  // ── Seed: contact_messages ────────────────────────────────
  const existingMessages = db.prepare('SELECT COUNT(*) as cnt FROM contact_messages').get();
  if (!existingMessages || existingMessages.cnt === 0) {
    const seedMessages = db.prepare(`
      INSERT INTO contact_messages (name, email, subject, message, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);

    const messagesData = [
      ['Ion Vasilescu', 'ion.vasilescu@email.ro', 'Înscriere copil', 'Bună ziua, aș dori informații despre înscrierea fiului meu de 10 ani la clasele de box pentru juniori. Care este programul și ce echipament are nevoie? Mulțumesc.', '2025-04-01 10:30:00'],
      ['Ana Petrescu', 'ana.petrescu@email.ro', 'Abonament Corporate', 'Suntem o companie cu 50 de angajați și suntem interesați de un abonament corporate. Ce oferte aveți disponibile?', '2025-04-05 14:15:00'],
      ['Mihai Stancu', 'mihai.stancu@email.ro', 'Competiție', 'Salut, sunt sportiv legitimat și aș vrea să particip la campionatul intern din iunie. Care sunt condițiile de înscriere?', '2025-04-10 09:45:00'],
    ];

    for (const msg of messagesData) {
      seedMessages.run(msg[0], msg[1], msg[2], msg[3], msg[4]);
    }
  }

  console.log('[DB] Database initialized successfully.');
  return db;
}

module.exports = { getDb, initializeDatabase, closeDatabase, checkDatabaseConnection };