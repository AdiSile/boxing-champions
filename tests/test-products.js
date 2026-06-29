// ---------------------------------------------------------------------------
// tests/test-products.js — Teste CRUD pentru produse
// Verifică: GET /api/products (JSON cu data[], filtre categorie/preț),
//           POST/PUT/DELETE admin
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertEqual, assertStatus, assertOk, assertCreated }) {
  describe('CRUD Produse');

  let adminCookies = null;
  let csrfToken = null;
  let createdProductId = null;

  // -----------------------------------------------------------------------
  // Pregătire
  // -----------------------------------------------------------------------

  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
  });

  // -----------------------------------------------------------------------
  // GET /api/products — listare publică
  // -----------------------------------------------------------------------

  await it('GET /api/products — listare produse (public)', async () => {
    const res = await request('GET', '/api/products');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assert(typeof res.body.pagination === 'object', 'pagination trebuie să fie obiect');
    assert(typeof res.body.pagination.total === 'number', 'pagination.total trebuie să fie număr');
    assert(typeof res.body.pagination.page === 'number', 'pagination.page trebuie să fie număr');
  });

  await it('GET /api/products?page=1&limit=3 — paginare', async () => {
    const res = await request('GET', '/api/products?page=1&limit=3');
    assertOk(res);
    assert(res.body.data.length <= 3, 'Trebuie să returneze maxim 3 elemente');
    assertEqual(res.body.pagination.limit, 3, 'limit trebuie să fie 3');
  });

  // -----------------------------------------------------------------------
  // GET /api/products — filtre categorie / preț
  // -----------------------------------------------------------------------

  await it('GET /api/products?category=gloves — filtrare categorie', async () => {
    const res = await request('GET', '/api/products?category=gloves');
    assertOk(res);
    assert(res.body.data.length > 0, 'Trebuie să existe produse în categoria gloves');
    for (const p of res.body.data) {
      assertEqual(p.category, 'gloves', `Produsul "${p.name}" trebuie să fie categoria gloves`);
    }
  });

  await it('GET /api/products?min_price=100&max_price=300 — filtrare preț', async () => {
    const res = await request('GET', '/api/products?min_price=100&max_price=300');
    assertOk(res);
    for (const p of res.body.data) {
      assert(p.price >= 100, `Prețul ${p.price} trebuie >= 100`);
      assert(p.price <= 300, `Prețul ${p.price} trebuie <= 300`);
    }
  });

  await it('GET /api/products?category=gloves&limit=3 — filtrare combinată', async () => {
    const res = await request('GET', '/api/products?category=gloves&limit=3');
    assertOk(res);
    assert(res.body.data.length <= 3, 'Trebuie să returneze maxim 3 elemente');
    for (const p of res.body.data) {
      assertEqual(p.category, 'gloves', `Produsul "${p.name}" trebuie să fie categoria gloves`);
    }
  });

  await it('GET /api/products?sort=-price — sortare desc după preț', async () => {
    const res = await request('GET', '/api/products?sort=-price&limit=50');
    assertOk(res);
    const prices = res.body.data.map(p => p.price);
    for (let i = 1; i < prices.length; i++) {
      assert(prices[i] <= prices[i - 1], `Prețurile trebuie să fie descrescătoare: ${prices[i]} <= ${prices[i-1]}`);
    }
  });

  await it('GET /api/products?sort=name — sortare asc după nume', async () => {
    const res = await request('GET', '/api/products?sort=name&limit=50');
    assertOk(res);
    const names = res.body.data.map(p => p.name.toLowerCase());
    for (let i = 1; i < names.length; i++) {
      assert(names[i] >= names[i - 1], `Numele trebuie să fie în ordine alfabetică: "${names[i]}" >= "${names[i-1]}"`);
    }
  });

  await it('GET /api/products?search=box — căutare text', async () => {
    const res = await request('GET', '/api/products?search=box');
    assertOk(res);
    assert(res.body.data.length > 0, 'Căutarea după "box" trebuie să returneze rezultate');
    const keyword = 'box';
    for (const p of res.body.data) {
      const haystack = (p.name + ' ' + (p.description || '') + ' ' + p.category).toLowerCase();
      assert(haystack.includes(keyword), `Produsul "${p.name}" trebuie să conțină "box"`);
    }
  });

  await it('GET /api/products?is_active=all — admin vede toate produsele', async () => {
    const res = await request('GET', '/api/products?is_active=all');
    assertOk(res);
    assert(res.body.data.length > 0, 'Trebuie să returneze produse');
  });

  await it('GET /api/products?in_stock=true — doar produse în stoc', async () => {
    const res = await request('GET', '/api/products?in_stock=true');
    assertOk(res);
    for (const p of res.body.data) {
      assert(p.stock !== null && p.stock > 0, `Produsul "${p.name}" trebuie să aibă stock > 0`);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/products/categories
  // -----------------------------------------------------------------------

  await it('GET /api/products/categories — listă categorii', async () => {
    const res = await request('GET', '/api/products/categories');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    for (const cat of res.body.data) {
      assert(typeof cat.category === 'string', 'Fiecare categorie trebuie să aibă nume');
      assert(typeof cat.productCount === 'number', 'Fiecare categorie trebuie să aibă productCount');
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/products/:id — detaliu
  // -----------------------------------------------------------------------

  await it('GET /api/products/1 — primul produs din seed', async () => {
    const res = await request('GET', '/api/products/1');
    assertOk(res);
    assert(typeof res.body.data === 'object', 'data trebuie să fie obiect');
    assertEqual(res.body.data.id, 1, 'ID trebuie să fie 1');
    assert(typeof res.body.data.name === 'string', 'name trebuie să fie string');
    assert(typeof res.body.data.price === 'number', 'price trebuie să fie number');
    assert(typeof res.body.data.slug === 'string', 'slug trebuie să fie string');
  });

  await it('GET /api/products/999999 — 404 produs inexistent', async () => {
    const res = await request('GET', '/api/products/999999');
    assertStatus(res, 404, 'Trebuie să returneze 404');
    assertEqual(res.body.code, 'NOT_FOUND', 'Codul trebuie să fie NOT_FOUND');
  });

  // -----------------------------------------------------------------------
  // GET /api/products/slug/:slug — detaliu după slug
  // -----------------------------------------------------------------------

  await it('GET /api/products/slug/manusi-box-profesionale — slug valid', async () => {
    const res = await request('GET', '/api/products/slug/manusi-box-profesionale');
    assertOk(res);
    assert(typeof res.body.data === 'object', 'data trebuie să fie obiect');
    assertEqual(res.body.data.slug, 'manusi-box-profesionale', 'slug trebuie să corespundă');
  });

  await it('GET /api/products/slug/slug-inexistent — 404 slug invalid', async () => {
    const res = await request('GET', '/api/products/slug/slug-inexistent-zzz');
    assertStatus(res, 404, 'Trebuie să returneze 404');
    assertEqual(res.body.code, 'NOT_FOUND', 'Codul trebuie să fie NOT_FOUND');
  });

  // -----------------------------------------------------------------------
  // POST /api/products — creare (admin)
  // -----------------------------------------------------------------------

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
    assertEqual(res.body.message, 'Product created successfully.', 'Mesaj confirmare creare');
    assertEqual(res.body.data.name, 'Test Produs Automat', 'Numele trebuie să corespundă');
    assertEqual(res.body.data.price, 199.99, 'Prețul trebuie să corespundă');
    assertEqual(res.body.data.slug, slug, 'Slug-ul trebuie să corespundă');
    assertEqual(res.body.data.category, 'gloves', 'Categoria trebuie să fie gloves');
    assertEqual(res.body.data.stock, 50, 'Stock-ul trebuie să fie 50');
    createdProductId = res.body.data.id;
  });

  // -----------------------------------------------------------------------
  // GET /api/products/:id — verificare produs creat
  // -----------------------------------------------------------------------

  await it('GET /api/products/:id — detalii produs creat', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/products/${createdProductId}`);
    assertOk(res);
    assertEqual(res.body.data.id, createdProductId, 'ID-ul trebuie să corespundă');
  });

  // -----------------------------------------------------------------------
  // PUT /api/products/:id — actualizare (admin)
  // -----------------------------------------------------------------------

  await it('PUT /api/products/:id — actualizare produs', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Test Produs Modificat', price: 249.99, stock: 75 },
    });
    assertOk(res);
    assertEqual(res.body.message, 'Product updated successfully.', 'Mesaj confirmare actualizare');
    assertEqual(res.body.data.name, 'Test Produs Modificat', 'Numele trebuie actualizat');
    assertEqual(res.body.data.price, 249.99, 'Prețul trebuie actualizat');
    assertEqual(res.body.data.stock, 75, 'Stock-ul trebuie actualizat');
  });

  await it('PUT /api/products/:id — actualizare parțială (doar is_active)', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { is_active: false },
    });
    assertOk(res);
    assertEqual(res.body.data.is_active, false, 'is_active trebuie să fie false');
  });

  await it('PUT /api/products/:id — slug duplicat (409)', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { slug: 'manusi-box-profesionale' },
    });
    assertStatus(res, 409, 'Trebuie să returneze 409 pentru slug duplicat');
    assertEqual(res.body.code, 'SLUG_CONFLICT', 'Codul trebuie să fie SLUG_CONFLICT');
  });

  // -----------------------------------------------------------------------
  // DELETE /api/products/:id — ștergere (admin)
  // -----------------------------------------------------------------------

  await it('DELETE /api/products/:id — ștergere produs', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/products/${createdProductId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
    assertEqual(res.body.message, 'Product deleted successfully.', 'Mesaj confirmare ștergere');
    assertEqual(res.body.deleted.id, createdProductId, 'ID-ul șters trebuie să corespundă');
  });

  await it('GET /api/products/:id — 404 după ștergere', async () => {
    if (!createdProductId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/products/${createdProductId}`);
    assertStatus(res, 404, 'Trebuie să returneze 404 după ștergere');
  });

  await it('DELETE /api/products/999999 — 404 produs inexistent', async () => {
    const res = await request('DELETE', '/api/products/999999', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    assertStatus(res, 404, 'Trebuie să returneze 404');
    assertEqual(res.body.code, 'NOT_FOUND', 'Codul trebuie să fie NOT_FOUND');
  });

  // -----------------------------------------------------------------------
  // Autentificare / autorizare
  // -----------------------------------------------------------------------

  await it('POST /api/products — respins fără autentificare', async () => {
    const res = await request('POST', '/api/products', {
      body: { name: 'Fără Auth', slug: 'fara-auth-prod-' + Date.now(), price: 99.99 },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
    assertEqual(res.body.code, 'AUTH_REQUIRED', 'Codul trebuie să fie AUTH_REQUIRED');
  });

  await it('PUT /api/products/1 — respins fără autentificare', async () => {
    const res = await request('PUT', '/api/products/1', {
      body: { name: 'Fără Auth' },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  await it('DELETE /api/products/1 — respins fără autentificare', async () => {
    const res = await request('DELETE', '/api/products/1');
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  // -----------------------------------------------------------------------
  // Validare
  // -----------------------------------------------------------------------

  await it('POST /api/products — categorie invalidă', async () => {
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Categorie Invalidă', slug: 'categorie-invalida-' + Date.now(),
        price: 50, category: 'categorie_inexistenta',
      },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru categorie invalidă');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Codul trebuie să fie VALIDATION_ERROR');
  });

  await it('POST /api/products — slug duplicat (409)', async () => {
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Slug Duplicat', slug: 'manusi-box-profesionale',
        price: 99.99, category: 'gloves',
      },
    });
    assertStatus(res, 409, 'Trebuie să returneze 409 pentru slug duplicat');
    assertEqual(res.body.code, 'SLUG_CONFLICT', 'Codul trebuie să fie SLUG_CONFLICT');
  });

  await it('POST /api/products — câmpuri lipsă (validare)', async () => {
    const res = await request('POST', '/api/products', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Fără slug și preț' },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru câmpuri lipsă');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Codul trebuie să fie VALIDATION_ERROR');
  });

  done();
};