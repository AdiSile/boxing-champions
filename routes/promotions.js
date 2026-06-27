// ---------------------------------------------------------------------------
// routes/promotions.js
// Gestiune coduri promoționale — CRUD complet + endpoint public validare
//
// GET    /api/promotions/validate/:code – validare publică (fără auth)
// GET    /api/promotions                 – listare (admin, cu paginare)
// POST   /api/promotions                 – creare (admin)
// PUT    /api/promotions/:id             – actualizare (admin)
// DELETE /api/promotions/:id             – ștergere (admin)
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// Logica de validare promoții: unificată prin utils/promo-validator.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  authenticate,
  authorize,
  csrfProtection,
} = require('../middleware/auth');
const {
  validate,
  paramsIdSchema,
  promotionCreateSchema,
  promotionUpdateSchema,
  promotionListSchema,
  promoValidateSchema,
} = require('../middleware/validate');
const {
  validatePromoCode,
  calculateDiscount,
  getActivePromotions,
  VALID_APPLIES_TO,
} = require('../utils/promo-validator');

const router = express.Router();

const ALLOWED_SORT_COLUMNS = [
  'id', 'code', 'discount_type', 'discount_value',
  'applies_to', 'start_date', 'end_date', 'usage_limit',
  'usage_count', 'is_active', 'created_at',
];

// =========================================================================
// ENDPOINT PUBLIC
// =========================================================================

// ---------------------------------------------------------------------------
// GET /api/promotions/validate/:code
// Public – verifică un cod promoțional din baza de date.
// Parametri query opționali:
//   - cart_total  (number) – totalul coșului, pentru calcul discount
//   - applies_to  (string) – 'products', 'plans', 'events' – contextul
// ---------------------------------------------------------------------------

