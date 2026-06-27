// ---------------------------------------------------------------------------
// routes/products.js
// CRUD complet /api/products
//
// GET    /api/products            – public, listare cu paginare, sortare, căutare, filtrare
// GET    /api/products/categories – public, listă categorii
// GET    /api/products/:id        – public, detalii produs (după ID)
// GET    /api/products/slug/:slug – public, detalii produs (după slug)
// POST   /api/products            – admin, creare produs
// PUT    /api/products/:id        – admin, actualizare produs
// DELETE /api/products/:id        – admin, ștergere produs
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const {
  validate,
  productCreateSchema,
  productUpdateSchema,
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
  'id', 'name', 'price', 'category', 'stock', 'created_at', 'updated_at',
];
const SEARCH_FIELDS = ['name', 'description', 'category'];
const PRODUCT_CATEGORIES = [
  'general', 'gloves', 'headgear', 'footwear', 'apparel', 'protection', 'accessories', 'equipment',
];

// ---------------------------------------------------------------------------
// Helpers – Parsare
// ---------------------------------------------------------------------------

function parseProductRow(row) {
  if (!row) return null;
  return {
    ...row,
    price: row.price !== null ? Number(row.price) : 0,
    stock: row.stock !== null ? Number(row.stock) : null,
    is_active: Boolean(row.is_active),
  };
}

// ---------------------------------------------------------------------------
// Helpers – Construire query
// ---------------------------------------------------------------------------

function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.is_active !== undefined) { conditions.push('p.is_active = ?'); params.push(filters.is_active ? 1 : 0); }
  if (filters.category && typeof filters.category === 'string' && filters.category.trim()) { conditions.push('p.category = ?'); params.push(filters.category.trim().toLowerCase()); }
  if (filters.min_price !== undefined && filters.min_price !== null) { conditions.push('p.price >= ?'); params.push(Number(filters.min_price)); }
  if (filters.max_price !== undefined && filters.max_price !== null) { conditions.push('p.price <= ?'); params.push(Number(filters.max_price)); }
  if (filters.in_stock === true || filters.in_stock === 'true') conditions.push('(p.stock IS NOT NULL AND p.stock > 0)');
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `p.${field} LIKE ?`);
    conditions.push(`(${searchConditions.join(' OR ')})`);
    for (let i = 0; i < SEARCH_FIELDS.length; i++) params.push(searchTerm);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') return 'ORDER BY p.category ASC, p.name ASC';
  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;
  if (!ALLOWED_SORT_FIELDS.includes(field)) return 'ORDER BY p.category ASC, p.name ASC';
  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY p.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/products
// ---------------------------------------------------------------------------

