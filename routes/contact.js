'use strict';

// ---------------------------------------------------------------------------
// routes/contact.js — Boxing Champions Contact Routes
//
// Public endpoint (no auth):
//   POST /api/contact – submit contact form message
//
// Admin endpoints (JWT required, prefixed /api/contact/admin):
//   GET    /                     – list all messages
//   GET    /:id                  – single message
//   PATCH  /:id/read             – mark message as read
//   DELETE /:id                  – delete message
// ---------------------------------------------------------------------------

const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isString(s, maxLen = 5000) {
  return typeof s === 'string' && s.length <= maxLen;
}

function sanitizeString(s) {
  if (typeof s !== 'string') return '';
  return s.trim().slice(0, 5000);
}

function isPositiveInt(n) {
  return Number.isInteger(n) && n > 0;
}

// ---------------------------------------------------------------------------
// === PUBLIC ROUTE ===
// ---------------------------------------------------------------------------

/**
 * POST /api/contact
 *
 * Body (JSON):
 * {
 *   "name": "John Doe",
 *   "email": "john@example.com",
 *   "phone": "+40 721 234 567",
 *   "subject": "Întrebare despre abonamente",
 *   "message": "Aș dori să știu mai multe despre..."
 * }
 *
 * Saves the contact message to the database.
 * Returns 201 on success, 400 on validation errors, 500 on server errors.
 */
router.post('/', (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body || {};

    // --- Validation ---
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

    // --- Save message ---
    db.createMessage({
      name: sanitizeString(name),
      email: sanitizeString(email).toLowerCase(),
      phone: sanitizeString(phone || ''),
      subject: sanitizeString(subject),
      message: sanitizeString(message),
    });

    return res.status(201).json({ message: 'Mesajul a fost trimis cu succes.' });
  } catch (err) {
    console.error('[CONTACT] POST / error:', err.message);
    return res.status(500).json({ error: 'Eroare la trimiterea mesajului.' });
  }
});

// ---------------------------------------------------------------------------
// === ADMIN ROUTES (JWT protected) ===
// ---------------------------------------------------------------------------

const adminRouter = express.Router();

// Apply JWT verification to all admin routes
adminRouter.use(verifyToken);

/**
 * GET /api/contact/admin
 *
 * Returns all contact messages ordered by most recent first.
 */
adminRouter.get('/', (_req, res) => {
  try {
    const messages = db.getAllMessages();
    return res.json(messages);
  } catch (err) {
    console.error('[CONTACT] GET /admin error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea mesajelor.' });
  }
});

/**
 * GET /api/contact/admin/:id
 *
 * Returns a single contact message by ID.
 */
adminRouter.get('/:id', (req, res) => {
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
    console.error('[CONTACT] GET /admin/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la obținerea mesajului.' });
  }
});

/**
 * PATCH /api/contact/admin/:id/read
 *
 * Marks a message as read.
 */
adminRouter.patch('/:id/read', (req, res) => {
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
    console.error('[CONTACT] PATCH /admin/:id/read error:', err.message);
    return res.status(500).json({ error: 'Eroare la marcarea mesajului ca citit.' });
  }
});

/**
 * DELETE /api/contact/admin/:id
 *
 * Deletes a contact message.
 */
adminRouter.delete('/:id', (req, res) => {
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
    console.error('[CONTACT] DELETE /admin/:id error:', err.message);
    return res.status(500).json({ error: 'Eroare la ștergerea mesajului.' });
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