router.get('/api/promotions/validate/:code', validate(promoValidateSchema), (req, res) => {
  try {
    const { code } = req.params;
    const { cart_total, applies_to } = req.query;

    // code este deja validat de promoValidateSchema
    const options = {};
    if (applies_to) options.applies_to = applies_to;

    const validation = validatePromoCode(code, options);

    if (!validation.valid) {
      return res.status(404).json({
        valid: false,
        error: validation.error,
        code: validation.code,
      });
    }

    const promo = validation.promo;
    const cartTotal = cart_total ? parseFloat(cart_total) : 0;

    const response = {
      valid: true,
      code: promo.code,
      description: promo.description,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      applies_to: promo.applies_to,
    };

    // Calculează discount dacă e furnizat totalul
    if (!isNaN(cartTotal) && cartTotal > 0) {
      const discount = calculateDiscount(promo, cartTotal);
      response.discount_amount = discount.discountAmount;
      response.total_after_discount = discount.totalAfterDiscount;
    }

    // Include date despre expirare și utilizări (informativ)
    if (promo.start_date) response.start_date = promo.start_date;
    if (promo.end_date) response.end_date = promo.end_date;
    if (promo.usage_limit) {
      response.usage_limit = promo.usage_limit;
      response.usage_count = promo.usage_count;
      response.uses_remaining = promo.usage_limit - promo.usage_count;
    }

    return res.json(response);
  } catch (err) {
    console.error('[promotions] validate error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// =========================================================================
// ENDPOINT-URI ADMIN
// =========================================================================

// ---------------------------------------------------------------------------
// GET /api/promotions
// Middleware: authenticate → authorize('admin')
// ---------------------------------------------------------------------------

router.get('/api/promotions', authenticate, authorize('admin'), validate(promotionListSchema), (req, res) => {
  try {
    const db = getDb();
    const { page, limit, sort, search, is_active, applies_to } = req.query;
    const offset = (page - 1) * limit;

    let sortField = 'id';
    let sortDir = 'DESC';
    if (sort) {
      if (sort.startsWith('-')) { sortDir = 'DESC'; sortField = sort.substring(1); }
      else { sortDir = 'ASC'; sortField = sort; }
    }
    if (ALLOWED_SORT_COLUMNS.indexOf(sortField) === -1) sortField = 'id';

    // Construire where clause
    let whereClause = '';
    const params = [];

    if (search) {
      whereClause = 'WHERE (code LIKE ? OR description LIKE ?)';
      const searchPattern = '%' + search + '%';
      params.push(searchPattern, searchPattern);
    }

    if (is_active !== undefined) {
      const isActiveFilter = is_active === '1' || is_active === 'true' ? 1 : 0;
      const prefix = whereClause ? 'AND' : 'WHERE';
      whereClause += ' ' + prefix + ' is_active = ?';
      params.push(isActiveFilter);
    }

    if (applies_to) {
      const prefix = whereClause ? 'AND' : 'WHERE';
      whereClause += ' ' + prefix + ' applies_to = ?';
      params.push(applies_to);
    }

    const countSql = 'SELECT COUNT(*) as total FROM promotions ' + whereClause;
    const countRow = db.prepare(countSql).get(...params);
    const total = countRow ? countRow.total : 0;

    const dataSql = 'SELECT * FROM promotions ' + whereClause
      + ' ORDER BY ' + sortField + ' ' + sortDir + ' LIMIT ? OFFSET ?';
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);

    return res.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[promotions] GET error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/promotions
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.post('/api/promotions', authenticate, csrfProtection, authorize('admin'), validate(promotionCreateSchema), (req, res) => {
  try {
    const {
      code, description, discount_type, discount_value,
      applies_to, start_date, end_date, usage_limit, is_active,
    } = req.body;

    // code este deja sanitizat (trim + uppercase) de schema
    const trimmedCode = code;
    const dType = discount_type;
    const dValue = discount_value;
    const applies = applies_to || 'all';
    const usageLim = usage_limit || null;

    // Validare business suplimentară: procentaj max 100
    if (dType === 'percentage' && dValue > 100) {
      return res.status(400).json({ error: 'Procentul trebuie să fie între 0 și 100.', code: 'VALIDATION_ERROR' });
    }

    // Verificare date
    const db = getDb();

    const existing = db.prepare('SELECT id FROM promotions WHERE code = ?').get(trimmedCode);
    if (existing)
      return res.status(409).json({ error: 'Există deja o promoție cu acest cod.', code: 'DUPLICATE' });

    const info = db.prepare(`
      INSERT INTO promotions
        (code, description, discount_type, discount_value, applies_to,
         start_date, end_date, usage_limit, is_active)
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
    return res.status(201).json({ message: 'Promoție creată cu succes.', data: newPromotion });
  } catch (err) {
    console.error('[promotions] POST error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/promotions/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put('/api/promotions/:id', authenticate, csrfProtection, authorize('admin'), validate(promotionUpdateSchema), (req, res) => {
  try {
    const { id } = req.params;

    const db = getDb();
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    if (!existing)
      return res.status(404).json({ error: 'Promoția nu a fost găsită.', code: 'NOT_FOUND' });

    const body = req.body;

    // Cod – sanitizat de schema (trim + uppercase)
    const code = body.code !== undefined ? body.code : existing.code;

    if (code !== existing.code) {
      const dup = db.prepare('SELECT id FROM promotions WHERE code = ? AND id != ?').get(code, id);
      if (dup) return res.status(409).json({ error: 'Există deja o promoție cu acest cod.', code: 'DUPLICATE' });
    }

    // Tip discount
    const dType = body.discount_type !== undefined ? body.discount_type : existing.discount_type;
    const dValue = body.discount_value !== undefined ? body.discount_value : existing.discount_value;

    // Validare business suplimentară: procentaj max 100
    if (dType === 'percentage' && dValue > 100)
      return res.status(400).json({ error: 'Procentul trebuie să fie între 0 și 100.', code: 'VALIDATION_ERROR' });

    // applies_to
    const applies = body.applies_to !== undefined ? body.applies_to : existing.applies_to;

    // usage_limit
    let usageLim = existing.usage_limit;
    if (body.usage_limit !== undefined) {
      usageLim = body.usage_limit; // deja validat ca integer | null de schema
    }

    const isActive = body.is_active !== undefined
      ? (body.is_active ? 1 : 0)
      : existing.is_active;

    db.prepare(`
      UPDATE promotions
      SET code = ?, description = ?, discount_type = ?, discount_value = ?,
          applies_to = ?, start_date = ?, end_date = ?, usage_limit = ?,
          is_active = ?, updated_at = datetime('now')
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
    return res.json({ message: 'Promoție actualizată cu succes.', data: updated });
  } catch (err) {
    console.error('[promotions] PUT error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/promotions/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.delete('/api/promotions/:id', authenticate, csrfProtection, authorize('admin'), validate(paramsIdSchema), (req, res) => {
  try {
    const { id } = req.params;

    const db = getDb();
    const existing = db.prepare('SELECT id FROM promotions WHERE id = ?').get(id);
    if (!existing)
      return res.status(404).json({ error: 'Promoția nu a fost găsită.', code: 'NOT_FOUND' });

    db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
    return res.json({ message: 'Promoție ștearsă cu succes.' });
  } catch (err) {
    console.error('[promotions] DELETE error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;