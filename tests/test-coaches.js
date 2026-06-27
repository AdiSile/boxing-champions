// ---------------------------------------------------------------------------
// tests/test-coaches.js — Teste CRUD pentru antrenori
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertStatus, assertOk, assertCreated }) {
  describe('CRUD Antrenori');

  let adminCookies = null;
  let csrfToken = null;
  let createdCoachId = null;

  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
  });

  await it('GET /api/coaches — listare antrenori (public)', async () => {
    const res = await request('GET', '/api/coaches');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assert(res.body.pagination, 'Trebuie să includă pagination');
  });

  await it('GET /api/coaches?limit=5&sort=name — cu paginare și sortare', async () => {
    const res = await request('GET', '/api/coaches?limit=5&sort=name&is_active=true');
    assertOk(res);
    assert(res.body.data.length <= 5, 'Trebuie să returneze maxim 5 elemente');
  });

  await it('POST /api/coaches — creare antrenor nou', async () => {
    const slug = 'test-coach-' + Date.now();
    const res = await request('POST', '/api/coaches', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        name: 'Test Antrenor Automat', slug: slug,
        title: 'Antrenor Principal', bio: 'Creat automat de suita de teste.',
        email: 'test@antrenor.ro', phone: '0712345678',
        specialties: ['Box', 'Kickboxing'],
        certifications: ['Certificare A', 'Certificare B'],
        is_active: true, sort_order: 1,
      },
    });
    assertCreated(res, 'Crearea trebuie să returneze 201');
    assertEqual(res.body.data.name, 'Test Antrenor Automat', 'Numele trebuie să corespundă');
    createdCoachId = res.body.data.id;
  });

  await it('GET /api/coaches/:id — detalii antrenor creat', async () => {
    if (!createdCoachId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/coaches/${createdCoachId}`);
    assertOk(res);
    assertEqual(res.body.data.id, createdCoachId, 'ID-ul trebuie să corespundă');
  });

  await it('PUT /api/coaches/:id — actualizare antrenor', async () => {
    if (!createdCoachId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/coaches/${createdCoachId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { name: 'Test Antrenor Modificat', title: 'Antrenor Senior', sort_order: 2 },
    });
    assertOk(res);
    assertEqual(res.body.data.name, 'Test Antrenor Modificat', 'Numele trebuie actualizat');
  });

  await it('DELETE /api/coaches/:id — ștergere antrenor', async () => {
    if (!createdCoachId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/coaches/${createdCoachId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
    assertEqual(res.body.deleted.id, createdCoachId, 'ID-ul șters trebuie să corespundă');
  });

  await it('GET /api/coaches/:id — 404 după ștergere', async () => {
    if (!createdCoachId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/coaches/${createdCoachId}`);
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  await it('POST /api/coaches — respins fără autentificare', async () => {
    const res = await request('POST', '/api/coaches', {
      body: { name: 'Fără Auth', slug: 'fara-auth-' + Date.now() },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  done();
};