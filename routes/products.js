// ---------------------------------------------------------------------------
// routes/products.js
// CRUD complet /api/products
//
// GET    /api/products       – public, listare cu paginare, sortare, căutare, filtrare
// GET    /api/products/:id   – public, detalii produs (sau după slug)
// POST   /api/products       – admin, creare produs
// PUT    /api/products/:id   – admin, actualizare produs
// DELETE /api/products/:id   – admin, ștergere produs
// ---------------------------------------------------------------------------

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDb } = require('../config/db');
const {
  validate,
  productCreateSchema,
  productUpdateSchema,
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
  'id', 'name', 'price', 'category', 'stock', 'created_at', 'updated_at',
];

/** Câmpurile permise pentru căutare */
const SEARCH_FIELDS = ['name', 'description', 'category'];

/** Categoriile predefinite de produse */
const PRODUCT_CATEGORIES = [
  'general', 'gloves', 'headgear', 'footwear', 'apparel', 'protection', 'accessories', 'equipment',
];

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
    throw new Error('[products] JWT_SECRET nu este definit în variabilele de mediu.');
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
 * Parsează un rând din baza de date, convertind tipurile SQLite
 * (0/1 → boolean, TEXT → number) în tipuri JavaScript native.
 *
 * @param {object} row - Rândul din baza de date
 * @returns {object}
 */
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

/**
 * Construiește clauza WHERE și parametrii pentru filtrare și căutare.
 *
 * @param {object} filters - { search, is_active, category, min_price, max_price, in_stock }
 * @returns {{ whereClause: string, params: Array }}
 */
