// ---------------------------------------------------------------------------
// routes/promotions.js
// Gestiune coduri promoționale — CRUD complet
//
// GET    /api/promotions        – listare (cu paginare, sortare, căutare)
// POST   /api/promotions        – creare cod promoțional
// PUT    /api/promotions/:id    – actualizare cod promoțional
// DELETE /api/promotions/:id    – ștergere cod promoțional
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------
const TOKEN_COOKIE = 'token';
const JWT_ALGORITHM = 'HS256';
const ALLOWED_SORT_COLUMNS = ['id', 'code', 'discount_type', 'discount_value', 'applies_to', 'start_date', 'end_date', 'usage_limit', 'is_active', 'created_at'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('[promotions] JWT_SECRET nu este definit.');
  return secret;
}

function verifyRequestToken(req) {
  const token = req.cookies?.[TOKEN_COOKIE];
  if (!token) return null;
  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
    if (!payload || !payload.sub || payload.type !== 'access') return null;
    return payload;
  } catch { return null; }
}

function hasRole(payload, role) {
  return payload !== null && payload.role === role;
}

function parseQueryParams(query) {
  let page = parseInt(query.page, 10);
  if (isNaN(page) || page < 1) page = 1;

  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  let sort = query.sort || '';
  let sortField = 'id';
  let sortDir = 'DESC';

  if (sort) {
    if (sort.startsWith('-')) {
      sortDir = 'DESC';
      sortField = sort.substring(1);
    } else {
      sortDir = 'ASC';
      sortField = sort;
    }
  }

  if (ALLOWED_SORT_COLUMNS.indexOf(sortField) === -1) {
    sortField = 'id';
  }

  let search = query.search || '';
  search = search.trim().substring(0, 100);

  return { page, limit, sortField, sortDir, search };
}

// ---------------------------------------------------------------------------
// GET /api/promotions
// ---------------------------------------------------------------------------

