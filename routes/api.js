'use strict';

// ---------------------------------------------------------------------------
// routes/api.js — Boxing Champions API Routes
//
// Public endpoints (no auth):
//   GET  /api/settings              – public settings
//   GET  /api/coaches               – active coaches
//   GET  /api/events                – active events
//   GET  /api/events/:id            – single event + photos
//   GET  /api/schedule              – active schedule
//   GET  /api/subscriptions         – active subscriptions
//   GET  /api/products              – active products (opt. ?category=)
//   GET  /api/products/:id          – single product
//   GET  /api/achievements          – public achievements
//   POST /api/messages              – submit contact message
//   POST /api/checkout              – create Stripe checkout session
//
// Admin endpoints (JWT required, prefixed /api/admin):
//   Settings       GET /, PUT /
//   Coaches        GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Events         GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//                  GET /:id/photos, POST /:id/photos, PUT /:id/photos/:pid, DELETE /:id/photos/:pid
//   Schedule       GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Subscriptions  GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Products       GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Orders         GET /, GET /:id, PATCH /:id/status, DELETE /:id
//   Messages       GET /, GET /:id, PATCH /:id/read, DELETE /:id
//   Achievements   GET /, PUT /:key
//   SEO            GET /, PUT /
//
// Stripe integration: uses STRIPE_KEY from env, creates checkout sessions
// with line_items from cart, stores order via db.createOrder.
// ---------------------------------------------------------------------------

const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Stripe initialization (lazy, fails gracefully if key is missing)
// ---------------------------------------------------------------------------
let stripe = null;
function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_KEY || '';
    if (key) {
      stripe = require('stripe')(key);
    }
  }
  return stripe;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ['Îmbrăcăminte', 'Echipament', 'Accesorii', 'Nutriție'];
const VALID_DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
const VALID_GENDERS = ['Masculin', 'Feminin', 'Mixt'];
const VALID_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeInt(n) {
  return Number.isInteger(n) && n >= 0;
}

function isPositiveNum(n) {
  return typeof n === 'number' && n > 0 && !Number.isNaN(n);
}

function isNonNegativeNum(n) {
  return typeof n === 'number' && n >= 0 && !Number.isNaN(n);
}

function isString(s, maxLen = 5000) {
  return typeof s === 'string' && s.length <= maxLen;
}

function isOptionalString(s, maxLen = 5000) {
  return s === undefined || s === null || (typeof s === 'string' && s.length <= maxLen);
}

function sanitizeString(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 5000);
}

// ---------------------------------------------------------------------------
// === PUBLIC ROUTES (no authentication) ===
// ---------------------------------------------------------------------------

// --- Settings ---
router.get('/settings', (_req, res) => {
  try {
    const settings = db.getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[API] GET /settings error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea setărilor.' });
  }
});

// --- Coaches (active only) ---
router.get('/coaches', (_req, res) => {
  try {
    const coaches = db.getActiveCoaches();
    return res.json(coaches);
  } catch (err) {
    console.error('[API] GET /coaches error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea antrenorilor.' });
  }
});

// --- Events (active only) ---
router.get('/events', (_req, res) => {
  try {
    const events = db.getActiveEvents();
    return res.json(events);
  } catch (err) {
    console.error('[API] GET /events error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea evenimentelor.' });
  }
});

// --- Single event with photos ---
router.get('/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }
    const event = db.getEventById(id);
    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }
    return res.json(event);
  } catch (err) {
    console.error('[API] GET /events/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea evenimentului.' });
  }
});

// --- Schedule (active only) ---
router.get('/schedule', (_req, res) => {
  try {
    const schedule = db.getActiveSchedule();
    return res.json(schedule);
  } catch (err) {
    console.error('[API] GET /schedule error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea programului.' });
  }
});

// --- Subscriptions (active only) ---
router.get('/subscriptions', (_req, res) => {
  try {
    const subscriptions = db.getActiveSubscriptions();
    return res.json(subscriptions);
  } catch (err) {
    console.error('[API] GET /subscriptions error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea abonamentelor.' });
  }
});

// --- Products (active only, optional category filter) ---
router.get('/products', (req, res) => {
  try {
    const { category } = req.query;
    let products;
    if (category && typeof category === 'string' && category.trim()) {
      const cat = category.trim();
      if (!VALID_CATEGORIES.includes(cat)) {
        return res.status(400).json({ error: 'Categorie invalidă.' });
      }
      products = db.getProductsByCategory(cat);
    } else {
      products = db.getActiveProducts();
    }
    return res.json(products);
  } catch (err) {
    console.error('[API] GET /products error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea produselor.' });
  }
});

// --- Single product ---
router.get('/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID produs invalid.' });
    }
    const product = db.getProductById(id);
    if (!product) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    }
    return res.json(product);
  } catch (err) {
    console.error('[API] GET /products/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea produsului.' });
  }
});

// --- Achievements ---
router.get('/achievements', (_req, res) => {
  try {
    const achievements = db.getAllAchievements();
    return res.json(achievements);
  } catch (err) {
    console.error('[API] GET /achievements error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea realizărilor.' });
  }
});

