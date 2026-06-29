// ---------------------------------------------------------------------------
// routes/orders.js
// GET, POST și PUT /api/orders
//
// GET    /api/orders       – listare comenzi cu paginare, sortare, căutare, filtrare
//                             Admin: vede toate comenzile
//                             User/Coach: vede doar comenzile proprii
// GET    /api/orders/:id   – detalii comandă (admin sau proprietar)
// POST   /api/orders       – creare comandă cu auto-creare cont, billing_address,
//                             trimitere email de confirmare
// PUT    /api/orders/:id   – admin, actualizare comandă (status, billing, notes)
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { getDb } = require('../config/db');
const {
  validate,
  orderCreateSchema,
  orderUpdateSchema,
  paginationSchema,
  paramsIdSchema,
  combineSchemas,
  requireJsonContentType,
} = require('../middleware/validate');
const {
  authenticate,
  authorize,
  optionalAuth,
  csrfProtection,
} = require('../middleware/auth');
const {
  sendOrderConfirmation,
  sendWelcomeEmail,
} = require('../utils/email');

const router = express.Router();

// Verificare strictă Content-Type pentru rutele care așteaptă JSON
router.use(requireJsonContentType({ strict: true }));

const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded'];
const ALLOWED_SORT_FIELDS = ['id', 'order_number', 'status', 'total_amount', 'billing_name', 'billing_email', 'paid_at', 'created_at', 'updated_at'];
const SEARCH_FIELDS = ['order_number', 'billing_name', 'billing_email', 'notes'];

function generateOrderNumber() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

