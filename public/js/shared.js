/**
 * ===========================================================================
 *  shared.js — Boxing Champions Frontend Utils
 *  ===========================================================================
 *  Features:
 *    1. Particule Canvas Aurii (Golden Particles)
 *    2. Cursor Personalizat cu Trail
 *    3. Animații Scroll (Intersection Observer)
 *    4. Navbar Responsive
 *    5. Preloader
 *    6. Modul Autentificare — Token Management & Refresh
 *    7. Funcții Fetch Generice cu Fallback + 401 Auto-Refresh
 *  ===========================================================================
 */

(function () {
  'use strict';

  /* ========================================================================
     DOM Ready Helper
     ======================================================================== */
  function domReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ========================================================================
     Configurare globală
     ======================================================================== */
  const CONFIG = {
    particles: {
      count: 80,
      color: '212, 168, 67',
      opacity: 0.35,
      speed: 0.4,
      maxRadius: 2.5,
      connectDistance: 140,
      lineOpacity: 0.08,
    },
    cursor: {
      trailCount: 12,
      trailDelay: 40,
      dotSize: 6,
      ringSize: 36,
      ringHoverSize: 56,
    },
    scrollReveal: {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px',
    },
    fetch: {
      defaultTimeout: 12000,
      retries: 2,
      retryDelay: 800,
    },
    auth: {
      tokenKey: 'auth_token',
      refreshTokenKey: 'refresh_token',
      refreshEndpoint: '/api/auth/refresh',
      loginPath: '/login',
      excludePaths: [
        '/login',
        '/register',
        '/api/auth/login',
        '/api/auth/register',
        '/api/auth/refresh',
      ],
    },
  };

  /* ========================================================================
     1. PARTICULE CANVAS AURII
     ======================================================================== */
  const Particles = {
    canvas: null,
    ctx: null,
    particles: [],
    animFrame: null,
    width: 0,
    height: 0,
    mouse: { x: -1000, y: -1000 },
    isActive: true,

    init() {
      this.canvas = document.getElementById('particles-canvas');
      if (!this.canvas) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'particles-canvas';
        this.canvas.setAttribute('aria-hidden', 'true');
        document.body.prepend(this.canvas);
      }
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      this.createParticles();
      this.bindEvents();
      this.animate();
    },

    resize() {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    },

    createParticles() {
      this.particles = [];
      const count = Math.floor(
        CONFIG.particles.count * (this.width * this.height) / (1920 * 1080)
      );
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          vx: (Math.random() - 0.5) * CONFIG.particles.speed,
          vy: (Math.random() - 0.5) * CONFIG.particles.speed,
          radius: Math.random() * CONFIG.particles.maxRadius + 0.4,
          originalRadius: Math.random() * CONFIG.particles.maxRadius + 0.4,
        });
      }
    },

    bindEvents() {
      window.addEventListener('resize', () => {
        this.resize();
        this.createParticles();
      });

      document.addEventListener('mousemove', (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
      });

      document.addEventListener('mouseleave', () => {
        this.mouse.x = -1000;
        this.mouse.y = -1000;
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stop();
        } else {
          this.isActive = true;
          this.animate();
        }
      });
    },

    animate() {
      if (!this.isActive) return;

      this.ctx.clearRect(0, 0, this.width, this.height);

      const particles = this.particles;
      const len = particles.length;

      for (let i = 0; i < len; i++) {
        const p = particles[i];

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -20) p.x = this.width + 20;
        if (p.x > this.width + 20) p.x = -20;
        if (p.y < -20) p.y = this.height + 20;
        if (p.y > this.height + 20) p.y = -20;

        const dxMouse = p.x - this.mouse.x;
        const dyMouse = p.y - this.mouse.y;
        const distMouse = Math.sqrt(dxMouse * dxMouse + dyMouse * dyMouse);

        if (distMouse < 120) {
          const force = (1 - distMouse / 120) * 0.8;
          p.vx += (dxMouse / distMouse) * force * 0.015;
          p.vy += (dyMouse / distMouse) * force * 0.015;
          p.radius = p.originalRadius + (1 - distMouse / 120) * 2;
        } else {
          p.radius += (p.originalRadius - p.radius) * 0.08;
        }

        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > CONFIG.particles.speed * 2) {
          p.vx = (p.vx / speed) * CONFIG.particles.speed * 2;
          p.vy = (p.vy / speed) * CONFIG.particles.speed * 2;
        }

        const [r, g, b] = CONFIG.particles.color.split(', ').map(Number);
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${CONFIG.particles.opacity})`;
        this.ctx.fill();

        for (let j = i + 1; j < len; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONFIG.particles.connectDistance) {
            const alpha = (1 - dist / CONFIG.particles.connectDistance) * CONFIG.particles.lineOpacity;
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            this.ctx.lineWidth = 0.5;
            this.ctx.stroke();
          }
        }
      }

      this.animFrame = requestAnimationFrame(() => this.animate());
    },

    stop() {
      this.isActive = false;
      if (this.animFrame) {
        cancelAnimationFrame(this.animFrame);
        this.animFrame = null;
      }
    },

    destroy() {
      this.stop();
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
    },
  };

  /* ========================================================================
     2. CURSOR PERSONALIZAT CU TRAIL
     ======================================================================== */
  const CustomCursor = {
    dot: null,
    ring: null,
    trail: [],
    trailElements: [],
    mouseX: -100,
    mouseY: -100,
    cursorX: -100,
    cursorY: -100,
    ringX: -100,
    ringY: -100,
    animFrame: null,
    isVisible: false,

    init() {
      if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return;

      this.createElements();
      this.bindEvents();
      this.animate();
    },

    createElements() {
      this.dot = document.createElement('div');
      this.dot.className = 'cursor-dot';
      this.dot.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.dot);

      this.ring = document.createElement('div');
      this.ring.className = 'cursor-ring';
      this.ring.setAttribute('aria-hidden', 'true');
      document.body.appendChild(this.ring);

      for (let i = 0; i < CONFIG.cursor.trailCount; i++) {
        const el = document.createElement('div');
        el.className = 'cursor-trail';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = `
          position: fixed;
          pointer-events: none;
          z-index: 9998;
          width: ${CONFIG.cursor.dotSize - i * 0.35}px;
          height: ${CONFIG.cursor.dotSize - i * 0.35}px;
          background: rgba(212, 168, 67, ${0.55 - i * 0.04});
          border-radius: 50%;
          transform: translate(-50%, -50%);
          transition: opacity 0.3s;
        `;
        document.body.appendChild(el);
        this.trailElements.push(el);
        this.trail.push({ x: -100, y: -100 });
      }
    },

    bindEvents() {
      document.addEventListener('mousemove', (e) => {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        if (!this.isVisible) {
          this.isVisible = true;
          this.dot.style.opacity = '1';
          this.ring.style.opacity = '1';
          this.trailElements.forEach((el) => { el.style.opacity = '1'; });
        }
      });

      document.addEventListener('mouseleave', () => {
        this.isVisible = false;
        this.dot.style.opacity = '0';
        this.ring.style.opacity = '0';
        this.trailElements.forEach((el) => { el.style.opacity = '0'; });
      });

      const hoverTargets = 'a, button, .btn, input, textarea, select, .product-card, .coach-card, .event-card, .plan-card, .shop__filter, .pricing__toggle-switch, [role="button"]';
      document.addEventListener('mouseover', (e) => {
        const target = e.target.closest(hoverTargets);
        if (target) {
          this.ring.classList.add('cursor-ring--hover');
        }
      });

      document.addEventListener('mouseout', (e) => {
        const target = e.target.closest(hoverTargets);
        if (target) {
          this.ring.classList.remove('cursor-ring--hover');
        }
      });
    },

    animate() {
      const dx = this.mouseX - this.cursorX;
      const dy = this.mouseY - this.cursorY;
      this.cursorX += dx * 0.22;
      this.cursorY += dy * 0.22;

      const rdx = this.mouseX - this.ringX;
      const rdy = this.mouseY - this.ringY;
      this.ringX += rdx * 0.12;
      this.ringY += rdy * 0.12;

      if (this.dot) {
        this.dot.style.left = this.cursorX + 'px';
        this.dot.style.top = this.cursorY + 'px';
      }

      if (this.ring) {
        this.ring.style.left = this.ringX + 'px';
        this.ring.style.top = this.ringY + 'px';
      }

      this.trail.unshift({ x: this.cursorX, y: this.cursorY });
      if (this.trail.length > CONFIG.cursor.trailCount) {
        this.trail.pop();
      }

      for (let i = 0; i < this.trailElements.length; i++) {
        if (this.trail[i]) {
          this.trailElements[i].style.left = this.trail[i].x + 'px';
          this.trailElements[i].style.top = this.trail[i].y + 'px';
        }
      }

      this.animFrame = requestAnimationFrame(() => this.animate());
    },

    destroy() {
      if (this.animFrame) cancelAnimationFrame(this.animFrame);
      if (this.dot && this.dot.parentNode) this.dot.parentNode.removeChild(this.dot);
      if (this.ring && this.ring.parentNode) this.ring.parentNode.removeChild(this.ring);
      this.trailElements.forEach((el) => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    },
  };

  /* ========================================================================
     3. ANIMAȚII SCROLL — Intersection Observer
     ======================================================================== */
  const ScrollReveal = {
    observer: null,

    init() {
      if (!('IntersectionObserver' in window)) {
        document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => {
          el.classList.add('reveal--visible', 'reveal-stagger--visible');
        });
        return;
      }

      const options = {
        threshold: CONFIG.scrollReveal.threshold,
        rootMargin: CONFIG.scrollReveal.rootMargin,
      };

      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target;

            if (el.classList.contains('reveal')) {
              el.classList.add('reveal--visible');
            }

            if (el.classList.contains('reveal-stagger')) {
              el.classList.add('reveal-stagger--visible');
            }

            this.observer.unobserve(el);
          }
        });
      }, options);

      this.refresh();

      this.watchDOM();
    },

    refresh() {
      const elements = document.querySelectorAll('.reveal, .reveal-stagger');
      elements.forEach((el) => {
        if (!el.dataset.scrollRevealObserved) {
          el.dataset.scrollRevealObserved = 'true';
          this.observer.observe(el);
        }
      });
    },

    watchDOM() {
      if (!('MutationObserver' in window)) return;

      const mutationObserver = new MutationObserver(() => {
        this.refresh();
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    },
  };

  /* ========================================================================
     4. NAVBAR RESPONSIVE
     ======================================================================== */
  const Navbar = {
    nav: null,
    toggle: null,
    links: null,
    overlay: null,
    isOpen: false,

    init() {
      this.nav = document.querySelector('.nav');
      this.toggle = document.querySelector('.nav__toggle');
      this.links = document.querySelector('.nav__links');

      if (!this.nav) return;

      if (!this.toggle) {
        this.toggle = document.createElement('button');
        this.toggle.className = 'nav__toggle';
        this.toggle.setAttribute('aria-label', 'Toggle navigation');
        this.toggle.setAttribute('aria-expanded', 'false');
        this.toggle.innerHTML = '<span></span><span></span><span></span>';
        const inner = this.nav.querySelector('.nav__inner');
        if (inner) inner.appendChild(this.toggle);
      }

      if (!document.querySelector('.nav__overlay')) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'nav__overlay';
        this.overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.overlay);
      } else {
        this.overlay = document.querySelector('.nav__overlay');
      }

      this.bindEvents();
    },

    bindEvents() {
      this.toggle.addEventListener('click', () => {
        this.isOpen ? this.close() : this.open();
      });

      if (this.overlay) {
        this.overlay.addEventListener('click', () => this.close());
      }

      if (this.links) {
        this.links.addEventListener('click', (e) => {
          if (e.target.closest('.nav__link')) {
            this.close();
          }
        });
      }

      let scrollTicking = false;
      window.addEventListener('scroll', () => {
        if (!scrollTicking) {
          requestAnimationFrame(() => {
            this.onScroll();
            scrollTicking = false;
          });
          scrollTicking = true;
        }
      }, { passive: true });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
          this.toggle.focus();
        }
      });

      this.onScroll();
    },

    onScroll() {
      const scrollY = window.scrollY || window.pageYOffset;
      if (scrollY > 60) {
        this.nav.classList.add('nav--scrolled');
      } else {
        this.nav.classList.remove('nav--scrolled');
      }
    },

    open() {
      this.isOpen = true;
      this.links?.classList.add('nav__links--open');
      this.toggle?.classList.add('active');
      this.toggle?.setAttribute('aria-expanded', 'true');
      if (this.overlay) {
        this.overlay.classList.add('nav__overlay--visible');
        this.overlay.setAttribute('aria-hidden', 'false');
      }
      document.body.style.overflow = 'hidden';
    },

    close() {
      this.isOpen = false;
      this.links?.classList.remove('nav__links--open');
      this.toggle?.classList.remove('active');
      this.toggle?.setAttribute('aria-expanded', 'false');
      if (this.overlay) {
        this.overlay.classList.remove('nav__overlay--visible');
        this.overlay.setAttribute('aria-hidden', 'true');
      }
      document.body.style.overflow = '';
    },
  };

  /* ========================================================================
     5. PRELOADER
     ======================================================================== */
  const Preloader = {
    element: null,

    init() {
      this.element = document.getElementById('preloader');
      if (!this.element) return;

      window.addEventListener('load', () => {
        setTimeout(() => {
          this.hide();
        }, 400);
      });

      setTimeout(() => {
        this.hide();
      }, 5000);
    },

    hide() {
      if (!this.element) return;
      if (this.element.classList.contains('fade-out')) return;

      this.element.classList.add('fade-out');

      this.element.addEventListener('transitionend', () => {
        if (this.element && this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        document.body.classList.add('loaded');
      }, { once: true });

      setTimeout(() => {
        if (this.element && this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
          this.element = null;
          document.body.classList.add('loaded');
        }
      }, 600);
    },
  };

  /* ========================================================================
     6. MODUL AUTENTIFICARE — Token Management & Refresh
     ======================================================================== */

  /**
   * Auth — gestiunea token-urilor, refresh automat și reîmprospătare manuală.
   *
   * Token-urile sunt stocate atât în localStorage cât și în sessionStorage,
   * astfel încât să persiste între tab-uri și sesiuni.
   *
   * refreshToken() previne apelurile concurente: dacă un refresh este deja
   * în curs, apelurile ulterioare așteaptă aceeași promisiune.
   */
  const Auth = {
    _refreshPromise: null,
    _refreshSubscribers: [],

    /**
     * Returnează token-ul de acces curent.
     * @returns {string|null}
     */
    getToken() {
      return (
        localStorage.getItem(CONFIG.auth.tokenKey) ||
        sessionStorage.getItem(CONFIG.auth.tokenKey) ||
        null
      );
    },

    /**
     * Salvează token-ul de acces.
     * @param {string} token
     */
    setToken(token) {
      if (!token) return;
      localStorage.setItem(CONFIG.auth.tokenKey, token);
      sessionStorage.setItem(CONFIG.auth.tokenKey, token);
    },

    /**
     * Returnează refresh-token-ul curent.
     * @returns {string|null}
     */
    getRefreshToken() {
      return (
        localStorage.getItem(CONFIG.auth.refreshTokenKey) ||
        sessionStorage.getItem(CONFIG.auth.refreshTokenKey) ||
        null
      );
    },

    /**
     * Salvează refresh-token-ul.
     * @param {string} token
     */
    setRefreshToken(token) {
      if (!token) return;
      localStorage.setItem(CONFIG.auth.refreshTokenKey, token);
      sessionStorage.setItem(CONFIG.auth.refreshTokenKey, token);
    },

    /**
     * Șterge toate token-urile (logout).
     */
    clearTokens() {
      localStorage.removeItem(CONFIG.auth.tokenKey);
      sessionStorage.removeItem(CONFIG.auth.tokenKey);
      localStorage.removeItem(CONFIG.auth.refreshTokenKey);
      sessionStorage.removeItem(CONFIG.auth.refreshTokenKey);
    },

    /**
     * Verifică dacă utilizatorul este autentificat (are token).
     * @returns {boolean}
     */
    isAuthenticated() {
      return !!this.getToken();
    },

    /**
     * Încearcă reîmprospătarea token-ului de acces folosind refresh-token-ul.
     *
     * Această metodă previne apelurile concurente (race condition):
     * dacă un refresh este deja în curs, returnează aceeași promisiune.
     *
     * @returns {Promise<string>} Noul token de acces.
     * @throws {Error} Dacă refresh-ul eșuează.
     */
    async refreshToken() {
      // Dacă un refresh este deja în curs, așteptăm același rezultat
      if (this._refreshPromise) {
        return this._refreshPromise;
      }

      const refreshTokenValue = this.getRefreshToken();
      if (!refreshTokenValue) {
        return Promise.reject(new Error('No refresh token available'));
      }

      this._refreshPromise = (async () => {
        try {
          const response = await fetch(CONFIG.auth.refreshEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ refreshToken: refreshTokenValue }),
          });

          if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const error = new Error(
              errorBody.error || errorBody.message || 'Token refresh failed'
            );
            error.status = response.status;
            throw error;
          }

          const data = await response.json();
          const newToken = data.token || data.accessToken || data.access_token;

          if (!newToken) {
            throw new Error('Refresh response missing token');
          }

          this.setToken(newToken);

          if (data.refreshToken || data.refresh_token) {
            this.setRefreshToken(data.refreshToken || data.refresh_token);
          }

          // Notifică abonații (cereri în așteptare)
          this._notifySubscribers(newToken);

          return newToken;
        } catch (err) {
          // Refresh eșuat → curățăm token-urile și notificăm abonații cu eroare
          this.clearTokens();
          this._notifySubscribers(null, err);
          throw err;
        } finally {
          this._refreshPromise = null;
        }
      })();

      return this._refreshPromise;
    },

    /**
     * Înregistrează un subscriber care așteaptă un token nou.
     * @param {Function} onResolve - apelat cu noul token
     * @param {Function} onReject  - apelat cu eroarea
     */
    subscribeToRefresh(onResolve, onReject) {
      this._refreshSubscribers.push({ resolve: onResolve, reject: onReject });
    },

    /**
     * Notifică toți abonații despre rezultatul refresh-ului.
     * @param {string|null} newToken
     * @param {Error|null}  error
     */
    _notifySubscribers(newToken, error) {
      const subs = this._refreshSubscribers.splice(0);
      subs.forEach((sub) => {
        if (error) {
          sub.reject(error);
        } else {
          sub.resolve(newToken);
        }
      });
    },

    /**
     * Redirecționează utilizatorul la pagina de login,
     * păstrând calea curentă pentru redirect după autentificare.
     */
    redirectToLogin() {
      this.clearTokens();
      const currentPath = window.location.pathname + window.location.search;
      const loginPath = CONFIG.auth.loginPath;

      // Evităm redirect loop dacă suntem deja pe login
      if (currentPath.startsWith(loginPath)) {
        return;
      }

      window.location.href =
        loginPath + '?redirect=' + encodeURIComponent(currentPath);
    },
  };

  /* ========================================================================
     7. FUNCȚII FETCH GENERICE CU FALLBACK
     ======================================================================== */

  /**
   * Determină dacă un URL este exceptat de la atașarea automată a token-ului.
   * @param {string} url
   * @returns {boolean}
   */
  function isAuthExcludedPath(url) {
    return CONFIG.auth.excludePaths.some(function (path) {
      return url.indexOf(path) !== -1;
    });
  }

  /**
   * fetchJSON — wrapper generic pentru cereri JSON
   *
   * Atașează automat token-ul de autentificare (dacă există) și
   * reîncearcă automat cu un token reîmprospătat când serverul
   * răspunde cu 401 Unauthorized.
   *
   * Gestionează erorile de rețea (TypeError, AbortError) distinct
   * față de erorile HTTP, oferind mesaje clare pentru depanare.
   *
   * @param {string}  url                     - URL-ul endpoint-ului
   * @param {object}  [options={}]            - Opțiuni fetch suplimentare
   * @param {string}  [options.method='GET']  - Metoda HTTP
   * @param {object}  [options.body=null]     - Body (va fi serializat JSON)
   * @param {object}  [options.headers={}]    - Headere adiționale
   * @param {number}  [options.timeout]       - Timeout în ms
   * @param {number}  [options.retries]       - Număr de reîncercări (fără refresh)
   * @param {boolean} [options.rawResponse]   - Returnează răspunsul brut
   * @param {boolean} [options.skipAuth]      - Nu atașa token-ul de auth
   * @param {boolean} [options.skipRefresh]   - Nu încerca refresh pe 401
   * @returns {Promise<any>}
   */
  async function fetchJSON(url, options = {}) {
    const {
      method = 'GET',
      body = null,
      headers = {},
      timeout = CONFIG.fetch.defaultTimeout,
      retries = CONFIG.fetch.retries,
      rawResponse = false,
      skipAuth = false,
      skipRefresh = false,
      ...restOptions
    } = options;

    /**
     * Construiește headerele, atașând token-ul dacă este disponibil.
     * @param {string|null} overrideToken - token forțat (după refresh)
     * @returns {object}
     */
    function buildHeaders(overrideToken) {
      const fetchHeaders = {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...headers,
      };

      if (body && typeof body === 'object' && !(body instanceof FormData)) {
        fetchHeaders['Content-Type'] = 'application/json';
      }

      // Atașează token-ul de autentificare
      if (!skipAuth && !isAuthExcludedPath(url)) {
        const token = overrideToken || Auth.getToken();
        if (token) {
          fetchHeaders['Authorization'] = 'Bearer ' + token;
        }
      }

      return fetchHeaders;
    }

    /**
     * Construiește obiectul de opțiuni pentru fetch.
     * @param {string|null} overrideToken
     * @returns {object}
     */
    function buildFetchOptions(overrideToken) {
      const fetchOpts = {
        method: method,
        headers: buildHeaders(overrideToken),
        ...restOptions,
      };

      if (body) {
        fetchOpts.body =
          body instanceof FormData ? body : JSON.stringify(body);
      }

      return fetchOpts;
    }

    /**
     * Parsează corpul răspunsului.
     * @param {Response} response
     * @returns {Promise<any>}
     */
    async function parseResponse(response) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (_) {
        return { _raw: text };
      }
    }

    /**
     * Efectuează o singură încercare de request.
     * @param {string|null} overrideToken
     * @returns {Promise<{response: Response, data: any}>}
     */
    async function performRequest(overrideToken) {
      const controller = new AbortController();
      const timeoutId = setTimeout(function () {
        controller.abort();
      }, timeout);

      try {
        const fetchOpts = buildFetchOptions(overrideToken);
        const response = await fetch(url, {
          ...fetchOpts,
          signal: controller.signal,
        });

        if (rawResponse) {
          return { response: response, data: null };
        }

        const data = await parseResponse(response);

        if (!response.ok) {
          const error = new Error(
            data?.error || data?.message || 'HTTP ' + response.status + ': ' + response.statusText
          );
          error.status = response.status;
          error.data = data;
          throw error;
        }

        return { response: response, data: data };
      } finally {
        clearTimeout(timeoutId);
      }
    }

    let lastError = null;
    let tokenRefreshed = false;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await sleep(CONFIG.fetch.retryDelay * attempt);
      }

      try {
        const result = await performRequest(null);

        if (rawResponse) {
          return result.response;
        }

        return result.data;
      } catch (err) {
        lastError = err;

        // ── Tratare 401 Unauthorized ──────────────────────────────
        if (
          !skipRefresh &&
          err.status === 401 &&
          Auth.getRefreshToken()
        ) {
          // Dacă deja am făcut refresh în această buclă și tot 401 primim,
          // înseamnă că refresh-ul nu a rezolvat problema → redirect login
          if (tokenRefreshed) {
            Auth.redirectToLogin();
            throw new Error('Session expired. Redirecting to login.');
          }

          try {
            // Dacă un refresh este deja în curs (alt request l-a declanșat),
            // așteptăm rezultatul în loc să inițiem unul nou.
            let newToken;
            if (Auth._refreshPromise) {
              newToken = await new Promise(function (resolve, reject) {
                Auth.subscribeToRefresh(resolve, reject);
              });
            } else {
              newToken = await Auth.refreshToken();
            }

            tokenRefreshed = true;
            // Reîncearcă request-ul original cu noul token,
            // fără a consuma o încercare din bucla de retries.
            const retryResult = await performRequest(newToken);

            if (rawResponse) {
              return retryResult.response;
            }

            return retryResult.data;
          } catch (refreshErr) {
            // Refresh-ul a eșuat → redirect login
            lastError = refreshErr;
            Auth.redirectToLogin();
            throw new Error(
              'Session expired. Please log in again. (' +
                (refreshErr.message || 'refresh failed') +
                ')'
            );
          }
        }

        // ── Clasificare erori de rețea ───────────────────────────
        // TypeError: fetch aruncă TypeError când rețeaua este inexistentă
        // (ex: navigator.onLine === false, DNS failure, CORS blocat)
        if (err.name === 'TypeError' || err.message === 'Failed to fetch') {
          lastError = new Error(
            'Network error: unable to reach the server. ' +
            'Please check your internet connection.'
          );
          lastError.isNetworkError = true;
          lastError.originalError = err;
          // Reîncercăm pentru erori de rețea (pot fi temporare)
          continue;
        }

        // AbortError: timeout sau abort manual
        if (err.name === 'AbortError') {
          if (attempt >= retries) {
            lastError = new Error(
              'Request timeout after ' + (retries + 1) + ' attempt(s)'
            );
            lastError.isTimeout = true;
            lastError.originalError = err;
            break;
          }
          // Mai încercăm o dată pentru timeout
          lastError = new Error('Request timed out, retrying...');
          lastError.isTimeout = true;
          continue;
        }

        // ── Erori HTTP client (4xx, exclus 401 tratat mai sus) ──
        if (err.status && err.status >= 400 && err.status < 500) {
          // 408 (Request Timeout) și 429 (Too Many Requests) → reîncercăm
          if (err.status === 408 || err.status === 429) {
            continue;
          }
          // Celelalte erori client (400, 403, 404, 422 etc.) nu se reîncearcă
          break;
        }

        // ── Erori HTTP server (5xx) ──────────────────────────────
        if (err.status && err.status >= 500) {
          // Reîncercăm pentru erori de server (pot fi tranzitorii)
          continue;
        }

        // Pentru orice altă eroare necunoscută, reîncercăm
        if (attempt < retries) {
          continue;
        }
      }
    }

    // Dacă ajungem aici, toate încercările au eșuat
    throw lastError || new Error('fetchJSON failed');
  }

  /**
   * fetchWithFallback — încearcă mai multe URL-uri în ordine
   *
   * @param {string[]} urls    - Listă de URL-uri de încercat
   * @param {object}   options - Opțiuni (aceleași ca fetchJSON)
   * @returns {Promise<any>}
   */
  async function fetchWithFallback(urls, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('fetchWithFallback: urls must be a non-empty array');
    }

    const errors = [];

    for (var i = 0; i < urls.length; i++) {
      var url = urls[i];
      try {
        var result = await fetchJSON(url, options);
        return result;
      } catch (err) {
        errors.push({ url: url, error: err.message });
      }
    }

    throw new Error(
      'All fallback URLs failed:\n' +
        errors
          .map(function (e) {
            return '  ' + e.url + ': ' + e.error;
          })
          .join('\n')
    );
  }

  /**
   * refreshAuth — reîmprospătează manual token-ul de autentificare.
   *
   * Poate fi apelată din paginile publice pentru a prelungi sesiunea
   * înainte de o operațiune sensibilă sau după o perioadă de inactivitate.
   *
   * @returns {Promise<{success: boolean, token?: string, error?: string}>}
   */
  async function refreshAuth() {
    try {
      if (!Auth.getRefreshToken()) {
        return { success: false, error: 'No refresh token available' };
      }

      const newToken = await Auth.refreshToken();
      return { success: true, token: newToken };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * sleep — helper pentru delay-uri asincrone
   *
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * debounce — limitează frecvența apelurilor
   *
   * @param {Function} fn
   * @param {number}   delay
   * @returns {Function}
   */
  function debounce(fn, delay) {
    if (delay === undefined) { delay = 250; }
    var timer;
    return function () {
      var context = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  /**
   * throttle — garantează apel maxim o dată pe interval
   *
   * @param {Function} fn
   * @param {number}   limit
   * @returns {Function}
   */
  function throttle(fn, limit) {
    if (limit === undefined) { limit = 250; }
    var inThrottle = false;
    return function () {
      var context = this;
      var args = arguments;
      if (!inThrottle) {
        fn.apply(context, args);
        inThrottle = true;
        setTimeout(function () {
          inThrottle = false;
        }, limit);
      }
    };
  }

  /**
   * Toast / Notificare temporară
   *
   * @param {string} message
   * @param {'success'|'error'|'info'} [type='info']
   * @param {number} [duration=3500]
   */
  function showToast(message, type, duration) {
    if (type === undefined) { type = 'info'; }
    if (duration === undefined) { duration = 3500; }

    var existing = document.querySelector('.toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.addEventListener('transitionend', function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      });
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 350);
    }, duration);
  }

  /* ========================================================================
     INIȚIALIZARE GLOBALĂ
     ======================================================================== */
  function initAll() {
    Preloader.init();
    Particles.init();
    CustomCursor.init();
    ScrollReveal.init();
    Navbar.init();

    // Garantăm că body primește clasa 'loaded' pentru a restaura cursorul,
    // chiar dacă preloader-ul nu există sau JS-ul este întârziat.
    if (!document.body.classList.contains('loaded')) {
      // Așteptăm un frame pentru a lăsa preloader-ul să se inițializeze
      requestAnimationFrame(function () {
        setTimeout(function () {
          document.body.classList.add('loaded');
        }, 200);
      });
    }
  }

  // Expune utilitarele global
  window.BoxingChampions = {
    fetchJSON: fetchJSON,
    fetchWithFallback: fetchWithFallback,
    sleep: sleep,
    debounce: debounce,
    throttle: throttle,
    showToast: showToast,
    refreshAuth: refreshAuth,
    Auth: Auth,
    Particles: Particles,
    CustomCursor: CustomCursor,
    ScrollReveal: ScrollReveal,
    Navbar: Navbar,
    Preloader: Preloader,
    refreshScrollReveal: function () {
      ScrollReveal.refresh();
    },
  };

  // Pornește totul când DOM-ul e gata
  domReady(initAll);
})();