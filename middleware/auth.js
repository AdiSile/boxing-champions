*(modificat — cookie `secure` și `sameSite` condiționate de `NODE_ENV === 'production'`)*

// ... (primele ~160 linii neschimbate) ...

function getAccessCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
    maxAge: parseTtlToMs(ACCESS_TOKEN_TTL),
  };
}

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/auth/refresh',
    maxAge: parseTtlToMs(REFRESH_TOKEN_TTL),
  };
}

// ...

function setCsrfCookie(res) {
  const token = generateCsrfToken();
  const hashed = hashCsrfToken(token);
  res.cookie('csrf_token', hashed, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
    maxAge: parseTtlToMs(ACCESS_TOKEN_TTL),
  });
  return token;
}

function clearCsrfCookie(res) {
  res.clearCookie('csrf_token', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
  });
}