function parseOrderRow(row) {
  if (!row) return null;
  let items = [];
  if (row.items && typeof row.items === 'string') {
    try { items = JSON.parse(row.items); } catch { items = []; }
  }
  return {
    id: row.id, user_id: row.user_id !== null ? Number(row.user_id) : null,
    order_number: row.order_number, status: row.status,
    total_amount: row.total_amount !== null ? Number(row.total_amount) : 0,
    items, billing_name: row.billing_name || null, billing_email: row.billing_email || null,
    billing_phone: row.billing_phone || null, billing_address: row.billing_address || null,
    notes: row.notes || null,
    paid_at: row.paid_at || null, created_at: row.created_at, updated_at: row.updated_at,
    user_name: row.user_name || null, user_email: row.user_email || null,
  };
}

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.status && typeof filters.status === 'string' && filters.status.trim()) {
    conditions.push('o.status = ?'); params.push(filters.status.trim().toLowerCase());
  }
  if (filters.user_id !== undefined && filters.user_id !== null) {
    conditions.push('o.user_id = ?'); params.push(Number(filters.user_id));
  }
  if (filters.date_from && typeof filters.date_from === 'string') {
    conditions.push('o.created_at >= ?'); params.push(filters.date_from);
  }
  if (filters.date_to && typeof filters.date_to === 'string') {
    conditions.push('o.created_at <= ?'); params.push(filters.date_to);
  }
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `o.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) params.push(searchTerm);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY o.created_at DESC, o.id DESC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY o.created_at DESC, o.id DESC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY o.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/orders
// Middleware: authenticate (obligatoriu pentru toți)
// ---------------------------------------------------------------------------

router.get('/api/orders', authenticate, validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const page = req.query.page || 1;
    const limit = req.query.limit || 20;
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const statusParam = req.query.status || null;
    const dateFromParam = req.query.date_from || null;
    const dateToParam = req.query.date_to || null;
    const filters = {};
    if (statusParam && typeof statusParam === 'string') {
      const normalizedStatus = statusParam.trim().toLowerCase();
      if (ORDER_STATUSES.includes(normalizedStatus)) filters.status = normalizedStatus;
    }
    if (dateFromParam) filters.date_from = dateFromParam;
    if (dateToParam) filters.date_to = dateToParam;
    if (search) filters.search = search;

    if (req.user.role === 'admin') {
      if (req.query.user_id !== undefined && req.query.user_id !== '') filters.user_id = Number(req.query.user_id);
    } else {
      filters.user_id = req.user.userId;
    }

    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const offset = (page - 1) * limit;
    const dataSql = `
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      ${whereClause} ${orderClause} LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);
    const orders = rows.map(parseOrderRow);
    return res.json({
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[orders] GET list error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// Middleware: authenticate
// ---------------------------------------------------------------------------

router.get('/api/orders/:id', authenticate, validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const row = db.prepare(`
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ error: 'Order not found.', code: 'NOT_FOUND' });
    if (req.user.role !== 'admin' && row.user_id !== req.user.userId)
      return res.status(403).json({ error: 'Insufficient permissions. You can only view your own orders.', code: 'FORBIDDEN' });
    const order = parseOrderRow(row);
    return res.json({ data: order });
  } catch (err) {
    console.error('[orders] GET single error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/orders
// Middleware: optionalAuth (public + auth users)
//
// Funcționalități:
//   - Acceptă billing_address
//   - Auto-creare cont utilizator din billing_email dacă utilizatorul nu este
//     autentificat și nu se specifică un user_id
//   - Trimite email de confirmare a comenzii
//   - Trimite email de bun venit dacă s-a creat automat un cont
// ---------------------------------------------------------------------------

router.post('/api/orders', optionalAuth, validate(orderCreateSchema), async (req, res) => {
  try {
    const db = getDb();
    const { user_id, items, billing_name, billing_email, billing_phone, billing_address, notes } = req.body;

    // ------------------------------------------------------------------
    // 1. Determină userId-ul efectiv + auto-creare cont
    // ------------------------------------------------------------------
    let effectiveUserId = null;
    let accountWasCreated = false;
    let generatedPassword = null;

    if (req.user) {
      // Utilizator autentificat
      if (req.user.role === 'admin' && user_id !== undefined && user_id !== null) {
        effectiveUserId = Number(user_id);
      } else {
        effectiveUserId = req.user.userId;
      }
    } else if (user_id !== undefined && user_id !== null) {
      // user_id explicit în request (fără autentificare)
      effectiveUserId = Number(user_id);
    } else if (billing_email && typeof billing_email === 'string' && billing_email.trim()) {
      // Nu există user autentificat și nici user_id explicit.
      // AUTO-CREARE CONT pe baza billing_email.
      const normalizedEmail = billing_email.trim().toLowerCase();

      // Verificăm dacă există deja un utilizator cu acest email
      const existingUser = db.prepare(
        'SELECT id, is_active FROM users WHERE email = ?'
      ).get(normalizedEmail);

      if (existingUser) {
        if (!existingUser.is_active) {
          return res.status(400).json({
            error: 'A user account with this email exists but is inactive. Please contact support.',
            code: 'USER_INACTIVE',
          });
        }
        effectiveUserId = existingUser.id;
      } else {
        // Creăm un cont nou automat
        generatedPassword = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 16);
        const saltRounds = 10;
        const hashedPassword = bcrypt.hashSync(generatedPassword, saltRounds);

        const userName = billing_name && billing_name.trim()
          ? billing_name.trim()
          : normalizedEmail.split('@')[0];

        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

        const createResult = db.prepare(`
          INSERT INTO users (name, email, password, role, is_active, email_verified_at, created_at, updated_at)
          VALUES (?, ?, ?, 'user', 1, ?, ?, ?)
        `).run(userName, normalizedEmail, hashedPassword, now, now, now);

        effectiveUserId = createResult.lastInsertRowid;
        accountWasCreated = true;

        console.log(`[orders] Auto-created account for ${normalizedEmail} (user_id=${effectiveUserId})`);
      }
    }

    // ------------------------------------------------------------------
    // 2. Validare utilizator (dacă există un userId)
    // ------------------------------------------------------------------
    if (effectiveUserId !== null && effectiveUserId !== undefined) {
      const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(effectiveUserId);
      if (!user) return res.status(400).json({ error: 'User not found.', code: 'USER_NOT_FOUND' });
      if (!user.is_active) return res.status(400).json({ error: 'User account is inactive.', code: 'USER_INACTIVE' });
    }

    // ------------------------------------------------------------------
    // 3. Validare și procesare items
    // ------------------------------------------------------------------
    let parsedItems;
    try { parsedItems = typeof items === 'string' ? JSON.parse(items) : items; } catch {
      return res.status(400).json({ error: 'Items must be a valid JSON array.', code: 'VALIDATION_ERROR' });
    }
    if (!Array.isArray(parsedItems) || parsedItems.length === 0)
      return res.status(400).json({ error: 'Order must contain at least one item.', code: 'VALIDATION_ERROR' });

    let totalAmount = 0;
    const validatedItems = [];
    for (const item of parsedItems) {
      if (!item.product_id || !item.quantity)
        return res.status(400).json({ error: 'Each item must have product_id and quantity.', code: 'VALIDATION_ERROR' });
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(productId) || productId < 1)
        return res.status(400).json({ error: `Invalid product_id: ${item.product_id}.`, code: 'VALIDATION_ERROR' });
      if (!Number.isInteger(quantity) || quantity < 1)
        return res.status(400).json({ error: `Invalid quantity for product ${productId}: ${item.quantity}.`, code: 'VALIDATION_ERROR' });
      const product = db.prepare('SELECT id, name, price, stock, is_active FROM products WHERE id = ?').get(productId);
      if (!product) return res.status(400).json({ error: `Product with id ${productId} not found.`, code: 'PRODUCT_NOT_FOUND' });
      if (!product.is_active) return res.status(400).json({ error: `Product "${product.name}" is no longer available.`, code: 'PRODUCT_UNAVAILABLE' });
      if (product.stock !== null && product.stock < quantity)
        return res.status(400).json({ error: `Insufficient stock for "${product.name}". Available: ${product.stock}, requested: ${quantity}.`, code: 'INSUFFICIENT_STOCK' });
      const unitPrice = item.price !== undefined ? Number(item.price) : product.price;
      const lineTotal = unitPrice * quantity;
      validatedItems.push({ product_id: productId, product_name: product.name, quantity, unit_price: unitPrice, line_total: lineTotal });
      totalAmount += lineTotal;
    }

    // ------------------------------------------------------------------
    // 4. Generează număr de comandă unic
    // ------------------------------------------------------------------
    let orderNumber;
    let attempts = 0;
    const maxAttempts = 10;
    do {
      orderNumber = generateOrderNumber();
      const exists = db.prepare('SELECT id FROM orders WHERE order_number = ?').get(orderNumber);
      if (!exists) break;
      attempts++;
    } while (attempts < maxAttempts);
    if (attempts >= maxAttempts)
      return res.status(500).json({ error: 'Could not generate a unique order number. Please try again.', code: 'INTERNAL_ERROR' });

    // ------------------------------------------------------------------
    // 5. Inserează comanda (include billing_address)
    // ------------------------------------------------------------------
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const sanitizedBillingAddress = billing_address && typeof billing_address === 'string'
      ? billing_address.trim().slice(0, 512)
      : null;

    const result = db.prepare(`
      INSERT INTO orders (user_id, order_number, status, total_amount, items, billing_name, billing_email, billing_phone, billing_address, notes, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      effectiveUserId, orderNumber, totalAmount, JSON.stringify(validatedItems),
      billing_name || null, billing_email || null, billing_phone || null,
      sanitizedBillingAddress, notes || null, now, now,
    );

    // ------------------------------------------------------------------
    // 6. Actualizează stocul produselor
    // ------------------------------------------------------------------
    for (const item of validatedItems) {
      const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
      if (product && product.stock !== null)
        db.prepare('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND stock IS NOT NULL').run(item.quantity, now, item.product_id);
    }

    // ------------------------------------------------------------------
    // 7. Citește comanda creată
    // ------------------------------------------------------------------
    const created = db.prepare(`
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(result.lastInsertRowid);
    const order = parseOrderRow(created);

    // ------------------------------------------------------------------
    // 8. Trimite email de confirmare (async, non-blocking)
    // ------------------------------------------------------------------
    const recipientEmail = billing_email || (effectiveUserId ? created.user_email : null);

    // Email de confirmare comandă
    if (recipientEmail) {
      sendOrderConfirmation(order, recipientEmail).catch(err => {
        console.error('[orders] Order confirmation email error:', err.message);
      });
    }

    // Email de bun venit dacă s-a creat cont automat
    if (accountWasCreated && recipientEmail) {
      const newUser = { name: created.user_name || billing_name, email: recipientEmail };
      sendWelcomeEmail(newUser, generatedPassword).catch(err => {
        console.error('[orders] Welcome email error:', err.message);
      });
    }

    // ------------------------------------------------------------------
    // 9. Răspuns
    // ------------------------------------------------------------------
    const responsePayload = {
      message: 'Order created successfully.',
      data: order,
    };

    if (accountWasCreated) {
      responsePayload.account_created = true;
      responsePayload.message += ' A new account was created for your email address.';
    }

    return res.status(201).json(responsePayload);
  } catch (err) {
    console.error('[orders] POST error:', err.message);
    if (err.message && err.message.includes('UNIQUE constraint'))
      return res.status(409).json({ error: 'An order with this order number already exists.', code: 'ORDER_NUMBER_CONFLICT' });
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/orders/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put('/api/orders/:id', authenticate, csrfProtection, authorize('admin'), validate(orderUpdateSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const existing = db.prepare(`
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(id);
    if (!existing) return res.status(404).json({ error: 'Order not found.', code: 'NOT_FOUND' });
    const updates = {};
    const setClauses = [];
    let shouldRestoreStock = false;
    if (req.body.status !== undefined) {
      const newStatus = String(req.body.status).trim().toLowerCase();
      if (!ORDER_STATUSES.includes(newStatus))
        return res.status(400).json({ error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}.`, code: 'VALIDATION_ERROR' });
      updates.status = newStatus;
      setClauses.push('status = ?');
      if (newStatus === 'completed' && existing.status !== 'completed') {
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        updates.paid_at = now;
        setClauses.push('paid_at = ?');
      }
      if ((newStatus === 'cancelled' || newStatus === 'refunded') && existing.status !== 'cancelled' && existing.status !== 'refunded')
        shouldRestoreStock = true;
    }
    const textFields = ['billing_name', 'billing_email', 'billing_phone', 'billing_address', 'notes'];
    for (const field of textFields) {
      if (req.body[field] !== undefined) { updates[field] = req.body[field] || null; setClauses.push(`${field} = ?`); }
    }
    if (setClauses.length === 0) {
      const order = parseOrderRow(existing);
      return res.json({ message: 'No changes provided.', data: order });
    }
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    setClauses.push('updated_at = ?');
    const setValues = Object.values(updates);
    const sql = `UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`;
    const params = [...setValues, now, id];
    const performUpdate = db.transaction(() => {
      db.prepare(sql).run(...params);
      if (shouldRestoreStock) {
        let existingItems;
        try { existingItems = typeof existing.items === 'string' ? JSON.parse(existing.items) : existing.items; } catch { existingItems = []; }
        if (Array.isArray(existingItems)) {
          for (const item of existingItems) {
            if (item.product_id && item.quantity)
              db.prepare('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ? AND stock IS NOT NULL').run(item.quantity, now, item.product_id);
          }
        }
      }
    });
    performUpdate();
    const updated = db.prepare(`
      SELECT o.*, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = ?
    `).get(id);
    const order = parseOrderRow(updated);
    return res.json({ message: 'Order updated successfully.', data: order });
  } catch (err) {
    console.error('[orders] PUT error:', err.message);
    if (err.message && err.message.includes('FOREIGN KEY'))
      return res.status(400).json({ error: 'Invalid reference.', code: 'FK_CONFLICT' });
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;