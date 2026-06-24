// ---------------------------------------------------------------------------
// routes/schedule.js
// GET și PUT /api/schedule – gestionează programul săptămânal
//
// GET  /api/schedule       – public, listare program cu opțiuni de filtrare
// PUT  /api/schedule       – admin, înlocuire completă program (batch)
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  paginationSchema,
} = require('../middleware/validate');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele cookie-ului de autentificare (sincronizat cu routes/auth.js) */
const TOKEN_COOKIE = 'token';

/** Algoritmul JWT */
const JWT_ALGORITHM = 'HS256';

/** Zilele săptămânii (0 = Duminică ... 6 = Sâmbătă) */
const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Câmpurile permise pentru sortare */
const ALLOWED_SORT_FIELDS = [
  'id', 'day_of_week', 'start_time', 'end_time', 'title', 'location',
  'max_participants', 'is_active', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['s.title', 's.location', 'c.name'];

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
    throw new Error('[schedule] JWT_SECRET nu este definit în variabilele de mediu.');
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
 * Parsează câmpurile unui rând de schedule.
 * Asigură tipuri corecte pentru numere și booleene.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
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
    // Câmpuri din JOIN cu coaches (dacă există)
    coach_name: row.coach_name || null,
    coach_title: row.coach_title || null,
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, day_of_week, is_active, coach_id }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_active (implicit: doar intrări active pentru public)
  if (filters.is_active !== undefined) {
    conditions.push('s.is_active = ?');
    params.push(filters.is_active ? 1 : 0);
  }

  // Filtru după ziua săptămânii
  if (filters.day_of_week !== undefined && filters.day_of_week !== null) {
    conditions.push('s.day_of_week = ?');
    params.push(Number(filters.day_of_week));
  }

  // Filtru după coach_id
  if (filters.coach_id !== undefined && filters.coach_id !== null) {
    conditions.push('s.coach_id = ?');
    params.push(Number(filters.coach_id));
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `${field} LIKE ?`);
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
 * Implicit: sortează după day_of_week ASC, apoi start_time ASC.
 *
 * @param {string} sort - Parametrul de sortare (ex: "start_time" sau "-day_of_week")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY s.day_of_week ASC, s.start_time ASC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY s.day_of_week ASC, s.start_time ASC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY s.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/schedule
// Public – listează programul săptămânal cu opțiuni de filtrare.
// Query params:
//   ?day_of_week=1&is_active=true&coach_id=2&search=boxing&sort=start_time
// ---------------------------------------------------------------------------

