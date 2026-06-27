// ---------------------------------------------------------------------------
// tests/test-checkout.js — Teste pentru checkout și promoții
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertStatus, assertOk, assertCreated }) {
  describe('Checkout & Promoții');

  let adminCookies = null;
  let csrfToken = null;
  let createdProductId = null;
  let createdPromoId = null;

  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
  });

  await it('Pregătire: creează produs de test', async () => {
    const slug = 'checkout-test-' + Date.now();
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Produs Test Checkout', slug: slug,
        price: 100, category: 'gloves', stock: 30, is_active: true,
      },
    });
    assertCreated(res);
    createdProductId = res.body.data.id;
  });

  await it('GET /api/config — config public disponibil', async () => {
    const res = await request('GET', '/api/config');
    assertOk(res);
    assert(typeof res.body.stripe_configured === 'boolean', 'Trebuie să indice dacă Stripe e configurat');
  });

  await it('POST /api/checkout — creare comandă (mod simulare)', async () => {
    if (!createdProductId) throw new Error('Produsul de test nu a fost creat');
    const res = await request('POST', '/api/checkout', {
      body: { items: [{ product_id: createdProductId, quantity: 2, price: 100 }] },
    });
    assertOk(res);
    assert(res.body.success === true, 'Checkout-ul trebuie să fie success');
    assertEqual(res.body.mode, 'simulation', 'Modul trebuie să fie simulation');
  });

  await it('POST /api/checkout — produs inexistent', async () => {
    const res = await request('POST', '/api/checkout', {
      body: { items: [{ product_id: 999999, quantity: 1, price: 100 }] },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400');
  });

  await it('POST /api/checkout — coș gol', async () => {
    const res = await request('POST', '/api/checkout', { body: { items: [] } });
    assertStatus(res, 400, 'Trebuie să returneze 400');
  });

  await it('GET /api/checkout/validate-promo/COD_INEXISTENT — cod inexistent', async () => {
    const res = await request('GET', '/api/checkout/validate-promo/COD_INEXISTENT');
    assert(res.status === 404 || (res.status === 200 && res.body.valid === false),
      'Trebuie să indice cod invalid');
  });

  await it('Pregătire: creează promoție de test', async () => {
    const code = 'TEST' + Date.now().toString().slice(-6);
    const res = await request('POST', '/api/promotions', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        code: code, description: 'Promoție creată automat de teste',
        discount_type: 'percentage', discount_value: 20,
        applies_to: 'products', is_active: true, usage_limit: 100,
      },
    });
    assertCreated(res);
    createdPromoId = res.body.data.id;
  });

  await it('GET /api/promotions/validate/:code — promoție validă', async () => {
    if (!createdPromoId) throw new Error('Promoția de test nu a fost creată');
    const promoRes = await request('GET', '/api/promotions?limit=1&sort=-id', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    if (promoRes.body.data && promoRes.body.data.length > 0) {
      const code = promoRes.body.data[0].code;
      const res = await request('GET', `/api/promotions/validate/${code}?cart_total=200`);
      assertOk(res);
      assert(res.body.valid === true, 'Promoția trebuie să fie validă');
    }
  });

  await it('POST /api/checkout — cu cod promoțional inexistent', async () => {
    if (!createdProductId) throw new Error('Produsul de test nu a fost creat');
    const res = await request('POST', '/api/checkout', {
      body: { items: [{ product_id: createdProductId, quantity: 1, price: 100 }], promo_code: 'COD_INEXISTENT' },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400');
  });

  await it('Curățare: șterge produsul de test', async () => {
    if (!createdProductId) return;
    await request('DELETE', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
  });

  await it('Curățare: șterge promoția de test', async () => {
    if (!createdPromoId) return;
    await request('DELETE', `/api/promotions/${createdPromoId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
  });

  done();
};