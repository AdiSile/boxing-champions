#!/usr/bin/env node
// ---------------------------------------------------------------------------
// tests/run.js — Test Runner pentru Boxing Champions
// Verifică integritatea după migrare și rulează toate suitele de test.
//
// Utilizare:
//   node tests/run.js                  # rulează toate testele
//   node tests/run.js --verbose        # output detaliat per test
//   node tests/run.js --suite auth     # rulează doar o suită
//   node tests/run.js --migration-only # doar verificări de migrare
//   node tests/run.js --no-http        # fără teste HTTP (doar DB)
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const VERBOSE = process.argv.includes('--verbose');
const MIGRATION_ONLY = process.argv.includes('--migration-only');
const NO_HTTP = process.argv.includes('--no-http');
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
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
function banner(title) {
  console.log('');
  console.log(`${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'═'.repeat(60)}${C.reset}`);
}

function subBanner(title) {
  console.log(`\n${C.bold}${C.magenta}▶ ${title}${C.reset}`);
}

// ---------------------------------------------------------------------------
// Stare globală
// ---------------------------------------------------------------------------
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  suites: [],
  migration: { total: 0, passed: 0, failed: 0, checks: [] },
};

let currentSuite = null;

// ---------------------------------------------------------------------------
// API minimal pentru teste
// ---------------------------------------------------------------------------

function describe(name) {
  currentSuite = { name, tests: [], passed: 0, failed: 0 };
  if (VERBOSE) console.log(`\n${C.bold}${C.cyan}▶ ${name}${C.reset}`);
}

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
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║                    VERIFICARE INTEGRITATE MIGRARE                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// ---------------------------------------------------------------------------

/**
 * Adaugă un rezultat al verificării de migrare.
 */
