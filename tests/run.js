#!/usr/bin/env node
// ---------------------------------------------------------------------------
// tests/run.js — Test Runner Minimal pentru Boxing Champions
// ---------------------------------------------------------------------------
// Rulează toate suitele de test în secvență și afișează un raport sumar.
//
// Utilizare:
//   node tests/run.js                  # rulează toate testele
//   node tests/run.js --verbose        # output detaliat per test
//   node tests/run.js --suite auth     # rulează doar o suită
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const VERBOSE = process.argv.includes('--verbose');
const SUITE_FILTER = (() => {
  const idx = process.argv.indexOf('--suite');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
})();

// ---------------------------------------------------------------------------
// Culori terminal
// ---------------------------------------------------------------------------
const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// ---------------------------------------------------------------------------
// Stare globală
// ---------------------------------------------------------------------------
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  suites: [],
};

let currentSuite = null;

// ---------------------------------------------------------------------------
// API minimal pentru teste
// ---------------------------------------------------------------------------

/**
 * Inițializează o suită nouă.
 * @param {string} name - numele suitei
 */
function describe(name) {
  currentSuite = { name, tests: [], passed: 0, failed: 0 };
  if (VERBOSE) console.log(`\n${C.bold}${C.cyan}▶ ${name}${C.reset}`);
}

/**
 * Definește un test.
 * @param {string} name - numele testului
 * @param {Function} fn - funcția de test (poate fi async)
 */
async function it(name, fn) {
  if (!currentSuite) throw new Error('it() must be called inside describe()');
  const start = Date.now();
  try {
    await fn();
    currentSuite.passed++;
    currentSuite.tests.push({ name, status: 'pass', duration: Date.now() - start });
    if (VERBOSE) console.log(`  ${C.green}✓${C.reset} ${name} ${C.dim}(${Date.now() - start}ms)${C.reset}`);
  } catch (err) {
    currentSuite.failed++;
    currentSuite.tests.push({ name, status: 'fail', error: err.message, duration: Date.now() - start });
    if (VERBOSE) console.log(`  ${C.red}✗${C.reset} ${name} ${C.dim}(${Date.now() - start}ms)${C.reset}`);
    if (VERBOSE) console.log(`    ${C.red}→ ${err.message}${C.reset}`);
  }
}

/**
 * Finalizează suita curentă.
 */
function done() {
  if (!currentSuite) return;
  results.total += currentSuite.passed + currentSuite.failed;
  results.passed += currentSuite.passed;
  results.failed += currentSuite.failed;
  results.suites.push(currentSuite);
  const status = currentSuite.failed === 0 ? C.green + 'PASS' : C.red + 'FAIL';
  console.log(`${status}${C.reset} ${currentSuite.name} — ${currentSuite.passed}/${currentSuite.passed + currentSuite.failed} passed`);
  currentSuite = null;
}

// ---------------------------------------------------------------------------
// Helper-e HTTP
// ---------------------------------------------------------------------------

/**
 * Efectuează o cerere HTTP și returnează răspunsul.
 * @param {string} method
 * @param {string} path
 * @param {object} [options]
 * @returns {Promise<{status: number, headers: object, body: any}>}
 */
async function request(method, path, options = {}) {
  const url = BASE_URL + path;
  const fetchOpts = {
    method,
    headers: {
      'Accept': 'application/json',
      ...(options.body && typeof options.body === 'object' ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    redirect: 'manual',
  };

  if (options.body && typeof options.body === 'object') {
    fetchOpts.body = JSON.stringify(options.body);
  }

  // Cookie jar simplu
  if (options.cookies) {
    fetchOpts.headers['Cookie'] = options.cookies;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000);
  fetchOpts.signal = controller.signal;

  const response = await fetch(url, fetchOpts);
  clearTimeout(timeout);

  let body;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    const text = await response.text();
    try { body = JSON.parse(text); } catch { body = text; }
  }

  // Extrage cookie-urile setate
  const setCookieHeaders = response.headers.get('set-cookie') || '';

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    setCookie: setCookieHeaders,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertStatus(res, expectedStatus, message) {
  if (res.status !== expectedStatus) {
    throw new Error(message || `Expected status ${expectedStatus}, got ${res.status}. Body: ${JSON.stringify(res.body)}`);
  }
}

function assertOk(res) {
  assertStatus(res, 200);
}

function assertCreated(res) {
  assertStatus(res, 201);
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runSuites() {
  const suitesDir = path.join(__dirname);
  const files = fs.readdirSync(suitesDir)
    .filter(f => f.startsWith('test-') && f.endsWith('.js'))
    .sort();

  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Boxing Champions — Test Suite         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Server: ${BASE_URL}${C.reset}\n`);

  for (const file of files) {
    if (SUITE_FILTER && !file.includes(SUITE_FILTER)) continue;
    try {
      // Definim contextul global pentru fiecare suită
      const suiteModule = {
        describe, it, done, request, assert, assertEqual, assertStatus, assertOk, assertCreated,
        BASE_URL,
      };
      const suiteFn = require(path.join(suitesDir, file));
      if (typeof suiteFn === 'function') {
        await suiteFn(suiteModule);
      }
    } catch (err) {
      console.error(`${C.red}✗ Eroare la încărcarea ${file}: ${err.message}${C.reset}`);
      if (VERBOSE) console.error(err.stack);
    }
  }

  // Raport final
  console.log(`\n${C.bold}${'═'.repeat(50)}${C.reset}`);
  console.log(`${C.bold}Raport Final${C.reset}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Total:   ${results.total}`);
  console.log(`  ${C.green}Passed:  ${results.passed}${C.reset}`);
  console.log(`  ${C.red}Failed:  ${results.failed}${C.reset}`);
  console.log(`${'═'.repeat(50)}\n`);

  // Ieșire cu cod de eroare dacă există eșecuri
  process.exit(results.failed > 0 ? 1 : 0);
}

runSuites().catch(err => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