// --- Messages (submit contact form) ---
router.post('/messages', (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body || {};

    // Validation
    const errors = [];
    if (!isString(name, 200) || name.trim().length < 2) {
      errors.push('Numele trebuie să aibă între 2 și 200 de caractere.');
    }
    if (!isString(email, 320) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email.trim())) {
      errors.push('Adresa de email este invalidă.');
    }
    if (phone && !isString(phone, 30)) {
      errors.push('Numărul de telefon este prea lung.');
    }
    if (!isString(subject, 300) || subject.trim().length < 2) {
      errors.push('Subiectul trebuie să aibă între 2 și 300 de caractere.');
    }
    if (!isString(message, 5000) || message.trim().length < 10) {
      errors.push('Mesajul trebuie să aibă între 10 și 5000 de caractere.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    db.createMessage({
      name: sanitizeString(name),
      email: sanitizeString(email).toLowerCase(),
      phone: sanitizeString(phone || ''),
      subject: sanitizeString(subject),
      message: sanitizeString(message),
    });

    return res.status(201).json({ message: 'Mesajul a fost trimis cu succes.' });
  } catch (err) {
    console.error('[API] POST /messages error:', err.message);
    return res.status(500).json({ error: 'Eroare la trimiterea mesajului.' });
  }
});

// ---------------------------------------------------------------------------
// --- Stripe Checkout Session ---
// ---------------------------------------------------------------------------

/**
 * POST /api/checkout
 *
 * Body (JSON):
 * {
 *   "items": [
 *     { "id": 1, "name": "Mănuși de box", "price": 150, "quantity": 2 }
 *   ],
 *   "customer": {
 *     "name": "John Doe",
 *     "email": "john@example.com",
 *     "phone": "+40 721 234 567"
 *   }
 * }
 *
 * Creates a Stripe Checkout Session and returns { url: "..." } for redirect.
 * If Stripe is not configured, returns a mock response for testing.
 */
router.post('/checkout', async (req, res) => {
  try {
    const { items, customer } = req.body || {};

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Coșul de cumpărături este gol.' });
    }

    for (const item of items) {
      if (!item.id || !isPositiveInt(item.id)) {
        return res.status(400).json({ error: 'ID produs invalid în coș.' });
      }
      if (!isString(item.name, 500) || item.name.trim().length === 0) {
        return res.status(400).json({ error: 'Nume produs invalid în coș.' });
      }
      if (!isPositiveNum(item.price) || item.price > 1000000) {
        return res.status(400).json({ error: 'Preț produs invalid în coș.' });
      }
      if (!isPositiveInt(item.quantity) || item.quantity > 100) {
        return res.status(400).json({ error: 'Cantitate invalidă în coș.' });
      }
    }

    // Validate customer
    if (!customer || typeof customer !== 'object') {
      return res.status(400).json({ error: 'Datele clientului sunt obligatorii.' });
    }
    if (!isString(customer.name, 200) || customer.name.trim().length < 2) {
      return res.status(400).json({ error: 'Numele clientului este invalid.' });
    }
    if (!isString(customer.email, 320) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(customer.email.trim())) {
      return res.status(400).json({ error: 'Email client invalid.' });
    }

    const customerName = sanitizeString(customer.name);
    const customerEmail = sanitizeString(customer.email).toLowerCase();
    const customerPhone = sanitizeString(customer.phone || '');

    // Calculate total
    const totalRON = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Build Stripe line_items
    const line_items = items.map((item) => ({
      price_data: {
        currency: 'ron',
        product_data: {
          name: item.name.trim().slice(0, 500),
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    const stripeInstance = getStripe();

    // If no Stripe key is configured, store order and return mock success
    if (!stripeInstance) {
      const order = db.createOrder({
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        items,
        total: totalRON,
        stripe_session_id: 'mock_session_' + Date.now(),
      });

      return res.status(201).json({
        message: 'Comanda a fost creată (mod test fără Stripe).',
        orderId: order.id,
        url: '/shop/thank-you?orderId=' + order.id,
      });
    }

    // Determine base URL for success/cancel
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    // Create Stripe session
    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: customerEmail,
      line_items,
      metadata: {
        customer_name: customerName,
        customer_phone: customerPhone,
      },
      success_url: `${baseUrl}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/shop`,
    });

    // Store order in database
    const order = db.createOrder({
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      items,
      total: totalRON,
      stripe_session_id: session.id,
    });

    return res.status(201).json({
      message: 'Sesiune de plată creată.',
      orderId: order.id,
      url: session.url,
    });
  } catch (err) {
    console.error('[API] POST /checkout error:', err.message);
    return res.status(500).json({
      error: 'Eroare la crearea sesiunii de plată.',
      details: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
});

// ---------------------------------------------------------------------------
// === ADMIN ROUTES (JWT protected) ===
// ---------------------------------------------------------------------------

const adminRouter = express.Router();

// Apply JWT verification to all admin routes
adminRouter.use(verifyToken);

// ---------------------------------------------------------------------------
// Admin: Settings
// ---------------------------------------------------------------------------

adminRouter.get('/settings', (_req, res) => {
  try {
    const settings = db.getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[API] GET /admin/settings error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea setărilor.' });
  }
});

adminRouter.put('/settings', (req, res) => {
  try {
    const settingsObj = req.body;
    if (!settingsObj || typeof settingsObj !== 'object' || Array.isArray(settingsObj)) {
      return res.status(400).json({ error: 'Corpul trebuie să fie un obiect cu perechi cheie-valoare.' });
    }

    const allowedKeys = [
      'club_name', 'slogan', 'email', 'phone', 'address',
      'facebook', 'instagram', 'tiktok', 'hero_badge', 'about_text',
    ];

    for (const [key, value] of Object.entries(settingsObj)) {
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ error: `Cheia "${key}" nu este permisă.` });
      }
      if (typeof value !== 'string' || value.length > 2000) {
        return res.status(400).json({ error: `Valoarea pentru "${key}" trebuie să fie un string de max 2000 caractere.` });
      }
    }

    const updated = db.updateSettingsBatch(settingsObj);
    return res.json(updated);
  } catch (err) {
    console.error('[API] PUT /admin/settings error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea setărilor.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Coaches
// ---------------------------------------------------------------------------

adminRouter.get('/coaches', (_req, res) => {
  try {
    const coaches = db.getAllCoaches();
    return res.json(coaches);
  } catch (err) {
    console.error('[API] GET /admin/coaches error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea antrenorilor.' });
  }
});

adminRouter.get('/coaches/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID antrenor invalid.' });
    }
    const coach = db.getCoachById(id);
    if (!coach) {
      return res.status(404).json({ error: 'Antrenorul nu a fost găsit.' });
    }
    return res.json(coach);
  } catch (err) {
    console.error('[API] GET /admin/coaches/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea antrenorului.' });
  }
});

