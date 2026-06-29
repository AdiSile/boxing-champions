// ---------------------------------------------------------------------------
// tests/test-schedule.js — Teste CRUD pentru program (schedule)
// Verifică:
//   - GET /api/schedule (JSON cu data[], grouped{} pe zile)
//   - POST /api/schedule (admin)
//   - PUT /api/schedule (admin, batch)
//   - PUT /api/schedule/:id (admin)
//   - DELETE /api/schedule/:id (admin)
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertEqual, assertStatus, assertOk, assertCreated }) {
  describe('CRUD Program (Schedule)');

  let adminCookies = null;
  let csrfToken = null;
  let createdEntryId = null;

  // ------------------------------------------------------------------
  // Pregătire: autentificare admin
  // ------------------------------------------------------------------
  await it('Pregătire: autentificare admin', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    adminCookies = res.setCookie;
    csrfToken = res.body.csrfToken || '';
    assert(adminCookies, 'Trebuie să existe cookie-uri de sesiune');
  });

  // ------------------------------------------------------------------
  // GET /api/schedule — public
  // ------------------------------------------------------------------
  await it('GET /api/schedule — listare program (public)', async () => {
    const res = await request('GET', '/api/schedule');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assert(typeof res.body.grouped === 'object' && res.body.grouped !== null, 'grouped trebuie să fie obiect');
    assert(typeof res.body.total === 'number', 'total trebuie să fie număr');

    // Verifică structura grouped: chei 0-6, fiecare array
    for (let day = 0; day <= 6; day++) {
      assert(Array.isArray(res.body.grouped[String(day)]), `grouped['${day}'] trebuie să fie array`);
    }

    // Verifică structura unui element din data
    if (res.body.data.length > 0) {
      const entry = res.body.data[0];
      assert(typeof entry.id === 'number', 'id trebuie să fie număr');
      assert(typeof entry.title === 'string', 'title trebuie să fie string');
      assert(typeof entry.day_of_week === 'number', 'day_of_week trebuie să fie număr');
      assert(entry.day_of_week >= 0 && entry.day_of_week <= 6, 'day_of_week trebuie să fie între 0 și 6');
      assert(typeof entry.day_name === 'string', 'day_name trebuie să fie string');
      assert(typeof entry.start_time === 'string', 'start_time trebuie să fie string');
      assert(typeof entry.end_time === 'string', 'end_time trebuie să fie string');
      assert(typeof entry.is_active === 'boolean', 'is_active trebuie să fie boolean');
    }
  });

  // ------------------------------------------------------------------
  // GET /api/schedule — filtrare după zi
  // ------------------------------------------------------------------
  await it('GET /api/schedule?day_of_week=1 — filtrare după zi (Luni)', async () => {
    const res = await request('GET', '/api/schedule?day_of_week=1');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    for (const entry of res.body.data) {
      assertEqual(entry.day_of_week, 1, 'Toate intrările trebuie să fie pentru ziua 1 (Luni)');
    }
  });

  // ------------------------------------------------------------------
  // GET /api/schedule — filtrare după zi invalidă (trebuie ignorată)
  // ------------------------------------------------------------------
  await it('GET /api/schedule?day_of_week=99 — zi invalidă, returnează tot', async () => {
    const res = await request('GET', '/api/schedule?day_of_week=99');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
  });

  // ------------------------------------------------------------------
  // GET /api/schedule — căutare text
  // ------------------------------------------------------------------
  await it('GET /api/schedule?search=Box — căutare text', async () => {
    const res = await request('GET', '/api/schedule?search=Box');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    // Toate rezultatele ar trebui să conțină "Box" în title, location sau coach name
    if (res.body.data.length > 0) {
      for (const entry of res.body.data) {
        const haystack = (entry.title + ' ' + (entry.location || '') + ' ' + (entry.coach_name || '')).toLowerCase();
        assert(haystack.includes('box'), `Intrarea "${entry.title}" trebuie să conțină "box"`);
      }
    }
  });

  // ------------------------------------------------------------------
  // POST /api/schedule — creare sesiune individuală (admin)
  // ------------------------------------------------------------------
  await it('POST /api/schedule — creare sesiune nouă (admin)', async () => {
    const res = await request('POST', '/api/schedule', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        title: 'Test Sesiune Automată',
        day_of_week: 3,
        start_time: '14:00',
        end_time: '15:00',
        location: 'Sala Test',
        max_participants: 10,
        is_active: true,
      },
    });
    assertCreated(res, 'Crearea trebuie să returneze 201');
    assertEqual(res.body.data.title, 'Test Sesiune Automată', 'Titlul trebuie să corespundă');
    assertEqual(res.body.data.day_of_week, 3, 'Ziua trebuie să fie 3 (Miercuri)');
    assertEqual(res.body.data.day_name, 'Wednesday', 'Numele zilei trebuie să fie Wednesday');
    createdEntryId = res.body.data.id;
    assert(createdEntryId > 0, 'ID-ul trebuie să fie pozitiv');
  });

  // ------------------------------------------------------------------
  // GET /api/schedule după creare — verifică prezența noii sesiuni
  // ------------------------------------------------------------------
  await it('GET /api/schedule?day_of_week=3 — noua sesiune apare în listă', async () => {
    if (!createdEntryId) throw new Error('Testul de creare nu a rulat');
    const res = await request('GET', '/api/schedule?day_of_week=3');
    assertOk(res);
    const found = res.body.data.find(e => e.id === createdEntryId);
    assert(found, 'Noua sesiune trebuie să fie prezentă în listă');
  });

  // ------------------------------------------------------------------
  // PUT /api/schedule/:id — actualizare sesiune individuală
  // ------------------------------------------------------------------
  await it('PUT /api/schedule/:id — actualizare sesiune (admin)', async () => {
    if (!createdEntryId) throw new Error('Testul de creare nu a rulat');
    const res = await request('PUT', `/api/schedule/${createdEntryId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        title: 'Test Sesiune Modificată',
        location: 'Sala Modificată',
        max_participants: 15,
      },
    });
    assertOk(res);
    assertEqual(res.body.data.title, 'Test Sesiune Modificată', 'Titlul trebuie actualizat');
    assertEqual(res.body.data.location, 'Sala Modificată', 'Locația trebuie actualizată');
    assertEqual(res.body.data.max_participants, 15, 'max_participants trebuie actualizat');
  });

  // ------------------------------------------------------------------
  // PUT /api/schedule/:id — 404 pentru ID inexistent
  // ------------------------------------------------------------------
  await it('PUT /api/schedule/:id — 404 pentru ID inexistent', async () => {
    const res = await request('PUT', '/api/schedule/99999', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { title: 'Nu există' },
    });
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  // ------------------------------------------------------------------
  // DELETE /api/schedule/:id — ștergere sesiune
  // ------------------------------------------------------------------
  await it('DELETE /api/schedule/:id — ștergere sesiune (admin)', async () => {
    if (!createdEntryId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/schedule/${createdEntryId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
    });
    assertOk(res);
    assertEqual(res.body.deleted.id, createdEntryId, 'ID-ul șters trebuie să corespundă');
  });

  // ------------------------------------------------------------------
  // DELETE /api/schedule/:id — 404 după ștergere
  // ------------------------------------------------------------------
  await it('DELETE /api/schedule/:id — 404 pentru ID deja șters', async () => {
    if (!createdEntryId) throw new Error('Testul de creare nu a rulat');
    const res = await request('DELETE', `/api/schedule/${createdEntryId}`, {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
    });
    assertStatus(res, 404, 'Trebuie să returneze 404');
  });

  // ------------------------------------------------------------------
  // PUT /api/schedule — batch replace (admin)
  // ------------------------------------------------------------------
  await it('PUT /api/schedule — înlocuire completă program (batch)', async () => {
    const res = await request('PUT', '/api/schedule', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        entries: [
          { title: 'Batch Luni 1', day_of_week: 1, start_time: '08:00', end_time: '09:00', location: 'Sala Batch', max_participants: 10, is_active: true },
          { title: 'Batch Luni 2', day_of_week: 1, start_time: '09:00', end_time: '10:00', location: 'Sala Batch', max_participants: 15, is_active: true },
          { title: 'Batch Marți 1', day_of_week: 2, start_time: '08:00', end_time: '09:00', location: 'Sala Batch', max_participants: 10, is_active: true },
        ],
      },
    });
    assertOk(res);
    assertEqual(res.body.total, 3, 'Trebuie să fie exact 3 intrări');
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assert(typeof res.body.grouped === 'object', 'grouped trebuie să fie obiect');
    assertEqual(res.body.data[0].title, 'Batch Luni 1', 'Prima intrare trebuie să fie Batch Luni 1');
  });

  // ------------------------------------------------------------------
  // PUT /api/schedule — batch cu validare eșuată (entries gol)
  // ------------------------------------------------------------------
  await it('PUT /api/schedule — batch respins cu entries gol', async () => {
    const res = await request('PUT', '/api/schedule', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { entries: [] },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400');
    assertEqual(res.body.code, 'VALIDATION_ERROR', 'Trebuie să fie VALIDATION_ERROR');
  });

  // ------------------------------------------------------------------
  // PUT /api/schedule — batch cu day_of_week invalid
  // ------------------------------------------------------------------
  await it('PUT /api/schedule — batch respins cu day_of_week invalid', async () => {
    const res = await request('PUT', '/api/schedule', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        entries: [
          { title: 'Invalid', day_of_week: 7, start_time: '08:00', end_time: '09:00' },
        ],
      },
    });
    assertStatus(res, 400, 'Trebuie să returneze 400');
  });

  // ------------------------------------------------------------------
  // POST /api/schedule — respins fără autentificare
  // ------------------------------------------------------------------
  await it('POST /api/schedule — respins fără autentificare (401)', async () => {
    const res = await request('POST', '/api/schedule', {
      body: {
        title: 'Fără Auth',
        day_of_week: 1,
        start_time: '10:00',
        end_time: '11:00',
      },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  // ------------------------------------------------------------------
  // POST /api/schedule — respins fără CSRF
  // ------------------------------------------------------------------
  await it('POST /api/schedule — respins fără CSRF (403)', async () => {
    const res = await request('POST', '/api/schedule', {
      cookies: adminCookies,
      // fără header X-CSRF-Token
      body: {
        title: 'Fără CSRF',
        day_of_week: 1,
        start_time: '10:00',
        end_time: '11:00',
      },
    });
    assertStatus(res, 403, 'Trebuie să returneze 403');
  });

  // ------------------------------------------------------------------
  // GET /api/schedule — după toate operațiile, programul e funcțional
  // ------------------------------------------------------------------
  await it('GET /api/schedule — programul este populat corect după batch', async () => {
    const res = await request('GET', '/api/schedule');
    assertOk(res);
    assert(Array.isArray(res.body.data), 'data trebuie să fie array');
    assertEqual(res.body.total, 3, 'Trebuie să fie exact 3 intrări după batch');
    // Verifică grouped
    const grouped = res.body.grouped;
    assertEqual(grouped['1'].length, 2, 'Luni trebuie să aibă 2 sesiuni');
    assertEqual(grouped['2'].length, 1, 'Marți trebuie să aibă 1 sesiune');
  });

  done();
};