// ---------------------------------------------------------------------------
// routes/checkout.js
// Stripe Checkout – test mode
//
// POST   /api/checkout                    – creează o sesiune Stripe Checkout
// GET    /api/config                       – returnează cheia publică Stripe
// GET    /api/checkout/validate-promo/:code – validează un cod promoțional (public)
//
// Promoțiile sunt validate din tabela `promotions` (nu hardcodate).
// Logica de promoții este unificată cu routes/promotions.js prin
// utils/promo-validator.js.
// ---------------------------------------------------------------------------

const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../config/db');
const {
  validatePromoCode,
  calculateDiscount,
  incrementPromoUsage,
  getActivePromotions,
} = require('../utils/promo-validator');
const {
  validate,
  promoValidateSchema,
} = require('../middleware/validate');

const router = express.Router();

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Statusuri valide de comandă */
const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded',
];

/** Categoriile de produse */
const PRODUCT_CATEGORIES = [
  'general', 'gloves', 'headgear', 'footwear', 'apparel', 'protection', 'accessories', 'equipment',
];

// ---------------------------------------------------------------------------
// Schemă validare POST /api/checkout
// ---------------------------------------------------------------------------

const checkoutSchema = {
  body: {
    items: {
      type: 'array',
      required: true,
      maxItems: 50,
      validate(value) {
        if (!Array.isArray(value)) return 'items must be an array.';
        if (value.length === 0) return 'items must have at least one item.';
        for (const item of value) {
          if (!Number.isInteger(item.product_id) || item.product_id < 1) {
            return 'each item must have a valid product_id (positive integer).';
          }
          if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
            return 'each item must have a quantity between 1 and 99.';
          }
          if (item.price !== undefined && (typeof item.price !== 'number' || item.price < 0)) {
            return 'each item price must be a non-negative number.';
          }
        }
        return true;
      },
    },
    promo_code: {
      type: 'string',
      minLength: 1,
      maxLength: 50,
      sanitize(value) {
        return typeof value === 'string' ? value.trim().toUpperCase() : value;
      },
    },
    billing_name: { type: 'name', minLength: 2, maxLength: 128 },
    billing_email: { type: 'email' },
    billing_phone: { type: 'phone' },
    notes: { type: 'text', maxLength: 2048 },
    success_url: {
      type: 'string',
      maxLength: 2048,
      validate(value) {
        if (value && !/^https?:\/\/.+/.test(value)) {
          return 'must be a valid HTTP URL.';
        }
        return true;
      },
    },
    cancel_url: {
      type: 'string',
      maxLength: 2048,
      validate(value) {
        if (value && !/^https?:\/\/.+/.test(value)) {
          return 'must be a valid HTTP URL.';
        }
        return true;
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Helper – Stripe inițializare lazy
// ---------------------------------------------------------------------------

let _stripe = null;

/**
 * Obține instanța Stripe (inițializare lazy).
 * @returns {import('stripe').Stripe|null}
 */
function getStripe() {
  if (_stripe) return _stripe;

  const stripeKey = process.env.STRIPE_KEY;
  if (!stripeKey || stripeKey === 'sk_test_placeholder') {
    console.warn('[checkout] STRIPE_KEY nu este configurată. Checkout-ul va fi simulat.');
    return null;
  }

  try {
    const Stripe = require('stripe');
    _stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
    });
    return _stripe;
  } catch (err) {
    console.error('[checkout] Eroare la inițializarea Stripe:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /api/checkout
// Creează o sesiune Stripe Checkout și returnează URL-ul de plată.
//
// Body (validat cu checkoutSchema):
//   - items (required): array de { product_id, quantity, price? }
//   - promo_code (optional): string cu codul promoțional
//   - billing_name, billing_email, billing_phone, notes (opționale)
//   - success_url, cancel_url (opționale – overrides)
// ---------------------------------------------------------------------------

router.post('/api/checkout', validate(checkoutSchema), async (req, res) => {
  try {
    const db = getDb();

    // ------------------------------------------------------------------
    // 1. Extragere date (deja validate și sanitizate)
    // ------------------------------------------------------------------
    const {
      items,
      promo_code,
      billing_name,
      billing_email,
      billing_phone,
      notes,
      success_url,
      cancel_url,
    } = req.body;

    // items este deja array valid datorită schemei
    const parsedItems = items;

    // ------------------------------------------------------------------
    // 2. Verificare produse, stoc și calcul subtotal
    // ------------------------------------------------------------------
    let subtotal = 0;
    const lineItems = [];
    const validatedItems = [];

    for (const item of parsedItems) {
      const productId = item.product_id;
      const quantity = item.quantity;

      const product = db.prepare(
        'SELECT id, name, slug, price, image, stock, is_active, category FROM products WHERE id = ?'
      ).get(productId);

      if (!product) {
        return res.status(400).json({
          error: `Produsul cu id ${productId} nu a fost găsit.`,
          code: 'PRODUCT_NOT_FOUND',
        });
      }

      if (!product.is_active) {
        return res.status(400).json({
          error: `Produsul "${product.name}" nu mai este disponibil.`,
          code: 'PRODUCT_UNAVAILABLE',
        });
      }

      if (product.stock !== null && product.stock < quantity) {
        return res.status(400).json({
          error: `Stoc insuficient pentru "${product.name}". Disponibil: ${product.stock}.`,
          code: 'INSUFFICIENT_STOCK',
        });
      }

      const unitPrice = item.price !== undefined ? item.price : Number(product.price);
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;

      validatedItems.push({
        product_id: productId,
        product_name: product.name,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
      });

      const imageUrl = product.image
        ? `${req.protocol}://${req.get('host')}${product.image}`
        : undefined;

      lineItems.push({
        price_data: {
          currency: 'ron',
          product_data: {
            name: product.name,
            ...(imageUrl ? { images: [imageUrl] } : {}),
          },
          unit_amount: Math.round(unitPrice * 100),
        },
        quantity,
      });

      subtotal += lineTotal;
    }

    subtotal = Math.round(subtotal * 100) / 100;

    // ------------------------------------------------------------------
    // 3. Validare promo code din baza de date
    // ------------------------------------------------------------------
    let appliedPromo = null;
    let discountAmount = 0;
    let totalAmount = subtotal;
    let promoId = null;

    if (promo_code) {
      const validation = validatePromoCode(promo_code, { applies_to: 'products' });

      if (!validation.valid) {
        return res.status(400).json({
          error: validation.error,
          code: validation.code,
        });
      }

      const promo = validation.promo;

      // Calculează discount-ul
      const discount = calculateDiscount(promo, subtotal);
      discountAmount = discount.discountAmount;
      totalAmount = discount.totalAfterDiscount;

      appliedPromo = {
        code: promo.code,
        description: promo.description,
        discount_type: promo.discount_type,
        discount_value: promo.discount_value,
        discount_amount: discountAmount,
      };

      promoId = promo.id;

      // Ajustează line_items Stripe cu discount-ul (doar pentru percentage)
      if (promo.discount_type === 'percentage' && promo.discount_value > 0) {
        const discountFactor = 1 - promo.discount_value / 100;
        for (const li of lineItems) {
          li.price_data.unit_amount = Math.round(
            li.price_data.unit_amount * discountFactor
          );
        }
      }
      // Pentru discount fix, adăugăm un line item negativ în loc de ajustare per item
      // (opțional — Stripe nu permite unit_amount negativ, deci îl gestionăm doar
      //  pe partea noastră de calcul)
    }

    if (totalAmount < 0.50) {
      return res.status(400).json({
        error: 'Totalul comenzii este prea mic.',
        code: 'AMOUNT_TOO_LOW',
      });
    }

    // ------------------------------------------------------------------
    // 4. Creează comanda în baza de date (pending)
    // ------------------------------------------------------------------
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const orderNumber = `ORD-${now.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const orderResult = db.prepare(`
      INSERT INTO orders
        (user_id, order_number, status, total_amount, items,
         billing_name, billing_email, billing_phone, notes, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      null,
      orderNumber,
      totalAmount,
      JSON.stringify(validatedItems),
      billing_name || null,
      billing_email || null,
      billing_phone || null,
      notes || null,
      now,
      now,
    );

    const orderId = orderResult.lastInsertRowid;

    // ------------------------------------------------------------------
    // 5. Stripe Checkout Session
    // ------------------------------------------------------------------
    const stripe = getStripe();

    if (!stripe) {
      // --- MOD SIMULARE (când Stripe nu e configurat) ---
      console.log(`[checkout] MOD SIMULARE – Comanda #${orderNumber} creată (${totalAmount} RON)`);

      // Incrementează usage_count pentru promoție chiar și în mod simulare
      if (promoId) {
        incrementPromoUsage(promoId);
      }

      return res.json({
        success: true,
        mode: 'simulation',
        order: {
          id: orderId,
          order_number: orderNumber,
          subtotal,
          total_amount: totalAmount,
          discount_amount: discountAmount,
          promo: appliedPromo,
          items: validatedItems,
        },
        message: appliedPromo
          ? `Comandă simulată cu reducere. Total: ${totalAmount} RON.`
          : `Comandă simulată. Total: ${totalAmount} RON.`,
        url: `/shop.html?order=${orderNumber}&simulated=true`,
      });
    }

    // --- MOD STRIPE REAL ---
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const finalSuccessUrl = success_url || `${baseUrl}/shop.html?success=true&order=${orderNumber}`;
    const finalCancelUrl = cancel_url || `${baseUrl}/shop.html?canceled=true`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      customer_email: billing_email || undefined,
      metadata: {
        order_id: String(orderId),
        order_number: orderNumber,
        promo_code: promo_code || '',
        discount_amount: String(discountAmount),
      },
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
    });

    if (session.id) {
      const updatedNotes = (notes || '') + ` [Stripe: ${session.id}]`;
      db.prepare('UPDATE orders SET notes = ?, updated_at = ? WHERE id = ?')
        .run(updatedNotes.trim(), now, orderId);
    }

    // Incrementează usage_count pentru promoție
    if (promoId) {
      incrementPromoUsage(promoId);
    }

    return res.json({
      success: true,
      mode: 'stripe',
      order: {
        id: orderId,
        order_number: orderNumber,
        subtotal,
        total_amount: totalAmount,
        discount_amount: discountAmount,
        promo: appliedPromo,
      },
      session_id: session.id,
      url: session.url,
    });
  } catch (err) {
    console.error('[checkout] POST error:', err.message);

    if (err.type && err.type.startsWith('Stripe')) {
      return res.status(402).json({
        error: err.message || 'Eroare procesare plată.',
        code: 'STRIPE_ERROR',
      });
    }

    return res.status(500).json({
      error: 'Eroare internă de server.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/config
// Returnează configurări publice (cheia Stripe publică, promoții active)
// ---------------------------------------------------------------------------

router.get('/api/config', (_req, res) => {
  const stripeKey = process.env.STRIPE_KEY || '';

  let stripePublishableKey = null;
  if (stripeKey.startsWith('sk_test_')) {
    stripePublishableKey = 'pk_test_placeholder';
  } else if (stripeKey.startsWith('sk_live_')) {
    stripePublishableKey = 'pk_live_placeholder';
  }

  // Obține promoțiile active din DB în loc de cele hardcodate
  let promoList = [];
  try {
    promoList = getActivePromotions();
  } catch (err) {
    console.error('[checkout] Eroare la obținerea promoțiilor active:', err.message);
    promoList = [];
  }

  res.json({
    stripe_publishable_key: stripePublishableKey,
    stripe_configured: stripeKey !== 'sk_test_placeholder' && stripeKey.length > 20,
    promo_codes: promoList.map(p => ({
      code: p.code,
      description: p.description,
      discount_type: p.discount_type,
      discount_value: p.discount_value,
      applies_to: p.applies_to,
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/checkout/validate-promo/:code
// Validează un cod promoțional și returnează discount-ul (public).
// ---------------------------------------------------------------------------

router.get('/api/checkout/validate-promo/:code', validate(promoValidateSchema), (req, res) => {
  const { code } = req.params;
  const { cart_total } = req.query;

  const cartTotal = cart_total ? Number(cart_total) : 0;

  const validation = validatePromoCode(code, { applies_to: 'products' });

  if (!validation.valid) {
    return res.status(404).json({
      valid: false,
      error: validation.error,
      code: validation.code,
    });
  }

  const promo = validation.promo;

  // Calculează discount-ul pe baza totalului coșului (dacă e furnizat)
  const discount = calculateDiscount(promo, cartTotal > 0 ? cartTotal : 0);

  return res.json({
    valid: true,
    code: promo.code,
    description: promo.description,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    discount_amount: cartTotal > 0 ? discount.discountAmount : null,
    total_after_discount: cartTotal > 0 ? discount.totalAfterDiscount : null,
    applies_to: promo.applies_to,
  });
});

module.exports = router;