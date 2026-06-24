/**
 * ===========================================================================
 *  admin.js — Boxing Champions Admin Dashboard
 *  ===========================================================================
 *  Features:
 *    1. Auth check + logout
 *    2. Sidebar navigation + mobile toggle
 *    3. Dashboard stats (counts, revenue, recent orders)
 *    4. CRUD complet pentru: Coaches, Events, Products, Plans, Schedule, Orders, Contact
 *    5. Settings management
 *    6. Toast notifications
 *    7. Modal forms (create/edit)
 *    8. Toggle switches (is_active, is_published, is_popular, is_read)
 *    9. Search, sort, paginate
 *   10. Delete confirmations
 *   11. Responsive sidebar
 *  ===========================================================================
 */

(function () {
  'use strict';

  /* ========================================================================
     DOM Ready
     ======================================================================== */
  function domReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  /* ========================================================================
     CONSTANTS
     ======================================================================== */
  var API = {
    AUTH_CHECK: '/api/auth/check',
    AUTH_LOGOUT: '/api/auth/logout',
    COACHES: '/api/coaches',
    EVENTS: '/api/events',
    PRODUCTS: '/api/products',
    PLANS: '/api/plans',
    SCHEDULE: '/api/schedule',
    ORDERS: '/api/orders',
    CONTACT: '/api/contact',
    SETTINGS: '/api/settings',
  };

  var SECTIONS = [
    'dashboard', 'coaches', 'events', 'products',
    'plans', 'schedule', 'orders', 'contact', 'settings',
  ];

  var STATUS_LABELS = {
    pending:    { ro: 'În așteptare',  cls: 'badge--warning' },
    confirmed:  { ro: 'Confirmată',    cls: 'badge--info' },
    processing: { ro: 'În procesare',  cls: 'badge--info' },
    completed:  { ro: 'Finalizată',    cls: 'badge--success' },
    cancelled:  { ro: 'Anulată',       cls: 'badge--danger' },
    refunded:   { ro: 'Rambursată',    cls: 'badge--neutral' },
  };

  var DAY_NAMES_RO = [
    'Duminică', 'Luni', 'Marți', 'Miercuri',
    'Joi', 'Vineri', 'Sâmbătă',
  ];

  var CATEGORY_LABELS = {
    'general': 'Generale', 'gloves': 'Mănuși', 'headgear': 'Căști',
    'footwear': 'Încălțăminte', 'apparel': 'Îmbrăcăminte',
    'protection': 'Protecție', 'accessories': 'Accesorii', 'equipment': 'Echipament',
  };

  var EVENT_TYPES = ['competition', 'seminar', 'workshop', 'general'];

  var PRODUCT_CATEGORIES = [
    'general', 'gloves', 'headgear', 'footwear',
    'apparel', 'protection', 'accessories', 'equipment',
  ];

  /* ========================================================================
     STATE
     ======================================================================== */
  var state = {
    user: null,
    authenticated: false,
    currentSection: 'dashboard',
    sidebarOpen: false,
    coaches: { data: [], pagination: null, page: 1, limit: 12, sort: '', search: '' },
    events: { data: [], pagination: null, page: 1, limit: 12, sort: '', search: '' },
    products: { data: [], pagination: null, page: 1, limit: 12, sort: '', search: '' },
    plans: { data: [], pagination: null, page: 1, limit: 12, sort: '', search: '' },
    schedule: { data: [], grouped: {} },
    orders: { data: [], pagination: null, page: 1, limit: 20, sort: '', search: '' },
    contact: { data: [], pagination: null, page: 1, limit: 20, sort: '', search: '' },
    settings: {},
    stats: {},
    editingId: null,
    deletingId: null,
    deletingType: null,
    searchTimer: null,
  };

  /* ========================================================================
     HELPERS
     ======================================================================== */

  function escapeHTML(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function formatPrice(val) {
    var n = Number(val);
    if (isNaN(n)) return '0';
    return n.toLocaleString('ro-RO');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleDateString('ro-RO', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (e) { return dateStr; }
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleDateString('ro-RO', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) { return dateStr; }
  }

  function slugify(str) {
    if (!str) return '';
    return str
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100);
  }

  /* ========================================================================
     TOAST
     ======================================================================== */
  function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3500;
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }
    var icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-xmark',
      info: 'fa-circle-info',
      warning: 'fa-triangle-exclamation',
    };
    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<i class="fa-solid ' + (icons[type] || icons.info) + '" aria-hidden="true"></i> ' +
      escapeHTML(message) +
      '<button class="toast__close" aria-label="Închide"><i class="fa-solid fa-xmark"></i></button>';
    container.appendChild(toast);
    var closeBtn = toast.querySelector('.toast__close');
    if (closeBtn) { closeBtn.addEventListener('click', function () { removeToast(toast); }); }
    var timer = setTimeout(function () { removeToast(toast); }, duration);
    toast._timer = timer;
  }

  function removeToast(toast) {
    if (!toast || toast._removing) return;
    toast._removing = true;
    clearTimeout(toast._timer);
    toast.classList.add('toast--removing');
    toast.addEventListener('transitionend', function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 350);
  }

  /* ========================================================================
     FETCH
     ======================================================================== */
  async function apiFetch(url, options) {
    options = options || {};
    var headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    var fetchOpts = {
      method: options.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
    };
    if (options.body) {
      fetchOpts.body = (options.body instanceof FormData) ? options.body : JSON.stringify(options.body);
    }
    var res = await fetch(url, fetchOpts);
    var data;
    var contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      var text = await res.text();
      try { data = JSON.parse(text); } catch (_) { data = { _raw: text }; }
    }
    if (!res.ok) {
      var err = new Error(data && data.error ? data.error : 'HTTP ' + res.status);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ========================================================================
     AUTH
     ======================================================================== */
  async function checkAuth() {
    try {
      var data = await apiFetch(API.AUTH_CHECK);
      if (data.authenticated && data.user && data.user.role === 'admin') {
        state.authenticated = true;
        state.user = data.user;
        updateUserUI();
        return true;
      }
    } catch (e) { console.error('[admin] Auth check failed:', e.message); }
    state.authenticated = false;
    state.user = null;
    redirectToLogin();
    return false;
  }

  function redirectToLogin() {
    if (window.location.pathname.indexOf('login.html') === -1) {
      window.location.href = '/admin/views/login.html';
    }
  }

  async function doLogout() {
    try { await apiFetch(API.AUTH_LOGOUT, { method: 'POST' }); } catch (e) { /* ignore */ }
    showToast('Te-ai deconectat cu succes.', 'info', 2000);
    setTimeout(function () { redirectToLogin(); }, 800);
  }

  function updateUserUI() {
    var nameEl = document.getElementById('sidebar-user-name');
    var roleEl = document.getElementById('sidebar-user-role');
    var avatarEl = document.getElementById('sidebar-user-avatar');
    if (nameEl && state.user) nameEl.textContent = state.user.name || state.user.email;
    if (roleEl) roleEl.textContent = 'Admin';
    if (avatarEl && state.user) {
      var initials = (state.user.name || state.user.email || 'A')
        .split(' ').map(function (s) { return s.charAt(0).toUpperCase(); }).join('').substring(0, 2);
      avatarEl.textContent = initials;
    }
  }

  /* ========================================================================
     SIDEBAR
     ======================================================================== */
  function initSidebar() {
    var toggle = document.getElementById('sidebar-toggle');
    var sidebar = document.getElementById('admin-sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (toggle) {
      toggle.addEventListener('click', function () {
        state.sidebarOpen = !state.sidebarOpen;
        if (sidebar) sidebar.classList.toggle('admin-sidebar--open', state.sidebarOpen);
        if (overlay) overlay.classList.toggle('sidebar-overlay--visible', state.sidebarOpen);
        document.body.style.overflow = state.sidebarOpen ? 'hidden' : '';
      });
    }
    if (overlay) { overlay.addEventListener('click', closeSidebar); }
    var links = document.querySelectorAll('.admin-sidebar__link[data-section]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        var section = this.getAttribute('data-section');
        if (section) switchSection(section);
        closeSidebar();
      });
    }
    var logoutBtn = document.getElementById('sidebar-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) { e.preventDefault(); doLogout(); });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.sidebarOpen) { closeSidebar(); }
    });
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    var sidebar = document.getElementById('admin-sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('admin-sidebar--open');
    if (overlay) overlay.classList.remove('sidebar-overlay--visible');
    document.body.style.overflow = '';
  }

  function setActiveNav(section) {
    var links = document.querySelectorAll('.admin-sidebar__link[data-section]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var isActive = link.getAttribute('data-section') === section;
      link.classList.toggle('admin-sidebar__link--active', isActive);
    }
  }

  /* ========================================================================
     SECTION SWITCHING
     ======================================================================== */
  function switchSection(section) {
    if (SECTIONS.indexOf(section) === -1) return;
    state.currentSection = section;
    setActiveNav(section);
    var panels = document.querySelectorAll('.section-panel');
    for (var i = 0; i < panels.length; i++) { panels[i].classList.add('u-hidden'); }
    var target = document.getElementById('section-' + section);
    if (target) target.classList.remove('u-hidden');
    var titleEl = document.getElementById('page-title');
    var titles = {
      dashboard: 'Dashboard', coaches: 'Antrenori', events: 'Evenimente',
      products: 'Produse', plans: 'Abonamente', schedule: 'Program Săptămânal',
      orders: 'Comenzi', contact: 'Mesaje Contact', settings: 'Setări',
    };
    if (titleEl) titleEl.innerHTML = 'Panou <span>Admin</span> — ' + (titles[section] || '');
    switch (section) {
      case 'dashboard': loadDashboard(); break;
      case 'coaches': loadCoaches(); break;
      case 'events': loadEvents(); break;
      case 'products': loadProducts(); break;
      case 'plans': loadPlans(); break;
      case 'schedule': loadSchedule(); break;
      case 'orders': loadOrders(); break;
      case 'contact': loadContact(); break;
      case 'settings': loadSettings(); break;
    }
  }

  /* ========================================================================
     DASHBOARD
     ======================================================================== */
  async function loadDashboard() {
    try {
      var results = await Promise.allSettled([
        apiFetch(API.COACHES + '?limit=1&is_active=true'),
        apiFetch(API.COACHES + '?limit=1&is_active=false'),
        apiFetch(API.EVENTS + '?limit=1&is_published=true'),
        apiFetch(API.EVENTS + '?limit=1&is_published=false'),
        apiFetch(API.PRODUCTS + '?limit=1&is_active=true'),
        apiFetch(API.PRODUCTS + '?limit=1&is_active=false'),
        apiFetch(API.PLANS + '?limit=1&is_active=true'),
        apiFetch(API.PLANS + '?limit=1&is_active=false'),
        apiFetch(API.ORDERS + '?limit=1'),
        apiFetch(API.CONTACT + '?limit=1&is_read=false'),
        apiFetch(API.ORDERS + '?limit=5&sort=-created_at'),
      ]);
      var coachesTotal = getResultTotal(results[0]) + getResultTotal(results[1]);
      var eventsTotal = getResultTotal(results[2]) + getResultTotal(results[3]);
      var productsTotal = getResultTotal(results[4]) + getResultTotal(results[5]);
      var plansTotal = getResultTotal(results[6]) + getResultTotal(results[7]);
      var ordersTotal = getResultTotal(results[8]);
      var unreadMessages = getResultTotal(results[9]);
      var recentOrders = getResultData(results[10]);
      setStatValue('stat-coaches', coachesTotal);
      setStatValue('stat-events', eventsTotal);
      setStatValue('stat-products', productsTotal);
      setStatValue('stat-plans', plansTotal);
      setStatValue('stat-orders', ordersTotal);
      setStatValue('stat-messages', unreadMessages);
      renderRecentOrders(recentOrders);
      var revenue = 0;
      if (recentOrders && recentOrders.length) {
        for (var i = 0; i < recentOrders.length; i++) {
          if (recentOrders[i].status === 'completed' || recentOrders[i].status === 'confirmed') {
            revenue += Number(recentOrders[i].total_amount) || 0;
          }
        }
      }
      setStatValue('stat-revenue', formatPrice(revenue) + ' RON');
    } catch (e) { console.error('[admin] Dashboard load error:', e.message); }
  }

  function getResultTotal(result) {
    if (result.status === 'fulfilled' && result.value && result.value.pagination) {
      return result.value.pagination.total || 0;
    }
    return 0;
  }

  function getResultData(result) {
    if (result.status === 'fulfilled' && result.value && result.value.data) {
      return result.value.data;
    }
    return [];
  }

  function setStatValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderRecentOrders(orders) {
    var tbody = document.getElementById('dashboard-recent-orders');
    if (!tbody) return;
    if (!orders || !orders.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table__empty"><i class="fa-solid fa-inbox"></i>Nu există comenzi recente.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < Math.min(orders.length, 5); i++) {
      var o = orders[i];
      var status = STATUS_LABELS[o.status] || { ro: o.status || '—', cls: 'badge--neutral' };
      html += '<tr>' +
        '<td><strong>' + escapeHTML(o.order_number) + '</strong></td>' +
        '<td>' + escapeHTML(o.billing_name || o.user_name || '—') + '</td>' +
        '<td>' + formatPrice(o.total_amount) + ' RON</td>' +
        '<td><span class="badge ' + status.cls + '">' + status.ro + '</span></td></tr>';
    }
    tbody.innerHTML = html;
  }

  /* ========================================================================
     CRUD — COACHES
     ======================================================================== */
  async function loadCoaches() {
    var tbody = document.getElementById('coaches-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.coaches.page + '&limit=' + state.coaches.limit;
    if (state.coaches.sort) params += '&sort=' + encodeURIComponent(state.coaches.sort);
    if (state.coaches.search) params += '&search=' + encodeURIComponent(state.coaches.search);
    try {
      var results = await Promise.allSettled([
        apiFetch(API.COACHES + params + '&is_active=true'),
        apiFetch(API.COACHES + params + '&is_active=false'),
      ]);
      var active = getResultData(results[0]);
      var inactive = getResultData(results[1]);
      var allCoaches = active.concat(inactive);
      var total = (results[0].status === 'fulfilled' && results[0].value && results[0].value.pagination ? results[0].value.pagination.total : 0) +
                  (results[1].status === 'fulfilled' && results[1].value && results[1].value.pagination ? results[1].value.pagination.total : 0);
      state.coaches.data = allCoaches;
      state.coaches.pagination = { page: state.coaches.page, limit: state.coaches.limit, total: total, totalPages: Math.ceil(total / state.coaches.limit) || 1 };
      renderCoachesTable();
      renderPagination('coaches', state.coaches.pagination, loadCoaches);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea antrenorilor.', 'error');
    }
  }

  function renderCoachesTable() {
    var tbody = document.getElementById('coaches-tbody');
    if (!tbody) return;
    var coaches = state.coaches.data;
    if (!coaches.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-user-slash"></i>Niciun antrenor găsit.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < coaches.length; i++) {
      var c = coaches[i];
      html += '<tr>' +
        '<td>' + c.id + '</td>' +
        '<td><strong>' + escapeHTML(c.name) + '</strong></td>' +
        '<td>' + escapeHTML(c.title || '—') + '</td>' +
        '<td>' + escapeHTML(c.email || '—') + '</td>' +
        '<td>' + escapeHTML(c.phone || '—') + '</td>' +
        '<td><span class="badge ' + (c.is_active ? 'badge--success' : 'badge--neutral') + '">' + (c.is_active ? 'Activ' : 'Inactiv') + '</span></td>' +
        '<td>' + (c.sort_order || 0) + '</td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-edit-coach="' + c.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button>' +
        '<button class="btn btn--ghost btn--sm" data-delete-coach="' + c.id + '" data-delete-name="' + escapeHTML(c.name) + '" aria-label="Șterge"><i class="fa-solid fa-trash"></i></button>' +
        '</div></td></tr>';
    }
    tbody.innerHTML = html;
    bindCoachesActions();
  }

  function bindCoachesActions() {
    var editBtns = document.querySelectorAll('[data-edit-coach]');
    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-coach'), 10);
        openCoachModal(id);
      });
    }
    var delBtns = document.querySelectorAll('[data-delete-coach]');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-delete-coach'), 10);
        var name = this.getAttribute('data-delete-name');
        openDeleteConfirm('coach', id, name);
      });
    }
  }

  function openCoachModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-coach');
    var title = document.getElementById('modal-coach-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editează Antrenor' : 'Adaugă Antrenor';
    var form = document.getElementById('form-coach');
    if (form) form.reset();
    document.getElementById('coach-id').value = '';
    if (id) {
      var coach = findById(state.coaches.data, id);
      if (coach) {
        document.getElementById('coach-id').value = coach.id;
        document.getElementById('coach-name').value = coach.name || '';
        document.getElementById('coach-slug').value = coach.slug || '';
        document.getElementById('coach-title').value = coach.title || '';
        document.getElementById('coach-bio').value = coach.bio || '';
        document.getElementById('coach-email').value = coach.email || '';
        document.getElementById('coach-phone').value = coach.phone || '';
        document.getElementById('coach-specialties').value = Array.isArray(coach.specialties) ? coach.specialties.join(', ') : '';
        document.getElementById('coach-certifications').value = Array.isArray(coach.certifications) ? coach.certifications.join(', ') : '';
        document.getElementById('coach-is-active').checked = coach.is_active;
        document.getElementById('coach-sort-order').value = coach.sort_order || 0;
      }
    }
    openModal('modal-coach');
  }

  async function saveCoach(e) {
    e.preventDefault();
    var id = document.getElementById('coach-id').value;
    var isEdit = !!id;
    var name = document.getElementById('coach-name').value.trim();
    var slug = document.getElementById('coach-slug').value.trim();
    if (!slug) slug = slugify(name);
    var specialtiesRaw = document.getElementById('coach-specialties').value;
    var certificationsRaw = document.getElementById('coach-certifications').value;
    var body = {
      name: name, slug: slug,
      title: document.getElementById('coach-title').value.trim() || null,
      bio: document.getElementById('coach-bio').value.trim() || null,
      email: document.getElementById('coach-email').value.trim() || null,
      phone: document.getElementById('coach-phone').value.trim() || null,
      specialties: specialtiesRaw ? specialtiesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
      certifications: certificationsRaw ? certificationsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
      is_active: document.getElementById('coach-is-active').checked,
      sort_order: parseInt(document.getElementById('coach-sort-order').value, 10) || 0,
    };
    try {
      if (isEdit) {
        await apiFetch(API.COACHES + '/' + id, { method: 'PUT', body: body });
        showToast('Antrenor actualizat cu succes!', 'success');
      } else {
        await apiFetch(API.COACHES, { method: 'POST', body: body });
        showToast('Antrenor creat cu succes!', 'success');
      }
      closeModal('modal-coach');
      loadCoaches();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — EVENTS
     ======================================================================== */
  async function loadEvents() {
    var tbody = document.getElementById('events-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.events.page + '&limit=' + state.events.limit;
    if (state.events.sort) params += '&sort=' + encodeURIComponent(state.events.sort);
    if (state.events.search) params += '&search=' + encodeURIComponent(state.events.search);
    try {
      var results = await Promise.allSettled([
        apiFetch(API.EVENTS + params + '&is_published=true'),
        apiFetch(API.EVENTS + params + '&is_published=false'),
      ]);
      var published = getResultData(results[0]);
      var unpublished = getResultData(results[1]);
      var allEvents = published.concat(unpublished);
      var total = (results[0].status === 'fulfilled' && results[0].value && results[0].value.pagination ? results[0].value.pagination.total : 0) +
                  (results[1].status === 'fulfilled' && results[1].value && results[1].value.pagination ? results[1].value.pagination.total : 0);
      state.events.data = allEvents;
      state.events.pagination = { page: state.events.page, limit: state.events.limit, total: total, totalPages: Math.ceil(total / state.events.limit) || 1 };
      renderEventsTable();
      renderPagination('events', state.events.pagination, loadEvents);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="9" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea evenimentelor.', 'error');
    }
  }

  function renderEventsTable() {
    var tbody = document.getElementById('events-tbody');
    if (!tbody) return;
    var events = state.events.data;
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="table__empty"><i class="fa-solid fa-calendar-xmark"></i>Niciun eveniment găsit.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      html += '<tr>' +
        '<td>' + ev.id + '</td>' +
        '<td><strong>' + escapeHTML(ev.title) + '</strong></td>' +
        '<td>' + escapeHTML(EVENT_TYPES.indexOf(ev.type) !== -1 ? ev.type : 'general') + '</td>' +
        '<td>' + formatDate(ev.start_date) + '</td>' +
        '<td>' + escapeHTML(ev.location || '—') + '</td>' +
        '<td>' + formatPrice(ev.price) + ' RON</td>' +
        '<td>' + (ev.capacity || '—') + '</td>' +
        '<td><span class="badge ' + (ev.is_published ? 'badge--success' : 'badge--neutral') + '">' + (ev.is_published ? 'Publicat' : 'Nepublicat') + '</span></td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-edit-event="' + ev.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button>' +
        '<button class="btn btn--ghost btn--sm" data-delete-event="' + ev.id + '" data-delete-name="' + escapeHTML(ev.title) + '" aria-label="Șterge"><i class="fa-solid fa-trash"></i></button>' +
        '</div></td></tr>';
    }
    tbody.innerHTML = html;
    bindEventsActions();
  }

  function bindEventsActions() {
    var editBtns = document.querySelectorAll('[data-edit-event]');
    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-event'), 10);
        openEventModal(id);
      });
    }
    var delBtns = document.querySelectorAll('[data-delete-event]');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-delete-event'), 10);
        var name = this.getAttribute('data-delete-name');
        openDeleteConfirm('event', id, name);
      });
    }
  }

  function openEventModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-event');
    var title = document.getElementById('modal-event-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editează Eveniment' : 'Adaugă Eveniment';
    var form = document.getElementById('form-event');
    if (form) form.reset();
    document.getElementById('event-id').value = '';
    if (id) {
      var ev = findById(state.events.data, id);
      if (ev) {
        document.getElementById('event-id').value = ev.id;
        document.getElementById('event-title').value = ev.title || '';
        document.getElementById('event-slug').value = ev.slug || '';
        document.getElementById('event-description').value = ev.description || '';
        document.getElementById('event-type').value = ev.type || 'general';
        document.getElementById('event-location').value = ev.location || '';
        document.getElementById('event-start-date').value = ev.start_date || '';
        document.getElementById('event-end-date').value = ev.end_date || '';
        document.getElementById('event-time').value = ev.time || '';
        document.getElementById('event-price').value = ev.price || 0;
        document.getElementById('event-capacity').value = ev.capacity || '';
        document.getElementById('event-is-published').checked = ev.is_published;
      }
    }
    openModal('modal-event');
  }

  async function saveEvent(e) {
    e.preventDefault();
    var id = document.getElementById('event-id').value;
    var isEdit = !!id;
    var title = document.getElementById('event-title').value.trim();
    var slug = document.getElementById('event-slug').value.trim();
    if (!slug) slug = slugify(title);
    var body = {
      title: title, slug: slug,
      description: document.getElementById('event-description').value.trim() || null,
      type: document.getElementById('event-type').value,
      location: document.getElementById('event-location').value.trim() || null,
      start_date: document.getElementById('event-start-date').value,
      end_date: document.getElementById('event-end-date').value || null,
      time: document.getElementById('event-time').value || null,
      price: parseFloat(document.getElementById('event-price').value) || 0,
      capacity: document.getElementById('event-capacity').value ? parseInt(document.getElementById('event-capacity').value, 10) : null,
      is_published: document.getElementById('event-is-published').checked,
    };
    try {
      if (isEdit) {
        await apiFetch(API.EVENTS + '/' + id, { method: 'PUT', body: body });
        showToast('Eveniment actualizat cu succes!', 'success');
      } else {
        await apiFetch(API.EVENTS, { method: 'POST', body: body });
        showToast('Eveniment creat cu succes!', 'success');
      }
      closeModal('modal-event');
      loadEvents();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — PRODUCTS
     ======================================================================== */
  async function loadProducts() {
    var tbody = document.getElementById('products-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.products.page + '&limit=' + state.products.limit;
    if (state.products.sort) params += '&sort=' + encodeURIComponent(state.products.sort);
    if (state.products.search) params += '&search=' + encodeURIComponent(state.products.search);
    try {
      var results = await Promise.allSettled([
        apiFetch(API.PRODUCTS + params + '&is_active=true'),
        apiFetch(API.PRODUCTS + params + '&is_active=false'),
      ]);
      var active = getResultData(results[0]);
      var inactive = getResultData(results[1]);
      var allProducts = active.concat(inactive);
      var total = (results[0].status === 'fulfilled' && results[0].value && results[0].value.pagination ? results[0].value.pagination.total : 0) +
                  (results[1].status === 'fulfilled' && results[1].value && results[1].value.pagination ? results[1].value.pagination.total : 0);
      state.products.data = allProducts;
      state.products.pagination = { page: state.products.page, limit: state.products.limit, total: total, totalPages: Math.ceil(total / state.products.limit) || 1 };
      renderProductsTable();
      renderPagination('products', state.products.pagination, loadProducts);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="9" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea produselor.', 'error');
    }
  }

  function renderProductsTable() {
    var tbody = document.getElementById('products-tbody');
    if (!tbody) return;
    var products = state.products.data;
    if (!products.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="table__empty"><i class="fa-solid fa-box-open"></i>Niciun produs găsit.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var cat = CATEGORY_LABELS[p.category] || p.category || 'general';
      var stockClass = '';
      var stockText = p.stock !== null ? p.stock : '—';
      if (p.stock === 0) { stockClass = 'u-text-red'; stockText = 'Epuizat'; }
      else if (p.stock !== null && p.stock <= 5) { stockClass = 'u-text-gold'; }
      html += '<tr>' +
        '<td>' + p.id + '</td>' +
        '<td><strong>' + escapeHTML(p.name) + '</strong></td>' +
        '<td>' + escapeHTML(cat) + '</td>' +
        '<td>' + formatPrice(p.price) + ' RON</td>' +
        '<td class="' + stockClass + '">' + stockText + '</td>' +
        '<td><span class="badge ' + (p.is_active ? 'badge--success' : 'badge--neutral') + '">' + (p.is_active ? 'Activ' : 'Inactiv') + '</span></td>' +
        '<td>' + (p.image ? '✓' : '—') + '</td>' +
        '<td>' + formatDate(p.created_at) + '</td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-edit-product="' + p.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button>' +
        '<button class="btn btn--ghost btn--sm" data-delete-product="' + p.id + '" data-delete-name="' + escapeHTML(p.name) + '" aria-label="Șterge"><i class="fa-solid fa-trash"></i></button>' +
        '</div></td></tr>';
    }
    tbody.innerHTML = html;
    bindProductsActions();
  }

  function bindProductsActions() {
    var editBtns = document.querySelectorAll('[data-edit-product]');
    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-product'), 10);
        openProductModal(id);
      });
    }
    var delBtns = document.querySelectorAll('[data-delete-product]');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-delete-product'), 10);
        var name = this.getAttribute('data-delete-name');
        openDeleteConfirm('product', id, name);
      });
    }
  }

  function openProductModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-product');
    var title = document.getElementById('modal-product-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editează Produs' : 'Adaugă Produs';
    var form = document.getElementById('form-product');
    if (form) form.reset();
    document.getElementById('product-id').value = '';
    if (id) {
      var p = findById(state.products.data, id);
      if (p) {
        document.getElementById('product-id').value = p.id;
        document.getElementById('product-name').value = p.name || '';
        document.getElementById('product-slug').value = p.slug || '';
        document.getElementById('product-description').value = p.description || '';
        document.getElementById('product-price').value = p.price || 0;
        document.getElementById('product-category').value = p.category || 'general';
        document.getElementById('product-stock').value = p.stock !== null ? p.stock : '';
        document.getElementById('product-image').value = p.image || '';
        document.getElementById('product-is-active').checked = p.is_active;
      }
    }
    openModal('modal-product');
  }

  async function saveProduct(e) {
    e.preventDefault();
    var id = document.getElementById('product-id').value;
    var isEdit = !!id;
    var name = document.getElementById('product-name').value.trim();
    var slug = document.getElementById('product-slug').value.trim();
    if (!slug) slug = slugify(name);
    var stockVal = document.getElementById('product-stock').value;
    var body = {
      name: name, slug: slug,
      description: document.getElementById('product-description').value.trim() || null,
      price: parseFloat(document.getElementById('product-price').value) || 0,
      category: document.getElementById('product-category').value,
      stock: stockVal !== '' ? parseInt(stockVal, 10) : null,
      image: document.getElementById('product-image').value.trim() || null,
      is_active: document.getElementById('product-is-active').checked,
    };
    try {
      if (isEdit) {
        await apiFetch(API.PRODUCTS + '/' + id, { method: 'PUT', body: body });
        showToast('Produs actualizat cu succes!', 'success');
      } else {
        await apiFetch(API.PRODUCTS, { method: 'POST', body: body });
        showToast('Produs creat cu succes!', 'success');
      }
      closeModal('modal-product');
      loadProducts();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — PLANS
     ======================================================================== */
  async function loadPlans() {
    var tbody = document.getElementById('plans-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.plans.page + '&limit=' + state.plans.limit;
    if (state.plans.sort) params += '&sort=' + encodeURIComponent(state.plans.sort);
    if (state.plans.search) params += '&search=' + encodeURIComponent(state.plans.search);
    try {
      var results = await Promise.allSettled([
        apiFetch(API.PLANS + params + '&is_active=true'),
        apiFetch(API.PLANS + params + '&is_active=false'),
      ]);
      var active = getResultData(results[0]);
      var inactive = getResultData(results[1]);
      var allPlans = active.concat(inactive);
      var total = (results[0].status === 'fulfilled' && results[0].value && results[0].value.pagination ? results[0].value.pagination.total : 0) +
                  (results[1].status === 'fulfilled' && results[1].value && results[1].value.pagination ? results[1].value.pagination.total : 0);
      state.plans.data = allPlans;
      state.plans.pagination = { page: state.plans.page, limit: state.plans.limit, total: total, totalPages: Math.ceil(total / state.plans.limit) || 1 };
      renderPlansTable();
      renderPagination('plans', state.plans.pagination, loadPlans);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea abonamentelor.', 'error');
    }
  }

  function renderPlansTable() {
    var tbody = document.getElementById('plans-tbody');
    if (!tbody) return;
    var plans = state.plans.data;
    if (!plans.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-receipt"></i>Niciun abonament găsit.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      html += '<tr>' +
        '<td>' + p.id + '</td>' +
        '<td><strong>' + escapeHTML(p.name) + '</strong></td>' +
        '<td>' + formatPrice(p.price) + ' RON</td>' +
        '<td>' + (p.duration_days || 30) + ' zile</td>' +
        '<td><span class="badge ' + (p.is_popular ? 'badge--gold' : 'badge--neutral') + '">' + (p.is_popular ? 'Popular' : 'Standard') + '</span></td>' +
        '<td><span class="badge ' + (p.is_active ? 'badge--success' : 'badge--neutral') + '">' + (p.is_active ? 'Activ' : 'Inactiv') + '</span></td>' +
        '<td>' + (p.sort_order || 0) + '</td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-edit-plan="' + p.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button>' +
        '<button class="btn btn--ghost btn--sm" data-delete-plan="' + p.id + '" data-delete-name="' + escapeHTML(p.name) + '" aria-label="Șterge"><i class="fa-solid fa-trash"></i></button>' +
        '</div></td></tr>';
    }
    tbody.innerHTML = html;
    bindPlansActions();
  }

  function bindPlansActions() {
    var editBtns = document.querySelectorAll('[data-edit-plan]');
    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-plan'), 10);
        openPlanModal(id);
      });
    }
    var delBtns = document.querySelectorAll('[data-delete-plan]');
    for (var j = 0; j < delBtns.length; j++) {
      delBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-delete-plan'), 10);
        var name = this.getAttribute('data-delete-name');
        openDeleteConfirm('plan', id, name);
      });
    }
  }

  function openPlanModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-plan');
    var title = document.getElementById('modal-plan-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editează Abonament' : 'Adaugă Abonament';
    var form = document.getElementById('form-plan');
    if (form) form.reset();
    document.getElementById('plan-id').value = '';
    if (id) {
      var p = findById(state.plans.data, id);
      if (p) {
        document.getElementById('plan-id').value = p.id;
        document.getElementById('plan-name').value = p.name || '';
        document.getElementById('plan-slug').value = p.slug || '';
        document.getElementById('plan-description').value = p.description || '';
        document.getElementById('plan-price').value = p.price || 0;
        document.getElementById('plan-duration').value = p.duration_days || 30;
        document.getElementById('plan-features').value = Array.isArray(p.features) ? p.features.join('\n') : '';
        document.getElementById('plan-is-popular').checked = p.is_popular;
        document.getElementById('plan-is-active').checked = p.is_active;
        document.getElementById('plan-sort-order').value = p.sort_order || 0;
      }
    }
    openModal('modal-plan');
  }

  async function savePlan(e) {
    e.preventDefault();
    var id = document.getElementById('plan-id').value;
    var isEdit = !!id;
    var name = document.getElementById('plan-name').value.trim();
    var slug = document.getElementById('plan-slug').value.trim();
    if (!slug) slug = slugify(name);
    var featuresRaw = document.getElementById('plan-features').value;
    var body = {
      name: name, slug: slug,
      description: document.getElementById('plan-description').value.trim() || null,
      price: parseFloat(document.getElementById('plan-price').value) || 0,
      duration_days: parseInt(document.getElementById('plan-duration').value, 10) || 30,
      features: featuresRaw ? featuresRaw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [],
      is_popular: document.getElementById('plan-is-popular').checked,
      is_active: document.getElementById('plan-is-active').checked,
      sort_order: parseInt(document.getElementById('plan-sort-order').value, 10) || 0,
    };
    try {
      if (isEdit) {
        await apiFetch(API.PLANS + '/' + id, { method: 'PUT', body: body });
        showToast('Abonament actualizat cu succes!', 'success');
      } else {
        await apiFetch(API.PLANS, { method: 'POST', body: body });
        showToast('Abonament creat cu succes!', 'success');
      }
      closeModal('modal-plan');
      loadPlans();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — SCHEDULE
     ======================================================================== */
  async function loadSchedule() {
    var container = document.getElementById('schedule-container');
    if (!container) return;
    container.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';
    try {
      var data = await apiFetch(API.SCHEDULE);
      state.schedule.data = data.data || [];
      state.schedule.grouped = data.grouped || {};
      renderScheduleView();
    } catch (e) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state__icon"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="empty-state__title">Eroare la încărcare</div></div>';
      showToast('Eroare la încărcarea programului.', 'error');
    }
  }

  function renderScheduleView() {
    var container = document.getElementById('schedule-container');
    if (!container) return;
    var grouped = state.schedule.grouped;
    var html = '';
    for (var day = 0; day <= 6; day++) {
      var entries = grouped[day] || [];
      html += '<div class="panel panel--gold-border" style="margin-bottom:1rem;">';
      html += '<div class="panel__header"><h3 class="panel__title">' + DAY_NAMES_RO[day] + ' <span style="font-size:0.7rem;color:#999;">(' + entries.length + ' sesiuni)</span></h3></div>';
      html += '<div class="panel__body panel__body--no-padding"><div class="table-wrap"><table class="table table--sm"><thead><tr>' +
        '<th>Titlu</th><th>Antrenor</th><th>Interval</th><th>Locație</th><th>Max</th><th>Activ</th><th></th></tr></thead><tbody>';
      if (!entries.length) {
        html += '<tr><td colspan="7" class="table__empty">— Gol —</td></tr>';
      } else {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          html += '<tr>' +
            '<td><strong>' + escapeHTML(e.title) + '</strong></td>' +
            '<td>' + escapeHTML(e.coach_name || '—') + '</td>' +
            '<td>' + escapeHTML(e.start_time) + ' – ' + escapeHTML(e.end_time) + '</td>' +
            '<td>' + escapeHTML(e.location || '—') + '</td>' +
            '<td>' + (e.max_participants || '—') + '</td>' +
            '<td><span class="badge ' + (e.is_active ? 'badge--success' : 'badge--neutral') + '">' + (e.is_active ? 'Da' : 'Nu') + '</span></td>' +
            '<td><button class="btn btn--ghost btn--sm" data-edit-schedule="' + e.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button></td></tr>';
        }
      }
      html += '</tbody></table></div></div></div>';
    }
    html += '<div style="text-align:center;margin-top:1rem;">';
    html += '<button class="btn btn--primary" id="btn-add-schedule-entry"><i class="fa-solid fa-plus"></i> Adaugă Sesiune Nouă</button></div>';
    container.innerHTML = html;
    var addBtn = document.getElementById('btn-add-schedule-entry');
    if (addBtn) { addBtn.addEventListener('click', function () { openScheduleModal(null); }); }
    var editBtns = document.querySelectorAll('[data-edit-schedule]');
    for (var j = 0; j < editBtns.length; j++) {
      editBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-schedule'), 10);
        openScheduleModal(id);
      });
    }
  }

  function openScheduleModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-schedule');
    var title = document.getElementById('modal-schedule-title');
    if (!modal || !title) return;
    title.textContent = id ? 'Editează Sesiune' : 'Adaugă Sesiune';
    var form = document.getElementById('form-schedule');
    if (form) form.reset();
    document.getElementById('schedule-id').value = '';
    if (id) {
      var s = findById(state.schedule.data, id);
      if (s) {
        document.getElementById('schedule-id').value = s.id;
        document.getElementById('schedule-title').value = s.title || '';
        document.getElementById('schedule-coach-id').value = s.coach_id || '';
        document.getElementById('schedule-day').value = s.day_of_week;
        document.getElementById('schedule-start').value = s.start_time || '';
        document.getElementById('schedule-end').value = s.end_time || '';
        document.getElementById('schedule-location').value = s.location || '';
        document.getElementById('schedule-max').value = s.max_participants || '';
        document.getElementById('schedule-is-active').checked = s.is_active;
      }
    }
    openModal('modal-schedule');
  }

  async function saveSchedule(e) {
    e.preventDefault();
    var id = document.getElementById('schedule-id').value;
    var entry = {
      title: document.getElementById('schedule-title').value.trim(),
      coach_id: document.getElementById('schedule-coach-id').value ? parseInt(document.getElementById('schedule-coach-id').value, 10) : null,
      day_of_week: parseInt(document.getElementById('schedule-day').value, 10),
      start_time: document.getElementById('schedule-start').value,
      end_time: document.getElementById('schedule-end').value,
      location: document.getElementById('schedule-location').value.trim() || null,
      max_participants: document.getElementById('schedule-max').value ? parseInt(document.getElementById('schedule-max').value, 10) : null,
      is_active: document.getElementById('schedule-is-active').checked,
    };
    if (id) entry.id = parseInt(id, 10);
    try {
      var currentEntries = state.schedule.data.slice();
      if (id) {
        for (var i = 0; i < currentEntries.length; i++) {
          if (currentEntries[i].id === parseInt(id, 10)) { currentEntries[i] = entry; break; }
        }
      } else { currentEntries.push(entry); }
      var putEntries = currentEntries.map(function (e) {
        return { id: e.id, coach_id: e.coach_id, title: e.title, day_of_week: e.day_of_week, start_time: e.start_time, end_time: e.end_time, location: e.location, max_participants: e.max_participants, is_active: e.is_active };
      });
      await apiFetch(API.SCHEDULE, { method: 'PUT', body: { entries: putEntries } });
      showToast('Program actualizat cu succes!', 'success');
      closeModal('modal-schedule');
      loadSchedule();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  async function deleteScheduleEntry(id) {
    var currentEntries = state.schedule.data.slice();
    currentEntries = currentEntries.filter(function (e) { return e.id !== id; });
    var putEntries = currentEntries.map(function (e) {
      return { id: e.id, coach_id: e.coach_id, title: e.title, day_of_week: e.day_of_week, start_time: e.start_time, end_time: e.end_time, location: e.location, max_participants: e.max_participants, is_active: e.is_active };
    });
    try {
      await apiFetch(API.SCHEDULE, { method: 'PUT', body: { entries: putEntries } });
      showToast('Sesiune ștearsă!', 'success');
      loadSchedule();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — ORDERS
     ======================================================================== */
  async function loadOrders() {
    var tbody = document.getElementById('orders-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.orders.page + '&limit=' + state.orders.limit;
    if (state.orders.sort) params += '&sort=' + encodeURIComponent(state.orders.sort);
    if (state.orders.search) params += '&search=' + encodeURIComponent(state.orders.search);
    try {
      var data = await apiFetch(API.ORDERS + params);
      state.orders.data = data.data || [];
      state.orders.pagination = data.pagination || null;
      renderOrdersTable();
      renderPagination('orders', state.orders.pagination, loadOrders);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea comenzilor.', 'error');
    }
  }

  function renderOrdersTable() {
    var tbody = document.getElementById('orders-tbody');
    if (!tbody) return;
    var orders = state.orders.data;
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="table__empty"><i class="fa-solid fa-inbox"></i>Nicio comandă găsită.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      var status = STATUS_LABELS[o.status] || { ro: o.status || '—', cls: 'badge--neutral' };
      html += '<tr>' +
        '<td><strong>' + escapeHTML(o.order_number) + '</strong></td>' +
        '<td>' + escapeHTML(o.billing_name || o.user_name || '—') + '</td>' +
        '<td>' + escapeHTML(o.billing_email || o.user_email || '—') + '</td>' +
        '<td>' + formatPrice(o.total_amount) + ' RON</td>' +
        '<td><span class="badge ' + status.cls + '">' + status.ro + '</span></td>' +
        '<td>' + formatDateTime(o.created_at) + '</td>' +
        '<td>' + (o.items ? o.items.length : 0) + ' prod.</td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-edit-order="' + o.id + '" aria-label="Editează"><i class="fa-solid fa-pen-to-square"></i></button></div></td></tr>';
    }
    tbody.innerHTML = html;
    bindOrdersActions();
  }

  function bindOrdersActions() {
    var editBtns = document.querySelectorAll('[data-edit-order]');
    for (var i = 0; i < editBtns.length; i++) {
      editBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-edit-order'), 10);
        openOrderModal(id);
      });
    }
  }

  function openOrderModal(id) {
    state.editingId = id || null;
    var modal = document.getElementById('modal-order');
    var title = document.getElementById('modal-order-title');
    if (!modal || !title) return;
    title.textContent = 'Detalii Comandă';
    var order = findById(state.orders.data, id);
    if (!order) return;
    document.getElementById('order-id').value = order.id;
    document.getElementById('order-number-display').textContent = order.order_number || '—';
    document.getElementById('order-status').value = order.status || 'pending';
    document.getElementById('order-billing-name').value = order.billing_name || '';
    document.getElementById('order-billing-email').value = order.billing_email || '';
    document.getElementById('order-billing-phone').value = order.billing_phone || '';
    document.getElementById('order-notes').value = order.notes || '';
    document.getElementById('order-total-display').textContent = formatPrice(order.total_amount) + ' RON';
    var itemsContainer = document.getElementById('order-items-list');
    if (itemsContainer) {
      var items = order.items || [];
      if (items.length) {
        var itemsHtml = '<ul style="list-style:disc;padding-left:1.5rem;">';
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          itemsHtml += '<li>' + escapeHTML(item.product_name || 'Produs #' + item.product_id) +
            ' × ' + item.quantity + ' — ' + formatPrice(item.line_total || item.unit_price * item.quantity) + ' RON</li>';
        }
        itemsHtml += '</ul>';
        itemsContainer.innerHTML = itemsHtml;
      } else { itemsContainer.innerHTML = '<p class="u-text-muted">Niciun produs</p>'; }
    }
    openModal('modal-order');
  }

  async function saveOrder(e) {
    e.preventDefault();
    var id = document.getElementById('order-id').value;
    var body = {
      status: document.getElementById('order-status').value,
      billing_name: document.getElementById('order-billing-name').value.trim() || null,
      billing_email: document.getElementById('order-billing-email').value.trim() || null,
      billing_phone: document.getElementById('order-billing-phone').value.trim() || null,
      notes: document.getElementById('order-notes').value.trim() || null,
    };
    try {
      await apiFetch(API.ORDERS + '/' + id, { method: 'PUT', body: body });
      showToast('Comandă actualizată cu succes!', 'success');
      closeModal('modal-order');
      loadOrders();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — CONTACT
     ======================================================================== */
  async function loadContact() {
    var tbody = document.getElementById('contact-tbody');
    if (!tbody) return;
    tbody.innerHTML = buildSkeletonRows(5);
    var params = '?page=' + state.contact.page + '&limit=' + state.contact.limit;
    if (state.contact.sort) params += '&sort=' + encodeURIComponent(state.contact.sort);
    if (state.contact.search) params += '&search=' + encodeURIComponent(state.contact.search);
    try {
      var data = await apiFetch(API.CONTACT + params);
      state.contact.data = data.data || [];
      state.contact.pagination = data.pagination || null;
      renderContactTable();
      renderPagination('contact', state.contact.pagination, loadContact);
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" class="table__empty"><i class="fa-solid fa-triangle-exclamation"></i>Eroare la încărcare.</td></tr>';
      showToast('Eroare la încărcarea mesajelor.', 'error');
    }
  }

  function renderContactTable() {
    var tbody = document.getElementById('contact-tbody');
    if (!tbody) return;
    var messages = state.contact.data;
    if (!messages.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table__empty"><i class="fa-solid fa-envelope-open"></i>Niciun mesaj găsit.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      html += '<tr style="' + (!m.is_read ? 'background:rgba(212,168,67,0.04);' : '') + '">' +
        '<td>' + m.id + '</td>' +
        '<td><strong>' + escapeHTML(m.name) + '</strong></td>' +
        '<td>' + escapeHTML(m.email) + '</td>' +
        '<td>' + escapeHTML(m.subject || '—') + '</td>' +
        '<td><span class="badge ' + (m.is_read ? 'badge--success' : 'badge--warning') + '">' + (m.is_read ? 'Citit' : 'Necitit') + '</span></td>' +
        '<td>' + formatDateTime(m.created_at) + '</td>' +
        '<td><div class="table__actions">' +
        '<button class="btn btn--ghost btn--sm" data-view-contact="' + m.id + '" aria-label="Vezi"><i class="fa-solid fa-eye"></i></button>' +
        (!m.is_read ? '<button class="btn btn--ghost btn--sm" data-mark-read="' + m.id + '" aria-label="Marchează citit"><i class="fa-solid fa-check"></i></button>' : '') +
        '<button class="btn btn--ghost btn--sm" data-delete-contact="' + m.id + '" data-delete-name="' + escapeHTML(m.name) + '" aria-label="Șterge"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
    }
    tbody.innerHTML = html;
    bindContactActions();
  }

  function bindContactActions() {
    var viewBtns = document.querySelectorAll('[data-view-contact]');
    for (var i = 0; i < viewBtns.length; i++) {
      viewBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-view-contact'), 10);
        openContactModal(id);
      });
    }
    var markBtns = document.querySelectorAll('[data-mark-read]');
    for (var j = 0; j < markBtns.length; j++) {
      markBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-mark-read'), 10);
        markContactRead(id);
      });
    }
    var delBtns = document.querySelectorAll('[data-delete-contact]');
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-delete-contact'), 10);
        var name = this.getAttribute('data-delete-name');
        openDeleteConfirm('contact', id, name);
      });
    }
  }

  function openContactModal(id) {
    var m = findById(state.contact.data, id);
    if (!m) return;
    var modal = document.getElementById('modal-contact-view');
    if (!modal) return;
    document.getElementById('contact-view-name').textContent = m.name || '—';
    document.getElementById('contact-view-email').textContent = m.email || '—';
    document.getElementById('contact-view-subject').textContent = m.subject || '—';
    document.getElementById('contact-view-date').textContent = formatDateTime(m.created_at);
    document.getElementById('contact-view-message').textContent = m.message || '—';
    document.getElementById('contact-view-id').value = m.id;
    if (!m.is_read) { markContactRead(id, true); }
    openModal('modal-contact-view');
  }

  async function markContactRead(id, silent) {
    try {
      await apiFetch(API.CONTACT + '/' + id, { method: 'PUT', body: { is_read: true } });
      if (!silent) { showToast('Mesaj marcat ca citit.', 'info'); }
      loadContact();
    } catch (err) { if (!silent) showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     CRUD — SETTINGS
     ======================================================================== */
  async function loadSettings() {
    var container = document.getElementById('settings-container');
    if (!container) return;
    container.innerHTML = '<div class="skeleton skeleton--card" style="height:200px;"></div>';
    try {
      var data = await apiFetch(API.SETTINGS);
      state.settings = data || {};
      renderSettingsForm();
    } catch (e) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state__icon"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="empty-state__title">Eroare la încărcare</div></div>';
      showToast('Eroare la încărcarea setărilor.', 'error');
    }
  }

  function renderSettingsForm() {
    var container = document.getElementById('settings-container');
    if (!container) return;
    var s = state.settings;
    var html = '<div class="panel panel--gold-border"><div class="panel__header"><h3 class="panel__title"><i class="fa-solid fa-building"></i> Informații Club</h3></div><div class="panel__body"><div class="form-grid">';
    html += buildSettingsField('Nume Club', 'text', 'site_name', s.site_name || 'Boxing Champions');
    html += buildSettingsField('Slogan', 'text', 'site_tagline', s.site_tagline || '');
    html += buildSettingsField('Adresă', 'text', 'contact_address', (s.contact || {}).address || '');
    html += buildSettingsField('Telefon', 'text', 'contact_phone', (s.contact || {}).phone || '');
    html += buildSettingsField('Email Contact', 'email', 'contact_email', (s.contact || {}).email || '');
    html += '</div></div></div>';
    html += '<div class="panel panel--gold-border"><div class="panel__header"><h3 class="panel__title"><i class="fa-solid fa-globe"></i> Social Media</h3></div><div class="panel__body"><div class="form-grid">';
    html += buildSettingsField('Facebook URL', 'url', 'social_facebook', (s.social || {}).facebook || '');
    html += buildSettingsField('Instagram URL', 'url', 'social_instagram', (s.social || {}).instagram || '');
    html += buildSettingsField('YouTube URL', 'url', 'social_youtube', (s.social || {}).youtube || '');
    html += '</div></div></div>';
    html += '<div class="panel panel--gold-border"><div class="panel__header"><h3 class="panel__title"><i class="fa-solid fa-clock"></i> Program</h3></div><div class="panel__body"><div class="form-grid">';
    html += buildSettingsField('Luni-Vineri', 'text', 'hours_weekday', (s.hours || {}).weekday || '');
    html += buildSettingsField('Sâmbătă', 'text', 'hours_saturday', (s.hours || {}).saturday || '');
    html += buildSettingsField('Duminică', 'text', 'hours_sunday', (s.hours || {}).sunday || '');
    html += '</div></div></div>';
    html += '<div style="text-align:right;margin-top:1.5rem;"><button class="btn btn--primary" id="btn-save-settings"><i class="fa-solid fa-floppy-disk"></i> Salvează Setările</button></div>';
    container.innerHTML = html;
    var saveBtn = document.getElementById('btn-save-settings');
    if (saveBtn) { saveBtn.addEventListener('click', saveSettings); }
  }

  function buildSettingsField(label, type, id, value) {
    return '<div class="form-group"><label class="form-label" for="setting-' + id + '">' + escapeHTML(label) + '</label><input class="form-input" type="' + type + '" id="setting-' + id + '" value="' + escapeHTML(value || '') + '"></div>';
  }

  async function saveSettings() {
    var body = {
      site_name: getSettingVal('setting-site_name'),
      site_tagline: getSettingVal('setting-site_tagline'),
      contact: { address: getSettingVal('setting-contact_address'), phone: getSettingVal('setting-contact_phone'), email: getSettingVal('setting-contact_email') },
      social: { facebook: getSettingVal('setting-social_facebook'), instagram: getSettingVal('setting-social_instagram'), youtube: getSettingVal('setting-social_youtube') },
      hours: { weekday: getSettingVal('setting-hours_weekday'), saturday: getSettingVal('setting-hours_saturday'), sunday: getSettingVal('setting-hours_sunday') },
    };
    try {
      await apiFetch(API.SETTINGS, { method: 'PUT', body: body });
      showToast('Setări salvate cu succes!', 'success');
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  function getSettingVal(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  /* ========================================================================
     DELETE
     ======================================================================== */
  function openDeleteConfirm(type, id, name) {
    state.deletingType = type;
    state.deletingId = id;
    document.getElementById('confirm-delete-name').textContent = name || 'acest element';
    openModal('modal-confirm-delete');
  }

  async function executeDelete() {
    var type = state.deletingType;
    var id = state.deletingId;
    closeModal('modal-confirm-delete');
    var url, reloadFn, label;
    switch (type) {
      case 'coach': url = API.COACHES + '/' + id; reloadFn = loadCoaches; label = 'Antrenor șters'; break;
      case 'event': url = API.EVENTS + '/' + id; reloadFn = loadEvents; label = 'Eveniment șters'; break;
      case 'product': url = API.PRODUCTS + '/' + id; reloadFn = loadProducts; label = 'Produs șters'; break;
      case 'plan': url = API.PLANS + '/' + id; reloadFn = loadPlans; label = 'Abonament șters'; break;
      case 'schedule': await deleteScheduleEntry(id); return;
      case 'contact': url = API.CONTACT + '/' + id; reloadFn = loadContact; label = 'Mesaj șters'; break;
      default: return;
    }
    try {
      await apiFetch(url, { method: 'DELETE' });
      showToast(label + ' cu succes!', 'success');
      if (reloadFn) reloadFn();
    } catch (err) { showToast('Eroare: ' + (err.message || 'Necunoscută'), 'error'); }
  }

  /* ========================================================================
     MODAL HELPERS
     ======================================================================== */
  function openModal(modalId) {
    var overlay = document.getElementById(modalId);
    if (!overlay) return;
    overlay.classList.add('modal-overlay--visible');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var firstInput = overlay.querySelector('input:not([type="hidden"]), textarea, select');
      if (firstInput) firstInput.focus();
    }, 200);
  }

  function closeModal(modalId) {
    var overlay = document.getElementById(modalId);
    if (!overlay) return;
    overlay.classList.remove('modal-overlay--visible');
    document.body.style.overflow = '';
  }

  function initModals() {
    var closeBtns = document.querySelectorAll('[data-close-modal]');
    for (var i = 0; i < closeBtns.length; i++) {
      closeBtns[i].addEventListener('click', function () {
        var modalId = this.getAttribute('data-close-modal');
        if (modalId) closeModal(modalId);
      });
    }
    var overlays = document.querySelectorAll('.modal-overlay');
    for (var j = 0; j < overlays.length; j++) {
      overlays[j].addEventListener('click', function (e) {
        if (e.target === this) { this.classList.remove('modal-overlay--visible'); document.body.style.overflow = ''; }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var visible = document.querySelector('.modal-overlay--visible');
        if (visible) { visible.classList.remove('modal-overlay--visible'); document.body.style.overflow = ''; }
      }
    });
    var formCoach = document.getElementById('form-coach');
    if (formCoach) formCoach.addEventListener('submit', saveCoach);
    var formEvent = document.getElementById('form-event');
    if (formEvent) formEvent.addEventListener('submit', saveEvent);
    var formProduct = document.getElementById('form-product');
    if (formProduct) formProduct.addEventListener('submit', saveProduct);
    var formPlan = document.getElementById('form-plan');
    if (formPlan) formPlan.addEventListener('submit', savePlan);
    var formSchedule = document.getElementById('form-schedule');
    if (formSchedule) formSchedule.addEventListener('submit', saveSchedule);
    var formOrder = document.getElementById('form-order');
    if (formOrder) formOrder.addEventListener('submit', saveOrder);
    var btnConfirmDelete = document.getElementById('btn-confirm-delete');
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDelete);
    initSlugAuto('coach-name', 'coach-slug');
    initSlugAuto('event-title', 'event-slug');
    initSlugAuto('product-name', 'product-slug');
    initSlugAuto('plan-name', 'plan-slug');
  }

  function initSlugAuto(nameId, slugId) {
    var nameEl = document.getElementById(nameId);
    var slugEl = document.getElementById(slugId);
    if (!nameEl || !slugEl) return;
    nameEl.addEventListener('input', function () {
      if (!slugEl.dataset.manual) { slugEl.value = slugify(nameEl.value); }
    });
    slugEl.addEventListener('input', function () { slugEl.dataset.manual = 'true'; });
  }

  /* ========================================================================
     ADD BUTTONS
     ======================================================================== */
  function initAddButtons() {
    var btnAddCoach = document.getElementById('btn-add-coach');
    if (btnAddCoach) btnAddCoach.addEventListener('click', function () { openCoachModal(null); });
    var btnAddEvent = document.getElementById('btn-add-event');
    if (btnAddEvent) btnAddEvent.addEventListener('click', function () { openEventModal(null); });
    var btnAddProduct = document.getElementById('btn-add-product');
    if (btnAddProduct) btnAddProduct.addEventListener('click', function () { openProductModal(null); });
    var btnAddPlan = document.getElementById('btn-add-plan');
    if (btnAddPlan) btnAddPlan.addEventListener('click', function () { openPlanModal(null); });
  }

  /* ========================================================================
     SEARCH & SORT
     ======================================================================== */
  function initSearch() {
    var searchMap = {
      'coaches-search': { stateKey: 'coaches', loadFn: loadCoaches },
      'events-search': { stateKey: 'events', loadFn: loadEvents },
      'products-search': { stateKey: 'products', loadFn: loadProducts },
      'plans-search': { stateKey: 'plans', loadFn: loadPlans },
      'orders-search': { stateKey: 'orders', loadFn: loadOrders },
      'contact-search': { stateKey: 'contact', loadFn: loadContact },
    };
    Object.keys(searchMap).forEach(function (inputId) {
      var input = document.getElementById(inputId);
      if (!input) return;
      var cfg = searchMap[inputId];
      input.addEventListener('input', function () {
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(function () {
          state[cfg.stateKey].search = input.value;
          state[cfg.stateKey].page = 1;
          cfg.loadFn();
        }, 350);
      });
    });
    var sortHeaders = document.querySelectorAll('th[data-sort]');
    for (var i = 0; i < sortHeaders.length; i++) {
      sortHeaders[i].addEventListener('click', function () {
        var field = this.getAttribute('data-sort');
        var section = this.getAttribute('data-section');
        if (!field || !section || !state[section]) return;
        var cur = state[section].sort;
        if (cur === field) { state[section].sort = '-' + field; }
        else if (cur === '-' + field) { state[section].sort = ''; }
        else { state[section].sort = field; }
        state[section].page = 1;
        var loadMap = { coaches: loadCoaches, events: loadEvents, products: loadProducts, plans: loadPlans, orders: loadOrders, contact: loadContact };
        if (loadMap[section]) loadMap[section]();
      });
    }
  }

  /* ========================================================================
     PAGINATION
     ======================================================================== */
  function renderPagination(section, pagination, loadFn) {
    var container = document.getElementById(section + '-pagination');
    if (!container) return;
    if (!pagination || pagination.totalPages <= 1) { container.innerHTML = ''; return; }
    var current = pagination.page;
    var total = pagination.totalPages;
    var html = '';
    html += '<button class="pagination__btn" data-page="' + (current - 1) + '"' + (current <= 1 ? ' disabled' : '') + '>◀</button>';
    var maxV = 5;
    var start = Math.max(1, current - Math.floor(maxV / 2));
    var end = Math.min(total, start + maxV - 1);
    if (end - start < maxV - 1) start = Math.max(1, end - maxV + 1);
    if (start > 1) { html += '<button class="pagination__btn" data-page="1">1</button>'; if (start > 2) html += '<span class="pagination__btn" style="pointer-events:none;">…</span>'; }
    for (var p = start; p <= end; p++) { html += '<button class="pagination__btn' + (p === current ? ' pagination__btn--active' : '') + '" data-page="' + p + '">' + p + '</button>'; }
    if (end < total) { if (end < total - 1) html += '<span class="pagination__btn" style="pointer-events:none;">…</span>'; html += '<button class="pagination__btn" data-page="' + total + '">' + total + '</button>'; }
    html += '<button class="pagination__btn" data-page="' + (current + 1) + '"' + (current >= total ? ' disabled' : '') + '>▶</button>';
    container.innerHTML = html;
    var btns = container.querySelectorAll('.pagination__btn:not([disabled])');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var page = parseInt(this.getAttribute('data-page'), 10);
        if (page && page !== state[section].page) {
          state[section].page = page;
          loadFn();
          document.getElementById('section-' + section).scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }
  }

  /* ========================================================================
     SKELETON
     ======================================================================== */
  function buildSkeletonRows(count) {
    count = count || 5;
    var html = '';
    for (var i = 0; i < count; i++) { html += '<tr><td colspan="12"><div class="skeleton skeleton--text" style="width:100%;"></div></td></tr>'; }
    return html;
  }

  /* ========================================================================
     FIND BY ID
     ======================================================================== */
  function findById(arr, id) {
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) { if (arr[i].id === id) return arr[i]; }
    return null;
  }

  /* ========================================================================
     INIT
     ======================================================================== */
  async function init() {
    var authed = await checkAuth();
    if (!authed) return;
    initSidebar();
    initModals();
    initAddButtons();
    initSearch();
    switchSection('dashboard');
  }

  /* ========================================================================
     EXPOSE
     ======================================================================== */
  window.Admin = {
    state: state,
    switchSection: switchSection,
    showToast: showToast,
    loadDashboard: loadDashboard,
    loadCoaches: loadCoaches,
    loadEvents: loadEvents,
    loadProducts: loadProducts,
    loadPlans: loadPlans,
    loadSchedule: loadSchedule,
    loadOrders: loadOrders,
    loadContact: loadContact,
    loadSettings: loadSettings,
  };

  domReady(init);

})();