// ---------------------------------------------------------------------------
// routes/settings.js
// Setări aplicație: GET /api/settings (public) și PUT /api/settings (admin)
//
// GET  – returnează toate setările (defaults + persistente, deep-merged).
// PUT  – actualizează setările prin deep-merge; necesită autentificare admin.
//        Acceptă un obiect parțial – doar cheile trimise se modifică.
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
// Public – returnează setările complete ale aplicației.
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
// Admin only – actualizează setările prin deep-merge.
// Middleware: authenticate → csrfProtection → authorize('admin')
// ---------------------------------------------------------------------------

router.put('/api/settings', authenticate, csrfProtection, authorize('admin'), (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length === 0)
      return res.status(400).json({ error: 'Request body must be a non-empty JSON object.', code: 'INVALID_BODY' });
    const updated = settingsModel.updateSettings(req.body);
    return res.json({ message: 'Settings updated successfully.', settings: updated });
  } catch (err) {
    console.error('[settings] PUT error:', err.message);
    if (err instanceof TypeError)
      return res.status(400).json({ error: err.message, code: 'INVALID_BODY' });
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;