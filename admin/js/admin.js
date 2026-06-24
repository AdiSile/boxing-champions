'use strict';

// =============================================================================
// BOXING CHAMPIONS — ADMIN DASHBOARD — CLIENT-SIDE MODULE
// =============================================================================
// Funcționalități:
//   - Management sesiune JWT (check / refresh periodic / logout)
//   - Navigare secțiuni sidebar cu badge-uri dinamice
//   - CRUD complet prin API (fetch cu credentials: 'same-origin')
//   - Toggle activ / inactiv pentru entități
//   - Upload fișiere (imagini) cu preview live
//   - Validare formulare admin (client-side)
//   - Notificări toast & stări de încărcare
// =============================================================================
//
// COMPATIBILITATE: Acest modul este proiectat să funcționeze ca script EXTERN
// independent. NU este compatibil cu script-ul inline din dashboard.html,
// deoarece folosesc API-uri, selectori DOM și sisteme de navigare diferite.
//
// Dacă pagina conține deja script-ul inline dashboard (detectat prin prezența
// elementelor #mainPanel sau .nav-item), acest modul se va dezactiva automat
// pentru a preveni conflictele de dublă inițializare.
// =============================================================================

(function () {
  // ---------------------------------------------------------------------------
  // GUARD: Detectare script inline dashboard — previne dubla inițializare
  // ---------------------------------------------------------------------------
  var _inlineDashboardDetected = (function () {
    // Verifică dacă structura DOM specifică script-ului inline din dashboard.html
    // este prezentă: #mainPanel (container principal inline) sau .nav-item
    // (elemente de navigare inline, spre deosebire de .sidebar-nav-item).
    var hasMainPanel = !!document.getElementById('mainPanel');
    var hasNavItems = document.querySelectorAll('.nav-item[data-section]').length > 0;
    // De asemenea, verificăm dacă #modalOverlay există (modal inline static)
    var hasModalOverlay = !!document.getElementById('modalOverlay');

    if (hasMainPanel || (hasNavItems && hasModalOverlay)) {
      console.warn(
        '[admin.js] Script-ul inline dashboard a fost detectat pe această pagină ' +
        '(elemente: #mainPanel, .nav-item[data-section], #modalOverlay). ' +
        'admin.js se dezactivează automat pentru a preveni conflictele de dublă ' +
        'inițializare, API-uri diferite și selectori DOM incompatibili. ' +
        'Pentru a folosi admin.js, elimină script-ul inline din dashboard.html ' +
        'și asigură-te că markup-ul HTML folosește clasele .sidebar-nav-item, ' +
        '.sidebar, .main-content.'
      );
      return true;
    }
    return false;
  })();

  // Dacă dashboard-ul inline este activ, ieșim imediat — fără a înregistra
  // event listeneri, fără a expune AdminDashboard, fără a polua DOM-ul.
  if (_inlineDashboardDetected) {
    // Expunem un obiect gol pentru a preveni erori de tip
    // "AdminDashboard is undefined" în eventuale apeluri externe.
    window.AdminDashboard = {
      _disabled: true,
      _reason: 'Inline dashboard script detected — admin.js disabled to prevent conflicts.',
      switchSection: function () {},
      loadCoaches: function () {},
      loadEvents: function () {},
      loadSchedule: function () {},
      loadSubscriptions: function () {},
      loadProducts: function () {},
      loadOrders: function () {},
      loadMessages: function () {},
      loadAchievements: function () {},
      loadSEO: function () {},
      loadBadges: function () {},
      logout: function () { window.location.href = '/admin'; },
      showToast: function () {},
    };
    return; // Oprire completă — restul modulului nu se execută
  }

  // ---------------------------------------------------------------------------
  // CONSTANTE
  // ---------------------------------------------------------------------------
  const API_BASE = '/api/admin';
  const AUTH_CHECK_URL = '/api/auth/check';
  const AUTH_LOGOUT_URL = '/api/auth/logout';
  const LOGIN_URL = '/admin';
  const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minute
  const TOAST_DURATION = 3200;
  const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

  // Zile săptămână
  const WEEK_DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];

  // Categorii produse
  const PRODUCT_CATEGORIES = ['Îmbrăcăminte', 'Echipament', 'Accesorii', 'Nutriție'];

  // Statusuri comandă
  const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

  // Statusuri comandă localizate
  const ORDER_STATUS_LABELS = {
    pending: 'În așteptare',
    confirmed: 'Confirmată',
    processing: 'În procesare',
    shipped: 'Expediată',
    delivered: 'Livrată',
    cancelled: 'Anulată',
  };

  // Chei realizări
  const ACHIEVEMENT_KEYS = ['championships', 'matches_won', 'active_members', 'years_experience'];

  // Pagini SEO suportate de backend
  const SEO_PAGES = ['home', 'about', 'coaches', 'schedule', 'subscriptions', 'events', 'shop', 'contact'];
  const SEO_PAGE_LABELS = {
    home: 'Acasă',
    about: 'Despre Noi',
    coaches: 'Antrenori',
    schedule: 'Program',
    subscriptions: 'Abonamente',
    events: 'Evenimente',
    shop: 'Magazin',
    contact: 'Contact',
  };

  // ---------------------------------------------------------------------------
  // REFERINȚE DOM GLOBALE
  // ---------------------------------------------------------------------------
  let sidebar = null;
  let mainContent = null;
  let toastContainer = null;
  let sessionCheckInterval = null;

  // Badge-uri sidebar
  let badgeMessages = null;
  let badgeOrders = null;

  // Cache date SEO
  let seoDataCache = [];

  // ---------------------------------------------------------------------------
  // UTILITARE
  // ---------------------------------------------------------------------------

  /** Escape HTML – previne XSS */
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

  /** Formatare preț RON */
  function formatPrice(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return '0.00 RON';
    return n.toFixed(2) + ' RON';
  }

  /** Formatare dată ISO -> locală */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('ro-RO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  /** Formatare dată + oră */
  function formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('ro-RO', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  /** Generează un ID unic */
  function uid(prefix) {
    return (prefix || 'el') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Iconiță pentru pagină SEO */
  function getPageIcon(page) {
    var icons = {
      home: 'fa-house',
      about: 'fa-circle-info',
      coaches: 'fa-user-graduate',
      schedule: 'fa-clock',
      subscriptions: 'fa-ticket',
      events: 'fa-calendar-star',
      shop: 'fa-store',
      contact: 'fa-envelope',
    };
    return icons[page] || 'fa-file';
  }

  // ---------------------------------------------------------------------------
  // TOAST SYSTEM
  // ---------------------------------------------------------------------------

  function ensureToastContainer() {
    if (toastContainer) return;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }

  function showToast(type, message, duration) {
    ensureToastContainer();
    const dur = duration || TOAST_DURATION;
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      info: 'fa-circle-info',
      warning: 'fa-triangle-exclamation',
    };
    const icon = icons[type] || icons.info;

    const toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.innerHTML = '<i class="fa-solid ' + icon + '"></i><span>' + escapeHtml(message) + '</span>';
    toast.setAttribute('role', 'status');
    toastContainer.appendChild(toast);

    void toast.offsetWidth;
    toast.classList.add('toast--visible');

    setTimeout(function () {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, { once: true });
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, dur);
  }

  // ---------------------------------------------------------------------------
  // SISTEM MODAL
  // ---------------------------------------------------------------------------

  function createModal(title, bodyHtml, footerHtml, opts) {
    var options = opts || {};
    var modalId = uid('modal');
    var sizeClass = options.size === 'large' ? 'modal--lg' : (options.size === 'small' ? 'modal--sm' : '');

    var html = '';
    html += '<div class="modal-overlay" id="' + modalId + '_overlay" data-modal="' + modalId + '" aria-hidden="true"></div>';
    html += '<div class="modal ' + sizeClass + '" id="' + modalId + '" role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="' + modalId + '_title">';
    html += '<div class="modal-dialog">';
    html += '<div class="modal-header">';
    html += '<h2 class="modal-title" id="' + modalId + '_title">' + escapeHtml(title) + '</h2>';
    html += '<button class="modal-close" data-modal-close="' + modalId + '" aria-label="Închide" type="button"><i class="fa-solid fa-xmark"></i></button>';
    html += '</div>';
    html += '<div class="modal-body">' + bodyHtml + '</div>';
    if (footerHtml) {
      html += '<div class="modal-footer">' + footerHtml + '</div>';
    }
    html += '</div></div>';

    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    var overlay = wrapper.querySelector('.modal-overlay');
    var modal = wrapper.querySelector('.modal');

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    function open() {
      overlay.setAttribute('aria-hidden', 'false');
      modal.setAttribute('aria-hidden', 'false');
      overlay.classList.add('modal-overlay--visible');
      modal.classList.add('modal--open');
      document.body.style.overflow = 'hidden';
      setTimeout(function () {
        var firstFocus = modal.querySelector('input, select, textarea, button:not(.modal-close)');
        if (firstFocus) firstFocus.focus();
      }, 100);
    }

    function close() {
      overlay.setAttribute('aria-hidden', 'true');
      modal.setAttribute('aria-hidden', 'true');
      overlay.classList.remove('modal-overlay--visible');
      modal.classList.remove('modal--open');
      document.body.style.overflow = '';
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (modal.parentNode) modal.parentNode.removeChild(modal);
      }, 350);
    }

    modal.querySelectorAll('[data-modal-close]').forEach(function (btn) {
      btn.addEventListener('click', close);
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });

    function onKeyDown(e) {
      if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') {
        close();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return {
      open: open,
      close: close,
      modalEl: modal,
      overlayEl: overlay,
      getElement: function (sel) { return modal.querySelector(sel); },
      destroy: function () {
        close();
        document.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // FETCH API CU GESTIONARE SESIUNE
  // ---------------------------------------------------------------------------

  async function apiRequest(url, options) {
    var opts = options || {};
    opts.credentials = 'same-origin';
    if (!opts.headers) opts.headers = {};

    if (opts.body && typeof opts.body === 'string' && !opts.headers['Content-Type']) {
      try {
        JSON.parse(opts.body);
        opts.headers['Content-Type'] = 'application/json';
      } catch (_) { /* nu e JSON */ }
    }

    try {
      var response = await fetch(url, opts);

      if (response.status === 401) {
        showToast('error', 'Sesiunea a expirat. Redirecționare la autentificare...');
        setTimeout(function () {
          window.location.href = LOGIN_URL;
        }, 1500);
        throw new Error('Sesiune expirată');
      }

      if (response.status === 403) {
        showToast('error', 'Acces interzis. Nu ai permisiunile necesare.');
        throw new Error('Acces interzis');
      }

      var data;
      var contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        var errorMsg = (data && data.error) ? data.error : ('Eroare HTTP ' + response.status);
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      if (err.message === 'Sesiune expirată' || err.message === 'Acces interzis') {
        throw err;
      }
      throw err;
    }
  }

  function apiGet(url) {
    return apiRequest(url, { method: 'GET' });
  }

  function apiPost(url, body) {
    return apiRequest(url, { method: 'POST', body: JSON.stringify(body) });
  }

  function apiPut(url, body) {
    return apiRequest(url, { method: 'PUT', body: JSON.stringify(body) });
  }

  function apiPatch(url, body) {
    return apiRequest(url, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
  }

  function apiDelete(url) {
    return apiRequest(url, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // GESTIUNE SESIUNE JWT
  // ---------------------------------------------------------------------------

  async function checkSession() {
    try {
      var response = await fetch(AUTH_CHECK_URL, { method: 'GET', credentials: 'same-origin' });
      if (!response.ok) { window.location.href = LOGIN_URL; return false; }
      return true;
    } catch (_) { window.location.href = LOGIN_URL; return false; }
  }

  function startSessionCheck() {
    if (sessionCheckInterval) clearInterval(sessionCheckInterval);
    sessionCheckInterval = setInterval(async function () {
      try {
        var response = await fetch(AUTH_CHECK_URL, { method: 'GET', credentials: 'same-origin' });
        if (!response.ok) {
          clearInterval(sessionCheckInterval);
          showToast('error', 'Sesiunea a expirat. Redirecționare...');
          setTimeout(function () { window.location.href = LOGIN_URL; }, 1500);
        }
      } catch (_) { /* ignore */ }
    }, SESSION_CHECK_INTERVAL);
  }

  async function logout() {
    try { await fetch(AUTH_LOGOUT_URL, { method: 'POST', credentials: 'same-origin' }); } catch (_) { }
    if (sessionCheckInterval) clearInterval(sessionCheckInterval);
    window.location.href = LOGIN_URL;
  }

  // ---------------------------------------------------------------------------
  // UPLOAD FIȘIERE + PREVIEW IMAGINI
  // ---------------------------------------------------------------------------

  function createImageUploader(containerSelector, currentImageUrl, onFileSelected) {
    var container = typeof containerSelector === 'string'
      ? document.querySelector(containerSelector)
      : containerSelector;
    if (!container) return null;

    var uploadId = uid('upload');
    var previewId = uid('preview');

    var html = '';
    html += '<div class="img-upload" id="' + uploadId + '">';
    html += '<div class="img-upload-preview" id="' + previewId + '">';
    if (currentImageUrl) {
      html += '<img src="' + escapeHtml(currentImageUrl) + '" alt="Preview imagine" class="img-upload-thumb">';
    } else {
      html += '<div class="img-upload-placeholder"><i class="fa-solid fa-image"></i><span>Nicio imagine</span></div>';
    }
    html += '</div>';
    html += '<div class="img-upload-actions">';
    html += '<label class="btn btn-outline btn-sm" for="' + uploadId + '_input">';
    html += '<i class="fa-solid fa-upload"></i> Alege Imaginea</label>';
    html += '<input type="file" id="' + uploadId + '_input" accept="image/*" style="display:none;">';
    html += '<button class="btn btn-ghost btn-sm img-upload-remove" type="button" id="' + uploadId + '_remove" ';
    html += currentImageUrl ? '' : 'style="display:none;"';
    html += '><i class="fa-solid fa-trash-can"></i> Șterge</button>';
    html += '</div>';
    html += '<div class="img-upload-error" id="' + uploadId + '_error" style="display:none;"></div>';
    html += '</div>';

    container.innerHTML = html;

    var fileInput = document.getElementById(uploadId + '_input');
    var previewEl = document.getElementById(previewId);
    var removeBtn = document.getElementById(uploadId + '_remove');
    var errorEl = document.getElementById(uploadId + '_error');
    var currentDataUrl = null;
    var currentFile = null;

    function updatePreview(dataUrl) {
      if (dataUrl) {
        previewEl.innerHTML = '<img src="' + dataUrl + '" alt="Preview imagine" class="img-upload-thumb">';
        removeBtn.style.display = '';
        errorEl.style.display = 'none';
      } else {
        previewEl.innerHTML = '<div class="img-upload-placeholder"><i class="fa-solid fa-image"></i><span>Nicio imagine</span></div>';
        removeBtn.style.display = 'none';
        errorEl.style.display = 'none';
      }
    }

    function clearImage() {
      currentFile = null;
      currentDataUrl = null;
      fileInput.value = '';
      updatePreview(null);
      if (onFileSelected) onFileSelected(null);
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;

      if (ALLOWED_IMAGE_TYPES.indexOf(file.type) === -1) {
        errorEl.textContent = 'Format invalid. Acceptate: JPEG, PNG, WebP, GIF, SVG.';
        errorEl.style.display = 'block';
        fileInput.value = '';
        return;
      }

      if (file.size > MAX_IMAGE_SIZE) {
        errorEl.textContent = 'Fișierul depășește 5 MB. Alege o imagine mai mică.';
        errorEl.style.display = 'block';
        fileInput.value = '';
        return;
      }

      errorEl.style.display = 'none';

      var reader = new FileReader();
      reader.onload = function (e) {
        currentDataUrl = e.target.result;
        currentFile = file;
        updatePreview(currentDataUrl);
        if (onFileSelected) onFileSelected({ file: file, dataUrl: currentDataUrl });
      };
      reader.readAsDataURL(file);
    });

    removeBtn.addEventListener('click', clearImage);

    return {
      getDataUrl: function () { return currentDataUrl; },
      getFile: function () { return currentFile; },
      clear: clearImage,
      setPreview: function (url) { if (url) updatePreview(url); },
    };
  }

  function processImageForSave(uploader) {
    if (!uploader) return '';
    var dataUrl = uploader.getDataUrl();
    return dataUrl || '';
  }

  // ---------------------------------------------------------------------------
  // NAVIGARE SECȚIUNI
  // ---------------------------------------------------------------------------

  var currentSection = 'settings';

  function switchSection(sectionName) {
    currentSection = sectionName;
    var allNavItems = document.querySelectorAll('.sidebar-nav-item');
    allNavItems.forEach(function (item) {
      var section = item.getAttribute('data-section');
      if (section === sectionName) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'page');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
      }
    });
    loadSectionContent(sectionName);
  }

  function loadSectionContent(sectionName) {
    if (!mainContent) return;
    mainContent.innerHTML = renderLoadingSkeleton();

    switch (sectionName) {
      case 'settings': loadSettings(); break;
      case 'coaches': loadCoaches(); break;
      case 'events': loadEvents(); break;
      case 'schedule': loadSchedule(); break;
      case 'subscriptions': loadSubscriptions(); break;
      case 'products': loadProducts(); break;
      case 'orders': loadOrders(); break;
      case 'messages': loadMessages(); break;
      case 'achievements': loadAchievements(); break;
      case 'seo': loadSEO(); break;
      default: mainContent.innerHTML = renderEmptyState('Secțiunea nu există.', 'fa-circle-exclamation');
    }
  }

  // ---------------------------------------------------------------------------
  // RANDARE COMPONENTE COMUNE
  // ---------------------------------------------------------------------------

  function renderLoadingSkeleton() {
    return '' +
      '<div class="skeleton-wrapper">' +
      '<div class="skeleton skeleton--title"></div>' +
      '<div class="skeleton skeleton--text"></div>' +
      '<div class="skeleton skeleton--text skeleton--short"></div>' +
      '<div class="skeleton skeleton--card"></div>' +
      '</div>';
  }

  function renderEmptyState(message, iconClass) {
    var icon = iconClass || 'fa-circle-info';
    return '' +
      '<div class="empty-state">' +
      '<div class="empty-state-icon"><i class="fa-solid ' + icon + '"></i></div>' +
      '<h3 class="empty-state-title">' + escapeHtml(message) + '</h3>' +
      '</div>';
  }

  function renderErrorState(message, retryFn) {
    var retryId = uid('retry');
    setTimeout(function () {
      var btn = document.getElementById(retryId);
      if (btn && retryFn) btn.addEventListener('click', retryFn);
    }, 50);
    return '' +
      '<div class="empty-state empty-state--error">' +
      '<div class="empty-state-icon"><i class="fa-solid fa-cloud-bolt"></i></div>' +
      '<h3 class="empty-state-title">Eroare la încărcare</h3>' +
      '<p class="empty-state-desc">' + escapeHtml(message) + '</p>' +
      '<button class="btn btn-primary btn-sm" id="' + retryId + '" type="button"><i class="fa-solid fa-rotate-right"></i> Reîncearcă</button>' +
      '</div>';
  }

  function renderBadge(active) {
    if (active === 1 || active === true) {
      return '<span class="badge badge--active">Activ</span>';
    }
    return '<span class="badge badge--inactive">Inactiv</span>';
  }

  function renderStatusBadge(status) {
    var label = ORDER_STATUS_LABELS[status] || status;
    var cls = 'badge badge--' + (status || 'pending');
    return '<span class="' + cls + '">' + escapeHtml(label) + '</span>';
  }

  function renderToggleSwitch(entityType, entityId, currentActive) {
    var switchId = uid('toggle');
    var checked = currentActive === 1 || currentActive === true ? ' checked' : '';
    return '' +
      '<label class="toggle-switch" for="' + switchId + '" title="' + (currentActive ? 'Dezactivează' : 'Activează') + '">' +
      '<input type="checkbox" class="toggle-input" id="' + switchId + '"' + checked +
      ' data-entity="' + entityType + '" data-id="' + entityId + '">' +
      '<span class="toggle-slider"></span>' +
      '</label>';
  }

  function renderSectionHeader(title, subtitle, actionLabel, actionIcon, actionFn, actionId) {
    var btnId = actionId || uid('action');
    setTimeout(function () {
      var btn = document.getElementById(btnId);
      if (btn && actionFn) btn.addEventListener('click', actionFn);
    }, 50);
    return '' +
      '<div class="section-header">' +
      '<div class="section-header-info">' +
      '<h2 class="section-title">' + escapeHtml(title) + '</h2>' +
      (subtitle ? '<p class="section-subtitle">' + escapeHtml(subtitle) + '</p>' : '') +
      '</div>' +
      (actionLabel ? '' +
        '<button class="btn btn-primary" id="' + btnId + '" type="button">' +
        '<i class="fa-solid ' + (actionIcon || 'fa-plus') + '"></i> ' +
        escapeHtml(actionLabel) +
        '</button>' : '') +
      '</div>';
  }

  // ---------------------------------------------------------------------------
  // VALIDARE FORMULARE — HELPERS
  // ---------------------------------------------------------------------------

  var validators = {
    required: function (val, label) {
      if (!val || (typeof val === 'string' && val.trim().length === 0)) {
        return (label || 'Câmpul') + ' este obligatoriu.';
      }
      return null;
    },
    minLength: function (val, min, label) {
      if (typeof val === 'string' && val.trim().length < min) {
        return (label || 'Câmpul') + ' trebuie să aibă minim ' + min + ' caractere.';
      }
      return null;
    },
    maxLength: function (val, max, label) {
      if (typeof val === 'string' && val.trim().length > max) {
        return (label || 'Câmpul') + ' trebuie să aibă maxim ' + max + ' caractere.';
      }
      return null;
    },
    email: function (val, label) {
      if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(val.trim())) {
        return (label || 'Email-ul') + ' nu este valid.';
      }
      return null;
    },
    positiveNum: function (val, label) {
      var n = parseFloat(val);
      if (Number.isNaN(n) || n < 0) return (label || 'Valoarea') + ' trebuie să fie un număr pozitiv.';
      return null;
    },
    integer: function (val, label) {
      var n = parseInt(val, 10);
      if (Number.isNaN(n) || n < 0 || String(n) !== String(val).trim()) {
        return (label || 'Valoarea') + ' trebuie să fie un număr întreg pozitiv.';
      }
      return null;
    },
    dateFormat: function (val, label) {
      if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
        return (label || 'Data') + ' trebuie să fie în format YYYY-MM-DD.';
      }
      return null;
    },
    timeFormat: function (val, label) {
      if (val && !/^\d{2}:\d{2}$/.test(val.trim())) {
        return (label || 'Ora') + ' trebuie să fie în format HH:mm.';
      }
      return null;
    },
  };

  function validateForm(form, rules) {
    var errors = {};
    var valid = true;
    for (var fieldName in rules) {
      if (!rules.hasOwnProperty(fieldName)) continue;
      var fieldRules = rules[fieldName];
      var input = form.querySelector('[name="' + fieldName + '"]');
      var val = input ? input.value : '';
      for (var i = 0; i < fieldRules.length; i++) {
        var rule = fieldRules[i];
        var validatorFn = validators[rule.validator];
        if (!validatorFn) continue;
        var error = validatorFn(val, rule.label, rule.param);
        if (error) { errors[fieldName] = error; valid = false; break; }
      }
    }
    return { valid: valid, errors: errors };
  }

  function displayFormErrors(form, errors) {
    form.querySelectorAll('.field-error').forEach(function (el) { el.textContent = ''; el.classList.remove('visible'); });
    form.querySelectorAll('.input-wrapper').forEach(function (el) { el.classList.remove('error'); });

    for (var fieldName in errors) {
      if (!errors.hasOwnProperty(fieldName)) continue;
      var input = form.querySelector('[name="' + fieldName + '"]');
      if (!input) continue;
      var wrapper = input.closest('.input-wrapper');
      var errorEl = wrapper
        ? wrapper.parentElement.querySelector('.field-error')
        : form.querySelector('[data-error-for="' + fieldName + '"]');
      if (wrapper) wrapper.classList.add('error');
      if (errorEl) { errorEl.textContent = errors[fieldName]; errorEl.classList.add('visible'); }
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: SETĂRI GENERALE ===
  // ---------------------------------------------------------------------------

  async function loadSettings() {
    try {
      var settings = await apiGet(API_BASE + '/settings');
      renderSettings(settings);
    } catch (err) {
      mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca setările.', loadSettings);
    }
  }

  function renderSettings(settings) {
    var html = renderSectionHeader('Setări Generale', 'Configurează datele clubului');
    html += '<form class="admin-form" id="settingsForm" novalidate>';
    html += '<div class="form-grid">';

    html += '<div class="form-group"><label for="set_club_name">Nume Club</label><div class="input-wrapper"><i class="fa-solid fa-building"></i><input type="text" id="set_club_name" name="club_name" value="' + escapeHtml(settings.club_name || '') + '" maxlength="200" required></div><div class="field-error" data-error-for="club_name"></div></div>';
    html += '<div class="form-group"><label for="set_slogan">Slogan</label><div class="input-wrapper"><i class="fa-solid fa-quote-right"></i><input type="text" id="set_slogan" name="slogan" value="' + escapeHtml(settings.slogan || '') + '" maxlength="300"></div><div class="field-error" data-error-for="slogan"></div></div>';
    html += '<div class="form-group"><label for="set_email">Email Contact</label><div class="input-wrapper"><i class="fa-solid fa-envelope"></i><input type="email" id="set_email" name="email" value="' + escapeHtml(settings.email || '') + '" maxlength="320"></div><div class="field-error" data-error-for="email"></div></div>';
    html += '<div class="form-group"><label for="set_phone">Telefon</label><div class="input-wrapper"><i class="fa-solid fa-phone"></i><input type="text" id="set_phone" name="phone" value="' + escapeHtml(settings.phone || '') + '" maxlength="30"></div><div class="field-error" data-error-for="phone"></div></div>';
    html += '<div class="form-group form-group--full"><label for="set_address">Adresă</label><div class="input-wrapper"><i class="fa-solid fa-location-dot"></i><input type="text" id="set_address" name="address" value="' + escapeHtml(settings.address || '') + '" maxlength="500"></div><div class="field-error" data-error-for="address"></div></div>';
    html += '<div class="form-group"><label for="set_facebook">Facebook URL</label><div class="input-wrapper"><i class="fa-brands fa-facebook"></i><input type="url" id="set_facebook" name="facebook" value="' + escapeHtml(settings.facebook || '') + '" maxlength="2000"></div></div>';
    html += '<div class="form-group"><label for="set_instagram">Instagram URL</label><div class="input-wrapper"><i class="fa-brands fa-instagram"></i><input type="url" id="set_instagram" name="instagram" value="' + escapeHtml(settings.instagram || '') + '" maxlength="2000"></div></div>';
    html += '<div class="form-group"><label for="set_tiktok">TikTok URL</label><div class="input-wrapper"><i class="fa-brands fa-tiktok"></i><input type="url" id="set_tiktok" name="tiktok" value="' + escapeHtml(settings.tiktok || '') + '" maxlength="2000"></div></div>';
    html += '<div class="form-group form-group--full"><label for="set_hero_badge">Text Badge Hero</label><div class="input-wrapper"><i class="fa-solid fa-tag"></i><input type="text" id="set_hero_badge" name="hero_badge" value="' + escapeHtml(settings.hero_badge || '') + '" maxlength="300"></div></div>';
    html += '<div class="form-group form-group--full"><label for="set_about_text">Text Despre Noi</label><div class="input-wrapper"><i class="fa-solid fa-circle-info"></i><textarea id="set_about_text" name="about_text" rows="4" maxlength="2000">' + escapeHtml(settings.about_text || '') + '</textarea></div></div>';

    html += '</div><div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvează Setările</button></div>';
    html += '</form>';

    mainContent.innerHTML = html;

    var form = document.getElementById('settingsForm');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var formData = new FormData(form);
        var settingsObj = {};
        formData.forEach(function (value, key) { settingsObj[key] = value; });

        var rules = {
          club_name: [{ validator: 'required', label: 'Numele clubului' }, { validator: 'minLength', label: 'Numele clubului', param: 2 }],
          email: [{ validator: 'email', label: 'Email-ul' }],
          slogan: [{ validator: 'maxLength', label: 'Sloganul', param: 300 }],
          phone: [{ validator: 'maxLength', label: 'Telefonul', param: 30 }],
          address: [{ validator: 'maxLength', label: 'Adresa', param: 500 }],
        };

        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        try {
          await apiPut(API_BASE + '/settings', settingsObj);
          showToast('success', 'Setările au fost salvate cu succes.');
        } catch (err) {
          showToast('error', err.message || 'Eroare la salvarea setărilor.');
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: ANTRENORI ===
  // ---------------------------------------------------------------------------

  async function loadCoaches() {
    try {
      var coaches = await apiGet(API_BASE + '/coaches');
      renderCoaches(coaches);
    } catch (err) {
      mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca antrenorii.', loadCoaches);
    }
  }

  function renderCoaches(coaches) {
    var activeCount = coaches.filter(function (c) { return c.active === 1; }).length;
    var inactiveCount = coaches.length - activeCount;

    var html = renderSectionHeader('Antrenori', activeCount + ' activi, ' + inactiveCount + ' inactivi — Total: ' + coaches.length, 'Adaugă Antrenor', 'fa-plus', openCoachModal);

    if (coaches.length === 0) {
      html += renderEmptyState('Nu există antrenori. Adaugă primul antrenor.', 'fa-user-slash');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Imagine</th><th>Nume</th><th>Specializare</th><th>Certificări</th><th>Status</th><th>Acțiuni</th></tr></thead><tbody>';

      coaches.forEach(function (coach) {
        html += '<tr data-entity="coach" data-id="' + coach.id + '">' +
          '<td><div class="table-img">' + (coach.photo ? '<img src="' + escapeHtml(coach.photo) + '" alt="' + escapeHtml(coach.name) + '" loading="lazy">' : '<div class="table-img-placeholder"><i class="fa-solid fa-user"></i></div>') + '</div></td>' +
          '<td><strong>' + escapeHtml(coach.name) + '</strong></td>' +
          '<td>' + escapeHtml(coach.specialization) + '</td>' +
          '<td><small>' + escapeHtml(coach.certifications) + '</small></td>' +
          '<td>' + renderToggleSwitch('coach', coach.id, coach.active) + ' ' + renderBadge(coach.active) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-edit" data-edit="coach" data-id="' + coach.id + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="coach" data-id="' + coach.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindToggles('coach');
    bindEdits('coach', openCoachModal);
    bindDeletes('coach', loadCoaches);
  }

  function openCoachModal(coachData) {
    var isEdit = !!coachData;
    var title = isEdit ? 'Editează Antrenor' : 'Adaugă Antrenor';
    var coach = coachData || {};

    var bodyHtml = '<form class="admin-form" id="coachForm" novalidate>' +
      '<input type="hidden" name="id" value="' + (coach.id || '') + '">' +
      '<div class="form-group"><label for="coach_name">Nume <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="coach_name" name="name" value="' + escapeHtml(coach.name || '') + '" maxlength="200" required></div><div class="field-error" data-error-for="name"></div></div>' +
      '<div class="form-group"><label for="coach_specialization">Specializare</label><div class="input-wrapper"><input type="text" id="coach_specialization" name="specialization" value="' + escapeHtml(coach.specialization || '') + '" maxlength="500"></div></div>' +
      '<div class="form-group"><label for="coach_certifications">Certificări</label><div class="input-wrapper"><textarea id="coach_certifications" name="certifications" rows="2" maxlength="1000">' + escapeHtml(coach.certifications || '') + '</textarea></div></div>' +
      '<div class="form-group"><label for="coach_quote">Citat</label><div class="input-wrapper"><textarea id="coach_quote" name="quote" rows="2" maxlength="1000">' + escapeHtml(coach.quote || '') + '</textarea></div></div>' +
      '<div class="form-group"><label>Imagine</label><div id="coachImageUploader"></div></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="active" value="1"' + (coach.active !== 0 ? ' checked' : '') + '> Activ</label></div>' +
      '</form>';

    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="coachSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Actualizează' : 'Adaugă') + '</button>';

    var modal = createModal(title, bodyHtml, footerHtml, { size: 'medium' });
    modal.open();

    var uploader = createImageUploader('#coachImageUploader', coach.photo || '', null);

    var saveBtn = modal.getElement('#coachSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var form = modal.getElement('#coachForm');
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (value, key) { data[key] = value; });

        var rules = { name: [{ validator: 'required', label: 'Numele' }, { validator: 'minLength', label: 'Numele', param: 2 }] };
        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        var imageUrl = processImageForSave(uploader);
        data.photo = imageUrl || coach.photo || '';
        data.active = data.active === '1';

        try {
          if (isEdit) {
            await apiPut(API_BASE + '/coaches/' + coach.id, data);
            showToast('success', 'Antrenorul a fost actualizat.');
          } else {
            await apiPost(API_BASE + '/coaches', data);
            showToast('success', 'Antrenorul a fost adăugat.');
          }
          modal.destroy();
          loadCoaches();
        } catch (err) { showToast('error', err.message || 'Eroare la salvarea antrenorului.'); }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: EVENIMENTE ===
  // ---------------------------------------------------------------------------

  async function loadEvents() {
    try {
      var events = await apiGet(API_BASE + '/events');
      renderEvents(events);
    } catch (err) {
      mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca evenimentele.', loadEvents);
    }
  }

  function renderEvents(events) {
    var activeCount = events.filter(function (e) { return e.active === 1; }).length;
    var html = renderSectionHeader('Evenimente', activeCount + ' active — Total: ' + events.length, 'Adaugă Eveniment', 'fa-plus', openEventModal);

    if (events.length === 0) {
      html += renderEmptyState('Nu există evenimente. Adaugă primul eveniment.', 'fa-calendar-xmark');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Titlu</th><th>Data</th><th>Locație</th><th>Foto</th><th>Status</th><th>Acțiuni</th></tr></thead><tbody>';

      events.forEach(function (event) {
        var firstPhoto = event.photos && event.photos.length > 0 ? event.photos[0].url : '';
        html += '<tr data-entity="event" data-id="' + event.id + '">' +
          '<td><strong>' + escapeHtml(event.title) + '</strong></td>' +
          '<td>' + formatDate(event.event_date) + '</td>' +
          '<td>' + escapeHtml(event.location) + '</td>' +
          '<td><div class="table-img">' + (firstPhoto ? '<img src="' + escapeHtml(firstPhoto) + '" alt="' + escapeHtml(event.title) + '" loading="lazy">' : '<div class="table-img-placeholder"><i class="fa-solid fa-calendar-days"></i></div>') + '</div></td>' +
          '<td>' + renderToggleSwitch('event', event.id, event.active) + ' ' + renderBadge(event.active) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-photos" data-photos="event" data-id="' + event.id + '" title="Galerie Foto" type="button"><i class="fa-solid fa-images"></i></button><button class="btn btn-ghost btn-sm btn-edit" data-edit="event" data-id="' + event.id + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="event" data-id="' + event.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindToggles('event');
    bindEdits('event', openEventModal);
    bindDeletes('event', loadEvents);
    bindPhotos();
  }

  function openEventModal(eventData) {
    var isEdit = !!eventData;
    var title = isEdit ? 'Editează Eveniment' : 'Adaugă Eveniment';
    var event = eventData || {};

    var bodyHtml = '<form class="admin-form" id="eventForm" novalidate>' +
      '<input type="hidden" name="id" value="' + (event.id || '') + '">' +
      '<div class="form-group"><label for="event_title">Titlu <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="event_title" name="title" value="' + escapeHtml(event.title || '') + '" maxlength="300" required></div><div class="field-error" data-error-for="title"></div></div>' +
      '<div class="form-group"><label for="event_date">Data <span class="required">*</span> (YYYY-MM-DD)</label><div class="input-wrapper"><input type="date" id="event_date" name="event_date" value="' + escapeHtml(event.event_date || '') + '" required></div><div class="field-error" data-error-for="event_date"></div></div>' +
      '<div class="form-group"><label for="event_location">Locație</label><div class="input-wrapper"><input type="text" id="event_location" name="location" value="' + escapeHtml(event.location || '') + '" maxlength="500"></div></div>' +
      '<div class="form-group"><label for="event_description">Descriere</label><div class="input-wrapper"><textarea id="event_description" name="description" rows="4" maxlength="5000">' + escapeHtml(event.description || '') + '</textarea></div></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="active" value="1"' + (event.active !== 0 ? ' checked' : '') + '> Activ</label></div>' +
      '</form>';

    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="eventSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Actualizează' : 'Adaugă') + '</button>';

    var modal = createModal(title, bodyHtml, footerHtml, { size: 'medium' });
    modal.open();

    var saveBtn = modal.getElement('#eventSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var form = modal.getElement('#eventForm');
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (value, key) { data[key] = value; });

        var rules = {
          title: [{ validator: 'required', label: 'Titlul' }, { validator: 'minLength', label: 'Titlul', param: 2 }],
          event_date: [{ validator: 'required', label: 'Data' }, { validator: 'dateFormat', label: 'Data' }],
        };
        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        data.active = data.active === '1';

        try {
          if (isEdit) { await apiPut(API_BASE + '/events/' + event.id, data); showToast('success', 'Evenimentul a fost actualizat.'); }
          else { await apiPost(API_BASE + '/events', data); showToast('success', 'Evenimentul a fost adăugat.'); }
          modal.destroy();
          loadEvents();
        } catch (err) { showToast('error', err.message || 'Eroare la salvarea evenimentului.'); }
      });
    }
  }

  function bindPhotos() {
    var photoBtns = document.querySelectorAll('[data-photos="event"]');
    photoBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var eventId = parseInt(this.getAttribute('data-id'), 10);
        openPhotosModal(eventId);
      });
    });
  }

  async function openPhotosModal(eventId) {
    try {
      var photos = await apiGet(API_BASE + '/events/' + eventId + '/photos');
      var event = await apiGet(API_BASE + '/events/' + eventId);
      renderPhotosModal(event, photos);
    } catch (err) { showToast('error', err.message || 'Eroare la încărcarea fotografiilor.'); }
  }

  function renderPhotosModal(event, photos) {
    var bodyHtml = '<h3 style="margin-bottom:16px;">' + escapeHtml(event.title) + '</h3>';
    bodyHtml += '<div class="photo-grid" id="photoGrid">';

    if (photos.length === 0) {
      bodyHtml += '<p style="color:var(--text-secondary);text-align:center;padding:24px;">Nicio fotografie în galerie.</p>';
    } else {
      photos.forEach(function (photo) {
        bodyHtml += '<div class="photo-card" data-photo-id="' + photo.id + '">' +
          '<img src="' + escapeHtml(photo.url) + '" alt="' + escapeHtml(photo.caption || 'Foto') + '" loading="lazy">' +
          '<div class="photo-card-info"><p>' + escapeHtml(photo.caption || 'Fără descriere') + '</p><button class="btn btn-ghost btn-sm btn-delete-photo" data-photo-id="' + photo.id + '" type="button"><i class="fa-solid fa-trash-can"></i></button></div>' +
          '</div>';
      });
    }
    bodyHtml += '</div>';

    bodyHtml += '<div class="photo-add" style="margin-top:20px;padding-top:20px;border-top:1px solid var(--glass-border);">' +
      '<h4 style="margin-bottom:12px;">Adaugă Fotografie</h4>' +
      '<form id="photoAddForm">' +
      '<div class="form-group"><label for="photo_url">URL Imagine <span class="required">*</span></label><div class="input-wrapper"><input type="url" id="photo_url" name="url" placeholder="https://..." required maxlength="2000"></div></div>' +
      '<div class="form-group"><label for="photo_caption">Descriere</label><div class="input-wrapper"><input type="text" id="photo_caption" name="caption" maxlength="500"></div></div>' +
      '<div class="form-group"><label for="photo_sort">Ordine</label><div class="input-wrapper"><input type="number" id="photo_sort" name="sort_order" value="0" min="0"></div></div>' +
      '<button class="btn btn-primary btn-sm" type="submit"><i class="fa-solid fa-plus"></i> Adaugă Fotografia</button></form></div>';

    var modal = createModal('Galerie Foto — ' + escapeHtml(event.title), bodyHtml, null, { size: 'large' });
    modal.open();

    var photoForm = modal.getElement('#photoAddForm');
    if (photoForm) {
      photoForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fd = new FormData(photoForm);
        var data = { url: fd.get('url') || '', caption: fd.get('caption') || '', sort_order: parseInt(fd.get('sort_order'), 10) || 0 };
        if (!data.url.trim()) { showToast('error', 'URL-ul imaginii este obligatoriu.'); return; }
        try {
          await apiPost(API_BASE + '/events/' + eventId + '/photos', data);
          showToast('success', 'Fotografia a fost adăugată.');
          modal.destroy();
          openPhotosModal(eventId);
        } catch (err) { showToast('error', err.message || 'Eroare la adăugarea fotografiei.'); }
      });
    }

    modal.modalEl.querySelectorAll('.btn-delete-photo').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var photoId = parseInt(this.getAttribute('data-photo-id'), 10);
        if (!confirm('Ești sigur că vrei să ștergi această fotografie?')) return;
        try {
          await apiDelete(API_BASE + '/events/' + eventId + '/photos/' + photoId);
          showToast('success', 'Fotografia a fost ștearsă.');
          modal.destroy();
          openPhotosModal(eventId);
        } catch (err) { showToast('error', err.message || 'Eroare la ștergerea fotografiei.'); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: PROGRAM ===
  // ---------------------------------------------------------------------------

  async function loadSchedule() {
    try {
      var schedule = await apiGet(API_BASE + '/schedule');
      renderSchedule(schedule);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-a putut încărca programul.', loadSchedule); }
  }

  function renderSchedule(schedule) {
    var activeCount = schedule.filter(function (s) { return s.active === 1; }).length;
    var html = renderSectionHeader('Program Săptămânal', activeCount + ' sloturi active — Total: ' + schedule.length, 'Adaugă Slot', 'fa-plus', openScheduleModal);

    if (schedule.length === 0) {
      html += renderEmptyState('Nu există sloturi în program.', 'fa-clock');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Zi</th><th>Interval</th><th>Categorie</th><th>Gen</th><th>Status</th><th>Acțiuni</th></tr></thead><tbody>';

      schedule.forEach(function (slot) {
        html += '<tr data-entity="schedule" data-id="' + slot.id + '">' +
          '<td><strong>' + escapeHtml(slot.day) + '</strong></td>' +
          '<td>' + escapeHtml(slot.start_time) + ' – ' + escapeHtml(slot.end_time) + '</td>' +
          '<td>' + escapeHtml(slot.category) + '</td><td>' + escapeHtml(slot.gender) + '</td>' +
          '<td>' + renderToggleSwitch('schedule', slot.id, slot.active) + ' ' + renderBadge(slot.active) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-edit" data-edit="schedule" data-id="' + slot.id + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="schedule" data-id="' + slot.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindToggles('schedule');
    bindEdits('schedule', openScheduleModal);
    bindDeletes('schedule', loadSchedule);
  }

  function openScheduleModal(slotData) {
    var isEdit = !!slotData;
    var title = isEdit ? 'Editează Slot Program' : 'Adaugă Slot Program';
    var slot = slotData || {};

    var dayOptions = WEEK_DAYS.map(function (d) { var sel = slot.day === d ? ' selected' : ''; return '<option value="' + d + '"' + sel + '>' + d + '</option>'; }).join('');

    var bodyHtml = '<form class="admin-form" id="scheduleForm" novalidate>' +
      '<input type="hidden" name="id" value="' + (slot.id || '') + '">' +
      '<div class="form-group"><label for="sched_day">Zi <span class="required">*</span></label><div class="input-wrapper"><select id="sched_day" name="day" required>' + dayOptions + '</select></div></div>' +
      '<div class="form-group"><label for="sched_start">Ora Început <span class="required">*</span></label><div class="input-wrapper"><input type="time" id="sched_start" name="start_time" value="' + escapeHtml(slot.start_time || '') + '" required></div></div>' +
      '<div class="form-group"><label for="sched_end">Ora Sfârșit <span class="required">*</span></label><div class="input-wrapper"><input type="time" id="sched_end" name="end_time" value="' + escapeHtml(slot.end_time || '') + '" required></div></div>' +
      '<div class="form-group"><label for="sched_category">Categorie <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="sched_category" name="category" value="' + escapeHtml(slot.category || '') + '" maxlength="200" required></div></div>' +
      '<div class="form-group"><label for="sched_gender">Gen</label><div class="input-wrapper"><select id="sched_gender" name="gender">' +
      '<option value="Masculin"' + (slot.gender === 'Masculin' ? ' selected' : '') + '>Masculin</option>' +
      '<option value="Feminin"' + (slot.gender === 'Feminin' ? ' selected' : '') + '>Feminin</option>' +
      '<option value="Mixt"' + (slot.gender === 'Mixt' || !slot.gender ? ' selected' : '') + '>Mixt</option>' +
      '</select></div></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="active" value="1"' + (slot.active !== 0 ? ' checked' : '') + '> Activ</label></div>' +
      '</form>';

    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="scheduleSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Actualizează' : 'Adaugă') + '</button>';

    var modal = createModal(title, bodyHtml, footerHtml, { size: 'small' });
    modal.open();

    var saveBtn = modal.getElement('#scheduleSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var form = modal.getElement('#scheduleForm');
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (value, key) { data[key] = value; });

        var rules = {
          day: [{ validator: 'required', label: 'Ziua' }],
          start_time: [{ validator: 'required', label: 'Ora de început' }],
          end_time: [{ validator: 'required', label: 'Ora de sfârșit' }],
          category: [{ validator: 'required', label: 'Categoria' }, { validator: 'minLength', label: 'Categoria', param: 2 }],
        };
        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        data.active = data.active === '1';

        try {
          if (isEdit) { await apiPut(API_BASE + '/schedule/' + slot.id, data); showToast('success', 'Slotul a fost actualizat.'); }
          else { await apiPost(API_BASE + '/schedule', data); showToast('success', 'Slotul a fost adăugat.'); }
          modal.destroy();
          loadSchedule();
        } catch (err) { showToast('error', err.message || 'Eroare la salvarea slotului.'); }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: ABONAMENTE ===
  // ---------------------------------------------------------------------------

  async function loadSubscriptions() {
    try {
      var subscriptions = await apiGet(API_BASE + '/subscriptions');
      renderSubscriptions(subscriptions);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca abonamentele.', loadSubscriptions); }
  }

  function renderSubscriptions(subscriptions) {
    var activeCount = subscriptions.filter(function (s) { return s.active === 1; }).length;
    var html = renderSectionHeader('Abonamente', activeCount + ' active — Total: ' + subscriptions.length, 'Adaugă Abonament', 'fa-plus', openSubscriptionModal);

    if (subscriptions.length === 0) {
      html += renderEmptyState('Nu există abonamente.', 'fa-ticket');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Nume</th><th>Preț Lunar</th><th>Preț Anual</th><th>Highlighted</th><th>Status</th><th>Acțiuni</th></tr></thead><tbody>';

      subscriptions.forEach(function (sub) {
        html += '<tr data-entity="subscription" data-id="' + sub.id + '">' +
          '<td><strong>' + escapeHtml(sub.name) + '</strong></td>' +
          '<td>' + formatPrice(sub.monthly_price) + '</td><td>' + formatPrice(sub.yearly_price) + '</td>' +
          '<td>' + (sub.highlighted ? '<span class="badge badge--gold">Recomandat</span>' : '—') + '</td>' +
          '<td>' + renderToggleSwitch('subscription', sub.id, sub.active) + ' ' + renderBadge(sub.active) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-edit" data-edit="subscription" data-id="' + sub.id + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="subscription" data-id="' + sub.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindToggles('subscription');
    bindEdits('subscription', openSubscriptionModal);
    bindDeletes('subscription', loadSubscriptions);
  }

  function openSubscriptionModal(subData) {
    var isEdit = !!subData;
    var title = isEdit ? 'Editează Abonament' : 'Adaugă Abonament';
    var sub = subData || {};
    var benefitsStr = '';
    try { benefitsStr = sub.benefits ? (typeof sub.benefits === 'string' ? sub.benefits : JSON.stringify(sub.benefits)) : '[]'; } catch (_) { benefitsStr = '[]'; }

    var bodyHtml = '<form class="admin-form" id="subscriptionForm" novalidate>' +
      '<input type="hidden" name="id" value="' + (sub.id || '') + '">' +
      '<div class="form-group"><label for="sub_name">Nume <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="sub_name" name="name" value="' + escapeHtml(sub.name || '') + '" maxlength="200" required></div><div class="field-error" data-error-for="name"></div></div>' +
      '<div class="form-group"><label for="sub_monthly_price">Preț Lunar (RON) <span class="required">*</span></label><div class="input-wrapper"><input type="number" id="sub_monthly_price" name="monthly_price" value="' + (sub.monthly_price || 0) + '" min="0" step="0.01" required></div></div>' +
      '<div class="form-group"><label for="sub_yearly_price">Preț Anual (RON) <span class="required">*</span></label><div class="input-wrapper"><input type="number" id="sub_yearly_price" name="yearly_price" value="' + (sub.yearly_price || 0) + '" min="0" step="0.01" required></div></div>' +
      '<div class="form-group"><label for="sub_benefits">Beneficii (JSON array)</label><div class="input-wrapper"><textarea id="sub_benefits" name="benefits" rows="4" maxlength="5000">' + escapeHtml(benefitsStr) + '</textarea></div><small style="color:var(--text-muted);">Ex: ["Acces nelimitat", "Echipament inclus", "..." ]</small></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="highlighted" value="1"' + (sub.highlighted ? ' checked' : '') + '> Recomandat (highlighted)</label></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="active" value="1"' + (sub.active !== 0 ? ' checked' : '') + '> Activ</label></div>' +
      '</form>';

    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="subscriptionSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Actualizează' : 'Adaugă') + '</button>';

    var modal = createModal(title, bodyHtml, footerHtml, { size: 'medium' });
    modal.open();

    var saveBtn = modal.getElement('#subscriptionSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var form = modal.getElement('#subscriptionForm');
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (value, key) { data[key] = value; });

        var rules = { name: [{ validator: 'required', label: 'Numele' }, { validator: 'minLength', label: 'Numele', param: 2 }] };
        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        data.monthly_price = parseFloat(data.monthly_price) || 0;
        data.yearly_price = parseFloat(data.yearly_price) || 0;
        data.highlighted = data.highlighted === '1';
        data.active = data.active === '1';
        try { data.benefits = JSON.parse(data.benefits); } catch (_) { data.benefits = []; }

        try {
          if (isEdit) { await apiPut(API_BASE + '/subscriptions/' + sub.id, data); showToast('success', 'Abonamentul a fost actualizat.'); }
          else { await apiPost(API_BASE + '/subscriptions', data); showToast('success', 'Abonamentul a fost adăugat.'); }
          modal.destroy();
          loadSubscriptions();
        } catch (err) { showToast('error', err.message || 'Eroare la salvarea abonamentului.'); }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: PRODUSE ===
  // ---------------------------------------------------------------------------

  async function loadProducts() {
    try {
      var products = await apiGet(API_BASE + '/products');
      renderProducts(products);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca produsele.', loadProducts); }
  }

  function renderProducts(products) {
    var activeCount = products.filter(function (p) { return p.active === 1; }).length;
    var html = renderSectionHeader('Produse', activeCount + ' active — Total: ' + products.length, 'Adaugă Produs', 'fa-plus', openProductModal);

    if (products.length === 0) {
      html += renderEmptyState('Nu există produse. Adaugă primul produs.', 'fa-box-open');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Imagine</th><th>Nume</th><th>Preț</th><th>Stoc</th><th>Categorie</th><th>Status</th><th>Acțiuni</th></tr></thead><tbody>';

      products.forEach(function (product) {
        html += '<tr data-entity="product" data-id="' + product.id + '">' +
          '<td><div class="table-img">' + (product.image ? '<img src="' + escapeHtml(product.image) + '" alt="' + escapeHtml(product.name) + '" loading="lazy">' : '<div class="table-img-placeholder"><i class="fa-solid fa-box"></i></div>') + '</div></td>' +
          '<td><strong>' + escapeHtml(product.name) + '</strong></td>' +
          '<td>' + formatPrice(product.price) + '</td><td>' + product.stock + '</td><td>' + escapeHtml(product.category) + '</td>' +
          '<td>' + renderToggleSwitch('product', product.id, product.active) + ' ' + renderBadge(product.active) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-edit" data-edit="product" data-id="' + product.id + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="product" data-id="' + product.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindToggles('product');
    bindEdits('product', openProductModal);
    bindDeletes('product', loadProducts);
  }

  function openProductModal(productData) {
    var isEdit = !!productData;
    var title = isEdit ? 'Editează Produs' : 'Adaugă Produs';
    var product = productData || {};

    var categoryOptions = PRODUCT_CATEGORIES.map(function (cat) { var sel = product.category === cat ? ' selected' : ''; return '<option value="' + cat + '"' + sel + '>' + cat + '</option>'; }).join('');

    var bodyHtml = '<form class="admin-form" id="productForm" novalidate>' +
      '<input type="hidden" name="id" value="' + (product.id || '') + '">' +
      '<div class="form-group"><label for="prod_name">Nume <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="prod_name" name="name" value="' + escapeHtml(product.name || '') + '" maxlength="300" required></div><div class="field-error" data-error-for="name"></div></div>' +
      '<div class="form-group"><label for="prod_description">Descriere</label><div class="input-wrapper"><textarea id="prod_description" name="description" rows="3" maxlength="5000">' + escapeHtml(product.description || '') + '</textarea></div></div>' +
      '<div class="form-group"><label for="prod_price">Preț (RON) <span class="required">*</span></label><div class="input-wrapper"><input type="number" id="prod_price" name="price" value="' + (product.price || 0) + '" min="0" step="0.01" required></div></div>' +
      '<div class="form-group"><label for="prod_old_price">Preț Vechi (RON)</label><div class="input-wrapper"><input type="number" id="prod_old_price" name="old_price" value="' + (product.old_price || '') + '" min="0" step="0.01"></div></div>' +
      '<div class="form-group"><label for="prod_discount_label">Etichetă Reducere</label><div class="input-wrapper"><input type="text" id="prod_discount_label" name="discount_label" value="' + escapeHtml(product.discount_label || '') + '" maxlength="100" placeholder="Ex: -20%"></div></div>' +
      '<div class="form-group"><label for="prod_contextual_label">Etichetă Contextuală</label><div class="input-wrapper"><input type="text" id="prod_contextual_label" name="contextual_label" value="' + escapeHtml(product.contextual_label || '') + '" maxlength="100" placeholder="Ex: Nou"></div></div>' +
      '<div class="form-group"><label for="prod_category">Categorie <span class="required">*</span></label><div class="input-wrapper"><select id="prod_category" name="category" required>' + categoryOptions + '</select></div></div>' +
      '<div class="form-group"><label for="prod_stock">Stoc <span class="required">*</span></label><div class="input-wrapper"><input type="number" id="prod_stock" name="stock" value="' + (product.stock || 0) + '" min="0" required></div></div>' +
      '<div class="form-group"><label>Imagine</label><div id="productImageUploader"></div></div>' +
      '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="active" value="1"' + (product.active !== 0 ? ' checked' : '') + '> Activ</label></div>' +
      '</form>';

    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="productSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Actualizează' : 'Adaugă') + '</button>';

    var modal = createModal(title, bodyHtml, footerHtml, { size: 'medium' });
    modal.open();

    var uploader = createImageUploader('#productImageUploader', product.image || '', null);

    var saveBtn = modal.getElement('#productSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var form = modal.getElement('#productForm');
        var formData = new FormData(form);
        var data = {};
        formData.forEach(function (value, key) { data[key] = value; });

        var rules = {
          name: [{ validator: 'required', label: 'Numele' }, { validator: 'minLength', label: 'Numele', param: 2 }],
          price: [{ validator: 'positiveNum', label: 'Prețul' }],
          stock: [{ validator: 'integer', label: 'Stocul' }],
          category: [{ validator: 'required', label: 'Categoria' }],
        };
        var validation = validateForm(form, rules);
        if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

        var imageUrl = processImageForSave(uploader);
        data.image = imageUrl || product.image || '';
        data.price = parseFloat(data.price) || 0;
        data.old_price = data.old_price ? parseFloat(data.old_price) : null;
        data.stock = parseInt(data.stock, 10) || 0;
        data.active = data.active === '1';

        try {
          if (isEdit) { await apiPut(API_BASE + '/products/' + product.id, data); showToast('success', 'Produsul a fost actualizat.'); }
          else { await apiPost(API_BASE + '/products', data); showToast('success', 'Produsul a fost adăugat.'); }
          modal.destroy();
          loadProducts();
        } catch (err) { showToast('error', err.message || 'Eroare la salvarea produsului.'); }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: COMENZI ===
  // ---------------------------------------------------------------------------

  async function loadOrders() {
    try {
      var orders = await apiGet(API_BASE + '/orders');
      renderOrders(orders);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca comenzile.', loadOrders); }
  }

  function renderOrders(orders) {
    var pendingCount = orders.filter(function (o) { return o.status === 'pending'; }).length;
    var totalRevenue = orders.reduce(function (sum, o) { return sum + (o.total || 0); }, 0);
    var html = renderSectionHeader('Comenzi', pendingCount + ' în așteptare — Venit total: ' + formatPrice(totalRevenue));

    if (orders.length === 0) {
      html += renderEmptyState('Nu există comenzi.', 'fa-receipt');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>ID</th><th>Client</th><th>Email</th><th>Total</th><th>Status</th><th>Data</th><th>Acțiuni</th></tr></thead><tbody>';

      orders.forEach(function (order) {
        html += '<tr data-entity="order" data-id="' + order.id + '">' +
          '<td>#' + order.id + '</td>' +
          '<td><strong>' + escapeHtml(order.customer_name) + '</strong></td>' +
          '<td>' + escapeHtml(order.customer_email) + '</td>' +
          '<td>' + formatPrice(order.total) + '</td>' +
          '<td>' + renderStatusBadge(order.status) + '</td>' +
          '<td>' + formatDateTime(order.created_at) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-view-order" data-view-order="' + order.id + '" title="Detalii" type="button"><i class="fa-solid fa-eye"></i></button><button class="btn btn-ghost btn-sm btn-status-order" data-status-order="' + order.id + '" title="Schimbă Status" type="button"><i class="fa-solid fa-arrow-progress"></i></button><button class="btn btn-ghost btn-sm btn-delete" data-delete="order" data-id="' + order.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindDeletes('order', loadOrders);
    bindViewOrders();
    bindStatusOrders();
  }

  function bindViewOrders() {
    var btns = document.querySelectorAll('.btn-view-order');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var orderId = parseInt(this.getAttribute('data-view-order'), 10);
        try {
          var order = await apiGet(API_BASE + '/orders/' + orderId);
          showOrderDetails(order);
        } catch (err) { showToast('error', err.message || 'Eroare la încărcarea detaliilor.'); }
      });
    });
  }

  function showOrderDetails(order) {
    var items = [];
    try { items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []); } catch (_) { items = []; }

    var itemsHtml = items.map(function (item) {
      return '<div class="order-item-row"><span>' + escapeHtml(item.name) + ' x ' + item.quantity + '</span><span>' + formatPrice((item.price || 0) * (item.quantity || 1)) + '</span></div>';
    }).join('');

    var bodyHtml = '<div class="order-details">' +
      '<div class="order-detail-row"><strong>Client:</strong> ' + escapeHtml(order.customer_name) + '</div>' +
      '<div class="order-detail-row"><strong>Email:</strong> ' + escapeHtml(order.customer_email) + '</div>' +
      '<div class="order-detail-row"><strong>Telefon:</strong> ' + escapeHtml(order.customer_phone || '—') + '</div>' +
      '<div class="order-detail-row"><strong>Status:</strong> ' + renderStatusBadge(order.status) + '</div>' +
      '<div class="order-detail-row"><strong>Data:</strong> ' + formatDateTime(order.created_at) + '</div>' +
      '<div class="order-detail-row"><strong>Total:</strong> ' + formatPrice(order.total) + '</div>' +
      '<hr style="border-color:var(--glass-border);margin:16px 0;"><h4>Produse</h4>' + itemsHtml + '</div>';

    var modal = createModal('Comandă #' + order.id, bodyHtml, null, { size: 'medium' });
    modal.open();
  }

  function bindStatusOrders() {
    var btns = document.querySelectorAll('.btn-status-order');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var orderId = parseInt(this.getAttribute('data-status-order'), 10);
        openStatusModal(orderId);
      });
    });
  }

  function openStatusModal(orderId) {
    var optionsHtml = ORDER_STATUSES.map(function (s) { return '<option value="' + s + '">' + ORDER_STATUS_LABELS[s] + '</option>'; }).join('');

    var bodyHtml = '<form id="orderStatusForm"><div class="form-group"><label for="order_new_status">Status Nou</label><div class="input-wrapper"><select id="order_new_status" name="status">' + optionsHtml + '</select></div></div></form>';
    var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="orderStatusSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> Actualizează</button>';

    var modal = createModal('Schimbă Status Comandă #' + orderId, bodyHtml, footerHtml, { size: 'small' });
    modal.open();

    var saveBtn = modal.getElement('#orderStatusSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', async function () {
        var select = modal.getElement('#order_new_status');
        var status = select ? select.value : 'pending';
        try {
          await apiPatch(API_BASE + '/orders/' + orderId + '/status', { status: status });
          showToast('success', 'Statusul comenzii a fost actualizat.');
          modal.destroy();
          loadOrders();
        } catch (err) { showToast('error', err.message || 'Eroare la actualizarea statusului.'); }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: MESAJE ===
  // ---------------------------------------------------------------------------

  async function loadMessages() {
    try {
      var messages = await apiGet(API_BASE + '/messages');
      renderMessages(messages);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca mesajele.', loadMessages); }
  }

  function renderMessages(messages) {
    var unreadCount = messages.filter(function (m) { return !m.is_read; }).length;
    var html = renderSectionHeader('Mesaje', unreadCount + ' necitite — Total: ' + messages.length);

    if (messages.length === 0) {
      html += renderEmptyState('Nu există mesaje.', 'fa-envelope-open');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Status</th><th>Nume</th><th>Email</th><th>Subiect</th><th>Data</th><th>Acțiuni</th></tr></thead><tbody>';

      messages.forEach(function (msg) {
        var isUnread = !msg.is_read;
        html += '<tr data-entity="message" data-id="' + msg.id + '" class="' + (isUnread ? 'row--unread' : '') + '">' +
          '<td>' + (isUnread ? '<span class="badge badge--unread">Necitit</span>' : '<span class="badge badge--read">Citit</span>') + '</td>' +
          '<td><strong>' + escapeHtml(msg.name) + '</strong></td>' +
          '<td>' + escapeHtml(msg.email) + '</td>' +
          '<td>' + escapeHtml(msg.subject) + '</td>' +
          '<td>' + formatDateTime(msg.created_at) + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-view-message" data-view-message="' + msg.id + '" title="Citește" type="button"><i class="fa-solid fa-eye"></i></button>' + (isUnread ? '<button class="btn btn-ghost btn-sm btn-mark-read" data-mark-read="' + msg.id + '" title="Marchează Citit" type="button"><i class="fa-solid fa-check"></i></button>' : '') + '<button class="btn btn-ghost btn-sm btn-delete" data-delete="message" data-id="' + msg.id + '" title="Șterge" type="button"><i class="fa-solid fa-trash-can"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindDeletes('message', loadMessages);
    bindViewMessages();
    bindMarkRead();
  }

  function bindViewMessages() {
    var btns = document.querySelectorAll('.btn-view-message');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var msgId = parseInt(this.getAttribute('data-view-message'), 10);
        try {
          var msg = await apiGet(API_BASE + '/messages/' + msgId);
          showMessageDetails(msg);
          if (!msg.is_read) { await apiPatch(API_BASE + '/messages/' + msgId + '/read'); }
        } catch (err) { showToast('error', err.message || 'Eroare la încărcarea mesajului.'); }
      });
    });
  }

  function showMessageDetails(msg) {
    var bodyHtml = '<div class="message-details">' +
      '<div class="message-detail-row"><strong>De la:</strong> ' + escapeHtml(msg.name) + ' (' + escapeHtml(msg.email) + ')</div>' +
      '<div class="message-detail-row"><strong>Telefon:</strong> ' + escapeHtml(msg.phone || '—') + '</div>' +
      '<div class="message-detail-row"><strong>Subiect:</strong> ' + escapeHtml(msg.subject) + '</div>' +
      '<div class="message-detail-row"><strong>Data:</strong> ' + formatDateTime(msg.created_at) + '</div>' +
      '<hr style="border-color:var(--glass-border);margin:16px 0;">' +
      '<div class="message-body">' + escapeHtml(msg.message).replace(/\n/g, '<br>') + '</div>' +
      '</div>';

    var footerHtml = (msg.email ? '<a href="mailto:' + escapeHtml(msg.email) + '?subject=Re: ' + encodeURIComponent(msg.subject) + '" class="btn btn-outline btn-sm"><i class="fa-solid fa-reply"></i> Răspunde</a>' : '') +
      '<button class="btn btn-ghost" data-modal-close type="button">Închide</button>';

    var modal = createModal('Mesaj: ' + escapeHtml(msg.subject), bodyHtml, footerHtml, { size: 'medium' });
    modal.open();

    var origClose = modal.close;
    modal.close = function () { origClose.call(modal); loadMessages(); loadBadges(); };
  }

  function bindMarkRead() {
    var btns = document.querySelectorAll('.btn-mark-read');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var msgId = parseInt(this.getAttribute('data-mark-read'), 10);
        try {
          await apiPatch(API_BASE + '/messages/' + msgId + '/read');
          showToast('success', 'Mesajul a fost marcat ca citit.');
          loadMessages();
          loadBadges();
        } catch (err) { showToast('error', err.message || 'Eroare.'); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: REALIZĂRI ===
  // ---------------------------------------------------------------------------

  async function loadAchievements() {
    try {
      var achievements = await apiGet(API_BASE + '/achievements');
      renderAchievements(achievements);
    } catch (err) { mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca realizările.', loadAchievements); }
  }

  function renderAchievements(achievements) {
    var html = renderSectionHeader('Realizări', 'Statistici afișate pe site');

    if (achievements.length === 0) {
      html += renderEmptyState('Nu există realizări configurate.', 'fa-trophy');
    } else {
      html += '<div class="data-table-wrap"><table class="data-table">';
      html += '<thead><tr><th>Cheie</th><th>Etichetă</th><th>Valoare</th><th>Acțiuni</th></tr></thead><tbody>';

      achievements.forEach(function (ach) {
        html += '<tr data-entity="achievement" data-key="' + escapeHtml(ach.key) + '">' +
          '<td><strong>' + escapeHtml(ach.key) + '</strong></td>' +
          '<td>' + escapeHtml(ach.label) + '</td><td>' + ach.value + '</td>' +
          '<td><div class="table-actions"><button class="btn btn-ghost btn-sm btn-edit-achievement" data-edit-achievement="' + escapeHtml(ach.key) + '" title="Editează" type="button"><i class="fa-solid fa-pen-to-square"></i></button></div></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    mainContent.innerHTML = html;
    bindAchievementEdits();
  }

  function bindAchievementEdits() {
    var btns = document.querySelectorAll('.btn-edit-achievement');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = this.getAttribute('data-edit-achievement');
        openAchievementModal(key);
      });
    });
  }

  async function openAchievementModal(key) {
    try {
      var ach = await apiGet(API_BASE + '/achievements');
      var achievement = Array.isArray(ach) ? ach.find(function (a) { return a.key === key; }) || {} : {};

      var bodyHtml = '<form id="achievementForm" novalidate>' +
        '<div class="form-group"><label>Cheie</label><div class="input-wrapper"><input type="text" value="' + escapeHtml(key) + '" disabled></div></div>' +
        '<div class="form-group"><label for="ach_value">Valoare <span class="required">*</span></label><div class="input-wrapper"><input type="number" id="ach_value" name="value" value="' + (achievement.value || 0) + '" min="0" required></div></div>' +
        '<div class="form-group"><label for="ach_label">Etichetă <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="ach_label" name="label" value="' + escapeHtml(achievement.label || '') + '" maxlength="200" required></div></div>' +
        '</form>';

      var footerHtml = '<button class="btn btn-ghost" data-modal-close type="button">Anulează</button><button class="btn btn-primary" id="achievementSaveBtn" type="button"><i class="fa-solid fa-floppy-disk"></i> Salvează</button>';

      var modal = createModal('Editează Realizare', bodyHtml, footerHtml, { size: 'small' });
      modal.open();

      var saveBtn = modal.getElement('#achievementSaveBtn');
      if (saveBtn) {
        saveBtn.addEventListener('click', async function () {
          var form = modal.getElement('#achievementForm');
          var value = parseInt(form.querySelector('[name="value"]').value, 10);
          var label = form.querySelector('[name="label"]').value.trim();

          if (!label) { showToast('error', 'Eticheta este obligatorie.'); return; }

          try {
            await apiPut(API_BASE + '/achievements/' + key, { value: value, label: label });
            showToast('success', 'Realizarea a fost actualizată.');
            modal.destroy();
            loadAchievements();
          } catch (err) { showToast('error', err.message || 'Eroare la actualizarea realizării.'); }
        });
      }
    } catch (err) { showToast('error', err.message || 'Eroare la încărcarea realizării.'); }
  }

  // ---------------------------------------------------------------------------
  // === SECȚIUNEA: SEO (META TAGS, TITLE, DESCRIPTION) ===
  // ---------------------------------------------------------------------------

  /** Inițializează cache-ul SEO cu date de la server */
  function initSeoCache(serverData) {
    var arr = Array.isArray(serverData) ? serverData : [];
    seoDataCache = SEO_PAGES.map(function (page) {
      var existing = null;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].page === page) { existing = arr[i]; break; }
      }
      return existing || { page: page, title: '', description: '', keywords: '', og_image: '' };
    });
  }

  async function loadSEO() {
    try {
      var seo = await apiGet(API_BASE + '/seo');
      initSeoCache(seo);
      renderSEO();
    } catch (err) {
      mainContent.innerHTML = renderErrorState(err.message || 'Nu s-au putut încărca setările SEO.', loadSEO);
    }
  }

  function renderSEO() {
    var html = renderSectionHeader('SEO', 'Meta-informații per pagină — optimizează titlul, descrierea și keywords');

    html += '<div class="seo-layout">';
    html += '<div class="seo-page-list">';
    html += '<h3 class="seo-page-list-title">Pagini</h3>';
    SEO_PAGES.forEach(function (page, idx) {
      var isActive = idx === 0 ? ' active' : '';
      var seoData = seoDataCache[idx];
      html += '<button class="seo-page-item' + isActive + '" data-seo-page="' + page + '" data-seo-index="' + idx + '" type="button">' +
        '<span class="seo-page-icon"><i class="fa-solid ' + getPageIcon(page) + '"></i></span>' +
        '<span class="seo-page-label">' + escapeHtml(SEO_PAGE_LABELS[page] || page) + '</span>' +
        (seoData && seoData.title ? '<span class="seo-page-badge" title="Configurat">●</span>' : '') +
        '</button>';
    });
    html += '</div>';

    html += '<div class="seo-editor-panel" id="seoEditorPanel">';
    var firstPage = seoDataCache[0] || { page: 'home', title: '', description: '', keywords: '', og_image: '' };
    html += renderSeoPageForm(firstPage, 0);
    html += '</div>';
    html += '</div>';

    mainContent.innerHTML = html;

    var pageBtns = document.querySelectorAll('.seo-page-item');
    pageBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var index = parseInt(this.getAttribute('data-seo-index'), 10);
        pageBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        saveCurrentSeoFormToCache();
        var panel = document.getElementById('seoEditorPanel');
        if (panel) {
          panel.innerHTML = renderSeoPageForm(seoDataCache[index], index);
          bindSeoFormEvents(index);
        }
      });
    });

    bindSeoFormEvents(0);
  }

  function renderSeoPageForm(seoData, index) {
    var data = seoData || {};
    var page = data.page || SEO_PAGES[index] || 'home';
    var pageLabel = SEO_PAGE_LABELS[page] || page;

    var html = '<form class="admin-form seo-page-form" id="seoPageForm_' + index + '" data-seo-index="' + index + '" data-seo-page="' + page + '" novalidate>';
    html += '<div class="seo-page-header"><h3 class="seo-page-title"><i class="fa-solid ' + getPageIcon(page) + '"></i> ' + escapeHtml(pageLabel) + '</h3><span class="seo-page-slug">/' + (page === 'home' ? '' : page) + '</span></div>';

    html += '<div class="form-group"><label for="seo_title_' + index + '">Title Tag <span class="required">*</span></label><div class="input-wrapper"><input type="text" id="seo_title_' + index + '" name="title" value="' + escapeHtml(data.title || '') + '" maxlength="70" placeholder="Maxim 60-70 caractere recomandat"></div><div class="seo-char-counter" id="seo_title_counter_' + index + '"><span class="counter-current">' + (data.title ? data.title.length : 0) + '</span>/70</div><div class="field-error" data-error-for="title"></div></div>';

    html += '<div class="form-group"><label for="seo_desc_' + index + '">Meta Description <span class="required">*</span></label><div class="input-wrapper"><textarea id="seo_desc_' + index + '" name="description" rows="3" maxlength="160" placeholder="Maxim 150-160 caractere recomandat">' + escapeHtml(data.description || '') + '</textarea></div><div class="seo-char-counter" id="seo_desc_counter_' + index + '"><span class="counter-current">' + (data.description ? data.description.length : 0) + '</span>/160</div><div class="field-error" data-error-for="description"></div></div>';

    html += '<div class="form-group"><label for="seo_keywords_' + index + '">Meta Keywords</label><div class="input-wrapper"><input type="text" id="seo_keywords_' + index + '" name="keywords" value="' + escapeHtml(data.keywords || '') + '" maxlength="1000" placeholder="cuvânt1, cuvânt2, cuvânt3"></div><small class="field-hint">Separați cuvintele cheie prin virgulă.</small><div class="field-error" data-error-for="keywords"></div></div>';

    html += '<div class="form-group"><label for="seo_og_image_' + index + '">OG Image URL</label><div class="input-wrapper"><input type="url" id="seo_og_image_' + index + '" name="og_image" value="' + escapeHtml(data.og_image || '') + '" maxlength="2000" placeholder="https://..."></div><small class="field-hint">Imaginea afișată la share social (1200×630 px recomandat).</small><div class="field-error" data-error-for="og_image"></div></div>';

    html += '<div class="seo-preview-card"><div class="preview-label">Google Search Preview</div><div class="seo-preview-url">boxing-champions.ro' + (page === 'home' ? '' : '/' + page) + ' ›</div><div class="seo-preview-title" id="seo_preview_title_' + index + '">' + escapeHtml(data.title || SEO_PAGE_LABELS[page] + ' — Boxing Champions') + '</div><div class="seo-preview-desc" id="seo_preview_desc_' + index + '">' + escapeHtml(data.description || '') + '</div></div>';

    html += '<div class="form-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvează ' + escapeHtml(pageLabel) + '</button></div>';
    html += '</form>';

    return html;
  }

  function saveCurrentSeoFormToCache() {
    var activePageBtn = document.querySelector('.seo-page-item.active');
    if (!activePageBtn) return;
    var index = parseInt(activePageBtn.getAttribute('data-seo-index'), 10);
    if (Number.isNaN(index) || index < 0 || index >= seoDataCache.length) return;

    var form = document.getElementById('seoPageForm_' + index);
    if (!form) return;

    var formData = new FormData(form);
    seoDataCache[index] = {
      page: form.getAttribute('data-seo-page') || SEO_PAGES[index],
      title: (formData.get('title') || '').trim(),
      description: (formData.get('description') || '').trim(),
      keywords: (formData.get('keywords') || '').trim(),
      og_image: (formData.get('og_image') || '').trim(),
    };
  }

  function bindSeoFormEvents(index) {
    var form = document.getElementById('seoPageForm_' + index);
    if (!form) return;

    var titleInput = document.getElementById('seo_title_' + index);
    var titleCounter = document.getElementById('seo_title_counter_' + index);
    var descInput = document.getElementById('seo_desc_' + index);
    var descCounter = document.getElementById('seo_desc_counter_' + index);
    var previewTitle = document.getElementById('seo_preview_title_' + index);
    var previewDesc = document.getElementById('seo_preview_desc_' + index);

    if (titleInput && titleCounter && previewTitle) {
      titleInput.addEventListener('input', function () {
        var len = this.value.length;
        titleCounter.querySelector('.counter-current').textContent = len;
        titleCounter.className = 'seo-char-counter' + (len > 60 ? ' warn' : '') + (len > 70 ? ' danger' : '');
        previewTitle.textContent = this.value || (SEO_PAGE_LABELS[SEO_PAGES[index]] + ' — Boxing Champions');
      });
    }

    if (descInput && descCounter && previewDesc) {
      descInput.addEventListener('input', function () {
        var len = this.value.length;
        descCounter.querySelector('.counter-current').textContent = len;
        descCounter.className = 'seo-char-counter' + (len > 150 ? ' warn' : '') + (len > 160 ? ' danger' : '');
        previewDesc.textContent = this.value || '';
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      saveCurrentSeoFormToCache();

      var rules = {
        title: [{ validator: 'required', label: 'Title tag' }, { validator: 'maxLength', label: 'Title tag', param: 70 }],
        description: [{ validator: 'required', label: 'Meta description' }, { validator: 'maxLength', label: 'Meta description', param: 160 }],
        keywords: [{ validator: 'maxLength', label: 'Keywords', param: 1000 }],
        og_image: [{ validator: 'maxLength', label: 'OG Image URL', param: 2000 }],
      };

      var validation = validateForm(form, rules);
      if (!validation.valid) { displayFormErrors(form, validation.errors); return; }

      var payload = seoDataCache.map(function (item) {
        return {
          page: item.page,
          title: item.title || '',
          description: item.description || '',
          keywords: item.keywords || '',
          og_image: item.og_image || '',
        };
      });

      try {
        await apiPut(API_BASE + '/seo', payload);
        showToast('success', 'Setările SEO au fost salvate cu succes.');
      } catch (err) {
        showToast('error', err.message || 'Eroare la salvarea setărilor SEO.');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // BINDING-URI GENERICE PENTRU TABELE
  // ---------------------------------------------------------------------------

  function bindToggles(entityType) {
    var toggles = document.querySelectorAll('.toggle-input[data-entity="' + entityType + '"]');
    toggles.forEach(function (toggle) {
      toggle.addEventListener('change', async function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        var newState = this.checked;
        try {
          var url = API_BASE + '/' + entityType + 's/' + id + '/toggle';
          await apiPatch(url);
          showToast('success', 'Starea a fost actualizată.');
          switch (entityType) {
            case 'coach': loadCoaches(); break;
            case 'event': loadEvents(); break;
            case 'schedule': loadSchedule(); break;
            case 'subscription': loadSubscriptions(); break;
            case 'product': loadProducts(); break;
          }
        } catch (err) { showToast('error', err.message || 'Eroare la comutarea stării.'); this.checked = !newState; }
      });
    });
  }

  function bindEdits(entityType, modalFn) {
    var btns = document.querySelectorAll('.btn-edit[data-edit="' + entityType + '"]');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        try {
          var url = API_BASE + '/' + entityType + 's/' + id;
          var data = await apiGet(url);
          modalFn(data);
        } catch (err) { showToast('error', err.message || 'Eroare la încărcarea datelor.'); }
      });
    });
  }

  function bindDeletes(entityType, reloadFn) {
    var btns = document.querySelectorAll('.btn-delete[data-delete="' + entityType + '"]');
    btns.forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = parseInt(this.getAttribute('data-id'), 10);
        if (!confirm('Ești sigur că vrei să ștergi acest element? Acțiunea este ireversibilă.')) return;
        try {
          var url = API_BASE + '/' + entityType + 's/' + id;
          await apiDelete(url);
          showToast('success', 'Elementul a fost șters.');
          reloadFn();
        } catch (err) { showToast('error', err.message || 'Eroare la ștergere.'); }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // BADGE-URI SIDEBAR
  // ---------------------------------------------------------------------------

  async function loadBadges() {
    try {
      var messages = await apiGet(API_BASE + '/messages');
      var unreadCount = messages.filter(function (m) { return !m.is_read; }).length;
      if (badgeMessages) { badgeMessages.textContent = unreadCount; badgeMessages.style.display = unreadCount > 0 ? 'flex' : 'none'; }

      var orders = await apiGet(API_BASE + '/orders');
      var pendingCount = orders.filter(function (o) { return o.status === 'pending'; }).length;
      if (badgeOrders) { badgeOrders.textContent = pendingCount; badgeOrders.style.display = pendingCount > 0 ? 'flex' : 'none'; }
    } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // INIT: LOGICĂ UI DIN DASHBOARD (mutată din inline-script pentru CSP nonce)
  // ---------------------------------------------------------------------------

  function initDashboardUI() {
    var hamburger   = document.getElementById('hamburgerMenu');
    var sidebarEl   = document.getElementById('adminSidebar');
    var overlay     = document.getElementById('sidebarOverlay');
    var btnRefresh  = document.getElementById('btnRefresh');
    var pageTitle   = document.getElementById('pageTitle');
    var globalSearch = document.getElementById('globalSearch');

    var sectionTitles = {
      settings: 'Setări Generale', coaches: 'Antrenori', events: 'Evenimente',
      schedule: 'Program Săptămânal', subscriptions: 'Abonamente', products: 'Produse',
      orders: 'Comenzi', messages: 'Mesaje', achievements: 'Realizări', seo: 'SEO',
    };

    if (hamburger && sidebarEl && overlay) {
      hamburger.addEventListener('click', function () {
        var isOpen = sidebarEl.classList.contains('mobile-open');
        if (isOpen) {
          sidebarEl.classList.remove('mobile-open');
          overlay.classList.remove('active');
          overlay.setAttribute('aria-hidden', 'true');
          document.body.style.overflow = '';
        } else {
          sidebarEl.classList.add('mobile-open');
          overlay.classList.add('active');
          overlay.setAttribute('aria-hidden', 'false');
          document.body.style.overflow = 'hidden';
        }
      });
      overlay.addEventListener('click', function () {
        sidebarEl.classList.remove('mobile-open');
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
      });
    }

    if (mainContent && pageTitle) {
      var observer = new MutationObserver(function () {
        var activeNav = document.querySelector('.sidebar-nav-item.active');
        if (activeNav) {
          var section = activeNav.getAttribute('data-section');
          if (section && sectionTitles[section]) pageTitle.textContent = sectionTitles[section];
        }
      });
      observer.observe(mainContent, { childList: true, subtree: false });
    }

    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        var activeNav = document.querySelector('.sidebar-nav-item.active');
        if (activeNav) activeNav.click();
      });
    }

    if (globalSearch) {
      globalSearch.addEventListener('input', function () {
        var query = this.value.trim().toLowerCase();
        var rows = document.querySelectorAll('.data-table tbody tr');
        rows.forEach(function (row) {
          if (!query) { row.style.display = ''; return; }
          var text = row.textContent.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebarEl && sidebarEl.classList.contains('mobile-open')) {
        sidebarEl.classList.remove('mobile-open');
        if (overlay) { overlay.classList.remove('active'); overlay.setAttribute('aria-hidden', 'true'); }
        document.body.style.overflow = '';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

  function init() {
    sidebar = document.querySelector('.sidebar');
    mainContent = document.querySelector('.main-content');
    badgeMessages = document.getElementById('badge-messages');
    badgeOrders = document.getElementById('badge-orders');

    initDashboardUI();

    checkSession().then(function (ok) {
      if (!ok) return;
      startSessionCheck();

      var navItems = document.querySelectorAll('.sidebar-nav-item');
      navItems.forEach(function (item) {
        item.addEventListener('click', function (e) {
          e.preventDefault();
          var section = this.getAttribute('data-section');
          if (section) switchSection(section);
        });
      });

      var logoutBtn = document.getElementById('btnLogout');
      if (logoutBtn) { logoutBtn.addEventListener('click', function (e) { e.preventDefault(); logout(); }); }

      loadBadges();

      var initialSection = document.querySelector('.sidebar-nav-item.active');
      if (initialSection) {
        var section = initialSection.getAttribute('data-section');
        if (section) switchSection(section);
      } else {
        switchSection('settings');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AdminDashboard = {
    switchSection: switchSection,
    loadCoaches: loadCoaches,
    loadEvents: loadEvents,
    loadSchedule: loadSchedule,
    loadSubscriptions: loadSubscriptions,
    loadProducts: loadProducts,
    loadOrders: loadOrders,
    loadMessages: loadMessages,
    loadAchievements: loadAchievements,
    loadSEO: loadSEO,
    loadBadges: loadBadges,
    logout: logout,
    showToast: showToast,
  };

})();