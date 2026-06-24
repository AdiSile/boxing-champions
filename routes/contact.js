'use strict';

// ---------------------------------------------------------------------------
// routes/contact.js — DEPRECATED (reconciled into routes/api.js)
//
// Toate rutele de contact/mesaje au fost consolidate în routes/api.js:
//
//   Public:
//     POST /api/messages           – submit contact form (era POST /api/contact)
//
//   Admin (JWT required):
//     GET    /api/admin/messages    – list all messages
//     GET    /api/admin/messages/:id – single message
//     PATCH  /api/admin/messages/:id/read – mark as read
//     DELETE /api/admin/messages/:id – delete message
//
// Motiv: POST /api/contact și POST /api/messages erau duplicate funcțional
// (ambele validau și salvau mesaje de contact prin db.createMessage()).
// Rutele de admin pentru mesaje erau de asemenea duplicate sub
// /api/contact/admin și /api/admin/messages.
//
// Eliminarea duplicării s-a făcut păstrând rutele din api.js ca punct
// canonic de acces și eliminând mount-ul /api/contact din server.js.
// ---------------------------------------------------------------------------

const express = require('express');
const router = express.Router();

// Re-export gol — nicio rută nu mai este expusă aici.
// Toate requesturile către /api/contact/* vor primi 404 de la server.

module.exports = router;