adminRouter.post('/coaches', (req, res) => {
  try {
    const { name, specialization, certifications, photo, quote, active } = req.body || {};

    const errors = [];
    if (!isString(name, 200) || name.trim().length < 2) {
      errors.push('Numele trebuie să aibă între 2 și 200 de caractere.');
    }
    if (!isOptionalString(specialization, 500)) {
      errors.push('Specializarea este prea lungă.');
    }
    if (!isOptionalString(certifications, 1000)) {
      errors.push('Certificările sunt prea lungi.');
    }
    if (!isOptionalString(photo, 2000)) {
      errors.push('URL-ul pozei este prea lung.');
    }
    if (!isOptionalString(quote, 1000)) {
      errors.push('Citatul este prea lung.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const coach = db.createCoach({
      name: sanitizeString(name),
      specialization: sanitizeString(specialization || ''),
      certifications: sanitizeString(certifications || ''),
      photo: sanitizeString(photo || ''),
      quote: sanitizeString(quote || ''),
      active: active !== undefined ? (active ? 1 : 0) : 1,
    });

    return res.status(201).json(coach);
  } catch (err) {
    console.error('[API] POST /admin/coaches error:', err.message);
    return res.status(500).json({ error: 'Eroare la crearea antrenorului.' });
  }
});

adminRouter.put('/coaches/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID antrenor invalid.' });
    }

    const { name, specialization, certifications, photo, quote, active } = req.body || {};

    const errors = [];
    if (name !== undefined && (!isString(name, 200) || name.trim().length < 2)) {
      errors.push('Numele trebuie să aibă între 2 și 200 de caractere.');
    }
    if (!isOptionalString(specialization, 500)) errors.push('Specializarea este prea lungă.');
    if (!isOptionalString(certifications, 1000)) errors.push('Certificările sunt prea lungi.');
    if (!isOptionalString(photo, 2000)) errors.push('URL-ul pozei este prea lung.');
    if (!isOptionalString(quote, 1000)) errors.push('Citatul este prea lung.');

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const coach = db.updateCoach(id, {
      name: name !== undefined ? sanitizeString(name) : undefined,
      specialization: specialization !== undefined ? sanitizeString(specialization) : undefined,
      certifications: certifications !== undefined ? sanitizeString(certifications) : undefined,
      photo: photo !== undefined ? sanitizeString(photo) : undefined,
      quote: quote !== undefined ? sanitizeString(quote) : undefined,
      active: active !== undefined ? (active ? 1 : 0) : undefined,
    });

    if (!coach) {
      return res.status(404).json({ error: 'Antrenorul nu a fost găsit.' });
    }

    return res.json(coach);
  } catch (err) {
    console.error('[API] PUT /admin/coaches/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea antrenorului.' });
  }
});

adminRouter.delete('/coaches/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID antrenor invalid.' });
    }
    const result = db.deleteCoach(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Antrenorul nu a fost găsit.' });
    }
    return res.json({ message: 'Antrenorul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/coaches/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea antrenorului.' });
  }
});

adminRouter.patch('/coaches/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID antrenor invalid.' });
    }
    const coach = db.toggleCoachActive(id);
    if (!coach) {
      return res.status(404).json({ error: 'Antrenorul nu a fost găsit.' });
    }
    return res.json(coach);
  } catch (err) {
    console.error('[API] PATCH /admin/coaches/:id/toggle error:', err.message);
    return res.status(500).json({ error: 'Eroare la comutarea stării.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Events
// ---------------------------------------------------------------------------

adminRouter.get('/events', (_req, res) => {
  try {
    const events = db.getAllEvents();
    return res.json(events);
  } catch (err) {
    console.error('[API] GET /admin/events error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea evenimentelor.' });
  }
});

adminRouter.get('/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }
    const event = db.getEventById(id);
    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }
    return res.json(event);
  } catch (err) {
    console.error('[API] GET /admin/events/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea evenimentului.' });
  }
});

adminRouter.post('/events', (req, res) => {
  try {
    const { title, event_date, location, description, active } = req.body || {};

    const errors = [];
    if (!isString(title, 300) || title.trim().length < 2) {
      errors.push('Titlul trebuie să aibă între 2 și 300 de caractere.');
    }
    if (!isString(event_date, 50) || !/^\d{4}-\d{2}-\d{2}$/.test(event_date.trim())) {
      errors.push('Data trebuie să fie în format YYYY-MM-DD.');
    }
    if (!isOptionalString(location, 500)) {
      errors.push('Locația este prea lungă.');
    }
    if (!isOptionalString(description, 5000)) {
      errors.push('Descrierea este prea lungă.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const event = db.createEvent({
      title: sanitizeString(title),
      event_date: sanitizeString(event_date),
      location: sanitizeString(location || ''),
      description: sanitizeString(description || ''),
      active: active !== undefined ? (active ? 1 : 0) : 1,
    });

    return res.status(201).json(event);
  } catch (err) {
    console.error('[API] POST /admin/events error:', err.message);
    return res.status(500).json({ error: 'Eroare la crearea evenimentului.' });
  }
});

