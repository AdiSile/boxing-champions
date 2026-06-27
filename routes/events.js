// ---------------------------------------------------------------------------
// routes/events.js
// CRUD complet /api/events
//
// GET    /api/events       – public, listare cu paginare, sortare, căutare
// GET    /api/events/:id   – public, detalii eveniment
// POST   /api/events       – admin, creare eveniment
// PUT    /api/events/:id   – admin, actualizare eveniment
// DELETE /api/events/:id   – admin, ștergere eveniment
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  validate,
  eventCreateSchema,
  eventUpdateSchema,
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

const ALLOWED_SORT_FIELDS = [
  'id', 'title', 'type', 'start_date', 'end_date', 'price', 'capacity',
  'created_at', 'updated_at',
];
const SEARCH_FIELDS = ['title', 'description', 'location', 'type'];

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

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

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.is_published !== undefined) {
    conditions.push('e.is_published = ?');
    params.push(filters.is_published ? 1 : 0);
  }
  if (filters.type && typeof filters.type === 'string' && filters.type.trim()) {
    conditions.push('e.type = ?');
    params.push(filters.type.trim().toLowerCase());
  }
  if (filters.upcoming === true) conditions.push("e.start_date >= date('now')");
  if (filters.past === true) conditions.push("e.start_date < date('now')");
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `e.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) params.push(searchTerm);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY e.start_date ASC, e.title ASC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY e.start_date ASC, e.title ASC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY e.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/events
// ---------------------------------------------------------------------------

router.get('/api/events', validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const page = req.query.page || 1;
    const limit = req.query.limit || 12;
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const isPublishedParam = req.query.is_published;
    const typeParam = req.query.type || null;
    const upcomingParam = req.query.upcoming;
    const pastParam = req.query.past;
    const filters = {};
    if (isPublishedParam !== undefined) filters.is_published = isPublishedParam === 'true' || isPublishedParam === true;
    else filters.is_published = true;
    if (typeParam) filters.type = typeParam;
    if (upcomingParam === 'true' || upcomingParam === true) filters.upcoming = true;
    if (pastParam === 'true' || pastParam === true) filters.past = true;
    if (search) filters.search = search;
    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM events e ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const offset = (page - 1) * limit;
    const dataSql = `SELECT e.* FROM events e ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);
    const events = rows.map(parseEventRow);
    return res.json({
      data: events,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[events] GET list error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/:id
// ---------------------------------------------------------------------------

router.get('/api/events/:id', validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Event not found.', code: 'NOT_FOUND' });
    const event = parseEventRow(row);
    return res.json({ data: event });
  } catch (err) {
    console.error('[events] GET single error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/events
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.post(
  '/api/events',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(eventCreateSchema),
  (req, res) => {
    try {
      const { title, slug, description, type, location, start_date, end_date, time, price, capacity, image, is_published } = req.body;
      const db = getDb();
      const existing = db.prepare('SELECT id FROM events WHERE slug = ?').get(slug);
      if (existing) return res.status(409).json({ error: 'An event with this slug already exists.', code: 'SLUG_CONFLICT' });
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const result = db.prepare(`
        INSERT INTO events (title, slug, description, type, location, start_date, end_date, time, price, capacity, image, is_published, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title, slug, description || null, type || 'general', location || null,
        start_date, end_date || null, time || null,
        price !== undefined ? price : 0, capacity !== undefined ? capacity : null,
        image || null, is_published !== undefined ? (is_published ? 1 : 0) : 1,
        now, now
      );
      const created = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
      const event = parseEventRow(created);
      return res.status(201).json({ message: 'Event created successfully.', data: event });
    } catch (err) {
      console.error('[events] POST error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'An event with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/events/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put(
  '/api/events/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(eventUpdateSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Event not found.', code: 'NOT_FOUND' });
      const updates = {};
      const setClauses = [];
      const textFields = ['title', 'slug', 'description', 'type', 'location', 'start_date', 'end_date', 'time', 'image'];
      for (const field of textFields) {
        if (req.body[field] !== undefined) { updates[field] = req.body[field]; setClauses.push(`${field} = ?`); }
      }
      if (req.body.price !== undefined) { updates.price = req.body.price; setClauses.push('price = ?'); }
      if (req.body.capacity !== undefined) { updates.capacity = req.body.capacity; setClauses.push('capacity = ?'); }
      if (req.body.is_published !== undefined) { updates.is_published = req.body.is_published ? 1 : 0; setClauses.push('is_published = ?'); }
      if (setClauses.length === 0) {
        const event = parseEventRow(existing);
        return res.json({ message: 'No changes provided.', data: event });
      }
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare('SELECT id FROM events WHERE slug = ? AND id != ?').get(updates.slug, id);
        if (slugConflict) return res.status(409).json({ error: 'An event with this slug already exists.', code: 'SLUG_CONFLICT' });
      }
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');
      const setValues = Object.values(updates);
      const sql = `UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];
      db.prepare(sql).run(...params);
      const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
      const event = parseEventRow(updated);
      return res.json({ message: 'Event updated successfully.', data: event });
    } catch (err) {
      console.error('[events] PUT error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'An event with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/events/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.delete(
  '/api/events/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT id, title FROM events WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Event not found.', code: 'NOT_FOUND' });
      db.prepare('DELETE FROM events WHERE id = ?').run(id);
      return res.json({ message: 'Event deleted successfully.', deleted: { id: existing.id, title: existing.title } });
    } catch (err) {
      console.error('[events] DELETE error:', err.message);
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;