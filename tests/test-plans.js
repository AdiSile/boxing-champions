// ---------------------------------------------------------------------------
// tests/test-plans.js — Teste CRUD pentru abonamente (plans)
// Verifică:
//   - GET /api/plans (JSON cu data[], paginare, sortare, filtre)
//   - GET /api/plans/:id
//   - POST /api/plans (admin)
//   - PUT /api/plans/:id (admin)
//   - DELETE /api/plans/:id (admin)
//   - Autentificare / autorizare
// ---------------------------------------------------------------------------

module.exports = async function ({
  describe, it, done, request,
  assert, assertEqual, assertStatus, assertOk, assertCreated,
}) {
  describe('CRUD Abonamente (Plans)');

  let adminCookies = null;
  let csrfToken = null;
  let createdPlanId = null;

  // ═══════════════════════════════════════════════════════════════════════
  // Pregătire: autentificare admin
  // ═══════════════════════════════════════════════════════════════════════
  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
    assert(csrfToken.length > 0, 'CSRF token trebuie să fie prezent');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans — listare publică
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans — listare abonamente (public)', async () => {
    const res = await request('GET', '/api/plans');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assert(typeof res.body.pagination === 'object', 'pagination trebuie să fie obiect');
    assert(typeof res.body.pagination.total === 'number', 'pagination.total trebuie să fie număr');
    assert(typeof res.body.pagination.page === 'number', 'pagination.page trebuie să fie număr');
    assert(typeof res.body.pagination.limit === 'number', 'pagination.limit trebuie să fie număr');
    assert(typeof res.body.pagination.totalPages === 'number', 'pagination.totalPages trebuie să fie număr');

    // Verifică structura unui plan
    if (res.body.data.length > 0) {
      const plan = res.body.data[0];
      assert(typeof plan.id === 'number', 'id trebuie să fie număr');
      assert(typeof plan.name === 'string', 'name trebuie să fie string');
      assert(typeof plan.slug === 'string', 'slug trebuie să fie string');
      assert(typeof plan.price === 'number', 'price trebuie să fie număr');
      assert(typeof plan.duration_days === 'number', 'duration_days trebuie să fie număr');
      assert(Array.isArray(plan.features), 'features trebuie să fie array');
      assert(typeof plan.is_popular === 'boolean', 'is_popular trebuie să fie boolean');
      assert(typeof plan.is_active === 'boolean', 'is_active trebuie să fie boolean');
      assert(typeof plan.sort_order === 'number', 'sort_order trebuie să fie număr');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans — paginare
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans?page=1&limit=3 — paginare', async () => {
    const res = await request('GET', '/api/plans?page=1&limit=3');
    assertOk(res);
    assert(res.body.data.length <= 3, 'Trebuie să returneze maxim 3 elemente');
    assertEqual(res.body.pagination.limit, 3, 'limit trebuie să fie 3');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans — sortare
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans?sort=-price — sortare desc după preț', async () => {
    const res = await request('GET', '/api/plans?sort=-price&limit=50');
    assertOk(res);
    const prices = res.body.data.map(p => p.price);
    for (let i = 1; i < prices.length; i++) {
      assert(prices[i] <= prices[i - 1], `Prețurile trebuie să fie descrescătoare: ${prices[i]} <= ${prices[i - 1]}`);
    }
  });

  await it('GET /api/plans?sort=name — sortare asc după nume', async () => {
    const res = await request('GET', '/api/plans?sort=name&limit=50');
    assertOk(res);
    const names = res.body.data.map(p => p.name.toLowerCase());
    for (let i = 1; i < names.length; i++) {
      assert(names[i] >= names[i - 1], `Numele trebuie să fie în ordine alfabetică: "${names[i]}" >= "${names[i - 1]}"`);
    }
  });

  await it('GET /api/plans?sort=-duration_days — sortare durată desc', async () => {
    const res = await request('GET', '/api/plans?sort=-duration_days&limit=50');
    assertOk(res);
    const durations = res.body.data.map(p => p.duration_days);
    for (let i = 1; i < durations.length; i++) {
      assert(durations[i] <= durations[i - 1], `Durata trebuie descrescătoare: ${durations[i]} <= ${durations[i - 1]}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans — filtre
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans?is_popular=true — doar planuri populare', async () => {
    const res = await request('GET', '/api/plans?is_popular=true');
    assertOk(res);
    for (const p of res.body.data) {
      assert(p.is_popular === true, `Planul "${p.name}" trebuie să fie popular`);
    }
  });

  await it('GET /api/plans?min_price=100&max_price=500 — filtrare preț', async () => {
    const res = await request('GET', '/api/plans?min_price=100&max_price=500');
    assertOk(res);
    for (const p of res.body.data) {
      assert(p.price >= 100, `Prețul ${p.price} trebuie >= 100`);
      assert(p.price <= 500, `Prețul ${p.price} trebuie <= 500`);
    }
  });

  await it('GET /api/plans?search=box — căutare text', async () => {
    const res = await request('GET', '/api/plans?search=box');
    assertOk(res);
    if (res.body.data.length > 0) {
      const keyword = 'box';
      for (const p of res.body.data) {
        const haystack = (p.name + ' ' + (p.description || '')).toLowerCase();
        assert(haystack.includes(keyword), `Planul "${p.name}" trebuie să conțină "box"`);
      }
    }
  });

  await it('GET /api/plans?is_active=all — admin vede toate planurile', async () => {
    const res = await request('GET', '/api/plans?is_active=all');
    assertOk(res);
    assert(res.body.data.length > 0, 'Trebuie să returneze planuri');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans/:id — detalii plan
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans/1 — primul plan din seed', async () => {
    const res = await request('GET', '/api/plans/1');
    assertOk(res);
    assert(typeof res.body.data === 'object', 'data trebuie să fie obiect');
    assertEqual(res.body.data.id, 1, 'ID trebuie să fie 1');
    assert(typeof res.body.data.name === 'string', 'name trebuie să fie string');
    assert(typeof res.body.data.price === 'number', 'price trebuie să fie number');
    assert(typeof res.body.data.slug === 'string', 'slug trebuie să fie string');
    assert(Array.isArray(res.body.data.features), 'features trebuie să fie array');
  });

  await it('GET /api/plans/999999 — 404 plan inexistent', async () => {
    const res = await request('GET', '/api/plans/999999');
    assertStatus(res, 404, 'Trebuie să returneze 404');
    assertEqual(res.body.code, 'NOT_FOUND', 'Codul trebuie să fie NOT_FOUND');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/plans — creare (admin)
  // ═══════════════════════════════════════════════════════════════════════
  await it('POST /api/plans — creare plan nou', async () => {
    const slug = 'test-plan-' + Date.now();
    const res = await request('POST', '/api/plans', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Test Plan Automat',
        slug: slug,
        description: 'Creat automat de suita de teste.',
        price: 149.99,
        duration_days: 90,
        features: ['Acces sală', 'Antrenor personal', 'Evaluare nutrițională'],
        is_popular: true,
        is_active: true,
        sort_order: 1,
      },
    });
    assertCreated(res, 'Crearea trebuie să returneze 201');
    assertEqual(res.body.message, 'Plan created successfully.', 'Mesaj confirmare creare');
    assertEqual(res.body.data.name, 'Test Plan Automat', 'Numele trebuie să corespundă');
    assertEqual(res.body.data.price, 149.99, 'Prețul trebuie să corespundă');
    assertEqual(res.body.data.slug, slug, 'Slug-ul trebuie să corespundă');
    assertEqual(res.body.data.duration_days, 90, 'Durata trebuie să fie 90 zile');
    assertEqual(res.body.data.is_popular, true, 'Trebuie să fie popular');
    assert(Array.isArray(res.body.data.features), 'features trebuie să fie array');
    assertEqual(res.body.data.features.length, 3, 'Trebuie să aibă 3 features');
    createdPlanId = res.body.data.id;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // GET /api/plans/:id — verificare plan creat
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/plans/:id — detalii plan creat', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/plans/${createdPlanId}`);
    assertOk(res);
    assertEqual(res.body.data.id, createdPlanId, 'ID-ul trebuie să corespundă');
    assertEqual(res.body.data.name, 'Test Plan Automat', 'Numele trebuie să corespundă');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /api/plans/:id — actualizare (admin)
  // ═══════════════════════════════════════════════════════════════════════
  await it('PUT /api/plans/:id — actualizare plan', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/plans/${createdPlanId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Test Plan Modificat',
        price: 199.99,
        duration_days: 180,
        features: ['Acces nelimitat', 'Antrenor premium', 'Saună'],
        is_popular: false,
      },
    });
    assertOk(res);
    assertEqual(res.body.message, 'Plan updated successfully.', 'Mesaj confirmare actualizare');
    assertEqual(res.body.data.name, 'Test Plan Modificat', 'Numele trebuie actualizat');
    assertEqual(res.body.data.price, 199.99, 'Prețul trebuie actualizat');
    assertEqual(res.body.data.duration_days, 180, 'Durata trebuie actualizată');
    assertEqual(res.body.data.is_popular, false, 'is_popular trebuie să fie false');
  });

  await it('PUT /api/plans/:id — actualizare parțială (doar is_active)', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/plans/${createdPlanId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { is_active: false },
    });
    assertOk(res);
    assertEqual(res.body.data.is_active, false, 'is_active trebuie să fie false');
  });

  await it('PUT /api/plans/:id — slug duplicat (409)', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    // Obține un slug existent pentru conflict
    const listRes = await request('GET', '/api/plans?limit=1');
    if (listRes.body.data.length > 0) {
      const existingSlug = listRes.body.data[0].slug;
      const res = await request('PUT', `/api/plans/${createdPlanId}`, {
        cookies: adminCookies,
        headers: { 'X-CSRF-Token': csrfToken },
        body: { slug: existingSlug },
      });
      assertStatus(res, 409, 'Trebuie să returneze 409 pentru slug duplicat');
      assertEqual(res.body.code, 'SLUG_CONFLICT', 'Codul trebuie să fie SLUG_CONFLICT');
    }
  });

  await it('PUT /api/plans/999999 — 404 plan inexistent', async () => {
    const res = await request('PUT', '/api/plans/999999', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Nu există' },
    });
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // DELETE /api/plans/:id — ștergere (admin)
  // ═══════════════════════════════════════════════════════════════════════
  await it('DELETE /api/plans/:id — ștergere plan', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/plans/${createdPlanId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
    assertEqual(res.body.message, 'Plan deleted successfully.', 'Mesaj confirmare ștergere');
    assertEqual(res.body.deleted.id, createdPlanId, 'ID-ul șters trebuie să corespundă');
  });

  await it('GET /api/plans/:id — 404 după ștergere', async () => {
    if (!createdPlanId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/plans/${createdPlanId}`);
    assertStatus(res, 404, 'Trebuie să returneze 404 după ștergere');
  });

  await it('DELETE /api/plans/999999 — 404 plan inexistent', async () => {
    const res = await request('DELETE', '/api/plans/999999', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
    });
    assertStatus(res, 404, 'Trebuie să returneze 404');
    assertEqual(res.body.code, 'NOT_FOUND', 'Codul trebuie să fie NOT_FOUND');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Autentificare / autorizare
  // ═══════════════════════════════════════════════════════════════════════
  await it('POST /api/plans — respins fără autentificare', async () => {
    const res = await request('POST', '/api/plans', {
      body: {
        name: 'Fără Auth',
        slug: 'fara-auth-plan-' + Date.now(),
        price: 99.99,
        duration_days: 30,
      },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
    assertEqual(res.body.code, 'AUTH_REQUIRED', 'Codul trebuie să fie AUTH_REQUIRED');
  });

  await it('PUT /api/plans/1 — respins fără autentificare', async () => {
    const res = await request('PUT', '/api/plans/1', {
      body: { name: 'Fără Auth' },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  await it('DELETE /api/plans/1 — respins fără autentificare', async () => {
    const res = await request('DELETE', '/api/plans/1');
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // POST /api/plans — respins fără CSRF
  // ═══════════════════════════════════════════════════════════════════════
  await it('POST /api/plans — respins fără CSRF (403)', async () => {
    const res = await request('POST', '/api/plans', {
      cookies: adminCookies,
      body: {
        name: 'Fără CSRF',
        slug: 'fara-csrf-' + Date.now(),
        price: 99.99,
        duration_days: 30,
      },
    });
    assertStatus(res, 403, 'Trebuie să returneze 403');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Validare
  // ═══════════════════════════════════════════════════════════════════════
  await it('POST /api/plans — câmpuri lipsă (validare)', async () => {
    const res = await request('POST', '/api/plans', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Fără slug și preț' },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru câmpuri lipsă');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Codul trebuie să fie VALIDATION_ERROR');
  });

  await it('POST /api/plans — slug duplicat (409)', async () => {
    const listRes = await request('GET', '/api/plans?limit=1');
    if (listRes.body.data.length > 0) {
      const existingSlug = listRes.body.data[0].slug;
      const res = await request('POST', '/api/plans', {
        cookies: adminCookies,
        headers: { 'X-CSRF-Token': csrfToken },
        body: {
          name: 'Slug Duplicat',
          slug: existingSlug,
          price: 99.99,
          duration_days: 30,
        },
      });
      assertStatus(res, 409, 'Trebuie să returneze 409 pentru slug duplicat');
      assertEqual(res.body.code, 'SLUG_CONFLICT', 'Codul trebuie să fie SLUG_CONFLICT');
    }
  });

  await it('POST /api/plans — preț negativ (validare)', async () => {
    const res = await request('POST', '/api/plans', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Preț Negativ',
        slug: 'pret-negativ-' + Date.now(),
        price: -10,
        duration_days: 30,
      },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru preț negativ');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Codul trebuie să fie VALIDATION_ERROR');
  });

  await it('POST /api/plans — duration_days invalid (validare)', async () => {
    const res = await request('POST', '/api/plans', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Durată Invalidă',
        slug: 'durata-invalida-' + Date.now(),
        price: 99.99,
        duration_days: 400,
      },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400 pentru duration_days > 365');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Codul trebuie să fie VALIDATION_ERROR');
  });

  done();
};