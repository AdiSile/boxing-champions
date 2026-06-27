// ---------------------------------------------------------------------------
// routes/dashboard.js
// Endpoint dedicat pentru statisticile dashboard-ului admin.
//
// GET /api/dashboard/stats  – admin, returnează toate statisticile într-o singură
//                              cerere (coaches, events, products, plans, orders,
//                              unread messages, active promotions, revenue,
//                              recent orders).
//
// Autentificare & autorizare: middleware centralizat din middleware/auth.js
// ---------------------------------------------------------------------------

const express = require('express');
const { getDb } = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/stats
// Middleware: authenticate → authorize('admin')
// ---------------------------------------------------------------------------

router.get('/api/dashboard/stats', authenticate, authorize('admin'), (req, res) => {
  try {
    const db = getDb();

    // Numără antrenori totali (activi + inactivi)
    const coachesTotal = db.prepare('SELECT COUNT(*) as total FROM coaches').get().total;

    // Numără evenimente totale
    const eventsTotal = db.prepare('SELECT COUNT(*) as total FROM events').get().total;

    // Numără produse totale
    const productsTotal = db.prepare('SELECT COUNT(*) as total FROM products').get().total;

    // Numără abonamente totale
    const plansTotal = db.prepare('SELECT COUNT(*) as total FROM plans').get().total;

    // Numără comenzi totale
    const ordersTotal = db.prepare('SELECT COUNT(*) as total FROM orders').get().total;

    // Numără mesaje necitite
    const unreadMessages = db.prepare("SELECT COUNT(*) as total FROM contact_messages WHERE is_read = 0").get().total;

    // Numără promoții active
    const activePromotions = db.prepare('SELECT COUNT(*) as total FROM promotions WHERE is_active = 1').get().total;

    // Calculează venitul din comenzile completed + confirmed
    const revenueRow = db.prepare(
      "SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status IN ('completed', 'confirmed')"
    ).get();
    const revenue = revenueRow ? revenueRow.total : 0;

    // Ultimele 5 comenzi
    const recentOrders = db.prepare(`
      SELECT o.id, o.order_number, o.status, o.total_amount, o.billing_name,
             o.created_at, u.name AS user_name, u.email AS user_email
      FROM orders o LEFT JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 5
    `).all();

    return res.json({
      coaches: coachesTotal,
      events: eventsTotal,
      products: productsTotal,
      plans: plansTotal,
      orders: ordersTotal,
      unread_messages: unreadMessages,
      active_promotions: activePromotions,
      revenue: revenue,
      recent_orders: recentOrders,
    });
  } catch (err) {
    console.error('[dashboard] stats error:', err.message);
    return res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
