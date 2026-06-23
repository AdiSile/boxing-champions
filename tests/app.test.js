'use strict';

// ---------------------------------------------------------------------------
// tests/app.test.js — Minimal smoke test
//
// Verifică faptul că serverul pornește fără erori și că ruta GET / returnează
// status 200 (servește pagina principală).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 0. Mock bcrypt — modul nativ care nu se compilează fără build tools.
//    jest.mock este hoisted — se execută înaintea oricărui import.
// ---------------------------------------------------------------------------
jest.mock('bcrypt', () => ({
  compareSync: jest.fn(() => true),
  hashSync: jest.fn(() => 'mock_hash'),
}));

// ---------------------------------------------------------------------------
// 1. Mock baza de date înainte de a încărca serverul
//    jest.mock este hoisted — se execută înaintea oricărui import.
// ---------------------------------------------------------------------------
jest.mock('../db', () => {
  const mockStmt = {
    get: jest.fn(() => null),
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
    getAdminByEmail: jest.fn(() => null),
  };
});

// ---------------------------------------------------------------------------
// 2. Înlocuiește app.listen cu un mock înainte ca server.js să fie încărcat,
//    pentru a preveni ascultarea efectivă pe portul 3000.
// ---------------------------------------------------------------------------
const express = require('express');
express.application.listen = jest.fn(function (port, cb) {
  if (typeof cb === 'function') cb();
  return { close: jest.fn() };
});

// ---------------------------------------------------------------------------
// 3. Încarcă serverul (acum listen-ul e mock-uit iar baza de date e mock-uită)
// ---------------------------------------------------------------------------
const app = require('../server');

// ---------------------------------------------------------------------------
// 4. Modul http pentru a crea un server de test izolat
// ---------------------------------------------------------------------------
const http = require('node:http');

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
