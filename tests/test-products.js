// ---------------------------------------------------------------------------
// tests/test-products.js — Teste CRUD pentru produse
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertStatus, assertOk, assertCreated }) {
  describe('CRUD Produse');

  let adminCookies = null;
  let csrfToken = null;
  let createdProductId = null;

  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
  });

  await it('GET /api/products — listare produse (public)', async () => {
    const res = await request('GET', '/api/products');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
  });

  await it('GET /api/products/categories — listă categorii', async () => {
    const res = await request('GET', '/api/products/categories');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
  });

  await it('GET /api/products?category=gloves&limit=3 — filtrare', async () => {
    const res = await request('GET', '/api/products?category=gloves&limit=3');
    assertOk(res);
    assert(res.body.data.length <= 3, 'Trebuie să returneze maxim 3 elemente');
  });

  await it('POST /api/products — creare produs nou', async () => {
    const slug = 'test-product-' + Date.now();
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Test Produs Automat', slug: slug,
        description: 'Creat automat de suita de teste.',
        price: 199.99, category: 'gloves', stock: 50, is_active: true,
      },
    });
    assertCreated(res, 'Crearea trebuie să returneze 201');
    assertEqual(res.body.data.name, 'Test Produs Automat', 'Numele trebuie să corespundă');
    assertEqual(res.body.data.price, 199.99, 'Prețul trebuie să corespundă');
    createdProductId = res.body.data.id;
  });

  await it('GET /api/products/:id — detalii produs creat', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/products/${createdProductId}`);
    assertOk(res);
    assertEqual(res.body.data.id, createdProductId, 'ID-ul trebuie să corespundă');
  });

  await it('PUT /api/products/:id — actualizare produs', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Test Produs Modificat', price: 249.99, stock: 75 },
    });
    assertOk(res);
    assertEqual(res.body.data.price, 249.99, 'Prețul trebuie actualizat');
  });

  await it('DELETE /api/products/:id — ștergere produs', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
  });

  await it('GET /api/products/:id — 404 după ștergere', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/products/${createdProductId}`);
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  await it('POST /api/products — respins fără autentificare', async () => {
    const res = await request('POST', '/api/products', {
      body: { name: 'Fără Auth', slug: 'fara-auth-prod-' + Date.now(), price: 99.99 },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  await it('POST /api/products — categorie invalidă', async () => {
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Categorie Invalidă', slug: 'categorie-invalida-' + Date.now(),
        price: 50, category: 'categorie_inexistenta',
      },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru categorie invalidă');
  });

  done();
};