adminRouter.put('/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }

    const { title, event_date, location, description, active } = req.body || {};

    const errors = [];
    if (title !== undefined && (!isString(title, 300) || title.trim().length < 2)) {
      errors.push('Titlul trebuie să aibă între 2 și 300 de caractere.');
    }
    if (event_date !== undefined && (!isString(event_date, 50) || !/^\d{4}-\d{2}-\d{2}$/.test(event_date.trim()))) {
      errors.push('Data trebuie să fie în format YYYY-MM-DD.');
    }
    if (!isOptionalString(location, 500)) errors.push('Locația este prea lungă.');
    if (!isOptionalString(description, 5000)) errors.push('Descrierea este prea lungă.');

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const event = db.updateEvent(id, {
      title: title !== undefined ? sanitizeString(title) : undefined,
      event_date: event_date !== undefined ? sanitizeString(event_date) : undefined,
      location: location !== undefined ? sanitizeString(location) : undefined,
      description: description !== undefined ? sanitizeString(description) : undefined,
      active: active !== undefined ? (active ? 1 : 0) : undefined,
    });

    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }

    return res.json(event);
  } catch (err) {
    console.error('[API] PUT /admin/events/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea evenimentului.' });
  }
});

adminRouter.delete('/events/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }
    const result = db.deleteEvent(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }
    return res.json({ message: 'Evenimentul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/events/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea evenimentului.' });
  }
});

adminRouter.patch('/events/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }
    const event = db.toggleEventActive(id);
    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }
    return res.json(event);
  } catch (err) {
    console.error('[API] PATCH /admin/events/:id/toggle error:', err.message);
    return res.status(500).json({ error: 'Eroare la comutarea stării.' });
  }
});

// --- Event Photos ---

adminRouter.get('/events/:id/photos', (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (!isPositiveInt(eventId)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }
    const event = db.getEventById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }
    return res.json(event.photos || []);
  } catch (err) {
    console.error('[API] GET /admin/events/:id/photos error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea fotografiilor.' });
  }
});

adminRouter.post('/events/:id/photos', (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (!isPositiveInt(eventId)) {
      return res.status(400).json({ error: 'ID eveniment invalid.' });
    }

    const event = db.getEventById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Evenimentul nu a fost găsit.' });
    }

    const { url, caption, sort_order } = req.body || {};

    const errors = [];
    if (!isString(url, 2000) || url.trim().length === 0) {
      errors.push('URL-ul fotografiei este obligatoriu.');
    }
    if (!isOptionalString(caption, 500)) {
      errors.push('Descrierea fotografiei este prea lungă.');
    }
    if (sort_order !== undefined && !isNonNegativeInt(sort_order)) {
      errors.push('Ordinea de sortare trebuie să fie un număr pozitiv.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const result = db.addEventPhoto(eventId, {
      url: sanitizeString(url),
      caption: sanitizeString(caption || ''),
      sort_order: sort_order ?? 0,
    });

    const photo = db.getDb()
      .prepare('SELECT * FROM event_photos WHERE id = ?')
      .get(result.lastInsertRowid);

    return res.status(201).json(photo);
  } catch (err) {
    console.error('[API] POST /admin/events/:id/photos error:', err.message);
    return res.status(500).json({ error: 'Eroare la adăugarea fotografiei.' });
  }
});

adminRouter.put('/events/:eventId/photos/:photoId', (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId, 10);
    if (!isPositiveInt(photoId)) {
      return res.status(400).json({ error: 'ID fotografie invalid.' });
    }

    const { url, caption, sort_order } = req.body || {};

    const errors = [];
    if (!isOptionalString(url, 2000)) errors.push('URL-ul fotografiei este prea lung.');
    if (!isOptionalString(caption, 500)) errors.push('Descrierea fotografiei este prea lungă.');
    if (sort_order !== undefined && !isNonNegativeInt(sort_order)) {
      errors.push('Ordinea de sortare trebuie să fie un număr pozitiv.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const photo = db.updateEventPhoto(photoId, {
      url: url !== undefined ? sanitizeString(url) : undefined,
      caption: caption !== undefined ? sanitizeString(caption) : undefined,
      sort_order: sort_order !== undefined ? sort_order : undefined,
    });

    if (!photo) {
      return res.status(404).json({ error: 'Fotografia nu a fost găsită.' });
    }

    return res.json(photo);
  } catch (err) {
    console.error('[API] PUT /admin/events/:eventId/photos/:photoId error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea fotografiei.' });
  }
});

adminRouter.delete('/events/:eventId/photos/:photoId', (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId, 10);
    if (!isPositiveInt(photoId)) {
      return res.status(400).json({ error: 'ID fotografie invalid.' });
    }
    const result = db.deleteEventPhoto(photoId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Fotografia nu a fost găsită.' });
    }
    return res.json({ message: 'Fotografia a fost ștearsă.' });
  } catch (err) {
    console.error('[API] DELETE /admin/events/:eventId/photos/:photoId error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea fotografiei.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Schedule
// ---------------------------------------------------------------------------

adminRouter.get('/schedule', (_req, res) => {
  try {
    const schedule = db.getAllSchedule();
    return res.json(schedule);
  } catch (err) {
    console.error('[API] GET /admin/schedule error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea programului.' });
  }
});

adminRouter.get('/schedule/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID program invalid.' });
    }
    const slot = db.getScheduleById(id);
    if (!slot) {
      return res.status(404).json({ error: 'Slotul nu a fost găsit.' });
    }
    return res.json(slot);
  } catch (err) {
    console.error('[API] GET /admin/schedule/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea slotului.' });
  }
});

