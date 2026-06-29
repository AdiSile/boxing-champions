// ---------------------------------------------------------------------------
// tests/test-auth.js — Teste pentru autentificare
// ---------------------------------------------------------------------------

module.exports = async function ({ describe, it, done, request, assert, assertEqual, assertStatus, assertOk, assertCreated, BASE_URL }) {
  describe('Autentificare');

  const ctx = { cookies: null };

  await it('POST /api/auth/login — login cu credențiale valide', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res, 'Login-ul ar trebui să returneze 200');
    assert(res.body.user, 'Răspunsul trebuie să conțină user');
    assertEqual(res.body.user.role, 'admin', 'Rolul trebuie să fie admin');
    assert(res.setCookie, 'Trebuie să existe cookie-uri setate');
    ctx.cookies = res.setCookie;
  });

  await it('GET /api/auth/check — verifică sesiunea autentificată', async () => {
    const res = await request('GET', '/api/auth/check', { cookies: ctx.cookies });
    assertOk(res);
    assert(res.body.authenticated === true, 'Trebuie să fie autentificat');
    assertEqual(res.body.user.role, 'admin', 'Rolul trebuie să fie admin');
  });

  await it('POST /api/auth/login — login cu parolă greșită', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'parola_gresita' },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  await it('POST /api/auth/login — login cu email inexistent', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'inexistent@example.com', password: 'orice_parola' },
    });
    assertStatus(res, 401, 'Trebuie să returneze 401');
  });

  await it('GET /api/auth/check — verifică fără cookie', async () => {
    const res = await request('GET', '/api/auth/check');
    assertOk(res);
    assert(res.body.authenticated === false, 'Nu trebuie să fie autentificat');
    assert(res.body.user === null, 'User trebuie să fie null');
  });

  await it('POST /api/auth/login — body gol', async () => {
    const res = await request('POST', '/api/auth/login', { body: {} });
    assertStatus(res, 400, 'Trebuie să returneze 400');
  });

  await it('POST /api/auth/login — returnează CSRF token', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    assert(typeof res.body.csrfToken === 'string', 'Trebuie să returneze csrfToken');
    assert(res.body.csrfToken.length > 0, 'csrfToken nu trebuie să fie gol');
  });

  await it('POST /api/auth/login — returnează accessToken în body și cookie', async () => {
    const res = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    assertOk(res);
    // accessToken în body
    assert(typeof res.body.accessToken === 'string', 'Trebuie să returneze accessToken în body');
    assert(res.body.accessToken.length > 0, 'accessToken nu trebuie să fie gol');
    // Verifică structura JWT (3 părți separate de punct)
    const parts = res.body.accessToken.split('.');
    assert(parts.length === 3, 'accessToken trebuie să fie un JWT valid (header.payload.signature)');
    // Cookie-ul access_token trebuie setat
    assert(res.setCookie && res.setCookie.includes('access_token'), 'Cookie-ul access_token trebuie setat');
  });

  await it('POST /api/auth/register — returnează accessToken în body', async () => {
    const uniqueEmail = `test_${Date.now()}@example.com`;
    const res = await request('POST', '/api/auth/register', {
      body: { name: 'Test User', email: uniqueEmail, password: 'TestPass123!' },
    });
    assertCreated(res);
    assert(typeof res.body.accessToken === 'string', 'Register trebuie să returneze accessToken în body');
    assert(res.body.accessToken.length > 0, 'accessToken nu trebuie să fie gol');
    assert(res.setCookie && res.setCookie.includes('access_token'), 'Cookie-ul access_token trebuie setat la register');
  });

  await it('POST /api/auth/logout — delogare', async () => {
    const loginRes = await request('POST', '/api/auth/login', {
      body: { email: 'admin@boxingchampions.ro', password: 'boxing2026' },
    });
    const logoutRes = await request('POST', '/api/auth/logout', {
      cookies: loginRes.setCookie,
      headers: { 'X-CSRF-Token': loginRes.body.csrfToken || '' },
    });
    assertOk(logoutRes);
  });

  done();
};