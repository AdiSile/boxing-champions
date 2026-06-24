// ---------------------------------------------------------------------------
// routes/orders.js
// GET și PUT /api/orders
//
// GET  /api/orders       – listare comenzi cu paginare, sortare, căutare,
//                           filtrare după status
//                           Admin: vede toate comenzile
//                           User/Coach: vede doar comenzile proprii
// GET  /api/orders/:id   – detalii comandă (admin sau proprietar)
// POST /api/orders       – creare comandă (autentificat opțional)
// PUT  /api/orders/:id   – admin, actualizare comandă (status, billing, notes)
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('../config/db');
const {
  validate,
  orderCreateSchema,
  orderUpdateSchema,
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

/** Statusurile valide pentru o comandă */
const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded',
];

/** Câmpurile permise pentru sortare */
const ALLOWED_SORT_FIELDS = [
  'id', 'order_number', 'status', 'total_amount', 'billing_name',
  'billing_email', 'paid_at', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['order_number', 'billing_name', 'billing_email', 'notes'];

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
    throw new Error('[orders] JWT_SECRET nu este definit în variabilele de mediu.');
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
// Helpers – Generare număr comandă
// ---------------------------------------------------------------------------

/**
 * Generează un număr unic de comandă.
 * Format: ORD-YYYYMMDD-XXXX (ex: ORD-20250115-A3F9)
 *
 * @returns {string}
 */
function generateOrderNumber() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

/**
 * Parsează câmpurile unui rând de comandă.
 * Asigură tipuri corecte pentru numere, JSON și booleene.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
function parseOrderRow(row) {
  if (!row) return null;

  let items = [];
  if (row.items && typeof row.items === 'string') {
    try {
      items = JSON.parse(row.items);
    } catch {
      items = [];
    }
  }

  return {
    id: row.id,
    user_id: row.user_id !== null ? Number(row.user_id) : null,
    order_number: row.order_number,
    status: row.status,
    total_amount: row.total_amount !== null ? Number(row.total_amount) : 0,
    items,
    billing_name: row.billing_name || null,
    billing_email: row.billing_email || null,
    billing_phone: row.billing_phone || null,
    notes: row.notes || null,
    paid_at: row.paid_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Câmpuri din JOIN cu users (dacă există)
    user_name: row.user_name || null,
    user_email: row.user_email || null,
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, status, user_id, date_from, date_to }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru după status
  if (filters.status && typeof filters.status === 'string' && filters.status.trim()) {
    conditions.push('o.status = ?');
    params.push(filters.status.trim().toLowerCase());
  }

  // Filtru după user_id (admin vede toți, user doar pe al său)
  if (filters.user_id !== undefined && filters.user_id !== null) {
    conditions.push('o.user_id = ?');
    params.push(Number(filters.user_id));
  }

  // Filtru după dată (de la)
  if (filters.date_from && typeof filters.date_from === 'string') {
    conditions.push('o.created_at >= ?');
    params.push(filters.date_from);
  }

  // Filtru după dată (până la)
  if (filters.date_to && typeof filters.date_to === 'string') {
    conditions.push('o.created_at <= ?');
    params.push(filters.date_to);
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `o.${field} LIKE ?`);
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
 * @param {string} sort - Parametrul de sortare (ex: "total_amount" sau "-created_at")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY o.created_at DESC, o.id DESC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY o.created_at DESC, o.id DESC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY o.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/orders
// Listează comenzile cu paginare, sortare, căutare și filtrare.
// Admin: vede toate comenzile.
// User/Coach: vede doar comenzile proprii (user_id = payload.sub).
// Query params:
//   ?page=1&limit=20&sort=-created_at&search=ORD-&status=pending
//   &date_from=2025-01-01&date_to=2025-01-31
// ---------------------------------------------------------------------------

router.get(
  '/api/orders',
  validate(paginationSchema),
  (req, res) => {
    try {
      const db = getDb();

      // ------------------------------------------------------------------
      // 1. Autentificare (opțională – admin obligatoriu, user optional)
      // ------------------------------------------------------------------
      const payload = verifyRequestToken(req);

      // Extragere parametri din query-ul sanitizat
      const page = req.query.page || 1;
      const limit = req.query.limit || 20;
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const statusParam = req.query.status || null;
      const dateFromParam = req.query.date_from || null;
      const dateToParam = req.query.date_to || null;

      // Construim filtrele
      const filters = {};

      // Status
      if (statusParam && typeof statusParam === 'string') {
        const normalizedStatus = statusParam.trim().toLowerCase();
        if (ORDER_STATUSES.includes(normalizedStatus)) {
          filters.status = normalizedStatus;
        }
      }

      // Filtre dată
      if (dateFromParam) {
        filters.date_from = dateFromParam;
      }
      if (dateToParam) {
        filters.date_to = dateToParam;
      }

      // Căutare
      if (search) {
        filters.search = search;
      }

      // ------------------------------------------------------------------
      // 2. Autorizare: admin vede tot, user/coach doar comenzile proprii
      // ------------------------------------------------------------------
      if (!payload) {
        // Neautentificat – nu poate vedea comenzile
        return res.status(401).json({
          error: 'Authentication required to view orders.',
          code: 'AUTH_REQUIRED',
        });
      }

      if (hasRole(payload, 'admin')) {
        // Admin: dacă se specifică user_id în query, filtrează după acesta
        if (req.query.user_id !== undefined && req.query.user_id !== '') {
          filters.user_id = Number(req.query.user_id);
        }
        // Altfel, admin vede toate comenzile (fără filtru user_id)
      } else {
        // Non-admin: vede doar comenzile proprii
        filters.user_id = payload.sub;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `
        SELECT COUNT(*) as total
        FROM orders o
        ${whereClause}
      `;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT
          o.*,
          u.name AS user_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const orders = rows.map(parseOrderRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[orders] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// Returnează detaliile unei comenzi după ID.
// Admin: poate vedea orice comandă.
// User/Coach: poate vedea doar comenzile proprii.
// ---------------------------------------------------------------------------

router.get(
  '/api/orders/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;

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
      // 2. Căutare comandă
      // ------------------------------------------------------------------
      const row = db.prepare(`
        SELECT
          o.*,
          u.name AS user_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
      `).get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Order not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 3. Autorizare: admin sau proprietar
      // ------------------------------------------------------------------
      if (!hasRole(payload, 'admin') && row.user_id !== payload.sub) {
        return res.status(403).json({
          error: 'Insufficient permissions. You can only view your own orders.',
          code: 'FORBIDDEN',
        });
      }

      const order = parseOrderRow(row);

      return res.json({ data: order });
    } catch (err) {
      console.error('[orders] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/orders
// Creează o nouă comandă.
// Autentificare opțională: dacă utilizatorul este autentificat, se asociază
// automat user_id-ul. Dacă nu, se pot trimite datele de facturare.
// Body (orderCreateSchema):
//   - items (required): array de { product_id, quantity, price }
//   - billing_name, billing_email, billing_phone, notes (opționale)
//   - user_id (opțional, doar admin poate seta explicit)
// ---------------------------------------------------------------------------

router.post(
  '/api/orders',
  validate(orderCreateSchema),
  (req, res) => {
    try {
      const db = getDb();

      // ------------------------------------------------------------------
      // 1. Autentificare (opțională)
      // ------------------------------------------------------------------
      const payload = verifyRequestToken(req);

      // ------------------------------------------------------------------
      // 2. Extragere date din body-ul validat
      // ------------------------------------------------------------------
      const {
        user_id,
        items,
        billing_name,
        billing_email,
        billing_phone,
        notes,
      } = req.body;

      // ------------------------------------------------------------------
      // 3. Determinare user_id
      // ------------------------------------------------------------------
      let effectiveUserId = null;

      if (payload) {
        // Admin poate seta user_id explicit sau îl lasă null
        if (hasRole(payload, 'admin') && user_id !== undefined) {
          effectiveUserId = user_id;
        } else {
          // User-ul autentificat – comanda e a lui
          effectiveUserId = payload.sub;
        }
      } else if (user_id !== undefined && user_id !== null) {
        // Neautentificat cu user_id explicit (ex: guest checkout)
        effectiveUserId = user_id;
      }

      // ------------------------------------------------------------------
      // 4. Verificare user_id valid (dacă e setat)
      // ------------------------------------------------------------------
      if (effectiveUserId !== null && effectiveUserId !== undefined) {
        const user = db.prepare(
          'SELECT id, is_active FROM users WHERE id = ?'
        ).get(effectiveUserId);

        if (!user) {
          return res.status(400).json({
            error: 'User not found.',
            code: 'USER_NOT_FOUND',
          });
        }

        if (!user.is_active) {
          return res.status(400).json({
            error: 'User account is inactive.',
            code: 'USER_INACTIVE',
          });
        }
      }

      // ------------------------------------------------------------------
      // 5. Parsează și validează items
      // ------------------------------------------------------------------
      let parsedItems;
      try {
        parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
      } catch {
        return res.status(400).json({
          error: 'Items must be a valid JSON array.',
          code: 'VALIDATION_ERROR',
        });
      }

      if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
        return res.status(400).json({
          error: 'Order must contain at least one item.',
          code: 'VALIDATION_ERROR',
        });
      }

      // ------------------------------------------------------------------
      // 6. Verificare produse și calcul total
      // ------------------------------------------------------------------
      let totalAmount = 0;
      const validatedItems = [];

      for (const item of parsedItems) {
        if (!item.product_id || !item.quantity) {
          return res.status(400).json({
            error: 'Each item must have product_id and quantity.',
            code: 'VALIDATION_ERROR',
          });
        }

        const productId = Number(item.product_id);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(productId) || productId < 1) {
          return res.status(400).json({
            error: `Invalid product_id: ${item.product_id}.`,
            code: 'VALIDATION_ERROR',
          });
        }

        if (!Number.isInteger(quantity) || quantity < 1) {
          return res.status(400).json({
            error: `Invalid quantity for product ${productId}: ${item.quantity}.`,
            code: 'VALIDATION_ERROR',
          });
        }

        // Verifică existența produsului
        const product = db.prepare(
          'SELECT id, name, price, stock, is_active FROM products WHERE id = ?'
        ).get(productId);

        if (!product) {
          return res.status(400).json({
            error: `Product with id ${productId} not found.`,
            code: 'PRODUCT_NOT_FOUND',
          });
        }

        if (!product.is_active) {
          return res.status(400).json({
            error: `Product "${product.name}" is no longer available.`,
            code: 'PRODUCT_UNAVAILABLE',
          });
        }

        // Verificare stoc (dacă e setat)
        if (product.stock !== null && product.stock < quantity) {
          return res.status(400).json({
            error: `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}.`,
            code: 'INSUFFICIENT_STOCK',
          });
        }

        // Prețul: folosește prețul din item sau cel din produs
        const unitPrice = item.price !== undefined ? Number(item.price) : product.price;
        const lineTotal = unitPrice * quantity;

        validatedItems.push({
          product_id: productId,
          product_name: product.name,
          quantity,
          unit_price: unitPrice,
          line_total: lineTotal,
        });

        totalAmount += lineTotal;
      }

      // ------------------------------------------------------------------
      // 7. Generează număr comandă unic
      // ------------------------------------------------------------------
      let orderNumber;
      let attempts = 0;
      const maxAttempts = 10;

      do {
        orderNumber = generateOrderNumber();
        const exists = db.prepare(
          'SELECT id FROM orders WHERE order_number = ?'
        ).get(orderNumber);
        if (!exists) break;
        attempts++;
      } while (attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        return res.status(500).json({
          error: 'Could not generate a unique order number. Please try again.',
          code: 'INTERNAL_ERROR',
        });
      }

      // ------------------------------------------------------------------
      // 8. Inserare comandă
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO orders
          (user_id, order_number, status, total_amount, items,
           billing_name, billing_email, billing_phone, notes, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        effectiveUserId,
        orderNumber,
        totalAmount,
        JSON.stringify(validatedItems),
        billing_name || null,
        billing_email || null,
        billing_phone || null,
        notes || null,
        now,
        now,
      );

      // ------------------------------------------------------------------
      // 9. Actualizare stoc (scădere)
      // ------------------------------------------------------------------
      for (const item of validatedItems) {
        const product = db.prepare(
          'SELECT stock FROM products WHERE id = ?'
        ).get(item.product_id);

        if (product && product.stock !== null) {
          db.prepare(
            'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock IS NOT NULL'
          ).run(item.quantity, now, item.product_id);
        }
      }

      // ------------------------------------------------------------------
      // 10. Returnează comanda creată
      // ------------------------------------------------------------------
      const created = db.prepare(`
        SELECT
          o.*,
          u.name AS user_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
      `).get(result.lastInsertRowid);

      const order = parseOrderRow(created);

      return res.status(201).json({
        message: 'Order created successfully.',
        data: order,
      });
    } catch (err) {
      console.error('[orders] POST error:', err.message);

      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'An order with this order number already exists.',
          code: 'ORDER_NUMBER_CONFLICT',
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
// PUT /api/orders/:id
// Admin only – actualizează o comandă existentă.
// Acceptă un obiect parțial – doar câmpurile trimise se modifică.
// Body (orderUpdateSchema):
//   - status, billing_name, billing_email, billing_phone, notes
// Când status-ul trece pe "completed", se setează automat paid_at.
// Când status-ul trece pe "cancelled" / "refunded", se poate reface stocul.
// ---------------------------------------------------------------------------

router.put(
  '/api/orders/:id',
  validate(orderUpdateSchema),
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
      // 3. Verificare existență comandă
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare(`
        SELECT
          o.*,
          u.name AS user_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
      `).get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Order not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic (doar câmpurile trimise)
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];
      let shouldRestoreStock = false;

      // Status
      if (req.body.status !== undefined) {
        const newStatus = String(req.body.status).trim().toLowerCase();

        if (!ORDER_STATUSES.includes(newStatus)) {
          return res.status(400).json({
            error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}.`,
            code: 'VALIDATION_ERROR',
          });
        }

        updates.status = newStatus;
        setClauses.push('status = ?');

        // Setează paid_at automat când trece pe "completed"
        if (newStatus === 'completed' && existing.status !== 'completed') {
          const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
          updates.paid_at = now;
          setClauses.push('paid_at = ?');
        }

        // Dacă se anulează / refundează, marchează pentru refacerea stocului
        if (
          (newStatus === 'cancelled' || newStatus === 'refunded') &&
          existing.status !== 'cancelled' &&
          existing.status !== 'refunded'
        ) {
          shouldRestoreStock = true;
        }

        // Reface stocul dacă trece din cancelled/refunded în altceva
        // (nu refacem – e o decizie manuală; se poate face prin admin)
      }

      // Câmpuri text
      const textFields = ['billing_name', 'billing_email', 'billing_phone', 'notes'];

      for (const field of textFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field] || null;
          setClauses.push(`${field} = ?`);
        }
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează comanda neschimbată
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const order = parseOrderRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: order,
        });
      }

      // ------------------------------------------------------------------
      // 6. Actualizare + refacere stoc (în tranzacție)
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');

      const setValues = Object.values(updates);
      const sql = `UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];

      const performUpdate = db.transaction(() => {
        // Actualizează comanda
        db.prepare(sql).run(...params);

        // Refacere stoc dacă e cazul
        if (shouldRestoreStock) {
          let existingItems;
          try {
            existingItems = typeof existing.items === 'string'
              ? JSON.parse(existing.items)
              : existing.items;
          } catch {
            existingItems = [];
          }

          if (Array.isArray(existingItems)) {
            for (const item of existingItems) {
              if (item.product_id && item.quantity) {
                db.prepare(
                  'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ? AND stock IS NOT NULL'
                ).run(item.quantity, now, item.product_id);
              }
            }
          }
        }
      });

      performUpdate();

      // ------------------------------------------------------------------
      // 7. Returnează comanda actualizată
      // ------------------------------------------------------------------
      const updated = db.prepare(`
        SELECT
          o.*,
          u.name AS user_name,
          u.email AS user_email
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id = ?
      `).get(id);

      const order = parseOrderRow(updated);

      return res.json({
        message: 'Order updated successfully.',
        data: order,
      });
    } catch (err) {
      console.error('[orders] PUT error:', err.message);

      if (err.message && err.message.includes('FOREIGN KEY')) {
        return res.status(400).json({
          error: 'Invalid reference.',
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