adminRouter.post('/schedule', (req, res) => {
  try {
    const { day, start_time, end_time, category, gender, active } = req.body || {};

    const errors = [];
    if (!isString(day, 20) || !VALID_DAYS.includes(day.trim())) {
      errors.push(`Ziua trebuie să fie una din: ${VALID_DAYS.join(', ')}.`);
    }
    if (!isString(start_time, 10) || !/^\d{2}:\d{2}$/.test(start_time.trim())) {
      errors.push('Ora de început trebuie să fie în format HH:mm.');
    }
    if (!isString(end_time, 10) || !/^\d{2}:\d{2}$/.test(end_time.trim())) {
      errors.push('Ora de sfârșit trebuie să fie în format HH:mm.');
    }
    if (!isString(category, 200) || category.trim().length < 2) {
      errors.push('Categoria trebuie să aibă între 2 și 200 de caractere.');
    }
    if (!isString(gender, 20) || !VALID_GENDERS.includes(gender.trim())) {
      errors.push(`Sexul trebuie să fie unul din: ${VALID_GENDERS.join(', ')}.`);
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const slot = db.createSchedule({
      day: sanitizeString(day),
      start_time: sanitizeString(start_time),
      end_time: sanitizeString(end_time),
      category: sanitizeString(category),
      gender: sanitizeString(gender),
      active: active !== undefined ? (active ? 1 : 0) : 1,
    });

    return res.status(201).json(slot);
  } catch (err) {
    console.error('[API] POST /admin/schedule error:', err.message);
    return res.status(500).json({ error: 'Eroare la crearea slotului.' });
  }
});

adminRouter.put('/schedule/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID program invalid.' });
    }

    const { day, start_time, end_time, category, gender, active } = req.body || {};

    const errors = [];
    if (day !== undefined && (!isString(day, 20) || !VALID_DAYS.includes(day.trim()))) {
      errors.push(`Ziua trebuie să fie una din: ${VALID_DAYS.join(', ')}.`);
    }
    if (start_time !== undefined && (!isString(start_time, 10) || !/^\d{2}:\d{2}$/.test(start_time.trim()))) {
      errors.push('Ora de început trebuie să fie în format HH:mm.');
    }
    if (end_time !== undefined && (!isString(end_time, 10) || !/^\d{2}:\d{2}$/.test(end_time.trim()))) {
      errors.push('Ora de sfârșit trebuie să fie în format HH:mm.');
    }
    if (category !== undefined && (!isString(category, 200) || category.trim().length < 2)) {
      errors.push('Categoria trebuie să aibă între 2 și 200 de caractere.');
    }
    if (gender !== undefined && (!isString(gender, 20) || !VALID_GENDERS.includes(gender.trim()))) {
      errors.push(`Sexul trebuie să fie unul din: ${VALID_GENDERS.join(', ')}.`);
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const slot = db.updateSchedule(id, {
      day: day !== undefined ? sanitizeString(day) : undefined,
      start_time: start_time !== undefined ? sanitizeString(start_time) : undefined,
      end_time: end_time !== undefined ? sanitizeString(end_time) : undefined,
      category: category !== undefined ? sanitizeString(category) : undefined,
      gender: gender !== undefined ? sanitizeString(gender) : undefined,
      active: active !== undefined ? (active ? 1 : 0) : undefined,
    });

    if (!slot) {
      return res.status(404).json({ error: 'Slotul nu a fost găsit.' });
    }

    return res.json(slot);
  } catch (err) {
    console.error('[API] PUT /admin/schedule/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea slotului.' });
  }
});

adminRouter.delete('/schedule/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID program invalid.' });
    }
    const result = db.deleteSchedule(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Slotul nu a fost găsit.' });
    }
    return res.json({ message: 'Slotul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/schedule/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea slotului.' });
  }
});

adminRouter.patch('/schedule/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID program invalid.' });
    }
    const slot = db.toggleScheduleActive(id);
    if (!slot) {
      return res.status(404).json({ error: 'Slotul nu a fost găsit.' });
    }
    return res.json(slot);
  } catch (err) {
    console.error('[API] PATCH /admin/schedule/:id/toggle error:', err.message);
    return res.status(500).json({ error: 'Eroare la comutarea stării.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Subscriptions
// ---------------------------------------------------------------------------

adminRouter.get('/subscriptions', (_req, res) => {
  try {
    const subscriptions = db.getAllSubscriptions();
    return res.json(subscriptions);
  } catch (err) {
    console.error('[API] GET /admin/subscriptions error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea abonamentelor.' });
  }
});

adminRouter.get('/subscriptions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID abonament invalid.' });
    }
    const subscription = db.getSubscriptionById(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Abonamentul nu a fost găsit.' });
    }
    return res.json(subscription);
  } catch (err) {
    console.error('[API] GET /admin/subscriptions/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea abonamentului.' });
  }
});

