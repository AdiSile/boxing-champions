// ---------------------------------------------------------------------------
// routes/schedule.js
// CRUD complet /api/schedule
//
// GET    /api/schedule       – public, listare program cu opțiuni de filtrare
// POST   /api/schedule       – admin, creare sesiune individuală
// PUT    /api/schedule       – admin, înlocuire completă program (batch)
// PUT    /api/schedule/:id   – admin, actualizare sesiune individuală
// DELETE /api/schedule/:id   – admin, ștergere sesiune individuală
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  validate,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  scheduleBatchUpdateSchema,
  paginationSchema,
  paramsIdSchema,
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

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];
const ALLOWED_SORT_FIELDS = [
  'id', 'day_of_week', 'start_time', 'end_time', 'title', 'location',
  'max_participants', 'is_active', 'created_at', 'updated_at',
];
const SEARCH_FIELDS = ['s.title', 's.location', 'c.name'];

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

function parseScheduleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    coach_id: row.coach_id !== null ? Number(row.coach_id) : null,
    title: row.title,
    day_of_week: Number(row.day_of_week),
    day_name: DAY_NAMES[Number(row.day_of_week)] || 'Unknown',
    start_time: row.start_time,
    end_time: row.end_time,
    location: row.location || null,
    max_participants: row.max_participants !== null ? Number(row.max_participants) : null,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
    coach_name: row.coach_name || null,
    coach_title: row.coach_title || null,
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.is_active !== undefined) { conditions.push('s.is_active = ?'); params.push(filters.is_active ? 1 : 0); }
  if (filters.day_of_week !== undefined && filters.day_of_week !== null) { conditions.push('s.day_of_week = ?'); params.push(Number(filters.day_of_week)); }
  if (filters.coach_id !== undefined && filters.coach_id !== null) { conditions.push('s.coach_id = ?'); params.push(Number(filters.coach_id)); }
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) params.push(searchTerm);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY s.day_of_week ASC, s.start_time ASC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY s.day_of_week ASC, s.start_time ASC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY s.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/schedule
// ---------------------------------------------------------------------------

