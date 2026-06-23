'use strict';

// ===========================================================================
// UTILITARE GENERALE — Boxing Champions
// ===========================================================================

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, function (m) { return map[m]; });
}

/** API base path */
const API_BASE = '/api';

/** Date de fallback în cazul în care API-ul nu răspunde */
const FALLBACK_DATA = {
  schedule: [],
  coaches: [],
  events: [],
  products: [],
};

/**
 * Fetch API cu fallback.
 * @param {string} url
 * @param {object} [options]
 * @param {*} [fallback]
 * @returns {Promise<*>}
 */
async function apiFetch(url, options = {}, fallback = null) {
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.warn('[API] Fetch failed for', url, ':', err.message);
    return fallback;
  }
}

/**
 * Randare stare goală pentru containere dinamice.
 * @param {string} message
 * @param {string} [iconClass] — clasă Font Awesome
 * @returns {string} HTML
 */
function renderEmptyState(message, iconClass) {
  const icon = iconClass || 'fa-circle-info';
  return `
    <div class="shop-empty-state" style="grid-column: 1 / -1;">
      <div class="shop-empty-icon">
        <i class="fa-solid ${icon}"></i>
      </div>
      <h3 class="shop-empty-title">Momentan nu există date</h3>
      <p class="shop-empty-desc">${escapeHtml(message)}</p>
    </div>
  `;
}

// ===========================================================================
// ÎNCĂRCARE DINAMICĂ — CONȚINUT PE PAGINI
// ===========================================================================

