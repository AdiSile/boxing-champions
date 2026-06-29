// ---------------------------------------------------------------------------
// tests/test-settings.js — Teste pentru GET /api/settings (public)
// și PUT /api/settings (admin) cu social media, nested objects etc.
// ---------------------------------------------------------------------------

module.exports = async function ({
  describe, it, done, request,
  assert, assertEqual, assertStatus, assertOk,
}) {
  describe('Setări aplicație (Settings)');

  let adminCookies = null;
  let csrfToken = null;

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
  // GET /api/settings — public
  // ═══════════════════════════════════════════════════════════════════════
  await it('GET /api/settings — returnează toate setările (public)', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assert(typeof res.body === 'object' && !Array.isArray(res.body),
      'Răspunsul trebuie să fie obiect JSON');
  });

  await it('GET /api/settings — conține setările de bază', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assert(typeof res.body.site_name === 'string', 'site_name trebuie să existe');
    assert(typeof res.body.admin_email === 'string', 'admin_email trebuie să existe');
    assert(typeof res.body.timezone === 'string', 'timezone trebuie să existe');
    assert(typeof res.body.locale === 'string', 'locale trebuie să existe');
    assert(typeof res.body.maintenance_mode === 'string', 'maintenance_mode trebuie să existe');
    assert(typeof res.body.items_per_page === 'string', 'items_per_page trebuie să existe');
  });

  await it('GET /api/settings — conține setări social media', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assert(typeof res.body.social_facebook === 'string', 'social_facebook trebuie să existe');
    assert(typeof res.body.social_instagram === 'string', 'social_instagram trebuie să existe');
    assert(typeof res.body.social_youtube === 'string', 'social_youtube trebuie să existe');
    assert(typeof res.body.social_tiktok === 'string', 'social_tiktok trebuie să existe');
    assert(typeof res.body.social_twitter === 'string', 'social_twitter trebuie să existe');
  });

  await it('GET /api/settings — conține setări de contact', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assert(typeof res.body.contact_phone === 'string', 'contact_phone trebuie să existe');
    assert(typeof res.body.contact_address === 'string', 'contact_address trebuie să existe');
    assert(typeof res.body.contact_email === 'string', 'contact_email trebuie să existe');
  });

  await it('GET /api/settings — nu expune chei sensibile în public? (verifică existența)', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assert(typeof res.body.smtp_host === 'string', 'smtp_host trebuie să existe');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /api/settings — admin (actualizări FLAT)
  // ═══════════════════════════════════════════════════════════════════════
  await it('PUT /api/settings — actualizare flat: site_name', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { site_name: 'Boxing Champions PRO' },
    });
    assertOk(res);
    assertEqual(res.body.message, 'Settings updated successfully.', 'Mesaj confirmare');
    assertEqual(res.body.settings.site_name, 'Boxing Champions PRO', 'site_name actualizat');
  });

  await it('GET /api/settings — verifică persistența site_name', async () => {
    const res = await request('GET', '/api/settings');
    assertOk(res);
    assertEqual(res.body.site_name, 'Boxing Champions PRO', 'site_name persistat');
  });

  await it('PUT /api/settings — actualizare flat: social media', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        social_facebook: 'https://facebook.com/boxingchampionspro',
        social_instagram: 'https://instagram.com/boxingchampionspro',
      },
    });
    assertOk(res);
    assertEqual(res.body.settings.social_facebook, 'https://facebook.com/boxingchampionspro');
    assertEqual(res.body.settings.social_instagram, 'https://instagram.com/boxingchampionspro');
  });

  await it('PUT /api/settings — actualizare multiplă: contact', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        contact_phone: '+40 733 000 999',
        contact_address: 'Str. Nouă nr. 42, București, Sector 2',
      },
    });
    assertOk(res);
    assertEqual(res.body.settings.contact_phone, '+40 733 000 999');
    assertEqual(res.body.settings.contact_address, 'Str. Nouă nr. 42, București, Sector 2');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /api/settings — admin (actualizări NESTED)
  // ═══════════════════════════════════════════════════════════════════════
  await it('PUT /api/settings — actualizare nested: { site: { name } }', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { site: { name: 'BC Nested Test' } },
    });
    assertOk(res);
    assertEqual(res.body.settings.site_name, 'BC Nested Test',
      'Obiectul nested { site: { name } } trebuie aplatizat → site_name');
  });

  await it('PUT /api/settings — actualizare nested: { social: { facebook, instagram } }', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {
        social: {
          facebook: 'https://fb.com/bc-nested',
          instagram: 'https://ig.com/bc-nested',
        },
      },
    });
    assertOk(res);
    assertEqual(res.body.settings.social_facebook, 'https://fb.com/bc-nested');
    assertEqual(res.body.settings.social_instagram, 'https://ig.com/bc-nested');
  });

  await it('PUT /api/settings — actualizare nested adânc: { a: { b: { c: "deep" } } }', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { a: { b: { c: 'deep-value' } } },
    });
    assertOk(res);
    assertEqual(res.body.settings.a_b_c, 'deep-value',
      'Nested adânc { a: { b: { c } } } → a_b_c');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /api/settings — validare & erori
  // ═══════════════════════════════════════════════════════════════════════
  await it('PUT /api/settings — 400 body gol', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: {},
    });
    assertStatus(res, 400, 'Body gol → 400');
    assertEqual(res.body.code, 'INVALID_BODY');
  });

  await it('PUT /api/settings — 400 body array', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: [{ key: 'value' }],
    });
    assertStatus(res, 400, 'Body array → 400');
  });

  await it('PUT /api/settings — 400 body null', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: null,
    });
    assertStatus(res, 400, 'Body null → 400');
  });

  await it('PUT /api/settings — 401 fără autentificare', async () => {
    const res = await request('PUT', '/api/settings', {
      body: { site_name: 'Hacked' },
    });
    assertStatus(res, 401, 'Fără auth → 401');
  });

  await it('PUT /api/settings — 403 fără CSRF token', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      // FĂRĂ header X-CSRF-Token
      body: { site_name: 'Hacked' },
    });
    assertStatus(res, 403, 'Fără CSRF → 403');
  });

  await it('PUT /api/settings — 403 cu CSRF token greșit', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': 'invalid-csrf-token-12345' },
      body: { site_name: 'Hacked' },
    });
    assertStatus(res, 403, 'CSRF greșit → 403');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUT /api/settings — edge cases
  // ═══════════════════════════════════════════════════════════════════════
  await it('PUT /api/settings — actualizare maintenance_mode', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { maintenance_mode: '1' },
    });
    assertOk(res);
    assertEqual(res.body.settings.maintenance_mode, '1');
  });

  await it('PUT /api/settings — revenire maintenance_mode', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { maintenance_mode: '0' },
    });
    assertOk(res);
    assertEqual(res.body.settings.maintenance_mode, '0');
  });

  await it('PUT /api/settings — actualizare items_per_page (număr ca string)', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { items_per_page: '24' },
    });
    assertOk(res);
    assertEqual(res.body.settings.items_per_page, '24');
  });

  await it('PUT /api/settings — restaurare site_name original', async () => {
    const res = await request('PUT', '/api/settings', {
      cookies: adminCookies,
      headers: { 'X-CSRF-Token': csrfToken },
      body: { site_name: 'Boxing Champions' },
    });
    assertOk(res);
    assertEqual(res.body.settings.site_name, 'Boxing Champions');
  });

  done();
};