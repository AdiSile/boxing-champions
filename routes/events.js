// ---------------------------------------------------------------------------
// routes/events.js
// CRUD complet /api/events
//
// GET    /api/events       – public, listare cu paginare, sortare, căutare
// GET    /api/events/:id   – public, detalii eveniment
// POST   /api/events       – admin, creare eveniment
// PUT    /api/events/:id   – admin, actualizare eveniment
// DELETE /api/events/:id   – admin, ștergere eveniment
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  eventCreateSchema,
  eventUpdateSchema,
  paginationSchema,
  paramsIdSchema,
  combineSchemas,
} = require('../middleware/validate');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare (sincronizat cu routes/auth.js) */
const TOKEN_COOKIE = 'access_token';

/** Algoritmul JWT */
const JWT_ALGORITHM = 'HS256';

/** Câmpurile permise pentru sortare */
const ALLOWED_SORT_FIELDS = [
  'id', 'title', 'type', 'start_date', 'end_date', 'price', 'capacity',
  'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['title', 'description', 'location', 'type'];

// ---------------------------------------------------------------------------
// Helpers – Auth
// ---------------------------------------------------------------------------

/**
 * Obține secretul JWT din variabilele de mediu.
 * @returns {string}
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[events] JWT_SECRET nu este definit în variabilele de mediu.');
  }
  return secret;
}

/**
 * Verifică token-ul JWT din cookie și returnează payload-ul decodificat.
 * Returnează null dacă token-ul lipsește, este invalid sau expirat.
 *
 * @param {object} req - Cererea Express
 * @returns {{ sub: number, email: string, role: string }|null}
 */
function verifyRequestToken(req) {
  const token = req.cookies?.[TOKEN_COOKIE];

  if (!token) return null;

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });

    if (!payload || !payload.sub || payload.type !== 'access') {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Verifică dacă payload-ul conține rolul specificat.
 *
 * @param {object|null} payload
 * @param {string} role
 * @returns {boolean}
 */
function hasRole(payload, role) {
  return payload !== null && payload.role === role;
}

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

/**
 * Parsează câmpurile unui rând de eveniment.
 * Asigură tipuri corecte pentru booleene și numere.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
function parseEventRow(row) {
  if (!row) return null;

  return {
    ...row,
    is_published: Boolean(row.is_published),
    price: row.price !== null ? Number(row.price) : 0,
    capacity: row.capacity !== null ? Number(row.capacity) : null,
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, is_published, type, ... }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_published (implicit: doar evenimente publicate pentru public)
  if (filters.is_published !== undefined) {
    conditions.push('e.is_published = ?');
    params.push(filters.is_published ? 1 : 0);
  }

  // Filtru după tipul evenimentului
  if (filters.type && typeof filters.type === 'string' && filters.type.trim()) {
    conditions.push('e.type = ?');
    params.push(filters.type.trim().toLowerCase());
  }

  // Filtru evenimente viitoare (start_date >= today)
  if (filters.upcoming === true) {
    conditions.push('e.start_date >= date(\'now\')');
  }

  // Filtru evenimente trecute
  if (filters.past === true) {
    conditions.push('e.start_date < date(\'now\')');
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `e.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) {
      params.push(searchTerm);
    }
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return { whereClause, params };
}

/**
 * Construiește clauza ORDER BY din parametrul de sortare.
 * Implicit: sortează după start_date ASC (cele mai apropiate primele).
 *
 * @param {string} sort - Parametrul de sortare (ex: "start_date" sau "-price")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY e.start_date ASC, e.title ASC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY e.start_date ASC, e.title ASC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY e.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/events
// Public – listează evenimentele cu paginare, sortare și căutare.
// Query params:
//   ?page=1&limit=12&sort=start_date&search=gala&is_published=true&type=competition&upcoming=true
// ---------------------------------------------------------------------------

router.get(
  '/api/events',
  validate(paginationSchema),
  (req, res) => {
    try {
      const db = getDb();

      // Extragere parametri din query-ul sanitizat
      const page = req.query.page || 1;
      const limit = req.query.limit || 12;
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const isPublishedParam = req.query.is_published;
      const typeParam = req.query.type || null;
      const upcomingParam = req.query.upcoming;
      const pastParam = req.query.past;

      // Construim filtrele
      const filters = {};

      // is_published: dacă nu e specificat explicit, returnăm doar evenimentele publicate
      if (isPublishedParam !== undefined) {
        filters.is_published = isPublishedParam === 'true' || isPublishedParam === true;
      } else {
        filters.is_published = true;
      }

      if (typeParam) {
        filters.type = typeParam;
      }

      if (upcomingParam === 'true' || upcomingParam === true) {
        filters.upcoming = true;
      }

      if (pastParam === 'true' || pastParam === true) {
        filters.past = true;
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `SELECT COUNT(*) as total FROM events e ${whereClause}`;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT e.*
        FROM events e
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const events = rows.map(parseEventRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: events,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[events] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/events/:id
// Public – returnează detaliile unui eveniment după ID.
// ---------------------------------------------------------------------------

router.get(
  '/api/events/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;

      const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Event not found.',
          code: 'NOT_FOUND',
        });
      }

      const event = parseEventRow(row);

      return res.json({ data: event });
    } catch (err) {
      console.error('[events] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/events
// Admin only – creează un nou eveniment.
// ---------------------------------------------------------------------------

router.post(
  '/api/events',
  validate(eventCreateSchema),
  (req, res) => {
    try {
      // ------------------------------------------------------------------
      // 1. Autentificare
      // ------------------------------------------------------------------
      const payload = verifyRequestToken(req);

      if (!payload) {
        return res.status(401).json({
          error: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      // ------------------------------------------------------------------
      // 2. Autorizare – doar admin
      // ------------------------------------------------------------------
      if (!hasRole(payload, 'admin')) {
        return res.status(403).json({
          error: 'Insufficient permissions. Admin access required.',
          code: 'FORBIDDEN',
        });
      }

      // ------------------------------------------------------------------
      // 3. Extragere date din body-ul validat
      // ------------------------------------------------------------------
      const {
        title,
        slug,
        description,
        type,
        location,
        start_date,
        end_date,
        time,
        price,
        capacity,
        image,
        is_published,
      } = req.body;

      // ------------------------------------------------------------------
      // 4. Verificare slug unic
      // ------------------------------------------------------------------
      const db = getDb();
      const existing = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
      if (existing) {
        return res.status(409).json({
          error: 'An event with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      // ------------------------------------------------------------------
      // 5. Inserare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO events (title, slug, description, type, location, start_date, end_date, time, price, capacity, image, is_published, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title,
        slug,
        description || null,
        type || 'general',
        location || null,
        start_date,
        end_date || null,
        time || null,
        price !== undefined ? price : 0,
        capacity !== undefined ? capacity : null,
        image || null,
        is_published !== undefined ? (is_published ? 1 : 0) : 1,
        now,
        now,
      );

      // ------------------------------------------------------------------
      // 6. Returnează evenimentul creat
      // ------------------------------------------------------------------
      const created = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
      const event = parseEventRow(created);

      return res.status(201).json({
        message: 'Event created successfully.',
        data: event,
      });
    } catch (err) {
      console.error('[events] POST error:', err.message);

      // Eroare de constrângere SQLite (ex: slug duplicat prins de UNIQUE)
      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'An event with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/events/:id
// Admin only – actualizează un eveniment existent.
// Acceptă un obiect parțial – doar câmpurile trimise se modifică.
// ---------------------------------------------------------------------------

router.put(
  '/api/events/:id',
  validate(eventUpdateSchema),
  (req, res) => {
    try {
      // ------------------------------------------------------------------
      // 1. Autentificare
      // ------------------------------------------------------------------
      const payload = verifyRequestToken(req);

      if (!payload) {
        return res.status(401).json({
          error: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      // ------------------------------------------------------------------
      // 2. Autorizare – doar admin
      // ------------------------------------------------------------------
      if (!hasRole(payload, 'admin')) {
        return res.status(403).json({
          error: 'Insufficient permissions. Admin access required.',
          code: 'FORBIDDEN',
        });
      }

      // ------------------------------------------------------------------
      // 3. Verificare existență eveniment
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Event not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic (doar câmpurile trimise)
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];

      // Câmpuri text
      const textFields = [
        'title', 'slug', 'description', 'type', 'location',
        'start_date', 'end_date', 'time', 'image',
      ];

      for (const field of textFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
          setClauses.push(`${field} = ?`);
        }
      }

      // Câmpuri numerice
      if (req.body.price !== undefined) {
        updates.price = req.body.price;
        setClauses.push('price = ?');
      }
      if (req.body.capacity !== undefined) {
        updates.capacity = req.body.capacity;
        setClauses.push('capacity = ?');
      }

      // Câmp boolean
      if (req.body.is_published !== undefined) {
        updates.is_published = req.body.is_published ? 1 : 0;
        setClauses.push('is_published = ?');
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează evenimentul neschimbat
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const event = parseEventRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: event,
        });
      }

      // ------------------------------------------------------------------
      // 6. Verificare slug unic (dacă se modifică slug-ul)
      // ------------------------------------------------------------------
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare(
          'SELECT id FROM events WHERE slug = ? AND id != ?'
        ).get(updates.slug, id);

        if (slugConflict) {
          return res.status(409).json({
            error: 'An event with this slug already exists.',
            code: 'SLUG_CONFLICT',
          });
        }
      }

      // ------------------------------------------------------------------
      // 7. Actualizare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');

      const setValues = Object.values(updates);
      const sql = `UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];

      db.prepare(sql).run(...params);

      // ------------------------------------------------------------------
      // 8. Returnează evenimentul actualizat
      // ------------------------------------------------------------------
      const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      const event = parseEventRow(updated);

      return res.json({
        message: 'Event updated successfully.',
        data: event,
      });
    } catch (err) {
      console.error('[events] PUT error:', err.message);

      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'An event with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/events/:id
// Admin only – șterge un eveniment după ID.
// ---------------------------------------------------------------------------

router.delete(
  '/api/events/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      // ------------------------------------------------------------------
      // 1. Autentificare
      // ------------------------------------------------------------------
      const payload = verifyRequestToken(req);

      if (!payload) {
        return res.status(401).json({
          error: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      // ------------------------------------------------------------------
      // 2. Autorizare – doar admin
      // ------------------------------------------------------------------
      if (!hasRole(payload, 'admin')) {
        return res.status(403).json({
          error: 'Insufficient permissions. Admin access required.',
          code: 'FORBIDDEN',
        });
      }

      // ------------------------------------------------------------------
      // 3. Verificare existență
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT id, title FROM events WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Event not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Ștergere
      // ------------------------------------------------------------------
      db.prepare('DELETE FROM events WHERE id = ?').run(id);

      return res.json({
        message: 'Event deleted successfully.',
        deleted: {
          id: existing.id,
          title: existing.title,
        },
      });
    } catch (err) {
      console.error('[events] DELETE error:', err.message);

      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

module.exports = router;