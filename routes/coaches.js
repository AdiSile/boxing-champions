// ---------------------------------------------------------------------------
// routes/coaches.js
// CRUD complet /api/coaches
//
// GET    /api/coaches       – public, listare cu paginare, sortare, căutare
// GET    /api/coaches/:id   – public, detalii antrenor
// POST   /api/coaches       – admin, creare antrenor
// PUT    /api/coaches/:id   – admin, actualizare antrenor
// DELETE /api/coaches/:id   – admin, ștergere antrenor
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  validate,
  coachCreateSchema,
  coachUpdateSchema,
  paginationSchema,
  paramsIdSchema,
  combineSchemas,
} = require('../middleware/validate');
const {
  authenticate,
  authorize,
  csrfProtection,
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Câmpurile permise pentru sortare */
const ALLOWED_SORT_FIELDS = [
  'id', 'name', 'title', 'sort_order', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['name', 'title', 'bio', 'email'];

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

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

function safeJsonParse(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  try { const parsed = JSON.parse(value); return parsed; } catch { return fallback; }
}

function safeJsonStringify(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    try { JSON.parse(value); return value; } catch { return JSON.stringify(value); }
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.is_active !== undefined) {
    conditions.push('c.is_active = ?');
    params.push(filters.is_active ? 1 : 0);
  }
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `c.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) {
      params.push(searchTerm);
    }
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY c.sort_order ASC, c.name ASC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY c.sort_order ASC, c.name ASC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY c.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/coaches
// ---------------------------------------------------------------------------

router.get('/api/coaches', validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const page = req.query.page || 1;
    const limit = req.query.limit || 12;
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const isActiveParam = req.query.is_active;
    const filters = {};
    if (isActiveParam !== undefined) {
      filters.is_active = isActiveParam === 'true' || isActiveParam === true;
    } else {
      filters.is_active = true;
    }
    if (search) filters.search = search;
    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM coaches c ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const offset = (page - 1) * limit;
    const dataSql = `SELECT c.* FROM coaches c ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);
    const coaches = rows.map(parseCoachRow);
    return res.json({
      data: coaches,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[coaches] GET list error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/coaches/:id
// ---------------------------------------------------------------------------

router.get('/api/coaches/:id', validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Coach not found.', code: 'NOT_FOUND' });
    const coach = parseCoachRow(row);
    return res.json({ data: coach });
  } catch (err) {
    console.error('[coaches] GET single error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/coaches
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.post(
  '/api/coaches',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(coachCreateSchema),
  (req, res) => {
    try {
      const { name, slug, title, bio, photo, specialties, certifications, email, phone, social_links, is_active, sort_order } = req.body;
      const db = getDb();
      const existing = db.prepare('SELECT id FROM coaches WHERE slug = ?').get(slug);
      if (existing) return res.status(409).json({ error: 'A coach with this slug already exists.', code: 'SLUG_CONFLICT' });
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const result = db.prepare(`
        INSERT INTO coaches (name, slug, title, bio, photo, specialties, certifications, email, phone, social_links, is_active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name, slug, title || null, bio || null, photo || null,
        safeJsonStringify(specialties) || '[]', safeJsonStringify(certifications) || '[]',
        email || null, phone || null, safeJsonStringify(social_links) || '{}',
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        sort_order !== undefined ? sort_order : 0, now, now
      );
      const created = db.prepare('SELECT * FROM coaches WHERE id = ?').get(result.lastInsertRowid);
      const coach = parseCoachRow(created);
      return res.status(201).json({ message: 'Coach created successfully.', data: coach });
    } catch (err) {
      console.error('[coaches] POST error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'A coach with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/coaches/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put(
  '/api/coaches/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(coachUpdateSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Coach not found.', code: 'NOT_FOUND' });
      const updates = {};
      const setClauses = [];
      const directFields = ['name', 'slug', 'title', 'bio', 'photo', 'email', 'phone'];
      for (const field of directFields) {
        if (req.body[field] !== undefined) { updates[field] = req.body[field]; setClauses.push(`${field} = ?`); }
      }
      if (req.body.specialties !== undefined) { updates.specialties = safeJsonStringify(req.body.specialties) || '[]'; setClauses.push('specialties = ?'); }
      if (req.body.certifications !== undefined) { updates.certifications = safeJsonStringify(req.body.certifications) || '[]'; setClauses.push('certifications = ?'); }
      if (req.body.social_links !== undefined) { updates.social_links = safeJsonStringify(req.body.social_links) || '{}'; setClauses.push('social_links = ?'); }
      if (req.body.is_active !== undefined) { updates.is_active = req.body.is_active ? 1 : 0; setClauses.push('is_active = ?'); }
      if (req.body.sort_order !== undefined) { updates.sort_order = req.body.sort_order; setClauses.push('sort_order = ?'); }
      if (setClauses.length === 0) {
        const coach = parseCoachRow(existing);
        return res.json({ message: 'No changes provided.', data: coach });
      }
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare('SELECT id FROM coaches WHERE slug = ? AND id != ?').get(updates.slug, id);
        if (slugConflict) return res.status(409).json({ error: 'A coach with this slug already exists.', code: 'SLUG_CONFLICT' });
      }
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');
      const setValues = Object.values(updates);
      const sql = `UPDATE coaches SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];
      db.prepare(sql).run(...params);
      const updated = db.prepare('SELECT * FROM coaches WHERE id = ?').get(id);
      const coach = parseCoachRow(updated);
      return res.json({ message: 'Coach updated successfully.', data: coach });
    } catch (err) {
      console.error('[coaches] PUT error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'A coach with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/coaches/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.delete(
  '/api/coaches/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT id, name FROM coaches WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Coach not found.', code: 'NOT_FOUND' });
      db.prepare('DELETE FROM coaches WHERE id = ?').run(id);
      return res.json({ message: 'Coach deleted successfully.', deleted: { id: existing.id, name: existing.name } });
    } catch (err) {
      console.error('[coaches] DELETE error:', err.message);
      if (err.message && err.message.includes('FOREIGN KEY'))
        return res.status(409).json({ error: 'Cannot delete this coach because they are referenced in the schedule. Remove the schedule entries first.', code: 'FK_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;