router.get('/api/products', validate(paginationSchema), (req, res) => {
  try {
    const db = getDb();
    const page = req.query.page || 1;
    const limit = req.query.limit || 12;
    const sort = req.query.sort || null;
    const search = req.query.search || null;
    const isActiveParam = req.query.is_active;
    const categoryParam = req.query.category;
    const minPriceParam = req.query.min_price;
    const maxPriceParam = req.query.max_price;
    const inStockParam = req.query.in_stock;
    const filters = {};
    if (isActiveParam !== undefined) filters.is_active = isActiveParam === 'true' || isActiveParam === true;
    else filters.is_active = true;
    if (categoryParam && typeof categoryParam === 'string') filters.category = categoryParam;
    if (minPriceParam !== undefined && minPriceParam !== '') filters.min_price = Number(minPriceParam);
    if (maxPriceParam !== undefined && maxPriceParam !== '') filters.max_price = Number(maxPriceParam);
    if (inStockParam === 'true' || inStockParam === true) filters.in_stock = true;
    if (search) filters.search = search;
    const { whereClause, params } = buildWhereClause(filters);
    const orderClause = buildOrderClause(sort);
    const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult ? countResult.total : 0;
    const offset = (page - 1) * limit;
    const dataSql = `SELECT p.* FROM products p ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const rows = db.prepare(dataSql).all(...dataParams);
    const products = rows.map(parseProductRow);
    return res.json({
      data: products,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    console.error('[products] GET list error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/categories
// ---------------------------------------------------------------------------

router.get('/api/products/categories', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT p.category, COUNT(*) as product_count
      FROM products p WHERE p.is_active = 1
      GROUP BY p.category ORDER BY p.category ASC
    `).all();
    const categories = rows.map(row => ({ category: row.category, productCount: row.product_count }));
    return res.json({ data: categories });
  } catch (err) {
    console.error('[products] GET categories error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/:id
// ---------------------------------------------------------------------------

router.get('/api/products/:id', validate(paramsIdSchema), (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
    const product = parseProductRow(row);
    return res.json({ data: product });
  } catch (err) {
    console.error('[products] GET single error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/products/slug/:slug
// ---------------------------------------------------------------------------

router.get('/api/products/slug/:slug', (req, res) => {
  try {
    const db = getDb();
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string' || slug.length > 128)
      return res.status(400).json({ error: 'Invalid slug parameter.', code: 'VALIDATION_ERROR' });
    const row = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
    if (!row) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
    const product = parseProductRow(row);
    return res.json({ data: product });
  } catch (err) {
    console.error('[products] GET by slug error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/products
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.post(
  '/api/products',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(productCreateSchema),
  (req, res) => {
    try {
      const { name, slug, description, price, category, stock, is_active } = req.body;
      const image = req.body.image || null;
      const normalizedCategory = (category || 'general').toLowerCase().trim();
      if (!PRODUCT_CATEGORIES.includes(normalizedCategory))
        return res.status(400).json({ error: `Invalid category. Must be one of: ${PRODUCT_CATEGORIES.join(', ')}.`, code: 'VALIDATION_ERROR' });
      const db = getDb();
      const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
      if (existing) return res.status(409).json({ error: 'A product with this slug already exists.', code: 'SLUG_CONFLICT' });
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const result = db.prepare(`
        INSERT INTO products (name, slug, description, price, category, image, stock, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name, slug, description || null, price, normalizedCategory, image,
        stock !== undefined && stock !== null ? stock : null,
        is_active !== undefined ? (is_active ? 1 : 0) : 1, now, now
      );
      const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
      const product = parseProductRow(created);
      return res.status(201).json({ message: 'Product created successfully.', data: product });
    } catch (err) {
      console.error('[products] POST error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'A product with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/products/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put(
  '/api/products/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(productUpdateSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
      const updates = {};
      const setClauses = [];
      const textFields = ['name', 'slug', 'description'];
      for (const field of textFields) {
        if (req.body[field] !== undefined) { updates[field] = req.body[field]; setClauses.push(`${field} = ?`); }
      }
      if (req.body.price !== undefined) { updates.price = req.body.price; setClauses.push('price = ?'); }
      if (req.body.stock !== undefined) { updates.stock = req.body.stock; setClauses.push('stock = ?'); }
      if (req.body.category !== undefined) {
        const normalizedCategory = String(req.body.category).toLowerCase().trim();
        if (!PRODUCT_CATEGORIES.includes(normalizedCategory))
          return res.status(400).json({ error: `Invalid category. Must be one of: ${PRODUCT_CATEGORIES.join(', ')}.`, code: 'VALIDATION_ERROR' });
        updates.category = normalizedCategory;
        setClauses.push('category = ?');
      }
      if (req.body.image !== undefined) { updates.image = req.body.image; setClauses.push('image = ?'); }
      if (req.body.is_active !== undefined) { updates.is_active = req.body.is_active ? 1 : 0; setClauses.push('is_active = ?'); }
      if (setClauses.length === 0) {
        const product = parseProductRow(existing);
        return res.json({ message: 'No changes provided.', data: product });
      }
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(updates.slug, id);
        if (slugConflict) return res.status(409).json({ error: 'A product with this slug already exists.', code: 'SLUG_CONFLICT' });
      }
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');
      const setValues = Object.values(updates);
      const sql = `UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];
      db.prepare(sql).run(...params);
      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      const product = parseProductRow(updated);
      return res.json({ message: 'Product updated successfully.', data: product });
    } catch (err) {
      console.error('[products] PUT error:', err.message);
      if (err.message && err.message.includes('UNIQUE constraint'))
        return res.status(409).json({ error: 'A product with this slug already exists.', code: 'SLUG_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/products/:id
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.delete(
  '/api/products/:id',
  authenticate,
  csrfProtection,
  authorize('admin'),
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;
      const existing = db.prepare('SELECT id, name, slug FROM products WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'Product not found.', code: 'NOT_FOUND' });
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
      return res.json({ message: 'Product deleted successfully.', deleted: { id: existing.id, name: existing.name, slug: existing.slug } });
    } catch (err) {
      console.error('[products] DELETE error:', err.message);
      if (err.message && err.message.includes('FOREIGN KEY'))
        return res.status(409).json({ error: 'Cannot delete this product because it is referenced in existing orders.', code: 'FK_CONFLICT' });
      return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
    }
  }
);

module.exports = router;