router.get('/api/schedule', validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const isActiveParam = req.query.is_active;
    const dayOfWeekParam = req.query.day_of_week;
    const coachIdParam = req.query.coach_id;
    const filters = {};
    if (isActiveParam !== undefined) filters.is_active = isActiveParam === 'true' || isActiveParam === true;
    else filters.is_active = true;
    if (dayOfWeekParam !== undefined && dayOfWeekParam !== '') {
      const day = parseInt(dayOfWeekParam, 10);
      if (!Number.isNaN(day) && day >= 0 && day <= 6) filters.day_of_week = day;
    }
    if (coachIdParam !== undefined && coachIdParam !== '') {
      const coachId = parseInt(coachIdParam, 10);
      if (!Number.isNaN(coachId) && coachId > 0) filters.coach_id = coachId;
    }
    if (search) filters.search = search;
    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM schedule s LEFT JOIN coaches c ON s.coach_id = c.id ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const dataSql = `
      SELECT s.id, s.coach_id, s.title, s.day_of_week, s.start_time, s.end_time,
             s.location, s.max_participants, s.is_active, s.created_at, s.updated_at,
             c.name AS coach_name, c.title AS coach_title
      FROM schedule s LEFT JOIN coaches c ON s.coach_id = c.id
      ${whereClause} ${orderClause}
    `;
    const rows = db.prepare(dataSql).all(...params);
    const schedule = rows.map(parseScheduleRow);
    const groupedByDay = {};
    for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
      groupedByDay[dayIndex] = schedule.filter(entry => entry.day_of_week === dayIndex);
    }
    return res.json({ data: schedule, grouped: groupedByDay, total });
  } catch (err) {
    console.error('[schedule] GET error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/schedule
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put(
  '/api/schedule',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(scheduleBatchUpdateSchema),
  (req, res) => {
    try {
      const { entries } = req.body;

      // entries este deja validat de scheduleBatchUpdateSchema
      const db = getDb();
      const coachIds = entries.filter(e => e.coach_id !== undefined && e.coach_id !== null).map(e => Number(e.coach_id));
      if (coachIds.length > 0) {
        const uniqueCoachIds = [...new Set(coachIds)];
        const placeholders = uniqueCoachIds.map(() => '?').join(',');
        const existingCoaches = db.prepare(`SELECT id FROM coaches WHERE id IN (${placeholders})`).all(...uniqueCoachIds);
        const existingIds = new Set(existingCoaches.map(c => c.id));
        for (const coachId of uniqueCoachIds) {
          if (!existingIds.has(coachId))
            return res.status(400).json({ error: `Coach with id ${coachId} does not exist.`, code: 'INVALID_COACH' });
        }
      }
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const replaceAll = db.transaction(() => {
        db.prepare('DELETE FROM schedule').run();
        const insertStmt = db.prepare(`
          INSERT INTO schedule (coach_id, title, day_of_week, start_time, end_time, location, max_participants, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const entry of entries) {
          insertStmt.run(
            entry.coach_id !== undefined && entry.coach_id !== null ? Number(entry.coach_id) : null,
            entry.title.trim(), Number(entry.day_of_week), entry.start_time, entry.end_time,
            entry.location || null,
            entry.max_participants !== undefined && entry.max_participants !== null ? Number(entry.max_participants) : null,
            entry.is_active !== undefined ? (entry.is_active ? 1 : 0) : 1, now, now
          );
        }
      });
      replaceAll();
      const updatedRows = db.prepare(`
        SELECT s.id, s.coach_id, s.title, s.day_of_week, s.start_time, s.end_time,
               s.location, s.max_participants, s.is_active, s.created_at, s.updated_at,
               c.name AS coach_name, c.title AS coach_title
        FROM schedule s LEFT JOIN coaches c ON s.coach_id = c.id
        ORDER BY s.day_of_week ASC, s.start_time ASC
      `).all();
      const schedule = updatedRows.map(parseScheduleRow);
      const groupedByDay = {};
      for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
        groupedByDay[dayIndex] = schedule.filter(entry => entry.day_of_week === dayIndex);
      }
      return res.json({ message: 'Schedule updated successfully.', data: schedule, grouped: groupedByDay, total: schedule.length });
    } catch (err) {
      console.error('[schedule] PUT error:', err.message);
      if (err.message && err.message.includes('FOREIGN KEY'))
        return res.status(400).json({ error: 'One or more coach references are invalid.', code: 'INVALID_COACH' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/schedule
// Middleware: authenticate → csrfProtection → authorize('admin')
// Creează o singură sesiune în program.
// ---------------------------------------------------------------------------

router.post(
  '/api/schedule',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(scheduleCreateSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { coach_id, title, day_of_week, start_time, end_time, location, max_participants, is_active } = req.body;

      // Validare coach_id dacă e furnizat
      if (coach_id !== undefined && coach_id !== null) {
        const coach = db.prepare('SELECT id FROM coaches WHERE id = ?').get(coach_id);
        if (!coach) return res.status(400).json({ error: `Coach with id ${coach_id} does not exist.`, code: 'INVALID_COACH' });
      }

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const result = db.prepare(`
        INSERT INTO schedule (coach_id, title, day_of_week, start_time, end_time, location, max_participants, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        coach_id !== undefined && coach_id !== null ? Number(coach_id) : null,
        title.trim(), Number(day_of_week), start_time, end_time,
        location || null,
        max_participants !== undefined && max_participants !== null ? Number(max_participants) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        now, now
      );

      const created = db.prepare(`
        SELECT s.*, c.name AS coach_name, c.title AS coach_title
        FROM schedule s LEFT JOIN coaches c ON s.coach_id = c.id
        WHERE s.id = ?
      `).get(result.lastInsertRowid);

      const entry = parseScheduleRow(created);
      return res.status(201).json({ message: 'Schedule entry created successfully.', data: entry });
    } catch (err) {
      console.error('[schedule] POST error:', err.message);
      if (err.message && err.message.includes('FOREIGN KEY'))
        return res.status(400).json({ error: 'Coach reference is invalid.', code: 'INVALID_COACH' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/schedule/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// Actualizează o singură sesiune din program.
// ---------------------------------------------------------------------------

router.put(
  '/api/schedule/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(scheduleUpdateSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM schedule WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Schedule entry not found.', code: 'NOT_FOUND' });

      // Validare coach_id dacă e furnizat
      if (req.body.coach_id !== undefined && req.body.coach_id !== null) {
        const coach = db.prepare('SELECT id FROM coaches WHERE id = ?').get(req.body.coach_id);
        if (!coach) return res.status(400).json({ error: `Coach with id ${req.body.coach_id} does not exist.`, code: 'INVALID_COACH' });
      }

      const updates = {};
      const setClauses = [];
      const directFields = ['title', 'start_time', 'end_time', 'location'];
      for (const field of directFields) {
        if (req.body[field] !== undefined) { updates[field] = req.body[field]; setClauses.push(`${field} = ?`); }
      }
      if (req.body.coach_id !== undefined) { updates.coach_id = req.body.coach_id; setClauses.push('coach_id = ?'); }
      if (req.body.day_of_week !== undefined) { updates.day_of_week = Number(req.body.day_of_week); setClauses.push('day_of_week = ?'); }
      if (req.body.max_participants !== undefined) { updates.max_participants = req.body.max_participants; setClauses.push('max_participants = ?'); }
      if (req.body.is_active !== undefined) { updates.is_active = req.body.is_active ? 1 : 0; setClauses.push('is_active = ?'); }

      if (setClauses.length === 0) {
        const entry = parseScheduleRow(existing);
        return res.json({ message: 'No changes provided.', data: entry });
      }

      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');
      const setValues = Object.values(updates);
      const sql = `UPDATE schedule SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];
      db.prepare(sql).run(...params);

      const updated = db.prepare(`
        SELECT s.*, c.name AS coach_name, c.title AS coach_title
        FROM schedule s LEFT JOIN coaches c ON s.coach_id = c.id
        WHERE s.id = ?
      `).get(id);
      const entry = parseScheduleRow(updated);
      return res.json({ message: 'Schedule entry updated successfully.', data: entry });
    } catch (err) {
      console.error('[schedule] PUT single error:', err.message);
      if (err.message && err.message.includes('FOREIGN KEY'))
        return res.status(400).json({ error: 'Coach reference is invalid.', code: 'INVALID_COACH' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/schedule/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// Șterge o singură sesiune din program.
// ---------------------------------------------------------------------------

router.delete(
  '/api/schedule/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT id, title FROM schedule WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Schedule entry not found.', code: 'NOT_FOUND' });
      db.prepare('DELETE FROM schedule WHERE id = ?').run(id);
      return res.json({ message: 'Schedule entry deleted successfully.', deleted: { id: existing.id, title: existing.title } });
    } catch (err) {
      console.error('[schedule] DELETE error:', err.message);
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;