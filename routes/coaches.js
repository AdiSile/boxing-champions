// ---------------------------------------------------------------------------
// routes/coaches.js
// CRUD complet /api/coaches
//
// GET    /api/coaches       – public, listare cu paginare, sortare, căutare
// GET    /api/coaches/:id   – public, detalii antrenor
// POST   /api/coaches       – admin, creare antrenor
// PUT    /api/coaches/:id   – admin, actualizare antrenor
// DELETE /api/coaches/:id   – admin, ștergere antrenor
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  coachCreateSchema,
  coachUpdateSchema,
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
  'id', 'name', 'title', 'sort_order', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['name', 'title', 'bio', 'email'];

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
    throw new Error('[coaches] JWT_SECRET nu este definit în variabilele de mediu.');
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
 * Parsează câmpurile JSON stocate ca TEXT în baza de date.
 * Returnează array-uri și obiecte reale.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
function parseCoachRow(row) {
  if (!row) return null;

  return {
    ...row,
    specialties: safeJsonParse(row.specialties, []),
    certifications: safeJsonParse(row.certifications, []),
    social_links: safeJsonParse(row.social_links, {}),
    is_active: Boolean(row.is_active),
  };
}

/**
 * Parsează JSON în siguranță, returnând fallback la eroare.
 *
 * @param {string} value
 * @param {*} fallback
 * @returns {*}
 */
function safeJsonParse(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch {
    return fallback;
  }
}

/**
 * Serializează un array/obiect în JSON pentru stocare.
 *
 * @param {*} value
 * @returns {string}
 */
function safeJsonStringify(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    // Verificăm dacă este deja JSON valid
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, is_active, ... }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_active (implicit: doar antrenori activi pentru public)
  if (filters.is_active !== undefined) {
    conditions.push('c.is_active = ?');
    params.push(filters.is_active ? 1 : 0);
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `c.${field} LIKE ?`);
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
 *
 * @param {string} sort - Parametrul de sortare (ex: "name" sau "-created_at")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY c.sort_order ASC, c.name ASC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY c.sort_order ASC, c.name ASC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY c.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/coaches
// Public – listează antrenorii cu paginare, sortare și căutare.
// Query params:
//   ?page=1&limit=12&sort=name&search=john&is_active=true
// ---------------------------------------------------------------------------

