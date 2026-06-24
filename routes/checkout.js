// ---------------------------------------------------------------------------
// routes/checkout.js
// Stripe Checkout – test mode
//
// POST /api/checkout – creează o sesiune Stripe Checkout
// GET  /api/config    – returnează cheia publică Stripe (pk_test_...)
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');

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

/** Coduri promoționale predefinite (test mode) */
const PROMO_CODES = {
  'CHAMP35': { discountPercent: 35, description: 'Promoție de vară -35%', minOrder: 0 },
  'GLOVES25': { discountPercent: 25, description: 'Reducere mănuși -25%', minOrder: 0, category: 'gloves' },
  'KICKS20': { discountPercent: 20, description: 'Reducere încălțăminte -20%', minOrder: 0, category: 'footwear' },
  'HEAD15': { discountPercent: 15, description: 'Reducere căști -15%', minOrder: 0, category: 'headgear' },
  'ALL10': { discountPercent: 10, description: 'Reducere generală -10%', minOrder: 0 },
  'BOXING20': { discountPercent: 20, description: 'Reducere campion -20%', minOrder: 200 },
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
// Body:
//   - items (required): array de { product_id, quantity, price }
//   - promo_code (optional): string cu codul promoțional
//   - billing_name, billing_email, billing_phone, notes (opționale)
//   - success_url, cancel_url (opționale – overrides)
// ---------------------------------------------------------------------------

router.post('/api/checkout', async (req, res) => {
  try {
    const db = getDb();

    // ------------------------------------------------------------------
    // 1. Extragere date
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

    // ------------------------------------------------------------------
    // 2. Validare items
    // ------------------------------------------------------------------
    let parsedItems;
    try {
      parsedItems = typeof items === 'string' ? JSON.parse(items) : items;
    } catch {
      return res.status(400).json({
        error: 'Items must be a valid JSON array.',
        code: 'VALIDATION_ERROR',
      });
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({
        error: 'Cart is empty.',
        code: 'EMPTY_CART',
      });
    }

    // ------------------------------------------------------------------
    // 3. Verificare produse, stoc și calcul total
    // ------------------------------------------------------------------
    let subtotal = 0;
    const lineItems = [];
    const validatedItems = [];

    for (const item of parsedItems) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity);

      if (!Number.isInteger(productId) || productId < 1) {
        return res.status(400).json({
          error: `Invalid product_id: ${item.product_id}.`,
          code: 'VALIDATION_ERROR',
        });
      }

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        return res.status(400).json({
          error: `Invalid quantity: ${item.quantity}. Must be between 1 and 99.`,
          code: 'VALIDATION_ERROR',
        });
      }

      const product = db.prepare(
        'SELECT id, name, slug, price, image, stock, is_active, category FROM products WHERE id = ?'
      ).get(productId);

      if (!product) {
        return res.status(400).json({
          error: `Product with id ${productId} not found.`,
          code: 'PRODUCT_NOT_FOUND',
        });
      }

      if (!product.is_active) {
        return res.status(400).json({
          error: `Product "${product.name}" is no longer available.`,
          code: 'PRODUCT_UNAVAILABLE',
        });
      }

      if (product.stock !== null && product.stock < quantity) {
        return res.status(400).json({
          error: `Insufficient stock for "${product.name}". Available: ${product.stock}.`,
          code: 'INSUFFICIENT_STOCK',
        });
      }

      const unitPrice = item.price !== undefined ? Number(item.price) : Number(product.price);
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

    // ------------------------------------------------------------------
    // 4. Aplicare promo code
    // ------------------------------------------------------------------
    let discountPercent = 0;
    let appliedPromo = null;

    if (promo_code && typeof promo_code === 'string' && promo_code.trim()) {
      const code = promo_code.trim().toUpperCase();
      const promoDef = PROMO_CODES[code];

      if (promoDef) {
        if (subtotal < promoDef.minOrder) {
          return res.status(400).json({
            error: `Codul "${code}" necesită o comandă minimă de ${promoDef.minOrder} RON.`,
            code: 'MIN_ORDER_NOT_MET',
          });
        }

        if (promoDef.category) {
          const allMatch = validatedItems.every(item => {
            const prod = db.prepare('SELECT category FROM products WHERE id = ?').get(item.product_id);
            return prod && prod.category === promoDef.category;
          });

          if (!allMatch) {
            return res.status(400).json({
              error: `Codul "${code}" se aplică doar produselor din categoria "${promoDef.category}".`,
              code: 'CATEGORY_MISMATCH',
            });
          }
        }

        discountPercent = promoDef.discountPercent;
        appliedPromo = { code, ...promoDef };

        if (discountPercent > 0) {
          const discountFactor = 1 - discountPercent / 100;
          for (const li of lineItems) {
            li.price_data.unit_amount = Math.round(
              li.price_data.unit_amount * discountFactor
            );
          }
        }
      } else {
        return res.status(400).json({
          error: `Codul promoțional "${code}" nu este valid.`,
          code: 'INVALID_PROMO_CODE',
        });
      }
    }

    const discountAmount = Math.round(subtotal * (discountPercent / 100) * 100) / 100;
    const totalAmount = Math.round((subtotal - discountAmount) * 100) / 100;

    if (totalAmount < 0.50) {
      return res.status(400).json({
        error: 'Order total is too low.',
        code: 'AMOUNT_TOO_LOW',
      });
    }

    // ------------------------------------------------------------------
    // 5. Creează comanda în baza de date (pending)
    // ------------------------------------------------------------------
    const crypto = require('crypto');
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const orderNumber = `ORD-${now.slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

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
    // 6. Stripe Checkout Session
    // ------------------------------------------------------------------
    const stripe = getStripe();

    if (!stripe) {
      // --- MOD SIMULARE (când Stripe nu e configurat) ---
      console.log(`[checkout] MOD SIMULARE – Comanda #${orderNumber} creată (${totalAmount} RON)`);

      return res.json({
        success: true,
        mode: 'simulation',
        order: {
          id: orderId,
          order_number: orderNumber,
          total_amount: totalAmount,
          discount_percent: discountPercent,
          discount_amount: discountAmount,
          promo: appliedPromo,
          items: validatedItems,
        },
        message: discountPercent > 0
          ? `Comandă simulată cu reducere ${discountPercent}%. Total: ${totalAmount} RON.`
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
        discount_percent: String(discountPercent),
      },
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
    });

    if (session.id) {
      const updatedNotes = (notes || '') + ` [Stripe: ${session.id}]`;
      db.prepare('UPDATE orders SET notes = ?, updated_at = ? WHERE id = ?')
        .run(updatedNotes.trim(), now, orderId);
    }

    return res.json({
      success: true,
      mode: 'stripe',
      order: {
        id: orderId,
        order_number: orderNumber,
        total_amount: totalAmount,
        discount_percent: discountPercent,
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
        error: err.message || 'Payment processing error.',
        code: 'STRIPE_ERROR',
      });
    }

    return res.status(500).json({
      error: 'Internal server error.',
      code: 'INTERNAL_ERROR',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/config
// Returnează configurări publice (cheia Stripe publică, etc.)
// ---------------------------------------------------------------------------

router.get('/api/config', (_req, res) => {
  const stripeKey = process.env.STRIPE_KEY || '';

  let stripePublishableKey = null;
  if (stripeKey.startsWith('sk_test_')) {
    stripePublishableKey = 'pk_test_placeholder';
  } else if (stripeKey.startsWith('sk_live_')) {
    stripePublishableKey = 'pk_live_placeholder';
  }

  res.json({
    stripe_publishable_key: stripePublishableKey,
    stripe_configured: stripeKey !== 'sk_test_placeholder' && stripeKey.length > 20,
    promo_codes: Object.keys(PROMO_CODES).map(code => ({
      code,
      ...PROMO_CODES[code],
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/checkout/validate-promo/:code
// Validează un cod promoțional și returnează discount-ul.
// ---------------------------------------------------------------------------

router.get('/api/checkout/validate-promo/:code', (req, res) => {
  const { code } = req.params;
  const { cart_total, category } = req.query;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'Cod promoțional lipsă.',
      code: 'VALIDATION_ERROR',
    });
  }

  const normalizedCode = code.trim().toUpperCase();
  const promoDef = PROMO_CODES[normalizedCode];

  if (!promoDef) {
    return res.status(404).json({
      error: `Codul "${normalizedCode}" nu este valid.`,
      code: 'INVALID_PROMO_CODE',
      valid: false,
    });
  }

  const total = cart_total ? Number(cart_total) : 0;
  if (total < promoDef.minOrder) {
    return res.json({
      valid: false,
      code: normalizedCode,
      error: `Necesită comandă minimă de ${promoDef.minOrder} RON.`,
      min_order: promoDef.minOrder,
    });
  }

  if (promoDef.category && category) {
    const cat = category.toLowerCase();
    if (cat !== promoDef.category) {
      return res.json({
        valid: false,
        code: normalizedCode,
        error: `Se aplică doar categoriei "${promoDef.category}".`,
        required_category: promoDef.category,
      });
    }
  }

  return res.json({
    valid: true,
    code: normalizedCode,
    discount_percent: promoDef.discountPercent,
    description: promoDef.description,
    min_order: promoDef.minOrder,
    category: promoDef.category || null,
  });
});

module.exports = router;