function buildWhereClause(filters = {}) {
  const conditions = [];
  const params = [];

  // Filtru is_active (implicit: doar produse active pentru public)
  if (filters.is_active !== undefined) {
    conditions.push('p.is_active = ?');
    params.push(filters.is_active ? 1 : 0);
  }

  // Filtru categorie
  if (filters.category && typeof filters.category === 'string' && filters.category.trim()) {
    conditions.push('p.category = ?');
    params.push(filters.category.trim().toLowerCase());
  }

  // Filtru preț minim
  if (filters.min_price !== undefined && filters.min_price !== null) {
    conditions.push('p.price >= ?');
    params.push(Number(filters.min_price));
  }

  // Filtru preț maxim
  if (filters.max_price !== undefined && filters.max_price !== null) {
    conditions.push('p.price <= ?');
    params.push(Number(filters.max_price));
  }

  // Filtru „în stoc" – doar produse cu stock > 0
  if (filters.in_stock === true || filters.in_stock === 'true') {
    conditions.push('(p.stock IS NOT NULL AND p.stock > 0)');
  }

  // Căutare text în mai multe câmpuri
  if (filters.search && typeof filters.search === 'string' && filters.search.trim()) {
    const searchTerm = `%${filters.search.trim()}%`;
    const searchConditions = SEARCH_FIELDS.map(field => `p.${field} LIKE ?`);
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
 * Implicit: sortează după category ASC, apoi name ASC.
 *
 * @param {string} sort - Parametrul de sortare (ex: "price" sau "-created_at")
 * @returns {string}
 */
function buildOrderClause(sort) {
  if (!sort || typeof sort !== 'string') {
    return 'ORDER BY p.category ASC, p.name ASC';
  }

  const isDesc = sort.startsWith('-');
  const field = isDesc ? sort.slice(1) : sort;

  if (!ALLOWED_SORT_FIELDS.includes(field)) {
    return 'ORDER BY p.category ASC, p.name ASC';
  }

  const direction = isDesc ? 'DESC' : 'ASC';
  return `ORDER BY p.${field} ${direction}`;
}

// ---------------------------------------------------------------------------
// GET /api/products
// Public – listează produsele cu paginare, sortare, căutare și filtrare.
// Query params:
//   ?page=1&limit=12&sort=price&search=gloves&is_active=true
//   &category=gloves&min_price=10&max_price=100&in_stock=true
// ---------------------------------------------------------------------------

router.get(
  '/api/products',
  validate(paginationSchema),
  (req, res) => {
    try {
      const db = getDb();

      // Extragere parametri din query-ul sanitizat
      const page = req.query.page || 1;
      const limit = req.query.limit || 12;
      const sort = req.query.sort || null;
      const search = req.query.search || null;
      const isActiveParam = req.query.is_active;
      const categoryParam = req.query.category;
      const minPriceParam = req.query.min_price;
      const maxPriceParam = req.query.max_price;
      const inStockParam = req.query.in_stock;

      // Construim filtrele
      const filters = {};

      // is_active: dacă nu e specificat explicit, returnăm doar produsele active
      if (isActiveParam !== undefined) {
        filters.is_active = isActiveParam === 'true' || isActiveParam === true;
      } else {
        filters.is_active = true;
      }

      // Categorie
      if (categoryParam && typeof categoryParam === 'string') {
        filters.category = categoryParam;
      }

      // Filtre preț
      if (minPriceParam !== undefined && minPriceParam !== '') {
        filters.min_price = Number(minPriceParam);
      }
      if (maxPriceParam !== undefined && maxPriceParam !== '') {
        filters.max_price = Number(maxPriceParam);
      }

      // Filtru „în stoc"
      if (inStockParam === 'true' || inStockParam === true) {
        filters.in_stock = true;
      }

      if (search) {
        filters.search = search;
      }

      const { whereClause, params } = buildWhereClause(filters);
      const orderClause = buildOrderClause(sort);

      // Număr total (pentru paginare)
      const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
      const countResult = db.prepare(countSql).get(...params);
      const total = countResult ? countResult.total : 0;

      // Calcul offset
      const offset = (page - 1) * limit;

      // Query principal
      const dataSql = `
        SELECT p.*
        FROM products p
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const dataParams = [...params, limit, offset];
      const rows = db.prepare(dataSql).all(...dataParams);

      // Parsează rândurile
      const products = rows.map(parseProductRow);

      // Răspuns cu metadate de paginare
      return res.json({
        data: products,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (err) {
      console.error('[products] GET list error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/products/categories
// Public – returnează lista categoriilor disponibile cu număr de produse.
// Trebuie definită ÎNAINTE de ruta /api/products/:id pentru a nu intra în
// conflict cu parametrul :id (Express ar interpreta „categories" ca id).
// ---------------------------------------------------------------------------

router.get(
  '/api/products/categories',
  (req, res) => {
    try {
      const db = getDb();

      const rows = db.prepare(`
        SELECT
          p.category,
          COUNT(*) as product_count
        FROM products p
        WHERE p.is_active = 1
        GROUP BY p.category
        ORDER BY p.category ASC
      `).all();

      const categories = rows.map(row => ({
        category: row.category,
        productCount: row.product_count,
      }));

      return res.json({
        data: categories,
      });
    } catch (err) {
      console.error('[products] GET categories error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/products/:id
// Public – returnează detaliile unui produs după ID.
// Suportă și lookup după slug: /api/products/slug/produs-exemplu
// ---------------------------------------------------------------------------

router.get(
  '/api/products/:id',
  validate(paramsIdSchema),
  (req, res) => {
    try {
      const db = getDb();
      const { id } = req.params;

      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

      if (!row) {
        return res.status(404).json({
          error: 'Product not found.',
          code: 'NOT_FOUND',
        });
      }

      const product = parseProductRow(row);

      return res.json({ data: product });
    } catch (err) {
      console.error('[products] GET single error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/products/slug/:slug
// Public – returnează detaliile unui produs după slug.
// Rută separată pentru a evita conflictele cu :id numeric.
// ---------------------------------------------------------------------------

router.get(
  '/api/products/slug/:slug',
  (req, res) => {
    try {
      const db = getDb();
      const { slug } = req.params;

      if (!slug || typeof slug !== 'string' || slug.length > 128) {
        return res.status(400).json({
          error: 'Invalid slug parameter.',
          code: 'VALIDATION_ERROR',
        });
      }

      const row = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);

      if (!row) {
        return res.status(404).json({
          error: 'Product not found.',
          code: 'NOT_FOUND',
        });
      }

      const product = parseProductRow(row);

      return res.json({ data: product });
    } catch (err) {
      console.error('[products] GET by slug error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/products
// Admin only – creează un nou produs.
// ---------------------------------------------------------------------------

router.post(
  '/api/products',
  validate(productCreateSchema),
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
      // 3. Extragere date din body-ul validat
      // ------------------------------------------------------------------
      const {
        name,
        slug,
        description,
        price,
        category,
        stock,
        is_active,
      } = req.body;

      // image poate fi trimis ca string (URL sau cale) – nu face parte din
      // schema de validare, dar îl acceptăm dacă este prezent.
      const image = req.body.image || null;

      // ------------------------------------------------------------------
      // 4. Validare categorie
      // ------------------------------------------------------------------
      const normalizedCategory = (category || 'general').toLowerCase().trim();
      if (!PRODUCT_CATEGORIES.includes(normalizedCategory)) {
        return res.status(400).json({
          error: `Invalid category. Must be one of: ${PRODUCT_CATEGORIES.join(', ')}.`,
          code: 'VALIDATION_ERROR',
        });
      }

      // ------------------------------------------------------------------
      // 5. Verificare slug unic
      // ------------------------------------------------------------------
      const db = getDb();
      const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
      if (existing) {
        return res.status(409).json({
          error: 'A product with this slug already exists.',
          code: 'SLUG_CONFLICT',
        });
      }

      // ------------------------------------------------------------------
      // 6. Inserare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = db.prepare(`
        INSERT INTO products (name, slug, description, price, category, image, stock, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        slug,
        description || null,
        price,
        normalizedCategory,
        image,
        stock !== undefined && stock !== null ? stock : null,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        now,
        now,
      );

      // ------------------------------------------------------------------
      // 7. Returnează produsul creat
      // ------------------------------------------------------------------
      const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
      const product = parseProductRow(created);

      return res.status(201).json({
        message: 'Product created successfully.',
        data: product,
      });
    } catch (err) {
      console.error('[products] POST error:', err.message);

      // Eroare de constrângere SQLite (ex: slug duplicat prins de UNIQUE)
      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A product with this slug already exists.',
          code: 'SLUG_CONFLICT',
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
// PUT /api/products/:id
// Admin only – actualizează un produs existent.
// Acceptă un obiect parțial – doar câmpurile trimise se modifică.
// ---------------------------------------------------------------------------

router.put(
  '/api/products/:id',
  validate(productUpdateSchema),
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
      // 3. Verificare existență produs
      // ------------------------------------------------------------------
      const db = getDb();
      const { id } = req.params;

      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Product not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Construire SET dinamic (doar câmpurile trimise)
      // ------------------------------------------------------------------
      const updates = {};
      const setClauses = [];

      // Câmpuri text
      const textFields = ['name', 'slug', 'description'];

      for (const field of textFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
          setClauses.push(`${field} = ?`);
        }
      }

      // Câmpuri numerice
      if (req.body.price !== undefined) {
        updates.price = req.body.price;
        setClauses.push('price = ?');
      }
      if (req.body.stock !== undefined) {
        updates.stock = req.body.stock;
        setClauses.push('stock = ?');
      }

      // Categorie – cu validare
      if (req.body.category !== undefined) {
        const normalizedCategory = String(req.body.category).toLowerCase().trim();
        if (!PRODUCT_CATEGORIES.includes(normalizedCategory)) {
          return res.status(400).json({
            error: `Invalid category. Must be one of: ${PRODUCT_CATEGORIES.join(', ')}.`,
            code: 'VALIDATION_ERROR',
          });
        }
        updates.category = normalizedCategory;
        setClauses.push('category = ?');
      }

      // Imagine (acceptat ca string)
      if (req.body.image !== undefined) {
        updates.image = req.body.image;
        setClauses.push('image = ?');
      }

      // Câmp boolean
      if (req.body.is_active !== undefined) {
        updates.is_active = req.body.is_active ? 1 : 0;
        setClauses.push('is_active = ?');
      }

      // ------------------------------------------------------------------
      // 5. Dacă nu s-a trimis nimic, returnează produsul neschimbat
      // ------------------------------------------------------------------
      if (setClauses.length === 0) {
        const product = parseProductRow(existing);
        return res.json({
          message: 'No changes provided.',
          data: product,
        });
      }

      // ------------------------------------------------------------------
      // 6. Verificare slug unic (dacă se modifică slug-ul)
      // ------------------------------------------------------------------
      if (updates.slug !== undefined && updates.slug !== existing.slug) {
        const slugConflict = db.prepare(
          'SELECT id FROM products WHERE slug = ? AND id != ?'
        ).get(updates.slug, id);

        if (slugConflict) {
          return res.status(409).json({
            error: 'A product with this slug already exists.',
            code: 'SLUG_CONFLICT',
          });
        }
      }

      // ------------------------------------------------------------------
      // 7. Actualizare
      // ------------------------------------------------------------------
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      setClauses.push('updated_at = ?');

      const setValues = Object.values(updates);
      const sql = `UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`;
      const params = [...setValues, now, id];

      db.prepare(sql).run(...params);

      // ------------------------------------------------------------------
      // 8. Returnează produsul actualizat
      // ------------------------------------------------------------------
      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      const product = parseProductRow(updated);

      return res.json({
        message: 'Product updated successfully.',
        data: product,
      });
    } catch (err) {
      console.error('[products] PUT error:', err.message);

      if (err.message && err.message.includes('UNIQUE constraint')) {
        return res.status(409).json({
          error: 'A product with this slug already exists.',
          code: 'SLUG_CONFLICT',
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
// DELETE /api/products/:id
// Admin only – șterge un produs după ID.
// ---------------------------------------------------------------------------

router.delete(
  '/api/products/:id',
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

      const existing = db.prepare('SELECT id, name, slug FROM products WHERE id = ?').get(id);

      if (!existing) {
        return res.status(404).json({
          error: 'Product not found.',
          code: 'NOT_FOUND',
        });
      }

      // ------------------------------------------------------------------
      // 4. Ștergere
      // ------------------------------------------------------------------
      db.prepare('DELETE FROM products WHERE id = ?').run(id);

      return res.json({
        message: 'Product deleted successfully.',
        deleted: {
          id: existing.id,
          name: existing.name,
          slug: existing.slug,
        },
      });
    } catch (err) {
      console.error('[products] DELETE error:', err.message);

      // Eroare FK – produsul este referențiat în comenzi
      if (err.message && err.message.includes('FOREIGN KEY')) {
        return res.status(409).json({
          error: 'Cannot delete this product because it is referenced in existing orders.',
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