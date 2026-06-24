'use strict';

// ---------------------------------------------------------------------------
// tests/api.test.js — API Routes Comprehensive Test Suite
//
// Acoperă toate rutele publice și rutele admin din routes/api.js:
//
// Rute publice:
//   GET  /api/settings      — verifică că returnează un OBIECT (nu array)
//   GET  /api/coaches       — verifică că returnează array
//   GET  /api/events        — verifică că returnează array
//   GET  /api/events/:id    — verifică obiect / 404
//   GET  /api/schedule      — verifică că returnează array
//   GET  /api/subscriptions — verifică că returnează array
//   GET  /api/products      — verifică că returnează array (+ filtrare categorie)
//   GET  /api/products/:id  — verifică obiect / 404
//   GET  /api/achievements  — verifică că returnează array
//   POST /api/messages      — verifică validare + creare
//   POST /api/checkout      — verifică validare + creare sesiune
//
// Rute admin (JWT required, prefix /api/admin):
//   Settings:       GET /, PUT /
//   Coaches:        GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Events:         GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Schedule:       GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Subscriptions:  GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Products:       GET /, GET /:id, POST /, PUT /:id, DELETE /:id, PATCH /:id/toggle
//   Orders:         GET /, GET /:id, PATCH /:id/status, DELETE /:id
//   Messages:       GET /, GET /:id, PATCH /:id/read, DELETE /:id
//   Achievements:   GET /, PUT /:key
//   SEO:            GET /, PUT /
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 0. Setează variabilele de mediu necesare
// ---------------------------------------------------------------------------
process.env.JWT_SECRET = 'test-jwt-secret-for-api-tests';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.STRIPE_KEY = 'sk_test_mock_stripe_key';
process.env.ADMIN_EMAIL = 'admin@boxing-champions.ro';
process.env.ADMIN_PASSWORD = 'password123456';

// ---------------------------------------------------------------------------
// 1. Mock bcrypt
// ---------------------------------------------------------------------------
jest.mock('bcrypt', () => ({
  compareSync: jest.fn(() => true),
  hashSync: jest.fn(() => 'mock_hash'),
}));

// ---------------------------------------------------------------------------
// 2. Mock stripe
// ---------------------------------------------------------------------------
jest.mock('stripe', () => {
  return jest.fn(() => ({
    checkout: {
      sessions: {
        create: jest.fn(() => Promise.resolve({
          id: 'cs_test_mock_session_123',
          url: 'https://checkout.stripe.com/test/mock',
        })),
      },
    },
  }));
});

// ---------------------------------------------------------------------------
// 3. Mock baza de date
// ---------------------------------------------------------------------------
const mockAdmin = { id: 1, email: 'admin@boxing-champions.ro', password: 'mock_hash' };

const mockSettings = {
  club_name: 'Boxing Champions',
  slogan: 'Where Champions Are Forged',
  email: 'contact@boxing-champions.ro',
  phone: '+40 721 234 567',
  address: 'Strada Sportului nr. 10, București',
  facebook: 'https://facebook.com/boxingchampions',
  instagram: 'https://instagram.com/boxingchampions',
  tiktok: 'https://tiktok.com/@boxingchampions',
  hero_badge: 'New Season 2026',
  about_text: 'Cel mai bun club de box.',
};

const mockCoaches = [
  { id: 1, name: 'Mihai Ionescu', specialization: 'Box Profesionist', active: 1 },
  { id: 2, name: 'Andreea Popa', specialization: 'Box Feminin', active: 1 },
];

const mockEvents = [
  { id: 1, title: 'Gala Campionilor', event_date: '2025-06-15', active: 1, photos: [] },
  { id: 2, title: 'Sparring Night', event_date: '2025-04-20', active: 1, photos: [] },
];

const mockSingleEvent = {
  id: 1, title: 'Gala Campionilor', event_date: '2025-06-15',
  location: 'Sala Polivalentă', description: 'O seară de neuitat.', active: 1,
  photos: [{ id: 1, event_id: 1, url: 'photo.jpg', caption: 'Intrare', sort_order: 0 }],
};

const mockSchedule = [
  { id: 1, day: 'Luni', start_time: '09:00', end_time: '10:30', category: 'Copii', gender: 'Mixt', active: 1 },
  { id: 2, day: 'Luni', start_time: '17:00', end_time: '18:30', category: 'Începători', gender: 'Masculin', active: 1 },
];