adminRouter.post('/subscriptions', (req, res) => {
  try {
    const { name, monthly_price, yearly_price, benefits, highlighted, active } = req.body || {};

    const errors = [];
    if (!isString(name, 200) || name.trim().length < 2) {
      errors.push('Numele trebuie să aibă între 2 și 200 de caractere.');
    }
    if (!isNonNegativeNum(monthly_price) || monthly_price > 100000) {
      errors.push('Prețul lunar trebuie să fie un număr între 0 și 100000.');
    }
    if (!isNonNegativeNum(yearly_price) || yearly_price > 1000000) {
      errors.push('Prețul anual trebuie să fie un număr între 0 și 1000000.');
    }
    if (benefits !== undefined) {
      if (typeof benefits === 'string') {
        try { JSON.parse(benefits); } catch { errors.push('Beneficiile trebuie să fie un JSON valid.'); }
      } else if (!Array.isArray(benefits)) {
        errors.push('Beneficiile trebuie să fie un array.');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const subscription = db.createSubscription({
      name: sanitizeString(name),
      monthly_price,
      yearly_price,
      benefits: benefits || [],
      highlighted: highlighted ? 1 : 0,
      active: active !== undefined ? (active ? 1 : 0) : 1,
    });

    return res.status(201).json(subscription);
  } catch (err) {
    console.error('[API] POST /admin/subscriptions error:', err.message);
    return res.status(500).json({ error: 'Eroare la crearea abonamentului.' });
  }
});

adminRouter.put('/subscriptions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID abonament invalid.' });
    }

    const { name, monthly_price, yearly_price, benefits, highlighted, active } = req.body || {};

    const errors = [];
    if (name !== undefined && (!isString(name, 200) || name.trim().length < 2)) {
      errors.push('Numele trebuie să aibă între 2 și 200 de caractere.');
    }
    if (monthly_price !== undefined && (!isNonNegativeNum(monthly_price) || monthly_price > 100000)) {
      errors.push('Prețul lunar trebuie să fie un număr între 0 și 100000.');
    }
    if (yearly_price !== undefined && (!isNonNegativeNum(yearly_price) || yearly_price > 1000000)) {
      errors.push('Prețul anual trebuie să fie un număr între 0 și 1000000.');
    }
    if (benefits !== undefined) {
      if (typeof benefits === 'string') {
        try { JSON.parse(benefits); } catch { errors.push('Beneficiile trebuie să fie un JSON valid.'); }
      } else if (!Array.isArray(benefits)) {
        errors.push('Beneficiile trebuie să fie un array.');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const subscription = db.updateSubscription(id, {
      name: name !== undefined ? sanitizeString(name) : undefined,
      monthly_price: monthly_price !== undefined ? monthly_price : undefined,
      yearly_price: yearly_price !== undefined ? yearly_price : undefined,
      benefits: benefits !== undefined ? benefits : undefined,
      highlighted: highlighted !== undefined ? (highlighted ? 1 : 0) : undefined,
      active: active !== undefined ? (active ? 1 : 0) : undefined,
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Abonamentul nu a fost găsit.' });
    }

    return res.json(subscription);
  } catch (err) {
    console.error('[API] PUT /admin/subscriptions/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea abonamentului.' });
  }
});

adminRouter.delete('/subscriptions/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID abonament invalid.' });
    }
    const result = db.deleteSubscription(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Abonamentul nu a fost găsit.' });
    }
    return res.json({ message: 'Abonamentul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/subscriptions/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea abonamentului.' });
  }
});

adminRouter.patch('/subscriptions/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID abonament invalid.' });
    }
    const subscription = db.toggleSubscriptionActive(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Abonamentul nu a fost găsit.' });
    }
    return res.json(subscription);
  } catch (err) {
    console.error('[API] PATCH /admin/subscriptions/:id/toggle error:', err.message);
    return res.status(500).json({ error: 'Eroare la comutarea stării.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Products
// ---------------------------------------------------------------------------

adminRouter.get('/products', (_req, res) => {
  try {
    const products = db.getAllProducts();
    return res.json(products);
  } catch (err) {
    console.error('[API] GET /admin/products error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea produselor.' });
  }
});

adminRouter.get('/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID produs invalid.' });
    }
    const product = db.getProductById(id);
    if (!product) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    }
    return res.json(product);
  } catch (err) {
    console.error('[API] GET /admin/products/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea produsului.' });
  }
});

adminRouter.post('/products', (req, res) => {
  try {
    const {
      name, description, price, old_price, discount_label,
      contextual_label, category, image, stock, active,
    } = req.body || {};

    const errors = [];
    if (!isString(name, 300) || name.trim().length < 2) {
      errors.push('Numele trebuie să aibă între 2 și 300 de caractere.');
    }
    if (!isOptionalString(description, 5000)) {
      errors.push('Descrierea este prea lungă.');
    }
    if (!isNonNegativeNum(price) || price > 1000000) {
      errors.push('Prețul trebuie să fie un număr între 0 și 1000000.');
    }
    if (old_price !== undefined && old_price !== null && (!isNonNegativeNum(old_price) || old_price > 1000000)) {
      errors.push('Prețul vechi trebuie să fie un număr între 0 și 1000000.');
    }
    if (!isOptionalString(discount_label, 100)) {
      errors.push('Eticheta de reducere este prea lungă.');
    }
    if (!isOptionalString(contextual_label, 100)) {
      errors.push('Eticheta contextuală este prea lungă.');
    }
    if (!isString(category, 50) || !VALID_CATEGORIES.includes(category.trim())) {
      errors.push(`Categoria trebuie să fie una din: ${VALID_CATEGORIES.join(', ')}.`);
    }
    if (!isOptionalString(image, 2000)) {
      errors.push('URL-ul imaginii este prea lung.');
    }
    if (!isNonNegativeInt(stock) || stock > 100000) {
      errors.push('Stocul trebuie să fie un număr întreg între 0 și 100000.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const product = db.createProduct({
      name: sanitizeString(name),
      description: sanitizeString(description || ''),
      price,
      old_price: old_price ?? null,
      discount_label: sanitizeString(discount_label || ''),
      contextual_label: sanitizeString(contextual_label || ''),
      category: sanitizeString(category),
      image: sanitizeString(image || ''),
      stock,
      active: active !== undefined ? (active ? 1 : 0) : 1,
    });

    return res.status(201).json(product);
  } catch (err) {
    console.error('[API] POST /admin/products error:', err.message);
    return res.status(500).json({ error: 'Eroare la crearea produsului.' });
  }
});

