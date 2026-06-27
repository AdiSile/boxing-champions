// ---------------------------------------------------------------------------
// tests/test-events.js — Teste CRUD pentru evenimente
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertStatus, assertOk, assertCreated }) {
  describe('CRUD Evenimente');

  let adminCookies = null;
  let csrfToken = null;
  let createdEventId = null;

  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
  });

  await it('GET /api/events — listare evenimente (public)', async () => {
    const res = await request('GET', '/api/events');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
  });

  await it('GET /api/events?type=competition — filtrare după tip', async () => {
    const res = await request('GET', '/api/events?type=competition&is_published=true');
    assertOk(res);
  });

  await it('POST /api/events — creare eveniment nou', async () => {
    const slug = 'test-event-' + Date.now();
    const res = await request('POST', '/api/events', {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: {
        title: 'Test Eveniment Automat', slug: slug,
        description: 'Creat automat de suita de teste.',
        type: 'competition', location: 'Sala de Box București',
        start_date: '2026-06-15', end_date: '2026-06-16',
        time: '18:00', price: 50, capacity: 100, is_published: true,
      },
    });
    assertCreated(res, 'Crearea trebuie să returneze 201');
    assertEqual(res.body.data.title, 'Test Eveniment Automat', 'Titlul trebuie să corespundă');
    createdEventId = res.body.data.id;
  });

  await it('GET /api/events/:id — detalii eveniment creat', async () => {
    if (!createdEventId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/events/${createdEventId}`);
    assertOk(res);
    assertEqual(res.body.data.id, createdEventId, 'ID-ul trebuie să corespundă');
  });

  await it('PUT /api/events/:id — actualizare eveniment', async () => {
    if (!createdEventId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/events/${createdEventId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
      body: { title: 'Test Eveniment Modificat', price: 75, capacity: 150 },
    });
    assertOk(res);
    assertEqual(res.body.data.title, 'Test Eveniment Modificat', 'Titlul trebuie actualizat');
  });

  await it('DELETE /api/events/:id — ștergere eveniment', async () => {
    if (!createdEventId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/events/${createdEventId}`, {
      cookies: adminCookies, headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
  });

  await it('GET /api/events/:id — 404 după ștergere', async () => {
    if (!createdEventId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', `/api/events/${createdEventId}`);
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  await it('POST /api/events — respins fără autentificare', async () => {
    const res = await request('POST', '/api/events', {
      body: { title: 'Fără Auth', slug: 'fara-auth-ev-' + Date.now(), start_date: '2026-01-01' },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  done();
};