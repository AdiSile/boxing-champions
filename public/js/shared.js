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
 *    6. Funcții Fetch Generice cu Fallback
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
     6. FUNCȚII FETCH GENERICE CU FALLBACK
     ======================================================================== */

  /**
   * fetchJSON — wrapper generic pentru cereri JSON
   *
   * @param {string}  url                   - URL-ul endpoint-ului
   * @param {object}  [options={}]          - Opțiuni fetch suplimentare
   * @param {string}  [options.method='GET'] - Metoda HTTP
   * @param {object}  [options.body=null]   - Body (va fi serializat JSON)
   * @param {object}  [options.headers={}]  - Headere adiționale
   * @param {number}  [options.timeout]     - Timeout în ms
   * @param {number}  [options.retries]     - Număr de reîncercări
   * @param {boolean} [options.rawResponse] - Returnează răspunsul brut
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
      ...restOptions
    } = options;

    const fetchHeaders = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...headers,
    };

    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      fetchHeaders['Content-Type'] = 'application/json';
    }

    const fetchOptions = {
      method,
      headers: fetchHeaders,
      ...restOptions,
    };

    if (body) {
      fetchOptions.body =
        body instanceof FormData ? body : JSON.stringify(body);
    }

    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await sleep(CONFIG.fetch.retryDelay * attempt);
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (rawResponse) {
          return response;
        }

        let data;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          const text = await response.text();
          try {
            data = JSON.parse(text);
          } catch (_) {
            data = { _raw: text };
          }
        }

        if (!response.ok) {
          const error = new Error(
            data?.error || data?.message || `HTTP ${response.status}: ${response.statusText}`
          );
          error.status = response.status;
          error.data = data;
          throw error;
        }

        return data;
      } catch (err) {
        lastError = err;

        if (err.status && err.status >= 400 && err.status < 500) {
          if (err.status !== 408 && err.status !== 429) {
            break;
          }
        }

        if (err.name === 'AbortError' && attempt >= retries) {
          lastError = new Error('Request timeout after ' + (retries + 1) + ' attempts');
          break;
        }
      }
    }

    throw lastError || new Error('fetchJSON failed');
  }

  /**
   * fetchWithFallback — încearcă mai multe URL-uri în ordine
   *
   * @param {string[]} urls   - Listă de URL-uri de încercat
   * @param {object}   options - Opțiuni (aceleași ca fetchJSON)
   * @returns {Promise<any>}
   */
  async function fetchWithFallback(urls, options = {}) {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('fetchWithFallback: urls must be a non-empty array');
    }

    const errors = [];

    for (const url of urls) {
      try {
        const result = await fetchJSON(url, options);
        return result;
      } catch (err) {
        errors.push({ url, error: err.message });
      }
    }

    throw new Error(
      'All fallback URLs failed:\n' +
      errors.map((e) => `  ${e.url}: ${e.error}`).join('\n')
    );
  }

  /**
   * sleep — helper pentru delay-uri asincrone
   *
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * debounce — limitează frecvența apelurilor
   *
   * @param {Function} fn
   * @param {number}   delay
   * @returns {Function}
   */
  function debounce(fn, delay = 250) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * throttle — garantează apel maxim o dată pe interval
   *
   * @param {Function} fn
   * @param {number}   limit
   * @returns {Function}
   */
  function throttle(fn, limit = 250) {
    let inThrottle = false;
    return function (...args) {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => { inThrottle = false; }, limit);
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
  function showToast(message, type = 'info', duration = 3500) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
      toast.style.transition = 'opacity 0.3s, transform 0.3s';
      toast.addEventListener('transitionend', () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      });
      setTimeout(() => {
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
  }

  // Expune utilitarele global
  window.BoxingChampions = {
    fetchJSON,
    fetchWithFallback,
    sleep,
    debounce,
    throttle,
    showToast,
    Particles,
    CustomCursor,
    ScrollReveal,
    Navbar,
    Preloader,
    refreshScrollReveal: () => ScrollReveal.refresh(),
  };

  // Pornește totul când DOM-ul e gata
  domReady(initAll);
})();