adminRouter.put('/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID produs invalid.' });
    }

    const {
      name, description, price, old_price, discount_label,
      contextual_label, category, image, stock, active,
    } = req.body || {};

    const errors = [];
    if (name !== undefined && (!isString(name, 300) || name.trim().length < 2)) {
      errors.push('Numele trebuie să aibă între 2 și 300 de caractere.');
    }
    if (!isOptionalString(description, 5000)) errors.push('Descrierea este prea lungă.');
    if (price !== undefined && (!isNonNegativeNum(price) || price > 1000000)) {
      errors.push('Prețul trebuie să fie un număr între 0 și 1000000.');
    }
    if (old_price !== undefined && old_price !== null && (!isNonNegativeNum(old_price) || old_price > 1000000)) {
      errors.push('Prețul vechi trebuie să fie un număr între 0 și 1000000.');
    }
    if (!isOptionalString(discount_label, 100)) errors.push('Eticheta de reducere este prea lungă.');
    if (!isOptionalString(contextual_label, 100)) errors.push('Eticheta contextuală este prea lungă.');
    if (category !== undefined && (!isString(category, 50) || !VALID_CATEGORIES.includes(category.trim()))) {
      errors.push(`Categoria trebuie să fie una din: ${VALID_CATEGORIES.join(', ')}.`);
    }
    if (!isOptionalString(image, 2000)) errors.push('URL-ul imaginii este prea lung.');
    if (stock !== undefined && (!isNonNegativeInt(stock) || stock > 100000)) {
      errors.push('Stocul trebuie să fie un număr întreg între 0 și 100000.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const product = db.updateProduct(id, {
      name: name !== undefined ? sanitizeString(name) : undefined,
      description: description !== undefined ? sanitizeString(description) : undefined,
      price: price !== undefined ? price : undefined,
      old_price: old_price !== undefined ? old_price : undefined,
      discount_label: discount_label !== undefined ? sanitizeString(discount_label) : undefined,
      contextual_label: contextual_label !== undefined ? sanitizeString(contextual_label) : undefined,
      category: category !== undefined ? sanitizeString(category) : undefined,
      image: image !== undefined ? sanitizeString(image) : undefined,
      stock: stock !== undefined ? stock : undefined,
      active: active !== undefined ? (active ? 1 : 0) : undefined,
    });

    if (!product) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    }

    return res.json(product);
  } catch (err) {
    console.error('[API] PUT /admin/products/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea produsului.' });
  }
});

adminRouter.delete('/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID produs invalid.' });
    }
    const result = db.deleteProduct(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    }
    return res.json({ message: 'Produsul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/products/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea produsului.' });
  }
});

adminRouter.patch('/products/:id/toggle', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID produs invalid.' });
    }
    const product = db.toggleProductActive(id);
    if (!product) {
      return res.status(404).json({ error: 'Produsul nu a fost găsit.' });
    }
    return res.json(product);
  } catch (err) {
    console.error('[API] PATCH /admin/products/:id/toggle error:', err.message);
    return res.status(500).json({ error: 'Eroare la comutarea stării.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Orders
// ---------------------------------------------------------------------------

adminRouter.get('/orders', (_req, res) => {
  try {
    const orders = db.getAllOrders();
    return res.json(orders);
  } catch (err) {
    console.error('[API] GET /admin/orders error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea comenzilor.' });
  }
});

adminRouter.get('/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID comandă invalid.' });
    }
    const order = db.getOrderById(id);
    if (!order) {
      return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
    }
    return res.json(order);
  } catch (err) {
    console.error('[API] GET /admin/orders/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea comenzii.' });
  }
});

adminRouter.patch('/orders/:id/status', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID comandă invalid.' });
    }

    const { status } = req.body || {};
    if (!isString(status, 50) || !VALID_ORDER_STATUSES.includes(status.trim())) {
      return res.status(400).json({
        error: `Statusul trebuie să fie unul din: ${VALID_ORDER_STATUSES.join(', ')}.`,
      });
    }

    const order = db.updateOrderStatus(id, sanitizeString(status));
    if (!order) {
      return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
    }
    return res.json(order);
  } catch (err) {
    console.error('[API] PATCH /admin/orders/:id/status error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea statusului comenzii.' });
  }
});

adminRouter.delete('/orders/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID comandă invalid.' });
    }
    const result = db.deleteOrder(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Comanda nu a fost găsită.' });
    }
    return res.json({ message: 'Comanda a fost ștearsă.' });
  } catch (err) {
    console.error('[API] DELETE /admin/orders/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea comenzii.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Messages
// ---------------------------------------------------------------------------

adminRouter.get('/messages', (_req, res) => {
  try {
    const messages = db.getAllMessages();
    return res.json(messages);
  } catch (err) {
    console.error('[API] GET /admin/messages error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea mesajelor.' });
  }
});

adminRouter.get('/messages/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID mesaj invalid.' });
    }
    const message = db.getMessageById(id);
    if (!message) {
      return res.status(404).json({ error: 'Mesajul nu a fost găsit.' });
    }
    return res.json(message);
  } catch (err) {
    console.error('[API] GET /admin/messages/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea mesajului.' });
  }
});

