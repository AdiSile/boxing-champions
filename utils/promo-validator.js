// ---------------------------------------------------------------------------
// utils/promo-validator.js
// Validare centralizată a codurilor promoționale din tabela `promotions`.
//
// Folosit de routes/checkout.js și routes/promotions.js pentru a unifica
// logica de validare și a evita codul duplicat.
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Valori valide pentru câmpul applies_to */
const VALID_APPLIES_TO = ['all', 'plans', 'products', 'events'];

/** Tipuri de discount */
const DISCOUNT_TYPES = ['percentage', 'fixed'];

// ---------------------------------------------------------------------------
// Helpers SQL
// ---------------------------------------------------------------------------

/**
 * Construiește și execută interogarea pentru un cod promoțional activ.
 * Verifică: is_active, start_date, end_date, usage_limit.
 *
 * @param {string} code - codul promoțional (va fi normalizat UPPERCASE)
 * @returns {object|null} rândul din DB sau null
 */
function fetchActivePromo(code) {
  const db = getDb();
  const normalized = code.trim().toUpperCase();

  return db.prepare(`
    SELECT *
    FROM promotions
    WHERE code = ?
      AND is_active = 1
      AND (start_date IS NULL OR start_date <= datetime('now'))
      AND (end_date IS NULL OR end_date >= datetime('now'))
      AND (usage_limit IS NULL OR usage_count < usage_limit)
  `).get(normalized);
}

// ---------------------------------------------------------------------------
// API public
// ---------------------------------------------------------------------------

/**
 * Validează un cod promoțional.
 *
 * @param {string} code - codul introdus de utilizator
 * @param {object} [options] - contexte suplimentare
 * @param {string} [options.applies_to] - 'products', 'plans', 'events' — domeniul apelant
 * @param {number} [options.cart_total] - totalul coșului pentru verificări suplimentare
 * @returns {{ valid: boolean, promo?: object, error?: string, code?: string }}
 */
function validatePromoCode(code, options = {}) {
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { valid: false, error: 'Cod promoțional lipsă.', code: 'VALIDATION_ERROR' };
  }

  const promo = fetchActivePromo(code);

  if (!promo) {
    return {
      valid: false,
      error: `Codul "${code.trim().toUpperCase()}" nu este valid sau a expirat.`,
      code: 'INVALID_PROMO_CODE',
    };
  }

  // Verificare applies_to (dacă apelantul specifică contextul)
  if (options.applies_to) {
    if (promo.applies_to !== 'all' && promo.applies_to !== options.applies_to) {
      return {
        valid: false,
        error: `Codul se aplică doar pentru: ${promo.applies_to}.`,
        code: 'APPLIES_TO_MISMATCH',
      };
    }
  }

  // Validare suplimentară: pentru discount de tip percentage, valoarea
  // trebuie să fie între 0 și 100.
  if (promo.discount_type === 'percentage') {
    const dv = Number(promo.discount_value);
    if (!Number.isFinite(dv) || dv < 0 || dv > 100) {
      return {
        valid: false,
        error: 'Valoarea discount-ului procentual trebuie să fie între 0 și 100.',
        code: 'INVALID_DISCOUNT_VALUE',
      };
    }
  }

  // Validare suplimentară: pentru discount de tip fixed, valoarea
  // trebuie să fie pozitivă.
  if (promo.discount_type === 'fixed') {
    const dv = Number(promo.discount_value);
    if (!Number.isFinite(dv) || dv < 0) {
      return {
        valid: false,
        error: 'Valoarea discount-ului fix trebuie să fie pozitivă.',
        code: 'INVALID_DISCOUNT_VALUE',
      };
    }
  }

  return {
    valid: true,
    promo: {
      id: promo.id,
      code: promo.code,
      description: promo.description,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      applies_to: promo.applies_to,
      start_date: promo.start_date,
      end_date: promo.end_date,
      usage_limit: promo.usage_limit,
      usage_count: promo.usage_count,
    },
  };
}

/**
 * Calculează discount-ul pe baza promoției și subtotalului.
 *
 * @param {object} promo - promoția validată
 * @param {number} subtotal - subtotalul coșului
 * @returns {{ discountAmount: number, totalAfterDiscount: number }}
 */
function calculateDiscount(promo, subtotal) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  let discountAmount = 0;

  if (promo.discount_type === 'fixed') {
    // Discount fix: nu poate depăși subtotalul
    discountAmount = Math.min(Number(promo.discount_value) || 0, safeSubtotal);
  } else {
    // Percentage: valoarea trebuie să fie între 0 și 100
    const pct = Math.min(100, Math.max(0, Number(promo.discount_value) || 0));
    discountAmount = Math.round(safeSubtotal * (pct / 100) * 100) / 100;
  }

  const totalAfterDiscount = Math.round(Math.max(0, safeSubtotal - discountAmount) * 100) / 100;

  return {
    discountAmount: Math.round(Math.max(0, discountAmount) * 100) / 100,
    totalAfterDiscount: Math.round(Math.max(0, totalAfterDiscount) * 100) / 100,
  };
}

/**
 * Incrementează usage_count pentru o promoție (după o comandă reușită).
 *
 * @param {number} promoId - ID-ul promoției
 */
function incrementPromoUsage(promoId) {
  const db = getDb();
  db.prepare(
    'UPDATE promotions SET usage_count = usage_count + 1, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(promoId);
}

/**
 * Returnează toate promoțiile active (pentru endpoint-ul public /api/config).
 *
 * @returns {Array<object>}
 */
function getActivePromotions() {
  const db = getDb();
  return db.prepare(`
    SELECT code, description, discount_type, discount_value, applies_to,
           start_date, end_date
    FROM promotions
    WHERE is_active = 1
      AND (start_date IS NULL OR start_date <= datetime('now'))
      AND (end_date IS NULL OR end_date >= datetime('now'))
      AND (usage_limit IS NULL OR usage_count < usage_limit)
    ORDER BY code ASC
  `).all();
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  validatePromoCode,
  calculateDiscount,
  incrementPromoUsage,
  getActivePromotions,
  fetchActivePromo,
  VALID_APPLIES_TO,
  DISCOUNT_TYPES,
};