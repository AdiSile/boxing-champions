// ---------------------------------------------------------------------------
// routes/plans.js
// CRUD complet /api/plans
//
// GET    /api/plans       – public, listare cu paginare, sortare, căutare
// GET    /api/plans/:id   – public, detalii plan
// POST   /api/plans       – admin, creare plan
// PUT    /api/plans/:id   – admin, actualizare plan
// DELETE /api/plans/:id   – admin, ștergere plan
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  planCreateSchema,
  planUpdateSchema,
  paginationSchema,
  paramsIdSchema,
  combineSchemas,
} = require('../middleware/validate');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare (sincronizat cu routes/auth.js) */
const TOKEN_COOKIE = 'token';

/** Algoritmul JWT */
const JWT_ALGORITHM = 'HS256';

/** Câmpurile permise pentru sortare */
const ALLOWED_SORT_FIELDS = [
  'id', 'name', 'price', 'duration_days', 'is_popular',
  'sort_order', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['name', 'description'];

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
    throw new Error('[plans] JWT_SECRET nu este definit în variabilele de mediu.');
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
function parsePlanRow(row) {
  if (!row) return null;

  return {
    ...row,
    features: safeJsonParse(row.features, []),
    price: row.price !== null ? Number(row.price) : 0,
    duration_days: row.duration_days !== null ? Number(row.duration_days) : 30,
    is_popular: Boolean(row.is_popular),
    is_active: Boolean(row.is_active),
    sort_order: row.sort_order !== null ? Number(row.sort_order) : 0,
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
 * @param {object} filters - { search, is_active, is_popular, min_price, max_price }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_active (implicit: doar planuri active pentru public)
  if (filters.is_active !== undefined) {
    conditions.push('p.is_active = ?');
    params.push(filters.is_active ? 1 : 0);
  }

  // Filtru is_popular
  if (filters.is_popular !== undefined) {
    conditions.push('p.is_popular = ?');
    params.push(filters.is_popular ? 1 : 0);
  }

  // Filtru preț minim
  if (filters.min_price !== undefined && filters.min_price !== null) {
    conditions.push('p.price >= ?');
    params.push(Number(filters.min_price));
  }

  // Filtru preț maxim
  if (filters.max_price !== undefined && filters.max_price !== null) {
    conditions.push('p.price <= ?');
    params.push(Number(filters.max_price));
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `p.${field} LIKE ?`);
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
 * Implicit: sortează după sort_order ASC, apoi price ASC.
 *
 * @param {string} sort - Parametrul de sortare (ex: "price" sau "-created_at")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY p.sort_order ASC, p.price ASC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY p.sort_order ASC, p.price ASC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY p.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/plans
// Public – listează planurile cu paginare, sortare și căutare.
// Query params:
//   ?page=1&limit=12&sort=price&search=premium&is_active=true&is_popular=true&min_price=0&max_price=100
// ---------------------------------------------------------------------------

router.get(
  '/api/plans',
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
      const isPopularParam = req.query.is_popular;
      const minPriceParam = req.query.min_price;
      const maxPriceParam = req.query.max_price;

      // Construim filtrele
      const filters = {};

      // is_active: dacă nu e specificat explicit, returnăm doar planurile active
      if (isActiveParam !== undefined) {
        filters.is_active = isActiveParam === 'true' || isActiveParam === true;
      } else {
        filters.is_active = true;
      }

      // is_popular
      if (isPopularParam !== undefined) {
        filters.is_popular = isPopularParam === 'true' || isPopularParam === true;
      }

      // Filtre preț
      if (minPriceParam !== undefined && minPriceParam !== '') {
        filters.min_price = Number(minPriceParam);
      }
      if (maxPriceParam !== undefined && maxPriceParam !== '') {
        filters.max_price = Number(maxPriceParam);
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `SELECT COUNT(*) as total FROM plans p ${whereClause}`;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT p.*
        FROM plans p
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const plans = rows.map(parsePlanRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: plans,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[plans] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/plans/:id
// Public – returnează detaliile unui plan după ID.
// ---------------------------------------------------------------------------

router.get(
  '/api/plans/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;

      const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Plan not found.',
          code: 'NOT_FOUND',
        });
      }

      const plan = parsePlanRow(row);

      return res.json({ data: plan });
    } catch (err) {
      console.error('[plans] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/plans
// Admin only – creează un nou plan.
// ---------------------------------------------------------------------------

router.post(
  '/api/plans',
  validate(planCreateSchema),
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
        description,
        price,
        duration_days,
        features,
        is_popular,
        is_active,
        sort_order,
      } = req.body;

      // ------------------------------------------------------------------
      // 4. Verificare slug unic
      // ------------------------------------------------------------------
      const db = getDb();
      const existing = db.prepare('SELECT id FROM plans WHERE slug = ?').get(slug);
      if (existing) {
        return res.status(409).json({
          error: 'A plan with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      // ------------------------------------------------------------------
      // 5. Inserare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO plans (name, slug, description, price, duration_days, features, is_popular, is_active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        slug,
        description || null,
        price,
        duration_days !== undefined ? duration_days : 30,
        safeJsonStringify(features) || '[]',
        is_popular !== undefined ? (is_popular ? 1 : 0) : 0,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        sort_order !== undefined ? sort_order : 0,
        now,
        now,
      );

      // ------------------------------------------------------------------
      // 6. Returnează planul creat
      // ------------------------------------------------------------------
      const created = db.prepare('SELECT * FROM plans WHERE id = ?').get(result.lastInsertRowid);
      const plan = parsePlanRow(created);

      return res.status(201).json({
        message: 'Plan created successfully.',
        data: plan,
      });
    } catch (err) {
      console.error('[plans] POST error:', err.message);

      // Eroare de constrângere SQLite (ex: slug duplicat prins de UNIQUE)
      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A plan with this slug already exists.',
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
// PUT /api/plans/:id
// Admin only – actualizează un plan existent.
// Acceptă un obiect parțial – doar câmpurile trimise se modifică.
// ---------------------------------------------------------------------------

router.put(
  '/api/plans/:id',
  validate(planUpdateSchema),
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
      // 3. Verificare existență plan
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Plan not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic (doar câmpurile trimise)
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];

      // Câmpuri text
      const textFields = ['name', 'slug', 'description'];

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
      if (req.body.duration_days !== undefined) {
        updates.duration_days = req.body.duration_days;
        setClauses.push('duration_days = ?');
      }
      if (req.body.sort_order !== undefined) {
        updates.sort_order = req.body.sort_order;
        setClauses.push('sort_order = ?');
      }

      // Câmp JSON – features
      if (req.body.features !== undefined) {
        updates.features = safeJsonStringify(req.body.features) || '[]';
        setClauses.push('features = ?');
      }

      // Câmpuri booleene
      if (req.body.is_popular !== undefined) {
        updates.is_popular = req.body.is_popular ? 1 : 0;
        setClauses.push('is_popular = ?');
      }
      if (req.body.is_active !== undefined) {
        updates.is_active = req.body.is_active ? 1 : 0;
        setClauses.push('is_active = ?');
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează planul neschimbat
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const plan = parsePlanRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: plan,
        });
      }

      // ------------------------------------------------------------------
      // 6. Verificare slug unic (dacă se modifică slug-ul)
      // ------------------------------------------------------------------
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare(
          'SELECT id FROM plans WHERE slug = ? AND id != ?'
        ).get(updates.slug, id);

        if (slugConflict) {
          return res.status(409).json({
            error: 'A plan with this slug already exists.',
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
      const sql = `UPDATE plans SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];

      db.prepare(sql).run(...params);

      // ------------------------------------------------------------------
      // 8. Returnează planul actualizat
      // ------------------------------------------------------------------
      const updated = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
      const plan = parsePlanRow(updated);

      return res.json({
        message: 'Plan updated successfully.',
        data: plan,
      });
    } catch (err) {
      console.error('[plans] PUT error:', err.message);

      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A plan with this slug already exists.',
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
// DELETE /api/plans/:id
// Admin only – șterge un plan după ID.
// ---------------------------------------------------------------------------

router.delete(
  '/api/plans/:id',
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

      const existing = db.prepare('SELECT id, name FROM plans WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Plan not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Ștergere
      // ------------------------------------------------------------------
      db.prepare('DELETE FROM plans WHERE id = ?').run(id);

      return res.json({
        message: 'Plan deleted successfully.',
        deleted: {
          id: existing.id,
          name: existing.name,
        },
      });
    } catch (err) {
      console.error('[plans] DELETE error:', err.message);

      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

module.exports = router;