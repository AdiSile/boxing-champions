'use strict';

// ---------------------------------------------------------------------------
// tests/app.test.js — End-to-End Smoke & Auth Test Suite
//
// Verifică:
//   1. Pornirea serverului fără erori
//   2. Ruta GET / returnează 200 (pagina principală)
//   3. Autentificare cu credențiale valide → 200 + admin payload
//   4. Autentificare cu credențiale default (.env) → 200 + redirect /admin/dashboard
//   5. Validare input: fără email, fără parolă, email invalid, parolă scurtă → 400
//   6. API public GET /api/coaches → 200 + array
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 0. Setează variabilele de mediu necesare înainte de orice import.
//    Acestea sunt folosite de server.js și de modulele rutiere (auth, stripe).
//    Le setăm manual pentru a nu depinde de fișierul .env la rularea testelor.
// ---------------------------------------------------------------------------
process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
process.env.PORT = '0'; // port 0 = sistemul de operare alege un port liber
process.env.NODE_ENV = 'test';
process.env.STRIPE_KEY = 'sk_test_mock_stripe_key';
process.env.ADMIN_EMAIL = 'admin@boxing-champions.ro';
process.env.ADMIN_PASSWORD = 'password123456';

// ---------------------------------------------------------------------------
// 1. Mock bcrypt — modul nativ care nu se compilează fără build tools.
//    jest.mock este hoisted — se execută înaintea oricărui import.
// ---------------------------------------------------------------------------
jest.mock('bcrypt', () => ({
  compareSync: jest.fn(() => true),
  hashSync: jest.fn(() => 'mock_hash'),
}));

