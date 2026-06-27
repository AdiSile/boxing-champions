// ---------------------------------------------------------------------------
// routes/auth.js
// Autentificare centralizată: folosește middleware-ul și helper-ele din
// middleware/auth.js pentru signare, verificare, cookie-uri și CSRF.
//
// POST /api/auth/login   – autentificare (bcrypt + setAuthCookies)
// GET  /api/auth/check   – verificare token (optionalAuth)
// POST /api/auth/logout  – ștergere cookie-uri + revocare (clearAuthCookies)
// POST /api/auth/refresh – refresh token rotation (refreshTokenHandler)
// ---------------------------------------------------------------------------

const express = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../config/db');
const { loginSchema, validate } = require('../middleware/validate');
const { authRateLimiter } = require('../middleware/security');
const {
  authenticate,
  optionalAuth,
  csrfProtection,
  refreshTokenHandler,
  setAuthCookies,
  clearAuthCookies,
  ACCESS_TOKEN_COOKIE,
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Costul bcrypt pentru hash-ul parolei */
const BCRYPT_SALT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Helpers – admin
// ---------------------------------------------------------------------------

/**
 * Returnează credențialele admin-ului din mediu sau default-uri.
 * @returns {{ email: string, password: string, name: string }}
 */
function getAdminCredentials() {
  return {
    email: process.env.ADMIN_EMAIL || 'admin@boxingchampions.ro',
    password: process.env.ADMIN_PASSWORD || 'boxing2026',
    name: process.env.ADMIN_NAME || 'Boxing Champions Admin',
  };
}

/**
 * Creează sau reactivează contul de admin.
 * Dacă admin-ul există deja (după email), îi actualizează parola și îl reactivează.
 * Dacă nu există, îl creează.
 *
 * @returns {{ success: boolean, user: object|null, error: string|null }}
 */
function recreateAdmin() {
  try {
    const db = getDb();
    const { email, password, name } = getAdminCredentials();

    // Verifică dacă tabela users există
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (!tableExists) {
      return { success: false, user: null, error: 'Tabela users nu există.' };
    }

    const hashedPassword = bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);

    // Verifică dacă admin-ul există deja după email
    const existing = db.prepare(
      'SELECT id, name, email, role, is_active FROM users WHERE email = ?'
    ).get(email);

    if (existing) {
      // Actualizează parola și reactivează
      db.prepare(`
        UPDATE users
        SET password = ?, is_active = 1, role = 'admin', email_verified_at = datetime('now')
        WHERE id = ?
      `).run(hashedPassword, existing.id);

      console.log(`[auth] Admin recreat (actualizat): ${email}`);

      return {
        success: true,
        user: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          role: 'admin',
        },
        error: null,
      };
    }

    // Creează admin nou
    const result = db.prepare(`
      INSERT INTO users (name, email, password, role, is_active, email_verified_at)
      VALUES (?, ?, ?, 'admin', 1, datetime('now'))
    `).run(name, email, hashedPassword);

    console.log(`[auth] Admin recreat (nou): ${email}`);

    return {
      success: true,
      user: {
        id: result.lastInsertRowid,
        name,
        email,
        role: 'admin',
      },
      error: null,
    };
  } catch (err) {
    console.error('[auth] Eroare la recrearea admin-ului:', err.message);
    return { success: false, user: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Auto-creare admin la pornire (dacă nu există niciun admin)
// ---------------------------------------------------------------------------

/**
 * Asigură existența unui cont de administrator la pornirea serverului.
 */
function ensureAdminOnStartup() {
  try {
    const db = getDb();

    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get();

    if (!tableExists) {
      return;
    }

    const existingAdmin = db.prepare(
      'SELECT id FROM users WHERE role = ? AND is_active = 1'
    ).get('admin');

    if (existingAdmin) {
      console.log('[auth] Admin există – skip auto-create la pornire.');
      return;
    }

    // Folosește aceeași funcție de recreare
    const result = recreateAdmin();
    if (result.success) {
      console.log('[auth] Admin auto-creat la pornire.');
    }
  } catch (err) {
    console.error('[auth] Eroare la ensureAdminOnStartup:', err.message);
  }
}

ensureAdminOnStartup();

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

router.post(
  '/api/auth/login',
  authRateLimiter,
  validate(loginSchema),
  async (req, res) => {
    try {
      const { email, password } = req.body;

      /**
       * Încearcă autentificarea cu credențialele date.
       * @returns {Promise<{ success: boolean, user: object|null }>}
       */
      async function attemptLogin() {
        const db = getDb();
        const user = db.prepare(
          'SELECT id, name, email, password, role, is_active FROM users WHERE email = ?'
        ).get(email);

        if (!user || !user.is_active) {
          return { success: false, user: null };
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return { success: false, user: null };
        }

        return {
          success: true,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        };
      }

      // 1. Prima încercare de autentificare
      let result = await attemptLogin();

      // 2. Dacă a eșuat și email-ul este cel de admin, recreăm admin-ul și reîncercăm
      if (!result.success) {
        const adminCreds = getAdminCredentials();

        if (email.toLowerCase() === adminCreds.email.toLowerCase()) {
          console.log('[auth] Autentificare admin eșuată – se reacrează admin-ul...');

          const recreation = recreateAdmin();

          if (recreation.success) {
            // Reîncearcă autentificarea după recreare
            result = await attemptLogin();

            if (!result.success) {
              return res.status(500).json({
                error: 'Admin account recovery failed.',
                code: 'ADMIN_RECOVERY_FAILED',
              });
            }
          } else {
            console.error('[auth] Recrearea admin-ului a eșuat:', recreation.error);
            return res.status(500).json({
              error: 'Admin account recovery failed.',
              code: 'ADMIN_RECOVERY_FAILED',
            });
          }
        }
      }

      // 3. Dacă tot nu s-a autentificat, returnează eroare generică
      if (!result.success) {
        return res.status(401).json({
          error: 'Invalid email or password.',
          code: 'INVALID_CREDENTIALS',
        });
      }

      // 4. Setează cookie-urile de autentificare (access + refresh + CSRF)
      const { csrfToken } = setAuthCookies(res, result.user);

      // 5. Răspuns – include CSRF token în body pentru client
      return res.json({
        message: 'Login successful.',
        user: result.user,
        csrfToken,
      });
    } catch (err) {
      console.error('[auth] Login error:', err.message);
      return res.status(500).json({
        error: 'Internal server error.',
        code: 'INTERNAL_ERROR',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/auth/check
// ---------------------------------------------------------------------------

router.get('/api/auth/check', optionalAuth, (req, res) => {
  try {
    // Dacă req.user este setat de optionalAuth, utilizatorul este autentificat
    if (req.user) {
      // Obține datele complete din baza de date
      try {
        const db = getDb();
        const user = db.prepare(
          'SELECT id, name, email, role, is_active FROM users WHERE id = ?'
        ).get(req.user.userId);

        if (user && user.is_active) {
          return res.json({
            authenticated: true,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
            },
          });
        }
      } catch {
        // Fallback: folosim datele din token
        return res.json({
          authenticated: true,
          user: {
            id: req.user.userId,
            email: req.user.email,
            role: req.user.role,
          },
        });
      }
    }

    // Neautentificat
    return res.json({
      authenticated: false,
      user: null,
    });
  } catch (err) {
    console.error('[auth] Check error:', err.message);
    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

router.post('/api/auth/logout', authenticate, csrfProtection, (req, res) => {
  // Revocă token-urile și șterge cookie-urile
  clearAuthCookies(req, res);

  return res.json({
    message: 'Logged out successfully.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// Refresh token rotation – emite o nouă pereche de token-uri și o revocă pe
// cea veche. Handler-ul este importat direct din middleware/auth.js.
// ---------------------------------------------------------------------------

router.post('/api/auth/refresh', refreshTokenHandler);

module.exports = router;