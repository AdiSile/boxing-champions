'use strict';

// ===========================================================================
// SHOP MODULE — Boxing Champions
// Magazin complet: coș localStorage, adăugare/eliminare, cantități,
// calcul total, integrare Stripe (redirect la checkout), filtre, sortare,
// afișare dinamică din API.
//
// Depinde de: main.js (escapeHtml, apiFetch, API_BASE, renderEmptyState)
// ===========================================================================

(function () {
  // ──────────────────────────────────────────────────────────────────────────
  // CONSTANTE
  // ──────────────────────────────────────────────────────────────────────────
  const CART_KEY = 'boxing_champions_cart';
  const CART_EVENT = 'boxing_champions_cart_sync';
  const API_BASE = window.API_BASE || '/api';
  const TOAST_DURATION = 2800;

  // Categorii acceptate
  const VALID_CATEGORIES = ['Îmbrăcăminte', 'Echipament', 'Accesorii', 'Nutriție'];

  // ──────────────────────────────────────────────────────────────────────────
  // REFERINȚE DOM
  // ──────────────────────────────────────────────────────────────────────────
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  let productGrid = null;
  let loadingSkeleton = null;
  let cartToggleBtn = null;
  let cartCountBadge = null;
  let cartOffcanvas = null;
  let cartOverlay = null;
  let cartCloseBtn = null;
  let cartItemsContainer = null;
  let cartFooter = null;
  let cartTotalAmount = null;
  let cartCheckoutBtn = null;
  let cartClearBtn = null;
  let checkoutModal = null;
  let checkoutModalOverlay = null;
  let checkoutModalClose = null;
  let checkoutForm = null;
  let checkoutSummary = null;
  let checkoutCancelBtn = null;
  let heroCartBtn = null;
  let sortSelect = null;
  let categoryTabs = [];
  let checkoutGlobalError = null;
  let checkoutGlobalSuccess = null;
  let checkoutNameError = null;
  let checkoutEmailError = null;
  let checkoutSubmitBtn = null;
  let toastContainer = null;

  // ──────────────────────────────────────────────────────────────────────────
  // STARE
  // ──────────────────────────────────────────────────────────────────────────
  let allProducts = [];
  let currentCategory = 'all';
  let currentSort = 'newest';
  let isLoading = false;
  let loadError = null;
  let checkoutSubmitting = false;

  // ──────────────────────────────────────────────────────────────────────────
  // TOAST — notificări tranzitorii
  // ──────────────────────────────────────────────────────────────────────────
  function ensureToastContainer() {
    if (toastContainer) return;
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }

  /**
   * Afișează o notificare toast.
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {string} message
   * @param {number} [duration]
   */
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
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
    toast.setAttribute('role', 'status');

    toastContainer.appendChild(toast);

    // Forțează reflow pentru animație
    void toast.offsetWidth;
    toast.classList.add('toast--visible');

    setTimeout(() => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, { once: true });
      // Fallback removal
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, dur);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COȘ — localStorage CRUD
  // ──────────────────────────────────────────────────────────────────────────
  function getCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const cart = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cart)) throw new Error('Cart is not an array');
      return cart;
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (err) {
      console.warn('[Shop] Nu s-a putut salva coșul în localStorage:', err.message);
      showToast('error', 'Coșul nu a putut fi salvat. Verifică spațiul disponibil.');
    }
    // Notificăm celelalte tab-uri
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: CART_KEY,
        newValue: JSON.stringify(cart),
      }));
    } catch { /* ignore */ }
  }

  function addToCart(product) {
    const cart = getCart();
    const existing = cart.find(item => item.id === product.id);
    const maxStock = product.stock || 100;

    if (existing) {
      if (existing.quantity >= maxStock) {
        showToast('warning', `Stoc maxim atins pentru "${product.name}".`);
        return;
      }
      existing.quantity = Math.min(existing.quantity + 1, maxStock);
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image || '',
        quantity: 1,
      });
    }

    saveCart(cart);
    updateCartUI();
    renderCartItems();
    showToast('success', `"${product.name}" a fost adăugat în coș.`);
  }

  function removeFromCart(productId) {
    const cart = getCart();
    const item = cart.find(i => i.id === productId);
    const newCart = cart.filter(item => item.id !== productId);
    saveCart(newCart);
    updateCartUI();
    renderCartItems();
    if (item) {
      showToast('info', `"${item.name}" a fost eliminat din coș.`);
    }
  }

  function updateQuantity(productId, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty < 1) {
      removeFromCart(productId);
      return;
    }
    if (newQty > 100) {
      showToast('warning', 'Cantitatea maximă este 100.');
      return;
    }
    item.quantity = newQty;
    saveCart(cart);
    updateCartUI();
    renderCartItems();
  }

  function setQuantity(productId, quantity) {
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 1) {
      removeFromCart(productId);
      return;
    }
    const cart = getCart();
    const item = cart.find(i => i.id === productId);
    if (!item) return;
    item.quantity = Math.min(qty, 100);
    saveCart(cart);
    updateCartUI();
    renderCartItems();
  }

  function clearCart() {
    saveCart([]);
    updateCartUI();
    renderCartItems();
    showToast('info', 'Coșul a fost golit.');
  }

  function getCartTotal() {
    return getCart().reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function getCartCount() {
    return getCart().reduce((sum, item) => sum + item.quantity, 0);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COȘ — UI
  // ──────────────────────────────────────────────────────────────────────────
  function updateCartUI() {
    if (!cartCountBadge) return;
    const count = getCartCount();
    cartCountBadge.textContent = count;
    cartCountBadge.style.display = count > 0 ? 'flex' : 'none';

    // Animație puls la schimbare
    if (count > 0) {
      cartCountBadge.classList.add('cart-count--pulse');
      setTimeout(() => cartCountBadge.classList.remove('cart-count--pulse'), 400);
    }
  }

  function renderCartItems() {
    if (!cartItemsContainer) return;
    const cart = getCart();

    // Empty state
    if (cart.length === 0) {
      cartItemsContainer.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon">
            <i class="fa-solid fa-cart-shopping"></i>
          </div>
          <p class="cart-empty-text">Coșul tău este gol.</p>
          <p class="cart-empty-sub">Adaugă produse din catalog pentru a începe.</p>
          <button class="btn btn-outline btn-sm" id="cart-empty-browse-btn" type="button">
            <i class="fa-solid fa-store"></i> Vezi Produsele
          </button>
        </div>
      `;
      if (cartFooter) cartFooter.style.display = 'none';

      const browseBtn = document.getElementById('cart-empty-browse-btn');
      if (browseBtn) {
        browseBtn.addEventListener('click', () => {
          closeCart();
          const grid = document.getElementById('shop-grid');
          if (grid) grid.scrollIntoView({ behavior: 'smooth' });
        });
      }
      return;
    }

    // Cart with items
    if (cartFooter) cartFooter.style.display = 'block';
    if (cartTotalAmount) {
      cartTotalAmount.textContent = getCartTotal().toFixed(2) + ' RON';
    }

    let html = '';
    cart.forEach(item => {
      const itemTotal = (item.price * item.quantity).toFixed(2);
      html += `
        <div class="cart-item" data-product-id="${item.id}">
          <div class="cart-item-img-wrap">
            ${item.image
              ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="cart-item-img" loading="lazy">`
              : `<div class="cart-item-img-placeholder"><i class="fa-solid fa-box"></i></div>`
            }
          </div>
          <div class="cart-item-info">
            <p class="cart-item-name">${escapeHtml(item.name)}</p>
            <p class="cart-item-price">${item.price.toFixed(2)} RON</p>
            <div class="cart-item-qty">
              <button class="cart-qty-btn" data-action="decrease" data-id="${item.id}"
                      aria-label="Scade cantitatea pentru ${escapeHtml(item.name)}"
                      ${item.quantity <= 1 ? 'disabled' : ''} type="button">
                <i class="fa-solid fa-minus"></i>
              </button>
              <input type="number" class="cart-qty-input" data-action="set"
                     data-id="${item.id}" value="${item.quantity}" min="1" max="100"
                     aria-label="Cantitate ${escapeHtml(item.name)}">
              <button class="cart-qty-btn" data-action="increase" data-id="${item.id}"
                      aria-label="Crește cantitatea pentru ${escapeHtml(item.name)}"
                      ${item.quantity >= 100 ? 'disabled' : ''} type="button">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
          <div class="cart-item-total">
            <p class="cart-item-total-price">${itemTotal} RON</p>
            <button class="cart-item-remove" data-action="remove" data-id="${item.id}"
                    aria-label="Elimină ${escapeHtml(item.name)} din coș" type="button">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      `;
    });

    cartItemsContainer.innerHTML = html;

    // Delegare evenimente pentru butoane și input-uri din coș
    attachCartItemEvents(cartItemsContainer);
  }

  function attachCartItemEvents(container) {
    // Butoane +/-
    $$('[data-action="decrease"]', container).forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = parseInt(this.getAttribute('data-id'), 10);
        updateQuantity(id, -1);
      });
    });

    $$('[data-action="increase"]', container).forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = parseInt(this.getAttribute('data-id'), 10);
        updateQuantity(id, 1);
      });
    });

    // Buton remove
    $$('[data-action="remove"]', container).forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const id = parseInt(this.getAttribute('data-id'), 10);
        removeFromCart(id);
      });
    });

    // Input direct cantitate (debounced)
    $$('.cart-qty-input', container).forEach(input => {
      let debounceTimer;
      input.addEventListener('input', function () {
        const id = parseInt(this.getAttribute('data-id'), 10);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          setQuantity(id, this.value);
        }, 600);
      });

      input.addEventListener('change', function () {
        const id = parseInt(this.getAttribute('data-id'), 10);
        clearTimeout(debounceTimer);
        setQuantity(id, this.value);
      });

      // Previne submit la Enter
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.blur();
        }
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // COȘ — offcanvas open/close
  // ──────────────────────────────────────────────────────────────────────────
  function openCart() {
    if (!cartOffcanvas || !cartOverlay) return;
    cartOffcanvas.setAttribute('aria-hidden', 'false');
    cartOverlay.setAttribute('aria-hidden', 'false');
    cartOffcanvas.classList.add('cart-offcanvas--open');
    cartOverlay.classList.add('cart-overlay--visible');
    if (cartToggleBtn) cartToggleBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    renderCartItems();
  }

  function closeCart() {
    if (!cartOffcanvas || !cartOverlay) return;
    cartOffcanvas.setAttribute('aria-hidden', 'true');
    cartOverlay.setAttribute('aria-hidden', 'true');
    cartOffcanvas.classList.remove('cart-offcanvas--open');
    cartOverlay.classList.remove('cart-overlay--visible');
    if (cartToggleBtn) cartToggleBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function toggleCart() {
    const isOpen = cartOffcanvas && cartOffcanvas.getAttribute('aria-hidden') === 'false';
    if (isOpen) {
      closeCart();
    } else {
      openCart();
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CHECKOUT MODAL
  // ──────────────────────────────────────────────────────────────────────────
  function openCheckoutModal() {
    const cart = getCart();
    if (cart.length === 0) {
      showToast('warning', 'Coșul tău este gol. Adaugă produse înainte de a finaliza comanda.');
      return;
    }

    closeCart();

    // Rezumat comandă
    let summaryHtml = '<div class="checkout-summary-title">Rezumat Comandă</div>';
    cart.forEach(item => {
      summaryHtml += `
        <div class="checkout-summary-row">
          <span>${escapeHtml(item.name)} &times; ${item.quantity}</span>
          <span>${(item.price * item.quantity).toFixed(2)} RON</span>
        </div>
      `;
    });
    summaryHtml += `
      <div class="checkout-summary-row checkout-summary-total">
        <strong>Total</strong>
        <strong>${getCartTotal().toFixed(2)} RON</strong>
      </div>
    `;
    if (checkoutSummary) checkoutSummary.innerHTML = summaryHtml;

    // Reset form
    if (checkoutForm) checkoutForm.reset();
    if (checkoutGlobalError) checkoutGlobalError.style.display = 'none';
    if (checkoutGlobalSuccess) checkoutGlobalSuccess.style.display = 'none';
    if (checkoutNameError) checkoutNameError.textContent = '';
    if (checkoutEmailError) checkoutEmailError.textContent = '';
    if (checkoutSubmitBtn) {
      checkoutSubmitBtn.disabled = false;
      checkoutSubmitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Plătește Acum';
    }

    if (checkoutModal) checkoutModal.setAttribute('aria-hidden', 'false');
    if (checkoutModalOverlay) checkoutModalOverlay.setAttribute('aria-hidden', 'false');
    if (checkoutModal) checkoutModal.classList.add('modal--open');
    if (checkoutModalOverlay) checkoutModalOverlay.classList.add('modal-overlay--visible');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const nameInput = document.getElementById('checkout-name');
      if (nameInput) nameInput.focus();
    }, 150);
  }

  function closeCheckoutModal() {
    if (checkoutModal) checkoutModal.setAttribute('aria-hidden', 'true');
    if (checkoutModalOverlay) checkoutModalOverlay.setAttribute('aria-hidden', 'true');
    if (checkoutModal) checkoutModal.classList.remove('modal--open');
    if (checkoutModalOverlay) checkoutModalOverlay.classList.remove('modal-overlay--visible');
    document.body.style.overflow = '';
  }

  async function submitCheckout(e) {
    e.preventDefault();

    if (checkoutSubmitting) return;

    // Reset errors
    if (checkoutGlobalError) checkoutGlobalError.style.display = 'none';
    if (checkoutGlobalSuccess) checkoutGlobalSuccess.style.display = 'none';
    if (checkoutNameError) checkoutNameError.textContent = '';
    if (checkoutEmailError) checkoutEmailError.textContent = '';

    const nameInput = document.getElementById('checkout-name');
    const emailInput = document.getElementById('checkout-email');
    const phoneInput = document.getElementById('checkout-phone');

    const name = nameInput ? nameInput.value.trim() : '';
    const email = emailInput ? emailInput.value.trim() : '';
    const phone = phoneInput ? phoneInput.value.trim() : '';

    let hasError = false;

    if (!name || name.length < 2) {
      if (checkoutNameError) checkoutNameError.textContent = 'Numele trebuie să aibă cel puțin 2 caractere.';
      hasError = true;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
      if (checkoutEmailError) checkoutEmailError.textContent = 'Adresa de email este invalidă.';
      hasError = true;
    }

    if (hasError) return;

    const cart = getCart();
    const items = cart.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    checkoutSubmitting = true;
    if (checkoutSubmitBtn) {
      checkoutSubmitBtn.disabled = true;
      checkoutSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Se procesează...';
    }

    try {
      const response = await fetch(`${API_BASE}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, customer: { name, email, phone } }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Eroare la procesarea plății.');
      }

      // Succes
      if (checkoutGlobalSuccess) {
        checkoutGlobalSuccess.style.display = 'block';
        checkoutGlobalSuccess.innerHTML = `
          <i class="fa-solid fa-circle-check"></i>
          ${escapeHtml(data.message || 'Comanda a fost creată cu succes!')}
        `;
      }

      // Golește coșul
      saveCart([]);
      updateCartUI();

      if (data.url) {
        // Redirect Stripe
        showToast('success', 'Redirecționare către pagina de plată...');
        setTimeout(() => {
          window.location.href = data.url;
        }, 1500);
      } else {
        // Fără URL — confirmare simplă
        showToast('success', data.message || 'Comanda a fost plasată cu succes!');
        setTimeout(() => {
          closeCheckoutModal();
        }, 2500);
      }
    } catch (err) {
      if (checkoutGlobalError) {
        checkoutGlobalError.style.display = 'block';
        checkoutGlobalError.textContent = err.message || 'Eroare la conectarea cu serverul. Încearcă din nou.';
      }
      showToast('error', err.message || 'Eroare la procesarea plății.');
    } finally {
      checkoutSubmitting = false;
      if (checkoutSubmitBtn) {
        checkoutSubmitBtn.disabled = false;
        checkoutSubmitBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Plătește Acum';
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRODUSE — fetch & render
  // ──────────────────────────────────────────────────────────────────────────
  async function loadProducts() {
    if (isLoading) return;
    isLoading = true;

    try {
      const response = await fetch(`${API_BASE}/products`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      allProducts = Array.isArray(data) ? data : [];
      loadError = null;
    } catch (err) {
      console.warn('[Shop] Nu s-au putut încărca produsele:', err.message);
      loadError = err.message;
      allProducts = [];
    } finally {
      isLoading = false;
    }

    // Ascunde scheletul de încărcare
    if (loadingSkeleton) {
      loadingSkeleton.style.display = 'none';
    }

    if (loadError && allProducts.length === 0) {
      renderLoadError();
    } else {
      renderProducts();
    }
  }

  function renderLoadError() {
    if (!productGrid) return;

    // Ascunde și scheletul
    if (loadingSkeleton) loadingSkeleton.style.display = 'none';

    productGrid.innerHTML = `
      <div class="shop-empty-state">
        <div class="shop-empty-icon">
          <i class="fa-solid fa-cloud-bolt"></i>
        </div>
        <h3 class="shop-empty-title">Eroare la încărcare</h3>
        <p class="shop-empty-desc">
          Nu am putut încărca produsele din catalog. Verifică conexiunea la internet și încearcă din nou.
        </p>
        <button class="btn btn-primary" id="shop-retry-btn" type="button">
          <i class="fa-solid fa-rotate-right"></i> Reîncearcă
        </button>
      </div>
    `;

    const retryBtn = document.getElementById('shop-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        loadError = null;
        if (loadingSkeleton) loadingSkeleton.style.display = '';
        productGrid.innerHTML = '';
        loadProducts();
      });
    }
  }

  function getFilteredAndSorted() {
    let filtered = [...allProducts];

    // Filtru categorie
    if (currentCategory !== 'all') {
      filtered = filtered.filter(p => {
        const cat = (p.category || '').trim();
        return cat === currentCategory;
      });
    }

    // Sortare
    switch (currentSort) {
      case 'price-asc':
        filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
        break;
      case 'price-desc':
        filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
        break;
      case 'name-asc':
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ro'));
        break;
      case 'name-desc':
        filtered.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'ro'));
        break;
      case 'newest':
      default:
        filtered.sort((a, b) => (b.id || 0) - (a.id || 0));
        break;
    }

    return filtered;
  }

  function renderProducts() {
    if (!productGrid) return;

    const filtered = getFilteredAndSorted();

    // Empty state
    if (filtered.length === 0) {
      const isFiltered = currentCategory !== 'all';
      productGrid.innerHTML = `
        <div class="shop-empty-state">
          <div class="shop-empty-icon">
            <i class="fa-solid ${isFiltered ? 'fa-filter-circle-xmark' : 'fa-box-open'}"></i>
          </div>
          <h3 class="shop-empty-title">
            ${isFiltered ? 'Niciun produs în această categorie' : 'Catalogul este momentan gol'}
          </h3>
          <p class="shop-empty-desc">
            ${isFiltered
              ? 'Nu există produse active în categoria selectată. Încearcă o altă categorie.'
              : 'Produsele vor apărea aici de îndată ce vor fi adăugate de administrator. Revino în curând!'}
          </p>
          ${isFiltered
            ? `<button class="btn btn-outline" id="shop-reset-filter-btn" type="button">
                 <i class="fa-solid fa-rotate-left"></i> Arată toate produsele
               </button>`
            : `<a href="/contact" class="btn btn-outline">
                 <i class="fa-solid fa-paper-plane"></i> Contactează-ne
               </a>`
          }
        </div>
      `;

      const resetBtn = document.getElementById('shop-reset-filter-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => setActiveCategory('all'));
      }
      return;
    }

    // Grid cu produse
    let html = '';
    filtered.forEach(product => {
      const hasDiscount = product.old_price && product.old_price > product.price;
      const discountPercent = hasDiscount
        ? Math.round((1 - product.price / product.old_price) * 100)
        : 0;

      html += `
        <div class="shop-product-card glass-card tilt-card fade-in">
          <div class="tilt-card-inner">
            <div class="tilt-card-glow"></div>
            <div class="tilt-card-shine"></div>
            <div class="shop-card-img-wrap">
              ${product.image
                ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="shop-card-img" loading="lazy">`
                : `<div class="shop-card-img-placeholder"><i class="fa-solid fa-image"></i></div>`
              }
              ${product.contextual_label
                ? `<span class="shop-card-badge shop-card-badge--context">${escapeHtml(product.contextual_label)}</span>`
                : ''}
              ${hasDiscount
                ? `<span class="shop-card-badge shop-card-badge--discount">-${discountPercent}%</span>`
                : ''}
              ${product.discount_label && !hasDiscount
                ? `<span class="shop-card-badge shop-card-badge--discount">${escapeHtml(product.discount_label)}</span>`
                : ''}
            </div>
            <div class="shop-card-body">
              <span class="shop-card-category">${escapeHtml(product.category || '')}</span>
              <h3 class="shop-card-name">${escapeHtml(product.name)}</h3>
              ${product.description
                ? `<p class="shop-card-desc">${escapeHtml(product.description.length > 80 ? product.description.slice(0, 80) + '...' : product.description)}</p>`
                : ''}
              <div class="shop-card-price-row">
                <div>
                  <span class="shop-card-price">${(product.price || 0).toFixed(2)} RON</span>
                  ${hasDiscount
                    ? `<span class="shop-card-old-price">${product.old_price.toFixed(2)} RON</span>`
                    : ''}
                </div>
                <span class="shop-card-stock ${product.stock > 0 ? 'shop-card-stock--ok' : 'shop-card-stock--out'}">
                  ${product.stock > 0
                    ? `<i class="fa-solid fa-circle-check"></i> În stoc`
                    : `<i class="fa-solid fa-circle-xmark"></i> Stoc epuizat`}
                </span>
              </div>
              <button class="btn btn-primary btn-block btn-sm shop-add-btn"
                      data-product-id="${product.id}"
                      data-product-name="${escapeHtml(product.name)}"
                      data-product-price="${product.price || 0}"
                      data-product-image="${escapeHtml(product.image || '')}"
                      data-product-stock="${product.stock || 0}"
                      ${(product.stock || 0) <= 0 ? 'disabled' : ''}
                      type="button">
                <i class="fa-solid fa-cart-plus"></i>
                ${(product.stock || 0) <= 0 ? 'Stoc Epuizat' : 'Adaugă în Coș'}
              </button>
            </div>
          </div>
        </div>
      `;
    });

    productGrid.innerHTML = html;

    // Atașează event listeners pentru butoanele "Adaugă în Coș"
    $$('.shop-add-btn', productGrid).forEach(btn => {
      btn.addEventListener('click', function () {
        const product = {
          id: parseInt(this.getAttribute('data-product-id'), 10),
          name: this.getAttribute('data-product-name'),
          price: parseFloat(this.getAttribute('data-product-price')),
          image: this.getAttribute('data-product-image'),
          stock: parseInt(this.getAttribute('data-product-stock'), 10),
        };
        addToCart(product);

        // Animație feedback pe buton
        this.classList.add('shop-add-btn--added');
        this.innerHTML = '<i class="fa-solid fa-circle-check"></i> Adăugat ✓';
        setTimeout(() => {
          this.classList.remove('shop-add-btn--added');
          this.innerHTML = '<i class="fa-solid fa-cart-plus"></i> Adaugă în Coș';
        }, 1500);
      });
    });
  }

  function setActiveCategory(category) {
    currentCategory = category;
    categoryTabs.forEach(tab => {
      const isActive = tab.getAttribute('data-category') === category;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.classList.toggle('active', isActive);
    });
    renderProducts();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EVENT LISTENERS
  // ──────────────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Category tabs
    categoryTabs.forEach(tab => {
      tab.addEventListener('click', function () {
        const category = this.getAttribute('data-category');
        setActiveCategory(category);
      });
    });

    // Sort
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        currentSort = this.value;
        renderProducts();
      });
    }

    // Cart toggle
    if (cartToggleBtn) cartToggleBtn.addEventListener('click', toggleCart);
    if (heroCartBtn) heroCartBtn.addEventListener('click', openCart);

    // Cart close
    if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCart);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCart);

    // Cart checkout
    if (cartCheckoutBtn) cartCheckoutBtn.addEventListener('click', openCheckoutModal);

    // Cart clear
    if (cartClearBtn) {
      cartClearBtn.addEventListener('click', function () {
        if (getCart().length === 0) return;
        if (confirm('Ești sigur că vrei să golești coșul?')) {
          clearCart();
          closeCart();
        }
      });
    }

    // Checkout modal close
    if (checkoutModalClose) checkoutModalClose.addEventListener('click', closeCheckoutModal);
    if (checkoutModalOverlay) checkoutModalOverlay.addEventListener('click', closeCheckoutModal);
    if (checkoutCancelBtn) checkoutCancelBtn.addEventListener('click', closeCheckoutModal);

    // Checkout form submit
    if (checkoutForm) checkoutForm.addEventListener('submit', submitCheckout);

    // Tastatură: Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (checkoutModal && checkoutModal.getAttribute('aria-hidden') === 'false') {
          closeCheckoutModal();
        } else if (cartOffcanvas && cartOffcanvas.getAttribute('aria-hidden') === 'false') {
          closeCart();
        }
      }
    });

    // Sincronizare cross-tab: ascultăm evenimentul storage
    window.addEventListener('storage', function (e) {
      if (e.key === CART_KEY) {
        updateCartUI();
        if (cartOffcanvas && cartOffcanvas.getAttribute('aria-hidden') === 'false') {
          renderCartItems();
        }
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAPTURE DOM REFERENCES
  // ──────────────────────────────────────────────────────────────────────────
  function captureDomRefs() {
    productGrid = document.getElementById('shop-product-grid');
    loadingSkeleton = document.getElementById('shop-loading-skeleton');
    cartToggleBtn = document.getElementById('cart-toggle-btn');
    cartCountBadge = document.getElementById('cart-count-badge');
    cartOffcanvas = document.getElementById('cart-offcanvas');
    cartOverlay = document.getElementById('cart-overlay');
    cartCloseBtn = document.getElementById('cart-close-btn');
    cartItemsContainer = document.getElementById('cart-items-container');
    cartFooter = document.getElementById('cart-footer');
    cartTotalAmount = document.getElementById('cart-total-amount');
    cartCheckoutBtn = document.getElementById('cart-checkout-btn');
    cartClearBtn = document.getElementById('cart-clear-btn');
    checkoutModal = document.getElementById('checkout-modal');
    checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    checkoutModalClose = document.getElementById('checkout-modal-close');
    checkoutForm = document.getElementById('checkout-form');
    checkoutSummary = document.getElementById('checkout-summary');
    checkoutCancelBtn = document.getElementById('checkout-cancel-btn');
    heroCartBtn = document.getElementById('hero-cart-btn');
    sortSelect = document.getElementById('shop-sort-select');
    categoryTabs = Array.from(document.querySelectorAll('.shop-cat-tab'));
    checkoutGlobalError = document.getElementById('checkout-global-error');
    checkoutGlobalSuccess = document.getElementById('checkout-global-success');
    checkoutNameError = document.getElementById('checkout-name-error');
    checkoutEmailError = document.getElementById('checkout-email-error');
    checkoutSubmitBtn = document.getElementById('checkout-submit-btn');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────────────────
  function init() {
    captureDomRefs();

    // Dacă nu suntem pe pagina de magazin, nu inițializăm
    if (!productGrid && !cartToggleBtn) return;

    // Inițializează UI coș
    updateCartUI();

    // Bind events
    bindEvents();

    // Încarcă produsele dacă suntem pe magazin
    if (productGrid) {
      loadProducts();
    }
  }

  // Pornim când DOM-ul e gata
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();