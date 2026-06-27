// ---------------------------------------------------------------------------
// routes/settings.js
// Setari aplicatie: GET /api/settings (public) si PUT /api/settings (admin)
//
// GET  – returneaza toate setarile (defaults + persistente, deep-merged).
// PUT  – actualizeaza setarile prin deep-merge; necesita autentificare admin.
//        Accepta atat obiecte FLAT { key: value, ... } cat si NESTED:
//          { site: { name: "X", description: "Y" }, smtp: { host: "..." } }
//        Obiectele nested sunt automat aplatizate (ex: site_name, smtp_host).
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const settingsModel = require('../models/settingsModel');
const {
  authenticate,
  authorize,
  csrfProtection,
} = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/settings
// Public – returneaza setarile complete ale aplicatiei.
// ---------------------------------------------------------------------------

router.get('/api/settings', (req, res) => {
  try {
    const settings = settingsModel.getSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[settings] GET error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// Admin only – actualizeaza setarile prin deep-merge.
// Middleware: authenticate → csrfProtection → authorize('admin')
//
// Body acceptat (ambele formate):
//   FLAT:   { "site_name": "Boxing Champions", "items_per_page": "24" }
//   NESTED: { "site": { "name": "Boxing Champions" }, "pagination": { "per_page": "24" } }
//
// Obiectele nested sunt aplatizate automat in chei cu underscore:
//   site.name → site_name
//   pagination.per_page → pagination_per_page
// ---------------------------------------------------------------------------

router.put('/api/settings', authenticate, csrfProtection, authorize('admin'), (req, res) => {
  try {
    // Validare body
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        error: 'Request body must be a JSON object (flat or nested).',
        code: 'INVALID_BODY',
      });
    }

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: 'Request body must be a non-empty JSON object.',
        code: 'INVALID_BODY',
      });
    }

    // updateSettings aplatizeaza automat obiectele nested
    const updated = settingsModel.updateSettings(req.body);

    return res.json({
      message: 'Settings updated successfully.',
      settings: updated,
    });
  } catch (err) {
    console.error('[settings] PUT error:', err.message);

    if (err instanceof TypeError) {
      return res.status(400).json({
        error: err.message,
        code: 'INVALID_BODY',
      });
    }

    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

module.exports = router;