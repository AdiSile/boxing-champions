// ---------------------------------------------------------------------------
// routes/contact.js
// Mesaje de contact: GET (admin) și POST (public) /api/contact
//
// GET    /api/contact       – admin, listare cu paginare, sortare, căutare
// GET    /api/contact/:id   – admin, detalii mesaj
// POST   /api/contact       – public, trimitere mesaj nou
// PUT    /api/contact/:id   – admin, marchează citit / răspuns
// DELETE /api/contact/:id   – admin, ștergere mesaj
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  validate,
  contactMessageSchema,
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

const ALLOWED_SORT_FIELDS = ['id', 'name', 'email', 'subject', 'is_read', 'created_at', 'replied_at'];
const SEARCH_FIELDS = ['name', 'email', 'subject', 'message'];

const contactUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: { is_read: { type: 'boolean' } },
};

function parseMessageRow(row) {
  if (!row) return null;
  return { ...row, is_read: Boolean(row.is_read) };
}

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.is_read !== undefined) { conditions.push('cm.is_read = ?'); params.push(filters.is_read ? 1 : 0); }
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `cm.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) params.push(searchTerm);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY cm.created_at DESC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY cm.created_at DESC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY cm.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/contact
// Middleware: authenticate → authorize('admin')
// ---------------------------------------------------------------------------

router.get('/api/contact', authenticate, authorize('admin'), validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const page = req.query.page || 1;
    const limit = req.query.limit || 20;
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const isReadParam = req.query.is_read;
    const filters = {};
    if (isReadParam !== undefined) filters.is_read = isReadParam === 'true' || isReadParam === true;
    if (search) filters.search = search;
    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM contact_messages cm ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const offset = (page - 1) * limit;
    const dataSql = `SELECT cm.* FROM contact_messages cm ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);
    const messages = rows.map(parseMessageRow);
    return res.json({
      data: messages,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[contact] GET list error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contact/:id
// Middleware: authenticate → authorize('admin')
// ---------------------------------------------------------------------------

router.get('/api/contact/:id', authenticate, authorize('admin'), validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Message not found.', code: 'NOT_FOUND' });
    const message = parseMessageRow(row);
    return res.json({ data: message });
  } catch (err) {
    console.error('[contact] GET single error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/contact
// Public – nu necesită autentificare
// ---------------------------------------------------------------------------

router.post('/api/contact', validate(contactMessageSchema), (req, res) => {
  try {
    const db = getDb();
    const { name, email, subject, message } = req.body;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const result = db.prepare(`
      INSERT INTO contact_messages (name, email, subject, message, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).run(name, email, subject || null, message, now);
    const created = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(result.lastInsertRowid);
    const createdMessage = parseMessageRow(created);
    return res.status(201).json({ message: 'Message sent successfully.', data: createdMessage });
  } catch (err) {
    console.error('[contact] POST error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/contact/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put('/api/contact/:id', authenticate, csrfProtection, authorize('admin'), validate(contactUpdateSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Message not found.', code: 'NOT_FOUND' });
    const updates = {};
    const setClauses = [];
    if (req.body.is_read !== undefined) {
      updates.is_read = req.body.is_read ? 1 : 0;
      setClauses.push('is_read = ?');
      if (req.body.is_read && !existing.is_read) {
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        updates.replied_at = now;
        setClauses.push('replied_at = ?');
      }
    }
    if (setClauses.length === 0) {
      const message = parseMessageRow(existing);
      return res.json({ message: 'No changes provided.', data: message });
    }
    const setValues = Object.values(updates);
    const sql = `UPDATE contact_messages SET ${setClauses.join(', ')} WHERE id = ?`;
    const params = [...setValues, id];
    db.prepare(sql).run(...params);
    const updated = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);
    const message = parseMessageRow(updated);
    return res.json({ message: 'Message updated successfully.', data: message });
  } catch (err) {
    console.error('[contact] PUT error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/contact/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.delete('/api/contact/:id', authenticate, csrfProtection, authorize('admin'), validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare('SELECT id, name, email, subject FROM contact_messages WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Message not found.', code: 'NOT_FOUND' });
    db.prepare('DELETE FROM contact_messages WHERE id = ?').run(id);
    return res.json({
      message: 'Message deleted successfully.',
      deleted: { id: existing.id, name: existing.name, email: existing.email, subject: existing.subject },
    });
  } catch (err) {
    console.error('[contact] DELETE error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;