router.get('/api/promotions', (req, res) => {
  try {
    const payload = verifyRequestToken(req);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    }
    if (!hasRole(payload, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions.', code: 'FORBIDDEN' });
    }

    const db = getDb();
    const { page, limit, sortField, sortDir, search } = parseQueryParams(req.query);
    const offset = (page - 1) * limit;

    let whereClause = '';
    const params = [];

    if (search) {
      whereClause = 'WHERE (code LIKE ? OR description LIKE ?)';
      const searchPattern = '%' + search + '%';
      params.push(searchPattern, searchPattern);
    }

    // Filtrul is_active
    if (req.query.is_active !== undefined) {
      const isActiveFilter = req.query.is_active === '1' || req.query.is_active === 'true' ? 1 : 0;
      const prefix = whereClause ? 'AND' : 'WHERE';
      whereClause += ' ' + prefix + ' is_active = ?';
      params.push(isActiveFilter);
    }

    const countSql = 'SELECT COUNT(*) as total FROM promotions ' + whereClause;
    const countRow = db.prepare(countSql).get(...params);
    const total = countRow ? countRow.total : 0;

    const dataSql = 'SELECT * FROM promotions ' + whereClause +
      ' ORDER BY ' + sortField + ' ' + sortDir +
      ' LIMIT ? OFFSET ?';
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);

    return res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    console.error('[promotions] GET error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/promotions
// ---------------------------------------------------------------------------

router.post('/api/promotions', (req, res) => {
  try {
    const payload = verifyRequestToken(req);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    }
    if (!hasRole(payload, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions.', code: 'FORBIDDEN' });
    }

    const { code, description, discount_type, discount_value, applies_to, start_date, end_date, usage_limit, is_active } = req.body || {};

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return res.status(400).json({ error: 'Codul promoției este obligatoriu.', code: 'VALIDATION_ERROR' });
    }

    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length > 50) {
      return res.status(400).json({ error: 'Codul promoției este prea lung.', code: 'VALIDATION_ERROR' });
    }

    const dType = discount_type === 'fixed' ? 'fixed' : 'percentage';
    const dValue = parseFloat(discount_value) || 0;
    if (dType === 'percentage' && (dValue < 0 || dValue > 100)) {
      return res.status(400).json({ error: 'Procentul trebuie să fie între 0 și 100.', code: 'VALIDATION_ERROR' });
    }
    if (dType === 'fixed' && dValue < 0) {
      return res.status(400).json({ error: 'Suma fixă nu poate fi negativă.', code: 'VALIDATION_ERROR' });
    }

    const validAppliesTo = ['all', 'plans', 'products', 'events'];
    const applies = validAppliesTo.indexOf(applies_to) !== -1 ? applies_to : 'all';

    const usageLim = usage_limit ? parseInt(usage_limit, 10) : null;
    if (usageLim !== null && (isNaN(usageLim) || usageLim < 1)) {
      return res.status(400).json({ error: 'Limita de utilizări este invalidă.', code: 'VALIDATION_ERROR' });
    }

    const db = getDb();

    const existing = db.prepare('SELECT id FROM promotions WHERE code = ?').get(trimmedCode);
    if (existing) {
      return res.status(409).json({ error: 'Există deja o promoție cu acest cod.', code: 'DUPLICATE' });
    }

    const info = db.prepare(`
      INSERT INTO promotions (code, description, discount_type, discount_value, applies_to, start_date, end_date, usage_limit, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trimmedCode,
      description || null,
      dType,
      dValue,
      applies,
      start_date || null,
      end_date || null,
      usageLim,
      is_active !== false ? 1 : 0,
    );

    const newPromotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(info.lastInsertRowid);

    return res.status(201).json({
      message: 'Promoție creată cu succes.',
      data: newPromotion,
    });
  } catch (err) {
    console.error('[promotions] POST error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/promotions/:id
// ---------------------------------------------------------------------------

router.put('/api/promotions/:id', (req, res) => {
  try {
    const payload = verifyRequestToken(req);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    }
    if (!hasRole(payload, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions.', code: 'FORBIDDEN' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'ID invalid.', code: 'INVALID_ID' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Promoția nu a fost găsită.', code: 'NOT_FOUND' });
    }

    const body = req.body || {};

    const code = body.code !== undefined ? body.code.trim().toUpperCase() : existing.code;
    if (!code || code.length === 0 || code.length > 50) {
      return res.status(400).json({ error: 'Codul promoției este invalid.', code: 'VALIDATION_ERROR' });
    }

    if (code !== existing.code) {
      const dup = db.prepare('SELECT id FROM promotions WHERE code = ? AND id != ?').get(code, id);
      if (dup) {
        return res.status(409).json({ error: 'Există deja o promoție cu acest cod.', code: 'DUPLICATE' });
      }
    }

    const dType = body.discount_type === 'fixed' ? 'fixed' : (body.discount_type === 'percentage' ? 'percentage' : existing.discount_type);
    const dValue = body.discount_value !== undefined ? parseFloat(body.discount_value) : existing.discount_value;
    if (dType === 'percentage' && (dValue < 0 || dValue > 100)) {
      return res.status(400).json({ error: 'Procentul trebuie să fie între 0 și 100.', code: 'VALIDATION_ERROR' });
    }
    if (dType === 'fixed' && dValue < 0) {
      return res.status(400).json({ error: 'Suma fixă nu poate fi negativă.', code: 'VALIDATION_ERROR' });
    }

    const validAppliesTo = ['all', 'plans', 'products', 'events'];
    const applies = body.applies_to !== undefined ? (validAppliesTo.indexOf(body.applies_to) !== -1 ? body.applies_to : 'all') : existing.applies_to;

    let usageLim = existing.usage_limit;
    if (body.usage_limit !== undefined) {
      if (body.usage_limit === null || body.usage_limit === '') {
        usageLim = null;
      } else {
        const parsed = parseInt(body.usage_limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          return res.status(400).json({ error: 'Limita de utilizări este invalidă.', code: 'VALIDATION_ERROR' });
        }
        usageLim = parsed;
      }
    }

    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

    db.prepare(`
      UPDATE promotions
      SET code = ?, description = ?, discount_type = ?, discount_value = ?, applies_to = ?,
          start_date = ?, end_date = ?, usage_limit = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      code,
      body.description !== undefined ? (body.description || null) : existing.description,
      dType,
      dValue,
      applies,
      body.start_date !== undefined ? (body.start_date || null) : existing.start_date,
      body.end_date !== undefined ? (body.end_date || null) : existing.end_date,
      usageLim,
      isActive,
      id,
    );

    const updated = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);

    return res.json({
      message: 'Promoție actualizată cu succes.',
      data: updated,
    });
  } catch (err) {
    console.error('[promotions] PUT error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/promotions/:id
// ---------------------------------------------------------------------------

router.delete('/api/promotions/:id', (req, res) => {
  try {
    const payload = verifyRequestToken(req);
    if (!payload) {
      return res.status(401).json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' });
    }
    if (!hasRole(payload, 'admin')) {
      return res.status(403).json({ error: 'Insufficient permissions.', code: 'FORBIDDEN' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'ID invalid.', code: 'INVALID_ID' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM promotions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Promoția nu a fost găsită.', code: 'NOT_FOUND' });
    }

    db.prepare('DELETE FROM promotions WHERE id = ?').run(id);

    return res.json({ message: 'Promoție ștearsă cu succes.' });
  } catch (err) {
    console.error('[promotions] DELETE error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;