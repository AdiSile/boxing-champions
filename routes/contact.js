// ---------------------------------------------------------------------------
// routes/contact.js
// Mesaje de contact: GET (admin) și POST (public) /api/contact
//
// GET    /api/contact       – admin, listare cu paginare, sortare, căutare
// GET    /api/contact/:id   – admin, detalii mesaj
// POST   /api/contact       – public, trimitere mesaj nou
// PUT    /api/contact/:id   – admin, marchează citit / răspuns
// DELETE /api/contact/:id   – admin, ștergere mesaj
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  contactMessageSchema,
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
  'id', 'name', 'email', 'subject', 'is_read', 'created_at', 'replied_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['name', 'email', 'subject', 'message'];

// ---------------------------------------------------------------------------
// Schema pentru actualizare mesaj (marcare citit / răspuns)
// ---------------------------------------------------------------------------

const contactUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    is_read: { type: 'boolean' },
  },
};

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
    throw new Error('[contact] JWT_SECRET nu este definit în variabilele de mediu.');
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
 * Parsează câmpurile unui rând de mesaj.
 * Asigură tipuri corecte pentru booleene.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
function parseMessageRow(row) {
  if (!row) return null;

  return {
    ...row,
    is_read: Boolean(row.is_read),
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, is_read }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_read
  if (filters.is_read !== undefined) {
    conditions.push('cm.is_read = ?');
    params.push(filters.is_read ? 1 : 0);
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `cm.${field} LIKE ?`);
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
 * Implicit: sortează după created_at DESC (cele mai noi primele).
 *
 * @param {string} sort - Parametrul de sortare (ex: "created_at" sau "-name")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY cm.created_at DESC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY cm.created_at DESC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY cm.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/contact
// Admin only – listează mesajele de contact cu paginare, sortare și căutare.
// Query params:
//   ?page=1&limit=20&sort=-created_at&search=john&is_read=false
// ---------------------------------------------------------------------------

router.get(
  '/api/contact',
  validate(paginationSchema),
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
      // 3. Extragere parametri din query-ul sanitizat
      // ------------------------------------------------------------------
      const db = getDb();

      const page = req.query.page || 1;
      const limit = req.query.limit || 20;
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const isReadParam = req.query.is_read;

      // Construim filtrele
      const filters = {};

      if (isReadParam !== undefined) {
        filters.is_read = isReadParam === 'true' || isReadParam === true;
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `SELECT COUNT(*) as total FROM contact_messages cm ${whereClause}`;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT cm.*
        FROM contact_messages cm
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const messages = rows.map(parseMessageRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: messages,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[contact] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/contact/:id
// Admin only – returnează detaliile unui mesaj după ID.
// ---------------------------------------------------------------------------

router.get(
  '/api/contact/:id',
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
      // 3. Căutare mesaj
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const row = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Message not found.',
          code: 'NOT_FOUND',
        });
      }

      const message = parseMessageRow(row);

      return res.json({ data: message });
    } catch (err) {
      console.error('[contact] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/contact
// Public – creează un nou mesaj de contact.
// Nu necesită autentificare.
// ---------------------------------------------------------------------------

router.post(
  '/api/contact',
  validate(contactMessageSchema),
  (req, res) => {
    try {
      const db = getDb();

      // Extragere date din body-ul validat
      const { name, email, subject, message } = req.body;

      // Inserare mesaj
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO contact_messages (name, email, subject, message, is_read, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(
        name,
        email,
        subject || null,
        message,
        now,
      );

      // Returnează mesajul creat
      const created = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(result.lastInsertRowid);
      const createdMessage = parseMessageRow(created);

      return res.status(201).json({
        message: 'Message sent successfully.',
        data: createdMessage,
      });
    } catch (err) {
      console.error('[contact] POST error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/contact/:id
// Admin only – marchează un mesaj ca citit/necitit.
// Body: { is_read: true/false }
// ---------------------------------------------------------------------------

router.put(
  '/api/contact/:id',
  validate(contactUpdateSchema),
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
      // 3. Verificare existență mesaj
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Message not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];

      // Câmp is_read
      if (req.body.is_read !== undefined) {
        updates.is_read = req.body.is_read ? 1 : 0;
        setClauses.push('is_read = ?');

        // Setează replied_at automat când se marchează ca citit
        if (req.body.is_read && !existing.is_read) {
          const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
          updates.replied_at = now;
          setClauses.push('replied_at = ?');
        }
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează mesajul neschimbat
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const message = parseMessageRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: message,
        });
      }

      // ------------------------------------------------------------------
      // 6. Actualizare
      // ------------------------------------------------------------------
      const setValues = Object.values(updates);
      const sql = `UPDATE contact_messages SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, id];

      db.prepare(sql).run(...params);

      // ------------------------------------------------------------------
      // 7. Returnează mesajul actualizat
      // ------------------------------------------------------------------
      const updated = db.prepare('SELECT * FROM contact_messages WHERE id = ?').get(id);
      const message = parseMessageRow(updated);

      return res.json({
        message: 'Message updated successfully.',
        data: message,
      });
    } catch (err) {
      console.error('[contact] PUT error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/contact/:id
// Admin only – șterge un mesaj după ID.
// ---------------------------------------------------------------------------

router.delete(
  '/api/contact/:id',
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

      const existing = db.prepare('SELECT id, name, email, subject FROM contact_messages WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Message not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Ștergere
      // ------------------------------------------------------------------
      db.prepare('DELETE FROM contact_messages WHERE id = ?').run(id);

      return res.json({
        message: 'Message deleted successfully.',
        deleted: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          subject: existing.subject,
        },
      });
    } catch (err) {
      console.error('[contact] DELETE error:', err.message);

      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

module.exports = router;