// --- Schedule ---
async function loadSchedule() {
  const container = document.querySelector('.schedule-table-wrap, [data-content="schedule"]');
  if (!container) return;

  const schedule = await apiFetch(`${API_BASE}/schedule`, {}, FALLBACK_DATA.schedule);

  if (!schedule || schedule.length === 0) {
    container.innerHTML = renderEmptyState('Programul nu este disponibil momentan.', 'fa-clock');
    return;
  }

  // Grupează pe zile
  const days = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
  const grouped = {};
  days.forEach(d => { grouped[d] = []; });
  schedule.forEach(s => {
    if (grouped[s.day]) grouped[s.day].push(s);
  });

  const activeDays = days.filter(d => grouped[d].length > 0);

  function getTagClass(slot) {
    const category = (slot.category || '').toLowerCase();
    const gender = (slot.gender || '').toLowerCase();

    if (category.includes('copii') || category.includes('copil')) {
      return 'tag-kids';
    }
    if (gender === 'feminin' || category.includes('feminin')) {
      return 'tag-women';
    }
    if (gender === 'masculin') {
      return 'tag-men';
    }
    return 'tag-mixed';
  }

  let html = '<div class="schedule-table-wrap"><table class="schedule-table" aria-label="Program săptămânal Boxing Champions"><thead><tr>';
  html += '<th scope="col">Zi</th><th scope="col">Interval Orar</th><th scope="col">Categorie</th><th scope="col">Gen</th>';
  html += '</tr></thead><tbody>';

  activeDays.forEach(day => {
    grouped[day].forEach((slot, idx) => {
      const rowspan = idx === 0 ? `rowspan="${grouped[day].length}"` : '';
      const tagClass = getTagClass(slot);
      html += '<tr class="fade-in">';
      if (idx === 0) {
        html += `<td ${rowspan} style="font-weight: 700; color: var(--color-gold); font-family: var(--font-display); font-size: 1.1rem;">${escapeHtml(day)}</td>`;
      }
      html += `<td>${escapeHtml(slot.start_time)} – ${escapeHtml(slot.end_time)}</td>`;
      html += `<td>${escapeHtml(slot.category)}</td>`;
      html += `<td><span class="tag ${tagClass}">${escapeHtml(slot.gender)}</span></td>`;
      html += '</tr>';
    });
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// --- Coaches ---
async function loadCoaches() {
  const container = document.querySelector('[data-content="coaches"]');
  if (!container) return;

  const coaches = await apiFetch(`${API_BASE}/coaches`, {}, FALLBACK_DATA.coaches);

  if (!coaches || coaches.length === 0) {
    container.innerHTML = renderEmptyState('Momentan nu sunt antrenori disponibili.', 'fa-user-slash');
    return;
  }

  let html = '';
  coaches.forEach((coach, index) => {
    const delay = index * 100;
    html += `
      <div class="coach-card glass-card tilt-card fade-in delay-${delay}">
        <div class="tilt-card-inner">
          <div class="tilt-card-glow"></div>
          <div class="tilt-card-shine"></div>
          <div class="coach-card-img" style="width:160px;height:160px;border-radius:50%;margin:0 auto var(--space-lg);overflow:hidden;">
            ${coach.photo
              ? `<img src="${escapeHtml(coach.photo)}" alt="${escapeHtml(coach.name)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
              : `<div style="width:100%;height:100%;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;font-size:3rem;color:var(--color-gray-400);"><i class="fa-solid fa-user"></i></div>`
            }
          </div>
          <h3 style="text-align:center;font-family:var(--font-display);font-size:1.3rem;margin-bottom:var(--space-xs);">${escapeHtml(coach.name)}</h3>
          <p style="text-align:center;font-size:0.85rem;color:var(--color-gold-light);margin-bottom:var(--space-md);">${escapeHtml(coach.specialization)}</p>
          ${coach.quote
            ? `<p style="text-align:center;font-size:0.85rem;color:var(--color-gray-200);font-style:italic;">„${escapeHtml(coach.quote)}”</p>`
            : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// --- Events Preview ---
async function loadEventsPreview() {
  const container = document.querySelector('[data-content="events-preview"]');
  if (!container) return;

  const events = await apiFetch(`${API_BASE}/events`, {}, FALLBACK_DATA.events);

  if (!events || events.length === 0) {
    container.innerHTML = renderEmptyState('Momentan nu sunt evenimente programate.', 'fa-calendar-xmark');
    return;
  }

  // Ia primele 3 evenimente
  const preview = events.slice(0, 3);

  let html = '';
  preview.forEach((event, index) => {
    const delay = index * 100;
    const firstPhoto = event.photos && event.photos.length > 0 ? event.photos[0].url : '';
    html += `
      <div class="event-card glass-card tilt-card fade-in delay-${delay}">
        <div class="tilt-card-inner">
          <div class="tilt-card-glow"></div>
          <div class="tilt-card-shine"></div>
          <div class="event-card-img-wrap" style="height:220px;overflow:hidden;border-radius:var(--radius-md) var(--radius-md) 0 0;">
            ${firstPhoto
              ? `<img src="${escapeHtml(firstPhoto)}" alt="${escapeHtml(event.title)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
              : `<div style="width:100%;height:100%;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;font-size:3rem;color:var(--color-gray-400);"><i class="fa-solid fa-calendar-days"></i></div>`
            }
          </div>
          <div class="event-card-body" style="padding:var(--space-lg);">
            <span style="font-size:0.75rem;color:var(--color-gold-light);">${escapeHtml(event.event_date)}</span>
            <h3 style="font-family:var(--font-display);font-size:1.15rem;margin:var(--space-xs) 0;color:var(--color-light);">${escapeHtml(event.title)}</h3>
            ${event.location ? `<p style="font-size:0.8rem;color:var(--color-gray-300);margin-bottom:var(--space-sm);"><i class="fa-solid fa-location-dot" style="margin-right:0.35rem;color:var(--color-gold);"></i>${escapeHtml(event.location)}</p>` : ''}
            ${event.description ? `<p style="font-size:0.82rem;color:var(--color-gray-200);line-height:1.5;">${escapeHtml(event.description.length > 100 ? event.description.slice(0, 100) + '...' : event.description)}</p>` : ''}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// --- Events (full page) ---
async function loadEvents() {
  const container = document.querySelector('[data-content="events"]');
  if (!container) return;

  const events = await apiFetch(`${API_BASE}/events`, {}, FALLBACK_DATA.events);

  if (!events || events.length === 0) {
    container.innerHTML = renderEmptyState('Momentan nu sunt evenimente de afișat.', 'fa-calendar-xmark');
    return;
  }

  let html = '';
  events.forEach((event, index) => {
    const delay = index * 100;
    const firstPhoto = event.photos && event.photos.length > 0 ? event.photos[0].url : '';
    html += `
      <div class="event-card glass-card tilt-card fade-in delay-${delay}">
        <div class="tilt-card-inner">
          <div class="tilt-card-glow"></div>
          <div class="tilt-card-shine"></div>
          <div style="height:220px;overflow:hidden;border-radius:var(--radius-md) var(--radius-md) 0 0;">
            ${firstPhoto
              ? `<img src="${escapeHtml(firstPhoto)}" alt="${escapeHtml(event.title)}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
              : `<div style="width:100%;height:100%;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;font-size:3rem;color:var(--color-gray-400);"><i class="fa-solid fa-calendar-days"></i></div>`
            }
          </div>
          <div style="padding:var(--space-lg);">
            <span style="font-size:0.75rem;color:var(--color-gold-light);">${escapeHtml(event.event_date)}</span>
            <h3 style="font-family:var(--font-display);font-size:1.15rem;margin:var(--space-xs) 0;color:var(--color-light);">${escapeHtml(event.title)}</h3>
            ${event.location ? `<p style="font-size:0.8rem;color:var(--color-gray-300);margin-bottom:var(--space-sm);"><i class="fa-solid fa-location-dot" style="margin-right:0.35rem;color:var(--color-gold);"></i>${escapeHtml(event.location)}</p>` : ''}
            ${event.description ? `<p style="font-size:0.82rem;color:var(--color-gray-200);line-height:1.5;">${escapeHtml(event.description)}</p>` : ''}
            ${event.photos && event.photos.length > 1 ? `
              <div style="display:flex;gap:var(--space-xs);margin-top:var(--space-md);flex-wrap:wrap;">
                ${event.photos.map(p => `<span style="display:inline-block;padding:0.2rem 0.6rem;background:rgba(212,175,55,0.08);border-radius:50px;font-size:0.7rem;color:var(--color-gray-300);"><i class="fa-solid fa-image" style="margin-right:0.25rem;"></i>${escapeHtml(p.caption || 'Foto')}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// ===========================================================================
// INIT — execută toate încărcările disponibile pe pagină
// ===========================================================================
function initDynamicContent() {
  loadSchedule();
  loadCoaches();
  loadEventsPreview();
  loadEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDynamicContent);
} else {
  initDynamicContent();
}

// ===========================================================================
// PARTICULE CANVAS AURII — 40-60 cercuri animate
// ===========================================================================

(function () {
  // Reutilizează canvas-ul din HTML dacă există, altfel creează unul
  let canvas = document.getElementById('particles-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'particles-canvas';
    document.body.prepend(canvas);
  }
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  const ctx = canvas.getContext('2d');

  let width, height;
  let particles = [];

  const PARTICLE_COUNT_MIN = 40;
  const PARTICLE_COUNT_MAX = 60;

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  window.addEventListener('resize', resize);
  resize();

  function randomBetween(a, b) {
    return a + Math.random() * (b - a);
  }

  function createParticle() {
    return {
      x: randomBetween(0, width),
      y: randomBetween(0, height),
      radius: randomBetween(1.2, 3.5),
      speedX: randomBetween(-0.3, 0.3),
      speedY: randomBetween(-0.3, 0.3),
      opacity: randomBetween(0.15, 0.55),
      pulse: randomBetween(0, Math.PI * 2),
      pulseSpeed: randomBetween(0.005, 0.025),
    };
  }

  function initParticles() {
    const count = Math.floor(randomBetween(PARTICLE_COUNT_MIN, PARTICLE_COUNT_MAX));
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push(createParticle());
    }
  }

  initParticles();
  window.addEventListener('resize', () => {
    resize();
    initParticles();
  });

  function animate() {
    ctx.clearRect(0, 0, width, height);

    particles.forEach(function (p) {
      // actualizează pulsul
      p.pulse += p.pulseSpeed;

      // actualizează poziția
      p.x += p.speedX;
      p.y += p.speedY;

      // wrap around
      if (p.x < -10) p.x = width + 10;
      if (p.x > width + 10) p.x = -10;
      if (p.y < -10) p.y = height + 10;
      if (p.y > height + 10) p.y = -10;

      // opacitate cu puls
      const alpha = p.opacity + Math.sin(p.pulse) * 0.12;

      // desenare cerc auriu
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(212, 175, 55, ' + Math.max(0.05, alpha).toFixed(3) + ')';
      ctx.fill();

      // glow subtil
      var glowRadius = p.radius * 3;
      var gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
      gradient.addColorStop(0, 'rgba(212, 175, 55, ' + (Math.max(0.02, alpha * 0.3)).toFixed(3) + ')');
      gradient.addColorStop(1, 'rgba(212, 175, 55, 0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    });

    requestAnimationFrame(animate);
  }

  animate();
})();

// ===========================================================================
// CURSOR PERSONALIZAT — dot + ring cu inerție
// ===========================================================================

(function () {
  // elemente DOM pentru cursor — reutilizează din HTML dacă există
  var dot = document.querySelector('.cursor-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.className = 'cursor-dot';
    document.body.appendChild(dot);
  }
  dot.setAttribute('aria-hidden', 'true');

  var ring = document.querySelector('.cursor-ring');
  if (!ring) {
    ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(ring);
  }
  ring.setAttribute('aria-hidden', 'true');

  // poziții
  var mouseX = -100;
  var mouseY = -100;
  var dotX = -100;
  var dotY = -100;
  var ringX = -100;
  var ringY = -100;

  // stări
  var isHovering = false;
  var isVisible = false;
  var isTouchDevice = false;

  // factori de inerție
  var dotEasing = 0.35;
  var ringEasing = 0.12;

  // detectare touch device
  function detectTouch() {
    isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (isTouchDevice) {
      dot.style.display = 'none';
      ring.style.display = 'none';
    }
  }

  detectTouch();

  // actualizează poziția mouse-ului
  function onMouseMove(e) {
    if (isTouchDevice) return;
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (!isVisible) {
      dot.style.opacity = '1';
      ring.style.opacity = '1';
      isVisible = true;
    }
  }

  // ascunde cursorul când iese din fereastră
  function onMouseLeave() {
    if (isTouchDevice) return;
    isVisible = false;
    dot.style.opacity = '0';
    ring.style.opacity = '0';
  }

  function onMouseEnter() {
    if (isTouchDevice) return;
    isVisible = true;
  }

  // hover pe elemente interactive
  function onElementEnter() {
    if (isTouchDevice) return;
    isHovering = true;
    ring.style.transform = 'translate(-50%, -50%) scale(1.8)';
    ring.style.borderColor = 'rgba(212, 175, 55, 0.9)';
    ring.style.borderWidth = '1.5px';
    dot.style.transform = 'translate(-50%, -50%) scale(1.8)';
    dot.style.backgroundColor = 'rgba(212, 175, 55, 1)';
  }

  function onElementLeave() {
    if (isTouchDevice) return;
    isHovering = false;
    ring.style.transform = 'translate(-50%, -50%) scale(1)';
    ring.style.borderColor = 'rgba(212, 175, 55, 0.5)';
    ring.style.borderWidth = '1.5px';
    dot.style.transform = 'translate(-50%, -50%) scale(1)';
    dot.style.backgroundColor = 'rgba(212, 175, 55, 0.9)';
  }

  // loop de animație
  function updateCursor() {
    if (!isTouchDevice) {
      // inerție dot
      dotX += (mouseX - dotX) * dotEasing;
      dotY += (mouseY - dotY) * dotEasing;

      // inerție ring
      ringX += (mouseX - ringX) * ringEasing;
      ringY += (mouseY - ringY) * ringEasing;

      dot.style.left = dotX + 'px';
      dot.style.top = dotY + 'px';

      ring.style.left = ringX + 'px';
      ring.style.top = ringY + 'px';
    }

    requestAnimationFrame(updateCursor);
  }

  // evenimente mouse
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('mouseleave', onMouseLeave);
  document.addEventListener('mouseenter', onMouseEnter);

  // evenimente hover pe elemente interactive
  var interactiveSelector = 'a, button, input, textarea, select, [role="button"], .btn, .coach-card, .event-card, .tilt-card, .glass-card, .shop-card, [data-content], .nav-link, .schedule-table tr, .tag';
  document.addEventListener('mouseover', function (e) {
    var target = e.target.closest(interactiveSelector);
    if (target) {
      // verifică dacă nu suntem deja în hover
      if (!isHovering) {
        onElementEnter();
      }
    }
  });
  document.addEventListener('mouseout', function (e) {
    var target = e.target.closest(interactiveSelector);
    if (target) {
      var relatedTarget = e.relatedTarget;
      // verifică dacă relatedTarget nu este tot un element interactiv
      if (!relatedTarget || !relatedTarget.closest(interactiveSelector)) {
        onElementLeave();
      }
    }
  });

  // pornește loop-ul
  updateCursor();
})();