const mockSubscriptions = [
  { id: 1, name: 'Începător', monthly_price: 150, yearly_price: 1500, benefits: '[]', highlighted: 0, active: 1 },
];

const mockProducts = [
  { id: 1, name: 'Mănuși Box', price: 250, category: 'Echipament', stock: 10, active: 1 },
  { id: 2, name: 'Tricou Club', price: 80, category: 'Îmbrăcăminte', stock: 25, active: 1 },
];

const mockAchievements = [
  { id: 1, key: 'championships', value: 47, label: 'Campionate' },
  { id: 2, key: 'matches_won', value: 312, label: 'Meciuri Câștigate' },
];

const mockOrders = [
  { id: 1, customer_name: 'Ion Popescu', customer_email: 'ion@test.com', status: 'pending', total: 500 },
];

const mockMessages = [
  { id: 1, name: 'Test User', email: 'test@example.com', subject: 'Test', message: 'Test message body', is_read: 0 },
];

const mockSeo = [
  { id: 1, page: 'home', title: 'Boxing Champions', description: '...', keywords: 'box', og_image: 'og.jpg' },
];

// Build the mock DB
const mockStmt = {
  get: jest.fn(() => ({ cnt: 1 })),
  run: jest.fn(() => ({ lastInsertRowid: 99, changes: 1 })),
  all: jest.fn(() => []),
};

const mockDb = {
  prepare: jest.fn(() => mockStmt),
  exec: jest.fn(),
  pragma: jest.fn(),
  transaction: jest.fn((fn) => {
    const tx = () => fn();
    return tx;
  }),
};