router.get(
  '/api/schedule',
  validate(paginationSchema),
  (req, res) => {
    try {
      const db = getDb();

      // Extragere parametri din query-ul sanitizat
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const isActiveParam = req.query.is_active;
      const dayOfWeekParam = req.query.day_of_week;
      const coachIdParam = req.query.coach_id;

      // Construim filtrele
      const filters = {};

      // is_active: dacă nu e specificat explicit, returnăm doar intrările active
      if (isActiveParam !== undefined) {
        filters.is_active = isActiveParam === 'true' || isActiveParam === true;
      } else {
        filters.is_active = true;
      }

      // Filtru zi
      if (dayOfWeekParam !== undefined && dayOfWeekParam !== '') {
        const day = parseInt(dayOfWeekParam, 10);
        if (!Number.isNaN(day) && day >= 0 && day <= 6) {
          filters.day_of_week = day;
        }
      }

      // Filtru coach
      if (coachIdParam !== undefined && coachIdParam !== '') {
        const coachId = parseInt(coachIdParam, 10);
        if (!Number.isNaN(coachId) && coachId > 0) {
          filters.coach_id = coachId;
        }
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total
      const countSql = `
        SELECT COUNT(*) as total
        FROM schedule s
        LEFT JOIN coaches c ON s.coach_id = c.id
        ${whereClause}
      `;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Query principal (fără paginare – programul e de obicei mic)
      const dataSql = `
        SELECT
          s.id, s.coach_id, s.title, s.day_of_week,
          s.start_time, s.end_time, s.location,
          s.max_participants, s.is_active,
          s.created_at, s.updated_at,
          c.name AS coach_name,
          c.title AS coach_title
        FROM schedule s
        LEFT JOIN coaches c ON s.coach_id = c.id
        ${whereClause}
        ${orderClause}
      `;

      const rows = db.prepare(dataSql).all(...params);

      // Parsează rândurile
      const schedule = rows.map(parseScheduleRow);

      // Grupare pe zile pentru consum ușor în frontend
      const groupedByDay = {};
      for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
        groupedByDay[dayIndex] = schedule.filter(
          entry => entry.day_of_week === dayIndex
        );
      }

      return res.json({
        data: schedule,
        grouped: groupedByDay,
        total,
      });
    } catch (err) {
      console.error('[schedule] GET error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/schedule
// Admin only – înlocuire completă a programului săptămânal (batch).
//
// Acceptă un obiect JSON cu cheia "entries" (array de intrări de program).
// Fiecare entry poate conține:
//   - id (opțional): pentru actualizare
//   - coach_id, title, day_of_week, start_time, end_time,
//     location, max_participants, is_active
//
// Procesul (în tranzacție):
//   1. Șterge toate intrările existente din schedule
//   2. Inserează noile intrări din array
//   3. Dacă array-ul e gol, programul rămâne gol
// ---------------------------------------------------------------------------

router.put(
  '/api/schedule',
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
      // 3. Validare body
      // ------------------------------------------------------------------
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          error: 'Request body must be a JSON object with an "entries" array.',
          code: 'INVALID_BODY',
        });
      }

      const { entries } = req.body;

      if (!Array.isArray(entries)) {
        return res.status(400).json({
          error: 'Request body must contain an "entries" array.',
          code: 'INVALID_BODY',
        });
      }

      // ------------------------------------------------------------------
      // 4. Validare fiecare entry
      // ------------------------------------------------------------------
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const errors = [];

        // title – required
        if (!entry.title || typeof entry.title !== 'string' || entry.title.trim().length < 2) {
          errors.push(`entries[${i}].title is required (min 2 characters).`);
        }

        // day_of_week – required, 0-6
        if (
          entry.day_of_week === undefined ||
          entry.day_of_week === null ||
          !Number.isInteger(Number(entry.day_of_week)) ||
          Number(entry.day_of_week) < 0 ||
          Number(entry.day_of_week) > 6
        ) {
          errors.push(`entries[${i}].day_of_week is required and must be between 0 and 6.`);
        }

        // start_time – required, format HH:MM
        if (
          !entry.start_time ||
          typeof entry.start_time !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start_time)
        ) {
          errors.push(`entries[${i}].start_time is required and must be in HH:MM format.`);
        }

        // end_time – required, format HH:MM
        if (
          !entry.end_time ||
          typeof entry.end_time !== 'string' ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.end_time)
        ) {
          errors.push(`entries[${i}].end_time is required and must be in HH:MM format.`);
        }

        // coach_id – optional dar valid dacă e prezent
        if (
          entry.coach_id !== undefined &&
          entry.coach_id !== null &&
          !Number.isInteger(Number(entry.coach_id))
        ) {
          errors.push(`entries[${i}].coach_id must be an integer.`);
        }

        // max_participants – optional dar valid dacă e prezent
        if (
          entry.max_participants !== undefined &&
          entry.max_participants !== null &&
          (!Number.isInteger(Number(entry.max_participants)) || Number(entry.max_participants) < 1)
        ) {
          errors.push(`entries[${i}].max_participants must be a positive integer.`);
        }

        // location – optional, max 256
        if (
          entry.location !== undefined &&
          entry.location !== null &&
          typeof entry.location === 'string' &&
          entry.location.length > 256
        ) {
          errors.push(`entries[${i}].location must be at most 256 characters.`);
        }

        if (errors.length > 0) {
          return res.status(400).json({
            error: 'Validation failed.',
            code: 'VALIDATION_ERROR',
            details: errors,
          });
        }
      }

      // ------------------------------------------------------------------
      // 5. Verificare coach_id-uri valide (dacă sunt setate)
      // ------------------------------------------------------------------
      const db = getDb();
      const coachIds = entries
        .filter(e => e.coach_id !== undefined && e.coach_id !== null)
        .map(e => Number(e.coach_id));

      if (coachIds.length > 0) {
        const uniqueCoachIds = [...new Set(coachIds)];
        const placeholders = uniqueCoachIds.map(() => '?').join(',');
        const existingCoaches = db.prepare(
          `SELECT id FROM coaches WHERE id IN (${placeholders})`
        ).all(...uniqueCoachIds);

        const existingIds = new Set(existingCoaches.map(c => c.id));

        for (const coachId of uniqueCoachIds) {
          if (!existingIds.has(coachId)) {
            return res.status(400).json({
              error: `Coach with id ${coachId} does not exist.`,
              code: 'INVALID_COACH',
            });
          }
        }
      }

      // ------------------------------------------------------------------
      // 6. Înlocuire completă în tranzacție
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const replaceAll = db.transaction(() => {
        // Ștergem toate intrările existente
        db.prepare('DELETE FROM schedule').run();

        // Inserăm noile intrări
        const insertStmt = db.prepare(`
          INSERT INTO schedule
            (coach_id, title, day_of_week, start_time, end_time, location, max_participants, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const entry of entries) {
          insertStmt.run(
            entry.coach_id !== undefined && entry.coach_id !== null ? Number(entry.coach_id) : null,
            entry.title.trim(),
            Number(entry.day_of_week),
            entry.start_time,
            entry.end_time,
            entry.location || null,
            entry.max_participants !== undefined && entry.max_participants !== null
              ? Number(entry.max_participants) : null,
            entry.is_active !== undefined ? (entry.is_active ? 1 : 0) : 1,
            now,
            now,
          );
        }
      });

      replaceAll();

      // ------------------------------------------------------------------
      // 7. Returnează programul actualizat
      // ------------------------------------------------------------------
      const updatedRows = db.prepare(`
        SELECT
          s.id, s.coach_id, s.title, s.day_of_week,
          s.start_time, s.end_time, s.location,
          s.max_participants, s.is_active,
          s.created_at, s.updated_at,
          c.name AS coach_name,
          c.title AS coach_title
        FROM schedule s
        LEFT JOIN coaches c ON s.coach_id = c.id
        ORDER BY s.day_of_week ASC, s.start_time ASC
      `).all();

      const schedule = updatedRows.map(parseScheduleRow);

      // Regrupare pe zile
      const groupedByDay = {};
      for (const dayIndex of [0, 1, 2, 3, 4, 5, 6]) {
        groupedByDay[dayIndex] = schedule.filter(
          entry => entry.day_of_week === dayIndex
        );
      }

      return res.json({
        message: 'Schedule updated successfully.',
        data: schedule,
        grouped: groupedByDay,
        total: schedule.length,
      });
    } catch (err) {
      console.error('[schedule] PUT error:', err.message);

      // Eroare FK – coach_id referențiază un antrenor inexistent
      if (err.message && err.message.includes('FOREIGN KEY')) {
        return res.status(400).json({
          error: 'One or more coach references are invalid.',
          code: 'INVALID_COACH',
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