function migrationCheck(name, ok, detail) {
  results.migration.total++;
  if (ok) {
    results.migration.passed++;
    console.log(`  ${C.green}✓${C.reset} ${name}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  } else {
    results.migration.failed++;
    console.log(`  ${C.red}✗${C.reset} ${name}${detail ? C.dim + ' — ' + detail + C.reset : ''}`);
  }
  results.migration.checks.push({ name, ok, detail });
}

/**
 * Verifică existența modulului better-sqlite3.
 */
function checkBetterSqlite3Installed() {
  try {
    require.resolve('better-sqlite3');
    return { ok: true };
  } catch {
    // Verifică dacă sql.js este instalat ca fallback
    try {
      require.resolve('sql.js');
      return { ok: false, error: 'sql.js este instalat, dar better-sqlite3 NU. Migrarea nu a fost efectuată.' };
    } catch {
      return { ok: false, error: 'Nici better-sqlite3, nici sql.js nu sunt instalate.' };
    }
  }
}

/**
 * Verifică inițializarea bazei de date — comprehensive.
 */
async function checkDatabaseHealth() {
  try {
    const dbModule = require('../config/db');

    // Verifică dacă funcțiile așteptate sunt exportate
    const hasInitDb = typeof dbModule.initDb === 'function';
    const hasGetDb = typeof dbModule.getDb === 'function';
    const hasCloseDb = typeof dbModule.closeDb === 'function';
    const hasCheckConnection = typeof dbModule.checkDatabaseConnection === 'function';

    if (!hasInitDb || !hasGetDb) {
      return {
        ok: false,
        error: 'config/db.js nu exportă funcțiile așteptate (initDb, getDb).',
        details: { hasInitDb, hasGetDb, hasCloseDb, hasCheckConnection },
      };
    }

    // Inițializează DB
    await dbModule.initDb();
    const db = dbModule.getDb();

    if (!db) {
      return { ok: false, error: 'getDb() a returnat null — baza de date nu s-a inițializat.' };
    }

    // Verifică conexiunea
    const health = dbModule.checkDatabaseConnection();
    if (!health || !health.ok) {
      return { ok: false, error: health?.error || 'Conexiunea la baza de date a eșuat.' };
    }

    // ── Verifică tabelele ──────────────────────────────────────────
    const expectedTables = [
      'users', 'settings', 'coaches', 'events', 'schedule',
      'plans', 'products', 'orders', 'contact_messages', 'promotions',
    ];

    let tables;
    try {
      tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    } catch {
      // Fallback pentru sql.js (API diferit)
      const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
      tables = rows.length > 0 ? rows[0].values.map(v => ({ name: v[0] })) : [];
    }

    const tableNames = tables.map(t => t.name);
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));

    if (missingTables.length > 0) {
      return {
        ok: false,
        error: `Tabele lipsă: ${missingTables.join(', ')}`,
        details: { tables: tableNames, missingTables },
      };
    }

    // ── Verifică structura tabelelor principale ────────────────────
    const tableSchemas = {};

    for (const tableName of expectedTables) {
      let columns;
      try {
        columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
      } catch {
        try {
          const rows = db.exec(`PRAGMA table_info(${tableName})`);
          columns = rows.length > 0
            ? rows[0].values.map(v => ({ cid: v[0], name: v[1], type: v[2], notnull: v[3], dflt_value: v[4], pk: v[5] }))
            : [];
        } catch {
          columns = [];
        }
      }
      tableSchemas[tableName] = columns.map(c => c.name);
    }

    // ── Verifică foreign keys ──────────────────────────────────────
    let fkEnabled;
    try {
      const fkRow = db.prepare('PRAGMA foreign_keys').get();
      fkEnabled = fkRow && (fkRow.foreign_keys === 1 || fkRow.foreign_keys === '1');
    } catch {
      fkEnabled = false;
    }

    // ── Verifică WAL mode ──────────────────────────────────────────
    let journalMode = 'unknown';
    try {
      const jmRow = db.prepare('PRAGMA journal_mode').get();
      journalMode = jmRow?.journal_mode || 'unknown';
    } catch {
      // ignore
    }

    // ── Numără înregistrările per tabelă ───────────────────────────
    const rowCounts = {};
    for (const tableName of expectedTables) {
      try {
        const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ${tableName}`).get();
        rowCounts[tableName] = countRow?.cnt || 0;
      } catch {
        rowCounts[tableName] = -1;
      }
    }

    // ── Verifică admin seed ────────────────────────────────────────
    let adminExists = false;
    try {
      const adminRow = db.prepare("SELECT id, email, role FROM users WHERE email = 'admin@boxingchampions.ro'").get();
      adminExists = !!(adminRow && adminRow.role === 'admin');
    } catch {
      adminExists = false;
    }

    return {
      ok: true,
      details: {
        tables: tableNames,
        tableSchemas,
        foreignKeys: fkEnabled,
        journalMode,
        rowCounts,
        adminExists,
        missingTables,
      },
    };
  } catch (err) {
    if (err.message && err.message.includes('Too many parameter values')) {
      return {
        ok: false,
        error: 'DATABASE INIT FAILED: Too many parameter values — SQLITE_MAX_VARIABLE_NUMBER exceeded. Reduce batch size in seed inserts.',
      };
    }
    if (err.code === 'MODULE_NOT_FOUND') {
      return {
        ok: false,
        error: `Modulul de baza de date nu a fost gasit: ${err.message}. Ruleaza 'npm install' mai intai.`,
      };
    }
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Verificarea integrității fișierelor proiectului
// ---------------------------------------------------------------------------

function checkProjectFiles() {
  const requiredFiles = [
    'server.js',
    'package.json',
    '.env',
    'config/db.js',
    'middleware/auth.js',
    'middleware/security.js',
    'middleware/validate.js',
    'models/settingsModel.js',
    'routes/auth.js',
    'routes/settings.js',
    'routes/coaches.js',
    'routes/events.js',
    'routes/schedule.js',
    'routes/plans.js',
    'routes/products.js',
    'routes/orders.js',
    'routes/contact.js',
    'routes/checkout.js',
    'routes/promotions.js',
    'routes/dashboard.js',
    'utils/promo-validator.js',
    'utils/email.js',
  ];

  const publicFiles = [
    'public/index.html',
    'public/events.html',
    'public/schedule.html',
    'public/pricing.html',
    'public/shop.html',
    'public/contact.html',
    'public/css/style.css',
    'public/js/shared.js',
    'public/js/shop.js',
  ];

  const adminFiles = [
    'admin/views/login.html',
    'admin/views/dashboard.html',
    'admin/css/admin.css',
    'admin/js/admin.js',
  ];

  const missing = [];
  const found = [];

  for (const file of [...requiredFiles, ...publicFiles, ...adminFiles]) {
    const fullPath = path.join(__dirname, '..', file);
    if (fs.existsSync(fullPath)) {
      found.push(file);
    } else {
      missing.push(file);
    }
  }

  return { ok: missing.length === 0, missing, found };
}

/**
 * Verifică consistența între package.json și modulul de DB folosit.
 */
function checkPackageJsonConsistency() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, error: 'package.json lipsește.' };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const hasBetterSqlite3 = 'better-sqlite3' in deps;
  const hasSqlJs = 'sql.js' in deps;

  return {
    ok: hasBetterSqlite3 && !hasSqlJs,
    details: {
      betterSqlite3: hasBetterSqlite3,
      sqlJs: hasSqlJs,
      recommendation: hasSqlJs && !hasBetterSqlite3
        ? 'Înlocuiește sql.js cu better-sqlite3 în package.json.'
        : hasBetterSqlite3 && hasSqlJs
          ? 'Ambele pachete sunt listate — elimină sql.js.'
          : !hasBetterSqlite3 && !hasSqlJs
            ? 'Niciun pachet de SQLite nu e listat — adaugă better-sqlite3.'
            : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Execuția principală a verificărilor de migrare
// ---------------------------------------------------------------------------

async function runMigrationChecks() {
  banner('VERIFICARE INTEGRITATE PROIECT — POST-MIGRARE');

  // ── 1. Verifică pachetul SQLite ──────────────────────────────────
  subBanner('1. Pachet SQLite');
  const sqliteCheck = checkBetterSqlite3Installed();
  migrationCheck(
    'better-sqlite3 instalat',
    sqliteCheck.ok,
    sqliteCheck.ok ? 'Modul nativ detectat.' : sqliteCheck.error,
  );

  // ── 2. Verifică package.json ─────────────────────────────────────
  subBanner('2. Configurare package.json');
  const pkgCheck = checkPackageJsonConsistency();
  migrationCheck(
    'package.json — better-sqlite3 prezent, sql.js absent',
    pkgCheck.ok,
    pkgCheck.ok ? 'Corect.' : (pkgCheck.details?.recommendation || pkgCheck.error),
  );

  // Dacă better-sqlite3 nu e instalat dar sql.js este, afișează avertisment
  if (!sqliteCheck.ok && pkgCheck.details?.sqlJs) {
    console.log(`  ${C.yellow}⚠${C.reset}  Migrarea sql.js → better-sqlite3 nu a fost finalizată.`);
    console.log(`  ${C.yellow}   Rulează: npm uninstall sql.js && npm install better-sqlite3${C.reset}`);
  }

  // ── 3. Verifică fișierele proiectului ────────────────────────────
  subBanner('3. Integritate fișiere proiect');
  const fileCheck = checkProjectFiles();
  migrationCheck(
    `Fișiere proiect — ${fileCheck.found.length} găsite`,
    fileCheck.ok,
    fileCheck.ok ? 'Toate fișierele esențiale sunt prezente.' : `Lipsesc: ${fileCheck.missing.join(', ')}`,
  );

  if (fileCheck.missing.length > 0) {
    for (const m of fileCheck.missing) {
      console.log(`    ${C.red}  - ${m}${C.reset}`);
    }
  }

  // ── 4. Verifică baza de date ─────────────────────────────────────
  subBanner('4. Baza de date');
  const dbHealth = await checkDatabaseHealth();

  migrationCheck(
    'Inițializare baza de date',
    dbHealth.ok,
    dbHealth.ok ? 'Conexiune stabilită.' : dbHealth.error,
  );

  if (dbHealth.ok && dbHealth.details) {
    const d = dbHealth.details;

    migrationCheck(
      `Tabele create — ${d.tables?.length || 0} găsite`,
      d.missingTables?.length === 0,
      d.missingTables?.length > 0 ? `Lipsesc: ${d.missingTables.join(', ')}` : 'Toate tabelele sunt prezente.',
    );

    migrationCheck(
      `Foreign keys activate — ${d.foreignKeys ? 'ON' : 'OFF'}`,
      d.foreignKeys === true,
      d.foreignKeys ? 'Integritate referențială activă.' : 'Foreign keys sunt dezactivate!',
    );

    migrationCheck(
      `Journal mode — ${d.journalMode}`,
      d.journalMode === 'wal',
      d.journalMode === 'wal' ? 'WAL activ — performanță optimă.' : `Modul ${d.journalMode} — WAL recomandat.`,
    );

    // Verifică admin seed
    migrationCheck(
      'Admin seed — admin@boxingchampions.ro',
      d.adminExists === true,
      d.adminExists ? 'Contul de admin există.' : 'Contul de admin NU a fost găsit!',
    );

    // Verifică row counts
    migrationCheck(
      'Setări implicite populate',
      (d.rowCounts?.settings || 0) > 0,
      `${d.rowCounts?.settings || 0} setări în baza de date.`,
    );

    // Verifică că există cel puțin un users row (admin)
    migrationCheck(
      'Tabela users populată',
      (d.rowCounts?.users || 0) > 0,
      `${d.rowCounts?.users || 0} utilizatori.`,
    );

    // Afișează sumarul row counts
    if (VERBOSE) {
      console.log(`\n  ${C.dim}Row counts per tabelă:${C.reset}`);
      for (const [table, count] of Object.entries(d.rowCounts || {})) {
        console.log(`    ${C.dim}${table}: ${count}${C.reset}`);
      }
    }
  }

  // ── 5. Verifică node_modules ─────────────────────────────────────
  subBanner('5. Dependințe instalate');
  const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
  const hasNodeModules = fs.existsSync(nodeModulesPath);

  const criticalDeps = ['express', 'better-sqlite3', 'bcrypt', 'jsonwebtoken', 'helmet', 'cookie-parser', 'dotenv'];
  const missingDeps = [];
  if (hasNodeModules) {
    for (const dep of criticalDeps) {
      if (!fs.existsSync(path.join(nodeModulesPath, dep))) {
        // Pentru better-sqlite3, verificăm și sql.js ca fallback
        if (dep === 'better-sqlite3' && fs.existsSync(path.join(nodeModulesPath, 'sql.js'))) {
          continue; // sql.js e prezent ca fallback
        }
        missingDeps.push(dep);
      }
    }
  } else {
    missingDeps.push(...criticalDeps);
  }

  migrationCheck(
    'Dependințe critice instalate',
    missingDeps.length === 0,
    missingDeps.length > 0 ? `Lipsesc: ${missingDeps.join(', ')}` : 'Toate dependințele sunt prezente.',
  );

  // ── Sumar migrare ────────────────────────────────────────────────
  console.log(`\n${C.bold}${'─'.repeat(60)}${C.reset}`);
  const mOk = results.migration.failed === 0;
  console.log(`${mOk ? C.green + 'PASS' : C.red + 'FAIL'}${C.reset} Verificare integritate — ${results.migration.passed}/${results.migration.total} trecute.`);

  if (!mOk) {
    console.log(`\n${C.yellow}⚠  Unele verificări de migrare au eșuat.${C.reset}`);
    console.log(`${C.yellow}   Remediază problemele înainte de a rula testele HTTP.${C.reset}`);
  }

  return { ok: mOk, dbHealth };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runSuites() {
  console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Boxing Champions — Test Suite         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}Server: ${BASE_URL}${C.reset}`);
  console.log(`${C.dim}Data:   ${new Date().toISOString()}${C.reset}\n`);

  // ── Pas 1: Verificări de migrare ────────────────────────────────
  const { dbHealth } = await runMigrationChecks();

  if (!dbHealth || !dbHealth.ok) {
    console.log(`\n${C.red}${C.bold}✗ Baza de date nu este funcțională. Testele HTTP nu pot rula.${C.reset}`);
    console.log(`${C.red}  Eroare: ${dbHealth?.error || 'Necunoscută'}${C.reset}\n`);
    process.exit(1);
  }

  // Dacă s-a cerut doar migrare, ieșim aici
  if (MIGRATION_ONLY) {
    console.log(`\n${C.green}${C.bold}✓ Verificările de migrare s-au încheiat.${C.reset}`);
    console.log(`${C.dim}  Folosește 'node tests/run.js' fără --migration-only pentru testele complete.${C.reset}\n`);
    process.exit(results.migration.failed > 0 ? 1 : 0);
  }

  // Dacă s-a cerut fără HTTP, ieșim după verificări
  if (NO_HTTP) {
    console.log(`\n${C.green}${C.bold}✓ Verificările fără HTTP s-au încheiat.${C.reset}\n`);
    process.exit(results.migration.failed > 0 ? 1 : 0);
  }

  // ── Pas 2: Teste HTTP ───────────────────────────────────────────
  banner('TESTE HTTP — API');

  const suitesDir = path.join(__dirname);
  const files = fs.readdirSync(suitesDir)
    .filter(f => f.startsWith('test-') && f.endsWith('.js'))
    .sort();

  if (files.length === 0) {
    console.log(`  ${C.yellow}⚠ Niciun fișier de test găsit în tests/.${C.reset}`);
  }

  for (const file of files) {
    if (SUITE_FILTER && !file.includes(SUITE_FILTER)) continue;
    try {
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

  // ── Raport final ─────────────────────────────────────────────────
  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  RAPORT FINAL${C.reset}`);
  console.log(`${C.bold}${'═'.repeat(60)}${C.reset}`);

  // Secțiunea de migrare
  console.log(`\n  ${C.bold}Integritate migrare:${C.reset}`);
  console.log(`    Total:   ${results.migration.total}`);
  console.log(`    ${C.green}Passed:  ${results.migration.passed}${C.reset}`);
  console.log(`    ${C.red}Failed:  ${results.migration.failed}${C.reset}`);

  // Secțiunea de teste HTTP
  console.log(`\n  ${C.bold}Teste HTTP:${C.reset}`);
  console.log(`    Suite:   ${results.suites.length}`);
  console.log(`    Total:   ${results.total}`);
  console.log(`    ${C.green}Passed:  ${results.passed}${C.reset}`);
  console.log(`    ${C.red}Failed:  ${results.failed}${C.reset}`);

  // Sumar per suită
  if (results.suites.length > 0) {
    console.log(`\n  ${C.bold}Per suită:${C.reset}`);
    for (const suite of results.suites) {
      const s = suite.failed === 0 ? C.green + '✓' : C.red + '✗';
      console.log(`    ${s}${C.reset} ${suite.name}: ${suite.passed}/${suite.passed + suite.failed}`);
    }
  }

  console.log(`\n${'═'.repeat(60)}`);

  const totalFailed = results.migration.failed + results.failed;
  if (totalFailed === 0) {
    console.log(`${C.green}${C.bold}  ✓ TOATE TESTELE AU TRECUT — PROIECTUL ESTE SĂNĂTOS.${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  ✗ ${totalFailed} TESTE AU EȘUAT — VEZI DETALIILE MAI SUS.${C.reset}`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Pornire
// ---------------------------------------------------------------------------

runSuites().catch(err => {
  console.error(`${C.red}${C.bold}Fatal: ${err.message}${C.reset}`);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