router.get(
  '/api/coaches',
  validate(paginationSchema),
  (req, res) => {
    try {
      const db = getDb();

      // Extragere parametri din query-ul sanitizat
      const page = req.query.page || 1;
      const limit = req.query.limit || 12;
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const isActiveParam = req.query.is_active;

      // Construim filtrele
      const filters = {};

      // is_active: dacă nu e specificat explicit, returnăm doar antrenorii activi
      if (isActiveParam !== undefined) {
        filters.is_active = isActiveParam === 'true' || isActiveParam === true;
      } else {
        filters.is_active = true;
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `SELECT COUNT(*) as total FROM coaches c ${whereClause}`;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT c.*
        FROM coaches c
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const coaches = rows.map(parseCoachRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: coaches,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[coaches] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/coaches/:id
// Public – returnează detaliile unui antrenor după ID.
// ---------------------------------------------------------------------------

router.get(
  '/api/coaches/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;

      const row = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Coach not found.',
          code: 'NOT_FOUND',
        });
      }

      const coach = parseCoachRow(row);

      return res.json({ data: coach });
    } catch (err) {
      console.error('[coaches] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/coaches
// Admin only – creează un nou antrenor.
// ---------------------------------------------------------------------------

router.post(
  '/api/coaches',
  validate(coachCreateSchema),
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
        name,
        slug,
        title,
        bio,
        photo,
        specialties,
        certifications,
        email,
        phone,
        social_links,
        is_active,
        sort_order,
      } = req.body;

      // ------------------------------------------------------------------
      // 4. Verificare slug unic
      // ------------------------------------------------------------------
      const db = getDb();
      const existing = db.prepare('SELECT id FROM coaches WHERE slug = ?').get(slug);
      if (existing) {
        return res.status(409).json({
          error: 'A coach with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      // ------------------------------------------------------------------
      // 5. Inserare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO coaches (name, slug, title, bio, photo, specialties, certifications, email, phone, social_links, is_active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        slug,
        title || null,
        bio || null,
        photo || null,
        safeJsonStringify(specialties) || '[]',
        safeJsonStringify(certifications) || '[]',
        email || null,
        phone || null,
        safeJsonStringify(social_links) || '{}',
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        sort_order !== undefined ? sort_order : 0,
        now,
        now,
      );

      // ------------------------------------------------------------------
      // 6. Returnează antrenorul creat
      // ------------------------------------------------------------------
      const created = db.prepare('SELECT * FROM coaches WHERE id = ?').get(result.lastInsertRowid);
      const coach = parseCoachRow(created);

      return res.status(201).json({
        message: 'Coach created successfully.',
        data: coach,
      });
    } catch (err) {
      console.error('[coaches] POST error:', err.message);

      // Eroare de constrângere SQLite (ex: slug duplicat prins de UNIQUE)
      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A coach with this slug already exists.',
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
// PUT /api/coaches/:id
// Admin only – actualizează un antrenor existent.
// Acceptă un obiect parțial – doar câmpurile trimise se modifică.
// ---------------------------------------------------------------------------

router.put(
  '/api/coaches/:id',
  validate(coachUpdateSchema),
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
      // 3. Verificare existență antrenor
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Coach not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic (doar câmpurile trimise)
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];

      // Câmpuri directe
      const directFields = [
        'name', 'slug', 'title', 'bio', 'photo', 'email', 'phone',
      ];

      for (const field of directFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
          setClauses.push(`${field} = ?`);
        }
      }

      // Câmpuri JSON
      if (req.body.specialties !== undefined) {
        updates.specialties = safeJsonStringify(req.body.specialties) || '[]';
        setClauses.push('specialties = ?');
      }
      if (req.body.certifications !== undefined) {
        updates.certifications = safeJsonStringify(req.body.certifications) || '[]';
        setClauses.push('certifications = ?');
      }
      if (req.body.social_links !== undefined) {
        updates.social_links = safeJsonStringify(req.body.social_links) || '{}';
        setClauses.push('social_links = ?');
      }

      // Câmpuri numerice / booleene
      if (req.body.is_active !== undefined) {
        updates.is_active = req.body.is_active ? 1 : 0;
        setClauses.push('is_active = ?');
      }
      if (req.body.sort_order !== undefined) {
        updates.sort_order = req.body.sort_order;
        setClauses.push('sort_order = ?');
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează antrenorul neschimbat
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const coach = parseCoachRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: coach,
        });
      }

      // ------------------------------------------------------------------
      // 6. Verificare slug unic (dacă se modifică slug-ul)
      // ------------------------------------------------------------------
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare(
          'SELECT id FROM coaches WHERE slug = ? AND id != ?'
        ).get(updates.slug, id);

        if (slugConflict) {
          return res.status(409).json({
            error: 'A coach with this slug already exists.',
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
      const sql = `UPDATE coaches SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];

      db.prepare(sql).run(...params);

      // ------------------------------------------------------------------
      // 8. Returnează antrenorul actualizat
      // ------------------------------------------------------------------
      const updated = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
      const coach = parseCoachRow(updated);

      return res.json({
        message: 'Coach updated successfully.',
        data: coach,
      });
    } catch (err) {
      console.error('[coaches] PUT error:', err.message);

      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A coach with this slug already exists.',
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
// DELETE /api/coaches/:id
// Admin only – șterge un antrenor după ID.
// ---------------------------------------------------------------------------

router.delete(
  '/api/coaches/:id',
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

      const existing = db.prepare('SELECT id, name FROM coaches WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Coach not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Ștergere
      // ------------------------------------------------------------------
      db.prepare('DELETE FROM coaches WHERE id = ?').run(id);

      return res.json({
        message: 'Coach deleted successfully.',
        deleted: {
          id: existing.id,
          name: existing.name,
        },
      });
    } catch (err) {
      console.error('[coaches] DELETE error:', err.message);

      // Eroare FK – antrenorul este referențiat în schedule
      if (err.message && err.message.includes('FOREIGN KEY')) {
        return res.status(409).json({
          error: 'Cannot delete this coach because they are referenced in the schedule. Remove the schedule entries first.',
          code: 'FK_CONFLICT',
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