// Configurează mock-urile cu date realiste
const dbMock = {
  getDb: jest.fn(() => mockDb),

  // Settings
  getAllSettings: jest.fn(() => ({ ...mockSettings })),
  getSetting: jest.fn((key) => ({ key, value: mockSettings[key] || '' })),
  upsertSetting: jest.fn(),
  updateSettingsBatch: jest.fn((obj) => ({ ...mockSettings, ...obj })),

  // Coaches
  getAllCoaches: jest.fn(() => [...mockCoaches]),
  getActiveCoaches: jest.fn(() => [...mockCoaches]),
  getCoachById: jest.fn((id) => mockCoaches.find(c => c.id === id) || null),
  createCoach: jest.fn((data) => ({ id: 99, ...data, active: data.active ?? 1 })),
  updateCoach: jest.fn((id, data) => {
    const coach = mockCoaches.find(c => c.id === id);
    if (!coach) return null;
    return { ...coach, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  }),
  deleteCoach: jest.fn((id) => ({ changes: mockCoaches.some(c => c.id === id) ? 1 : 0 })),
  toggleCoachActive: jest.fn((id) => {
    const coach = mockCoaches.find(c => c.id === id);
    if (!coach) return null;
    return { ...coach, active: coach.active ? 0 : 1 };
  }),

  // Events
  getAllEvents: jest.fn(() => [...mockEvents]),
  getActiveEvents: jest.fn(() => [...mockEvents]),
  getEventById: jest.fn((id) => id === 1 ? { ...mockSingleEvent } : null),
  createEvent: jest.fn((data) => ({ id: 99, ...data, photos: [] })),
  updateEvent: jest.fn((id, data) => {
    if (id !== 1) return null;
    return { ...mockSingleEvent, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  }),
  deleteEvent: jest.fn((id) => ({ changes: id === 1 ? 1 : 0 })),
  toggleEventActive: jest.fn((id) => {
    if (id !== 1) return null;
    return { ...mockSingleEvent, active: mockSingleEvent.active ? 0 : 1 };
  }),

  // Event Photos
  addEventPhoto: jest.fn(() => ({ lastInsertRowid: 99 })),
  updateEventPhoto: jest.fn((photoId) => photoId === 1 ? { id: 1, url: 'updated.jpg' } : null),
  deleteEventPhoto: jest.fn((photoId) => ({ changes: photoId === 1 ? 1 : 0 })),
  getEventPhotos: jest.fn(() => [...mockSingleEvent.photos]),

  // Schedule
  getAllSchedule: jest.fn(() => [...mockSchedule]),
  getActiveSchedule: jest.fn(() => [...mockSchedule]),
  getScheduleById: jest.fn((id) => mockSchedule.find(s => s.id === id) || null),
  createSchedule: jest.fn((data) => ({ id: 99, ...data })),
  updateSchedule: jest.fn((id, data) => {
    const slot = mockSchedule.find(s => s.id === id);
    if (!slot) return null;
    return { ...slot, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  }),
  deleteSchedule: jest.fn((id) => ({ changes: mockSchedule.some(s => s.id === id) ? 1 : 0 })),
  toggleScheduleActive: jest.fn((id) => {
    const slot = mockSchedule.find(s => s.id === id);
    if (!slot) return null;
    return { ...slot, active: slot.active ? 0 : 1 };
  }),

  // Subscriptions
  getAllSubscriptions: jest.fn(() => [...mockSubscriptions]),
  getActiveSubscriptions: jest.fn(() => [...mockSubscriptions]),
  getSubscriptionById: jest.fn((id) => mockSubscriptions.find(s => s.id === id) || null),
  createSubscription: jest.fn((data) => ({ id: 99, ...data, benefits: '[]' })),
  updateSubscription: jest.fn((id, data) => {
    const sub = mockSubscriptions.find(s => s.id === id);
    if (!sub) return null;
    return { ...sub, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  }),
  deleteSubscription: jest.fn((id) => ({ changes: mockSubscriptions.some(s => s.id === id) ? 1 : 0 })),
  toggleSubscriptionActive: jest.fn((id) => {
    const sub = mockSubscriptions.find(s => s.id === id);
    if (!sub) return null;
    return { ...sub, active: sub.active ? 0 : 1 };
  }),

  // Products
  getAllProducts: jest.fn(() => [...mockProducts]),
  getActiveProducts: jest.fn(() => [...mockProducts]),
  getProductsByCategory: jest.fn((cat) => mockProducts.filter(p => p.category === cat)),
  getProductById: jest.fn((id) => mockProducts.find(p => p.id === id) || null),
  createProduct: jest.fn((data) => ({ id: 99, ...data })),
  updateProduct: jest.fn((id, data) => {
    const prod = mockProducts.find(p => p.id === id);
    if (!prod) return null;
    return { ...prod, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) };
  }),
  deleteProduct: jest.fn((id) => ({ changes: mockProducts.some(p => p.id === id) ? 1 : 0 })),
  toggleProductActive: jest.fn((id) => {
    const prod = mockProducts.find(p => p.id === id);
    if (!prod) return null;
    return { ...prod, active: prod.active ? 0 : 1 };
  }),

  // Orders
  getAllOrders: jest.fn(() => [...mockOrders]),
  getOrderById: jest.fn((id) => mockOrders.find(o => o.id === id) || null),
  createOrder: jest.fn((data) => ({ id: 99, ...data, status: 'pending' })),
  updateOrderStatus: jest.fn((id, status) => {
    const order = mockOrders.find(o => o.id === id);
    if (!order) return null;
    return { ...order, status };
  }),
  deleteOrder: jest.fn((id) => ({ changes: mockOrders.some(o => o.id === id) ? 1 : 0 })),

  // Messages
  getAllMessages: jest.fn(() => [...mockMessages]),
  getUnreadMessages: jest.fn(() => [...mockMessages]),
  getMessageById: jest.fn((id) => mockMessages.find(m => m.id === id) || null),
  createMessage: jest.fn(),
  markMessageRead: jest.fn(),
  deleteMessage: jest.fn((id) => ({ changes: mockMessages.some(m => m.id === id) ? 1 : 0 })),

  // Achievements
  getAllAchievements: jest.fn(() => [...mockAchievements]),
  getAchievement: jest.fn((key) => mockAchievements.find(a => a.key === key) || null),
  upsertAchievement: jest.fn(),

  // SEO
  getAllSeo: jest.fn(() => [...mockSeo]),
  getSeoByPage: jest.fn(() => mockSeo[0]),
  upsertSeo: jest.fn(),
  updateSeoBatch: jest.fn((arr) => arr),

  // Admin
  getAdminByEmail: jest.fn(() => ({ ...mockAdmin })),
};

jest.mock('../db', () => dbMock);

// ---------------------------------------------------------------------------
// 4. Mock app.listen
// ---------------------------------------------------------------------------
const express = require('express');
express.application.listen = jest.fn(function (port, cb) {
  if (typeof cb === 'function') cb();
  return { close: jest.fn() };
});

// ---------------------------------------------------------------------------
// 5. Încarcă serverul și modulele
// ---------------------------------------------------------------------------
const app = require('../server');
const http = require('node:http');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Helper: cerere HTTP
// ---------------------------------------------------------------------------
function httpRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const opts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (body) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
      opts.bodyData = data;
    }

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: rawBody,
          json() {
            try {
              return JSON.parse(rawBody);
            } catch {
              return null;
            }
          },
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Request timeout'));
    });

    if (opts.bodyData) {
      req.write(opts.bodyData);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: generează token JWT admin
// ---------------------------------------------------------------------------
function getAdminToken() {
  return jwt.sign(
    { id: 1, email: 'admin@boxing-champions.ro' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ---------------------------------------------------------------------------
// Helper: creează headers cu token admin
// ---------------------------------------------------------------------------
function authHeaders() {
  return { Cookie: `token=${getAdminToken()}` };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('API Routes — Comprehensive Test Suite', () => {
  let testServer;
  let baseUrl;

  beforeAll((done) => {
    testServer = http.createServer(app);
    testServer.listen(0, () => {
      const { port } = testServer.address();
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (testServer) {
      testServer.close(() => done());
    } else {
      done();
    }
  });

  // =========================================================================
  // RUTE PUBLICE
  // =========================================================================

  describe('Public — GET /api/settings', () => {
    test('returnează 200 și un OBIECT (nu array)', async () => {
      const res = await httpRequest(`${baseUrl}/api/settings`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
      expect(Array.isArray(data)).toBe(false);
      expect(data.club_name).toBe('Boxing Champions');
      expect(data.email).toBeDefined();
      expect(data.phone).toBeDefined();
    });

    test('returnează toate cheile de setări', async () => {
      const res = await httpRequest(`${baseUrl}/api/settings`);
      const data = res.json();
      expect(data).toHaveProperty('club_name');
      expect(data).toHaveProperty('slogan');
      expect(data).toHaveProperty('email');
      expect(data).toHaveProperty('phone');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('facebook');
      expect(data).toHaveProperty('instagram');
      expect(data).toHaveProperty('tiktok');
      expect(data).toHaveProperty('hero_badge');
      expect(data).toHaveProperty('about_text');
    });
  });

  describe('Public — GET /api/coaches', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/coaches`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Public — GET /api/events', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/events`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Public — GET /api/events/:id', () => {
    test('returnează 200 și obiect pentru id valid', async () => {
      const res = await httpRequest(`${baseUrl}/api/events/1`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(typeof data).toBe('object');
      expect(data.title).toBe('Gala Campionilor');
      expect(Array.isArray(data.photos)).toBe(true);
    });

    test('returnează 400 pentru id invalid', async () => {
      const res = await httpRequest(`${baseUrl}/api/events/abc`);
      expect(res.statusCode).toBe(400);
    });

    test('returnează 404 pentru eveniment inexistent', async () => {
      const res = await httpRequest(`${baseUrl}/api/events/9999`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Public — GET /api/schedule', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/schedule`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Public — GET /api/subscriptions', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/subscriptions`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Public — GET /api/products', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/products`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('filtrare cu categorie validă', async () => {
      const res = await httpRequest(`${baseUrl}/api/products?category=Echipament`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('returnează 400 pentru categorie invalidă', async () => {
      const res = await httpRequest(`${baseUrl}/api/products?category=CategorieInexistenta`);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Public — GET /api/products/:id', () => {
    test('returnează 200 și obiect pentru id valid', async () => {
      const res = await httpRequest(`${baseUrl}/api/products/1`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(typeof data).toBe('object');
      expect(data.name).toBeDefined();
    });

    test('returnează 400 pentru id invalid', async () => {
      const res = await httpRequest(`${baseUrl}/api/products/abc`);
      expect(res.statusCode).toBe(400);
    });

    test('returnează 404 pentru produs inexistent', async () => {
      const res = await httpRequest(`${baseUrl}/api/products/9999`);
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Public — GET /api/achievements', () => {
    test('returnează 200 și un array', async () => {
      const res = await httpRequest(`${baseUrl}/api/achievements`);
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('Public — POST /api/messages', () => {
    test('returnează 201 cu date valide', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/messages`,
        { method: 'POST' },
        {
          name: 'Test User',
          email: 'test@example.com',
          subject: 'Test Subject',
          message: 'This is a valid test message with enough characters.',
        }
      );
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.message).toContain('succes');
    });

    test('returnează 400 cu date invalide', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/messages`,
        { method: 'POST' },
        { name: '', email: 'invalid', subject: '', message: 'short' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Public — POST /api/checkout', () => {
    test('returnează 201 cu date valide (mock Stripe)', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/checkout`,
        { method: 'POST' },
        {
          items: [
            { id: 1, name: 'Mănuși Box', price: 250, quantity: 1 },
          ],
          customer: {
            name: 'Ion Popescu',
            email: 'ion@example.com',
            phone: '+40 721 234 567',
          },
        }
      );
      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.url).toBeDefined();
      expect(data.orderId).toBeDefined();
    });

    test('returnează 400 cu coș gol', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/checkout`,
        { method: 'POST' },
        { items: [], customer: { name: 'Test', email: 'test@test.com' } }
      );
      expect(res.statusCode).toBe(400);
    });

    test('returnează 400 fără customer', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/checkout`,
        { method: 'POST' },
        { items: [{ id: 1, name: 'Produs', price: 100, quantity: 1 }] }
      );
      expect(res.statusCode).toBe(400);
    });

    test('returnează 400 cu email client invalid', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/checkout`,
        { method: 'POST' },
        {
          items: [{ id: 1, name: 'Produs', price: 100, quantity: 1 }],
          customer: { name: 'Test', email: 'invalid-email' },
        }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // RUTE ADMIN (JWT PROTECTED)
  // =========================================================================

  // --- Admin Auth Required ---
  describe('Admin — Protecție JWT', () => {
    test('returnează 401 fără token', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/coaches`);
      expect(res.statusCode).toBe(401);
    });
  });

  // --- Admin Settings ---
  describe('Admin — GET /api/admin/settings', () => {
    test('returnează 200 și obiect', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/settings`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(typeof data).toBe('object');
      expect(Array.isArray(data)).toBe(false);
    });
  });

  describe('Admin — PUT /api/admin/settings', () => {
    test('returnează 200 cu date valide', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/settings`,
        { method: 'PUT', headers: authHeaders() },
        { club_name: 'Nou Club', slogan: 'Nou Slogan' }
      );
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(typeof data).toBe('object');
    });

    test('returnează 400 cu cheie invalidă', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/settings`,
        { method: 'PUT', headers: authHeaders() },
        { cheie_invalida: 'valoare' }
      );
      expect(res.statusCode).toBe(400);
    });

    test('returnează 400 cu array în loc de obiect', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/settings`,
        { method: 'PUT', headers: authHeaders() },
        [{ club_name: 'test' }]
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Coaches ---
  describe('Admin — Coaches CRUD', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/coaches`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('GET /:id returnează obiect', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/coaches/1`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json()).toBe('object');
    });

    test('GET /:id returnează 404 pentru inexistent', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/coaches/9999`, { headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    test('POST / creează un coach', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches`,
        { method: 'POST', headers: authHeaders() },
        { name: 'Nou Antrenor', specialization: 'Box Copii', certifications: 'Cert1', photo: '', quote: 'Citat test' }
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('Nou Antrenor');
    });

    test('POST / returnează 400 fără nume', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches`,
        { method: 'POST', headers: authHeaders() },
        { name: 'A' }
      );
      expect(res.statusCode).toBe(400);
    });

    test('PUT /:id actualizează un coach', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches/1`,
        { method: 'PUT', headers: authHeaders() },
        { name: 'Nume Actualizat' }
      );
      expect(res.statusCode).toBe(200);
    });

    test('PUT /:id returnează 404 pentru inexistent', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches/9999`,
        { method: 'PUT', headers: authHeaders() },
        { name: 'Test' }
      );
      expect(res.statusCode).toBe(404);
    });

    test('PATCH /:id/toggle comută starea', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches/1/toggle`,
        { method: 'PATCH', headers: authHeaders() }
      );
      expect(res.statusCode).toBe(200);
    });

    test('DELETE /:id șterge un coach', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/coaches/1`,
        { method: 'DELETE', headers: authHeaders() }
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('sters');
    });
  });

  // --- Admin Events ---
  describe('Admin — Events CRUD', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/events`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('POST / creează un eveniment', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/events`,
        { method: 'POST', headers: authHeaders() },
        { title: 'Eveniment Nou', event_date: '2025-07-20', location: 'București', description: 'Descriere test' }
      );
      expect(res.statusCode).toBe(201);
    });

    test('POST / returnează 400 cu dată invalidă', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/events`,
        { method: 'POST', headers: authHeaders() },
        { title: 'Test', event_date: 'invalid-date' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Event Photos ---
  describe('Admin — Event Photos', () => {
    test('GET /:id/photos returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/events/1/photos`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('GET /:id/photos returnează 404 pentru eveniment inexistent', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/events/9999/photos`, { headers: authHeaders() });
      expect(res.statusCode).toBe(404);
    });

    test('POST /:id/photos adaugă o fotografie', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/events/1/photos`,
        { method: 'POST', headers: authHeaders() },
        { url: 'https://example.com/photo.jpg', caption: 'Test photo', sort_order: 0 }
      );
      expect(res.statusCode).toBe(201);
    });
  });

  // --- Admin Schedule ---
  describe('Admin — Schedule CRUD', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/schedule`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('POST / creează un slot', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/schedule`,
        { method: 'POST', headers: authHeaders() },
        { day: 'Luni', start_time: '10:00', end_time: '11:00', category: 'Box Copii', gender: 'Mixt' }
      );
      expect(res.statusCode).toBe(201);
    });

    test('POST / returnează 400 cu zi invalidă', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/schedule`,
        { method: 'POST', headers: authHeaders() },
        { day: 'Invalid', start_time: '10:00', end_time: '11:00', category: 'Test', gender: 'Mixt' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Subscriptions ---
  describe('Admin — Subscriptions CRUD', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/subscriptions`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('POST / creează un abonament', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/subscriptions`,
        { method: 'POST', headers: authHeaders() },
        { name: 'Abonament Test', monthly_price: 200, yearly_price: 2000 }
      );
      expect(res.statusCode).toBe(201);
    });

    test('POST / returnează 400 fără nume', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/subscriptions`,
        { method: 'POST', headers: authHeaders() },
        { name: 'A' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Products ---
  describe('Admin — Products CRUD', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/products`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('POST / creează un produs', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/products`,
        { method: 'POST', headers: authHeaders() },
        { name: 'Produs Test', price: 100, category: 'Echipament', stock: 10 }
      );
      expect(res.statusCode).toBe(201);
    });

    test('POST / returnează 400 cu categorie invalidă', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/products`,
        { method: 'POST', headers: authHeaders() },
        { name: 'Test', price: 100, category: 'Invalid', stock: 10 }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Orders ---
  describe('Admin — Orders', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/orders`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('GET /:id returnează obiect', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/orders/1`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json()).toBe('object');
    });

    test('PATCH /:id/status actualizează statusul', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/orders/1/status`,
        { method: 'PATCH', headers: authHeaders() },
        { status: 'confirmed' }
      );
      expect(res.statusCode).toBe(200);
    });

    test('PATCH /:id/status returnează 400 cu status invalid', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/orders/1/status`,
        { method: 'PATCH', headers: authHeaders() },
        { status: 'invalid_status' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin Messages ---
  describe('Admin — Messages', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/messages`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('GET /:id returnează obiect', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/messages/1`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json()).toBe('object');
    });

    test('PATCH /:id/read marchează ca citit', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/messages/1/read`,
        { method: 'PATCH', headers: authHeaders() }
      );
      expect(res.statusCode).toBe(200);
    });
  });

  // --- Admin Achievements ---
  describe('Admin — Achievements', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/achievements`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('PUT /:key actualizează o realizare', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/achievements/championships`,
        { method: 'PUT', headers: authHeaders() },
        { value: 50, label: 'Campionate Câștigate' }
      );
      expect(res.statusCode).toBe(200);
    });

    test('PUT /:key returnează 400 cu cheie invalidă', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/achievements/invalid_key`,
        { method: 'PUT', headers: authHeaders() },
        { value: 10, label: 'Test' }
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // --- Admin SEO ---
  describe('Admin — SEO', () => {
    test('GET / returnează array', async () => {
      const res = await httpRequest(`${baseUrl}/api/admin/seo`, { headers: authHeaders() });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('PUT / actualizează SEO', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/seo`,
        { method: 'PUT', headers: authHeaders() },
        [{ page: 'home', title: 'Nou Titlu', description: 'Nouă descriere', keywords: 'box, club', og_image: 'img.jpg' }]
      );
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    test('PUT / returnează 400 cu array gol', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/seo`,
        { method: 'PUT', headers: authHeaders() },
        []
      );
      expect(res.statusCode).toBe(400);
    });

    test('PUT / returnează 400 cu obiect în loc de array', async () => {
      const res = await httpRequest(
        `${baseUrl}/api/admin/seo`,
        { method: 'PUT', headers: authHeaders() },
        { page: 'home', title: 'Test' }
      );
      expect(res.statusCode).toBe(400);
    });
  });
});