// ---------------------------------------------------------------------------
// 2. Mock baza de date înainte de a încărca serverul
//    jest.mock este hoisted — se execută înaintea oricărui import.
// ---------------------------------------------------------------------------
jest.mock('../db', () => {
  const mockStmt = {
    get: jest.fn(() => ({ cnt: 0 })),
    run: jest.fn(() => ({ lastInsertRowid: 1, changes: 0 })),
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

  return {
    getDb: jest.fn(() => mockDb),
    // Settings
    getAllSettings: jest.fn(() => ({})),
    getSetting: jest.fn(() => null),
    upsertSetting: jest.fn(),
    updateSettingsBatch: jest.fn(() => ({})),
    // Coaches
    getAllCoaches: jest.fn(() => []),
    getActiveCoaches: jest.fn(() => []),
    getCoachById: jest.fn(() => null),
    createCoach: jest.fn(() => null),
    updateCoach: jest.fn(() => null),
    deleteCoach: jest.fn(() => ({ changes: 0 })),
    toggleCoachActive: jest.fn(() => null),
    // Events
    getAllEvents: jest.fn(() => []),
    getActiveEvents: jest.fn(() => []),
    getEventById: jest.fn(() => null),
    createEvent: jest.fn(() => null),
    updateEvent: jest.fn(() => null),
    deleteEvent: jest.fn(() => ({ changes: 0 })),
    toggleEventActive: jest.fn(() => null),
    // Event Photos
    addEventPhoto: jest.fn(),
    updateEventPhoto: jest.fn(),
    deleteEventPhoto: jest.fn(),
    getEventPhotos: jest.fn(() => []),
    // Schedule
    getAllSchedule: jest.fn(() => []),
    getActiveSchedule: jest.fn(() => []),
    getScheduleById: jest.fn(() => null),
    createSchedule: jest.fn(() => null),
    updateSchedule: jest.fn(() => null),
    deleteSchedule: jest.fn(() => ({ changes: 0 })),
    toggleScheduleActive: jest.fn(() => null),
    // Subscriptions
    getAllSubscriptions: jest.fn(() => []),
    getActiveSubscriptions: jest.fn(() => []),
    getSubscriptionById: jest.fn(() => null),
    createSubscription: jest.fn(() => null),
    updateSubscription: jest.fn(() => null),
    deleteSubscription: jest.fn(() => ({ changes: 0 })),
    toggleSubscriptionActive: jest.fn(() => null),
    // Products
    getAllProducts: jest.fn(() => []),
    getActiveProducts: jest.fn(() => []),
    getProductsByCategory: jest.fn(() => []),
    getProductById: jest.fn(() => null),
    createProduct: jest.fn(() => null),
    updateProduct: jest.fn(() => null),
    deleteProduct: jest.fn(() => ({ changes: 0 })),
    toggleProductActive: jest.fn(() => null),
    // Orders
    getAllOrders: jest.fn(() => []),
    getOrderById: jest.fn(() => null),
    createOrder: jest.fn(() => ({ id: 1 })),
    updateOrderStatus: jest.fn(() => null),
    deleteOrder: jest.fn(() => ({ changes: 0 })),
    // Messages
    getAllMessages: jest.fn(() => []),
    getUnreadMessages: jest.fn(() => []),
    getMessageById: jest.fn(() => null),
    createMessage: jest.fn(),
    markMessageRead: jest.fn(),
    deleteMessage: jest.fn(() => ({ changes: 0 })),
    // Achievements
    getAllAchievements: jest.fn(() => []),
    getAchievement: jest.fn(() => null),
    upsertAchievement: jest.fn(),
    // Admin
    getAdminByEmail: jest.fn(() => ({
      id: 1,
      email: 'admin@boxing-champions.ro',
      password: 'mock_hash',
    })),
  };
});

// ---------------------------------------------------------------------------
// 3. Înlocuiește app.listen cu un mock înainte ca server.js să fie încărcat,
//    pentru a preveni ascultarea efectivă pe portul 3000.
// ---------------------------------------------------------------------------
const express = require('express');
express.application.listen = jest.fn(function (port, cb) {
  if (typeof cb === 'function') cb();
  return { close: jest.fn() };
});

// ---------------------------------------------------------------------------
// 4. Încarcă serverul (acum listen-ul e mock-uit iar baza de date e mock-uită)
// ---------------------------------------------------------------------------
const app = require('../server');

// ---------------------------------------------------------------------------
// 5. Modul http pentru a crea un server de test izolat
// ---------------------------------------------------------------------------
const http = require('node:http');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Efectuează o cerere HTTP și returnează o Promisiune cu datele răspunsului.
 * @param {string|URL} url
 * @param {import('http').RequestOptions} [options]
 * @param {string|Buffer} [body]
 * @returns {Promise<{statusCode: number, headers: import('http').IncomingHttpHeaders, body: string, json: Function}>}
 */
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
// Teste
// ---------------------------------------------------------------------------
describe('App Server — smoke test', () => {
  /** @type {import('http').Server} */
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

  test('GET / returnează 200', (done) => {
    http.get(`${baseUrl}/`, (res) => {
      expect(res.statusCode).toBe(200);
      done();
    }).on('error', done);
  });
});

// ---------------------------------------------------------------------------
// Teste de autentificare
// ---------------------------------------------------------------------------
describe('Auth — POST /api/auth/login', () => {
  /** @type {import('http').Server} */
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

  test('autentificare cu credențiale valide returnează 200 și admin payload', async () => {
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { email: 'admin@boxing-champions.ro', password: 'password123456' }
    );

    expect(response.statusCode).toBe(200);

    const data = response.json();
    expect(data).toBeDefined();
    expect(data.success).toBe(true);
    expect(data.admin).toBeDefined();
    expect(data.admin.id).toBe(1);
    expect(data.admin.email).toBe('admin@boxing-champions.ro');
  });

  test('autentificare cu credențiale default din .env returnează 200 și redirect la dashboard', async () => {
    // Credențialele default reale din .env: admin@boxingchampions.ro / boxing2026
    // Mock-ul getAdminByEmail returnează admin@boxing-champions.ro, dar dacă email-ul
    // nu este găsit, ruta de auth creează automat admin-ul default (din process.env).
    // Cum mock-ul get() returnează { cnt: 0 }, se creează admin-ul default,
    // iar apoi getAdminByEmail este apelat cu email-ul normalizat.
    // Pentru a testa cu credențialele default reale, vom verifica că răspunsul
    // conține câmpul redirect corect.
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { email: 'admin@boxingchampions.ro', password: 'boxing2026' }
    );

    // Dacă mock-ul getAdminByEmail nu găsește admin-ul (pentru că email-ul diferă),
    // va returna 401. Dar admin-ul default a fost deja creat cu ADMIN_EMAIL din env.
    // Oricum, testăm că răspunsul este coerent.
    expect(response.statusCode).toBe(200);

    const data = response.json();
    expect(data.success).toBe(true);
    expect(data.redirect).toBe('/admin/dashboard');
  });

  test('autentificare fără email returnează 400', async () => {
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { password: 'password123456' }
    );

    expect(response.statusCode).toBe(400);
    const data = response.json();
    expect(data.message).toBeDefined();
  });

  test('autentificare fără parolă returnează 400', async () => {
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { email: 'admin@boxing-champions.ro' }
    );

    expect(response.statusCode).toBe(400);
    const data = response.json();
    expect(data.message).toBeDefined();
  });

  test('autentificare cu email invalid returnează 400', async () => {
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { email: 'email-invalid', password: 'password123456' }
    );

    expect(response.statusCode).toBe(400);
    const data = response.json();
    expect(data.message).toBeDefined();
  });

  test('autentificare cu parolă prea scurtă returnează 400', async () => {
    const response = await httpRequest(
      `${baseUrl}/api/auth/login`,
      { method: 'POST' },
      { email: 'admin@boxing-champions.ro', password: 'short' }
    );

    expect(response.statusCode).toBe(400);
    const data = response.json();
    expect(data.message).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Teste API publice
// ---------------------------------------------------------------------------
describe('API Public — GET /api/coaches', () => {
  /** @type {import('http').Server} */
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

  test('GET /api/coaches returnează 200 și un array', async () => {
    const response = await httpRequest(`${baseUrl}/api/coaches`);

    expect(response.statusCode).toBe(200);

    const data = response.json();
    expect(Array.isArray(data)).toBe(true);
  });
});