adminRouter.patch('/messages/:id/read', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID mesaj invalid.' });
    }
    const message = db.getMessageById(id);
    if (!message) {
      return res.status(404).json({ error: 'Mesajul nu a fost găsit.' });
    }
    db.markMessageRead(id);
    const updated = db.getMessageById(id);
    return res.json(updated);
  } catch (err) {
    console.error('[API] PATCH /admin/messages/:id/read error:', err.message);
    return res.status(500).json({ error: 'Eroare la marcarea mesajului ca citit.' });
  }
});

adminRouter.delete('/messages/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPositiveInt(id)) {
      return res.status(400).json({ error: 'ID mesaj invalid.' });
    }
    const result = db.deleteMessage(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Mesajul nu a fost găsit.' });
    }
    return res.json({ message: 'Mesajul a fost șters.' });
  } catch (err) {
    console.error('[API] DELETE /admin/messages/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea mesajului.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: Achievements
// ---------------------------------------------------------------------------

adminRouter.get('/achievements', (_req, res) => {
  try {
    const achievements = db.getAllAchievements();
    return res.json(achievements);
  } catch (err) {
    console.error('[API] GET /admin/achievements error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea realizărilor.' });
  }
});

adminRouter.put('/achievements/:key', (req, res) => {
  try {
    const { key } = req.params;
    const allowedKeys = ['championships', 'matches_won', 'active_members', 'years_experience'];

    if (!allowedKeys.includes(key)) {
      return res.status(400).json({
        error: `Cheia trebuie să fie una din: ${allowedKeys.join(', ')}.`,
      });
    }

    const { value, label } = req.body || {};

    if (!isNonNegativeInt(value) || value > 1000000) {
      return res.status(400).json({ error: 'Valoarea trebuie să fie un număr întreg între 0 și 1000000.' });
    }
    if (!isString(label, 200) || label.trim().length < 1) {
      return res.status(400).json({ error: 'Eticheta trebuie să aibă între 1 și 200 de caractere.' });
    }

    db.upsertAchievement(key, value, sanitizeString(label));
    const achievement = db.getAchievement(key);

    return res.json(achievement);
  } catch (err) {
    console.error('[API] PUT /admin/achievements/:key error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea realizării.' });
  }
});

// ---------------------------------------------------------------------------
// Admin: SEO
// ---------------------------------------------------------------------------

adminRouter.get('/seo', (_req, res) => {
  try {
    const seo = db.getAllSeo();
    return res.json(seo);
  } catch (err) {
    console.error('[API] GET /admin/seo error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea setărilor SEO.' });
  }
});

adminRouter.put('/seo', (req, res) => {
  try {
    const seoArray = req.body;
    if (!Array.isArray(seoArray) || seoArray.length === 0) {
      return res.status(400).json({ error: 'Corpul trebuie să fie un array de obiecte SEO.' });
    }

    const VALID_PAGES = [
      'home', 'about', 'coaches', 'schedule',
      'subscriptions', 'events', 'shop', 'contact',
    ];

    const errors = [];
    for (let i = 0; i < seoArray.length; i++) {
      const seo = seoArray[i];
      const prefix = `Element[${i}]: `;

      if (!seo || typeof seo !== 'object') {
        errors.push(`${prefix}trebuie să fie un obiect.`);
        continue;
      }

      if (!isString(seo.page, 50) || !VALID_PAGES.includes(seo.page.trim())) {
        errors.push(`${prefix}câmpul "page" trebuie să fie unul din: ${VALID_PAGES.join(', ')}.`);
      }
      if (seo.title !== undefined && !isString(seo.title, 500)) {
        errors.push(`${prefix}câmpul "title" trebuie să fie un string de max 500 caractere.`);
      }
      if (seo.description !== undefined && !isString(seo.description, 1000)) {
        errors.push(`${prefix}câmpul "description" trebuie să fie un string de max 1000 caractere.`);
      }
      if (seo.keywords !== undefined && !isString(seo.keywords, 1000)) {
        errors.push(`${prefix}câmpul "keywords" trebuie să fie un string de max 1000 caractere.`);
      }
      if (seo.og_image !== undefined && !isString(seo.og_image, 2000)) {
        errors.push(`${prefix}câmpul "og_image" trebuie să fie un string de max 2000 caractere.`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: 'Date invalide.', details: errors });
    }

    const sanitized = seoArray.map((seo) => ({
      page: sanitizeString(seo.page),
      title: sanitizeString(seo.title ?? ''),
      description: sanitizeString(seo.description ?? ''),
      keywords: sanitizeString(seo.keywords ?? ''),
      og_image: sanitizeString(seo.og_image ?? ''),
    }));

    const updated = db.updateSeoBatch(sanitized);
    return res.json(updated);
  } catch (err) {
    console.error('[API] PUT /admin/seo error:', err.message);
    return res.status(500).json({ error: 'Eroare la actualizarea setărilor SEO.' });
  }
});

// ---------------------------------------------------------------------------
// Mount admin router under /admin
// ---------------------------------------------------------------------------
router.use('/admin', adminRouter);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
module.exports = router;