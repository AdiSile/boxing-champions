/**
 * ===========================================================================
 *  shop.js — Boxing Champions Shop
 * ===========================================================================
 * Features:
 *   1. Coș cumpărături localStorage (persistent)
 *   2. Checkout Stripe (test mode) via /api/checkout
 *   3. Logică promoții (coduri, discount per produs)
 *   4. Cart Drawer (offcanvas)
 *   5. Randare produse, filtre, căutare, sortare, paginare
 *   6. Toast notifications
 *   7. Fallback offline cu produse hardcodate
 *   8. Sincronizare promoții cu serverul (DB)
 * ===========================================================================
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
     Referințe la utilitarele globale
     ======================================================================== */
  var BC = window.BoxingChampions || {};
  var showToast = BC.showToast || function (msg, type, dur) { console.log('[toast]', type, msg); };
  var refreshScrollReveal = BC.refreshScrollReveal || function () {};

  /**
   * fetchJSON — wrapper sigur; folosește BC.fetchJSON dacă există,
   * altfel implementează local parsing JSON + error handling.
   */
  function fetchJSON(url, opts) {
    if (typeof BC.fetchJSON === 'function') {
      return BC.fetchJSON(url, opts);
    }

    // Fallback local robust
    var options = opts || {};
    var method = options.method || 'GET';
    var body = options.body || null;
    var headers = options.headers || {};

    var fetchHeaders = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    for (var h in headers) { if (headers.hasOwnProperty(h)) fetchHeaders[h] = headers[h]; }
    if (body && typeof body === 'object') { fetchHeaders['Content-Type'] = 'application/json'; }

    return fetch(url, {
      method: method,
      headers: fetchHeaders,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      var ct = response.headers.get('content-type') || '';
      if (ct.indexOf('application/json') !== -1) {
        return response.json().then(function (data) {
          if (!response.ok) {
            var err = new Error(data.error || data.message || ('HTTP ' + response.status));
            err.status = response.status;
            err.data = data;
            throw err;
          }
          return data;
        });
      }
      if (!response.ok) {
        var err2 = new Error('HTTP ' + response.status + ': ' + response.statusText);
        err2.status = response.status;
        throw err2;
      }
      return response.json();
    });
  }

  /* ========================================================================
     Configurare Stripe
     ======================================================================== */
  var STRIPE_CONFIG = {
    publishableKey: 'pk_test_placeholder',
    configured: false,
    mode: 'simulation', // 'simulation' | 'stripe'
  };

  /* ========================================================================
     Configurare Promoții
     ======================================================================== */
  var PROMO_CONFIG = {
    globalEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    globalBannerText: 'Promoție de vară: până la 35% reducere',
    globalBannerCode: 'CHAMP35',
    promos: [
      // Globale pe categorie (fallback)
      { id: 'global-gloves',   targetType: 'category', targetId: 'gloves',    discountPercent: 25, label: 'Reducere -25%', code: 'GLOVES25', active: true, discount_type: 'percentage', discount_value: 25 },
      { id: 'global-footwear', targetType: 'category', targetId: 'footwear',  discountPercent: 20, label: 'Reducere -20%', code: 'KICKS20',  active: true, discount_type: 'percentage', discount_value: 20 },
      { id: 'global-headgear', targetType: 'category', targetId: 'headgear',  discountPercent: 15, label: 'Reducere -15%', code: 'HEAD15',   active: true, discount_type: 'percentage', discount_value: 15 },
      { id: 'global-all',      targetType: 'all',      targetId: null,        discountPercent: 10, label: 'Reducere -10%', code: 'ALL10',    active: true, discount_type: 'percentage', discount_value: 10 },
      // Per-produs (prioritate maximă)
      { id: 'prod-special-1',  targetType: 'product',  targetId: 1,           discountPercent: 35, label: 'Super Reducere -35%', code: null, active: true, discount_type: 'percentage', discount_value: 35 },
      { id: 'prod-special-2',  targetType: 'product',  targetId: 3,           discountPercent: 30, label: 'Ofertă Specială -30%', code: null, active: true, discount_type: 'percentage', discount_value: 30 },
    ],
  };

  /* ========================================================================
     Coș cumpărături — localStorage
     ======================================================================== */
  var CART_STORAGE_KEY = 'boxing_champions_cart';

  var Cart = {
    items: [],
    appliedPromoCode: null,
    appliedPromoDiscount: 0,

    load: function () {
      try {
        var raw = localStorage.getItem(CART_STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          this.items = Array.isArray(parsed.items) ? parsed.items : [];
          this.appliedPromoCode = parsed.appliedPromoCode || null;
          this.appliedPromoDiscount = parsed.appliedPromoDiscount || 0;
        } else {
          this.items = [];
          this.appliedPromoCode = null;
          this.appliedPromoDiscount = 0;
        }
      } catch (e) {
        console.error('[cart] Eroare la încărcarea coșului:', e);
        this.items = [];
        this.appliedPromoCode = null;
        this.appliedPromoDiscount = 0;
      }
      return this;
    },

    save: function () {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
          items: this.items,
          appliedPromoCode: this.appliedPromoCode,
          appliedPromoDiscount: this.appliedPromoDiscount,
        }));
      } catch (e) {
        console.error('[cart] Eroare la salvarea coșului:', e);
      }
      return this;
    },

    add: function (product, quantity) {
      quantity = quantity || 1;
      var existing = null;
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].id === product.id) {
          existing = this.items[i];
          break;
        }
      }
      if (existing) {
        existing.quantity += quantity;
      } else {
        this.items.push({
          id: product.id,
          name: product.name,
          price: product.price,
          image: product.image || null,
          category: product.category || 'general',
          quantity: quantity,
        });
      }
      this.save();
      return this;
    },

    remove: function (productId) {
      this.items = this.items.filter(function (item) {
        return item.id !== productId;
      });
      this.save();
      return this;
    },

    setQuantity: function (productId, quantity) {
      if (quantity <= 0) {
        return this.remove(productId);
      }
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].id === productId) {
          this.items[i].quantity = Math.min(quantity, 99);
          break;
        }
      }
      this.save();
      return this;
    },

    applyPromo: function (code, discountPercent) {
      this.appliedPromoCode = code;
      this.appliedPromoDiscount = discountPercent;
      this.save();
      return this;
    },

    removePromo: function () {
      this.appliedPromoCode = null;
      this.appliedPromoDiscount = 0;
      this.save();
      return this;
    },

    getSubtotal: function () {
      var total = 0;
      for (var i = 0; i < this.items.length; i++) {
        total += this.items[i].price * this.items[i].quantity;
      }
      return Math.round(total * 100) / 100;
    },

    getTotal: function () {
      var subtotal = this.getSubtotal();
      if (this.appliedPromoDiscount > 0) {
        return Math.round(subtotal * (1 - this.appliedPromoDiscount / 100) * 100) / 100;
      }
      return subtotal;
    },

    getCount: function () {
      var count = 0;
      for (var i = 0; i < this.items.length; i++) {
        count += this.items[i].quantity;
      }
      return count;
    },

    clear: function () {
      this.items = [];
      this.appliedPromoCode = null;
      this.appliedPromoDiscount = 0;
      this.save();
      return this;
    },

    isEmpty: function () {
      return this.items.length === 0;
    },
  };

  /* ========================================================================
     Promo Engine
     ======================================================================== */

  function getProductPromo(product) {
    if (!product || !PROMO_CONFIG.promos) return null;
    var applicablePromos = [];
    var category = (product.category || '').toLowerCase();
    var productId = product.id;

    for (var i = 0; i < PROMO_CONFIG.promos.length; i++) {
      var promo = PROMO_CONFIG.promos[i];
      if (!promo.active) continue;
      var matches = false;
      if (promo.targetType === 'product' && promo.targetId === productId) {
        matches = true;
      } else if (promo.targetType === 'category' && promo.targetId === category) {
        matches = true;
      } else if (promo.targetType === 'all' || promo.targetType === 'products') {
        matches = true;
      }
      if (matches) {
        applicablePromos.push(promo);
      }
    }

    if (applicablePromos.length === 0) return null;

    // Alege promoția cu cel mai mare discount (pentru percentage)
    var bestPromo = applicablePromos[0];
    for (var j = 1; j < applicablePromos.length; j++) {
      if (applicablePromos[j].discountPercent > bestPromo.discountPercent) {
        bestPromo = applicablePromos[j];
      }
    }

    var price = Number(product.price) || 0;
    var discountedPrice = price;

    if (bestPromo.discount_type === 'fixed') {
      discountedPrice = Math.round(Math.max(0, price - bestPromo.discount_value) * 100) / 100;
    } else if (bestPromo.discountPercent > 0) {
      discountedPrice = Math.round(price * (1 - bestPromo.discountPercent / 100) * 100) / 100;
    }

    return {
      discountPercent: bestPromo.discountPercent || 0,
      discountValue: bestPromo.discount_value || 0,
      discountType: bestPromo.discount_type || 'percentage',
      label: bestPromo.label || ('Reducere -' + (bestPromo.discountPercent || 0) + '%'),
      code: bestPromo.code || null,
      originalPrice: price,
      discountedPrice: discountedPrice,
    };
  }

  /* ========================================================================
     Stripe Checkout
     ======================================================================== */

  function checkout(options) {
    var opts = options || {};
    var items = opts.items || Cart.items;
    var promoCode = opts.promoCode || Cart.appliedPromoCode;

    if (!items || items.length === 0) {
      if (typeof opts.onError === 'function') {
        opts.onError(new Error('Coșul este gol.'));
      }
      return;
    }

    // Trimitem doar product_id și quantity. Serverul folosește
    // prețurile din baza de date pentru a preveni manipularea.
    var payload = {
      items: items.map(function (item) {
        return {
          product_id: item.id,
          quantity: item.quantity,
        };
      }),
      promo_code: promoCode || undefined,
      success_url: window.location.origin + '/shop.html?success=true',
      cancel_url: window.location.origin + '/shop.html?canceled=true',
    };

    fetchJSON('/api/checkout', {
      method: 'POST',
      body: payload,
    })
      .then(function (data) {
        if (data && data.url) {
          if (data.mode === 'stripe') {
            // Redirecționare către Stripe Checkout
            window.location.href = data.url;
          } else if (data.mode === 'simulation') {
            var orderInfo = data.order || {};
            showToast(
              'Comand\u0103 simulat\u0103 #' + (orderInfo.order_number || 'N/A') +
              ' | Total: ' + (orderInfo.total_amount || 0) + ' RON',
              'success',
              5000
            );
            Cart.clear();
            updateCartUI();
            if (typeof opts.onSuccess === 'function') {
              opts.onSuccess(data);
            }
          }
        } else if (data && data.success) {
          // Răspuns de succes fără URL explicit
          var ord = data.order || {};
          showToast(
            'Comand\u0103 procesat\u0103 #' + (ord.order_number || 'N/A') +
            ' | Total: ' + (ord.total_amount || 0) + ' RON',
            'success',
            5000
          );
          Cart.clear();
          updateCartUI();
          if (typeof opts.onSuccess === 'function') {
            opts.onSuccess(data);
          }
        } else {
          throw new Error('Răspuns invalid de la server.');
        }
      })
      .catch(function (err) {
        console.error('[checkout] Eroare:', err);
        showToast('Eroare la procesarea pl\u0103\u021Bii: ' + (err.message || 'Eroare necunoscut\u0103'), 'error', 5000);
        if (typeof opts.onError === 'function') {
          opts.onError(err);
        }
      });
  }

  /**
   * Validează un cod promoțional. Încearcă API-ul serverului (DB),
   * apoi fallback local pentru cazul offline.
   */
  function validatePromoCode(code, cartTotal, callback) {
    fetchJSON('/api/checkout/validate-promo/' + encodeURIComponent(code) + '?cart_total=' + (cartTotal || 0))
      .then(function (data) {
        // Serverul returnează răspunsul de validare
        if (data && data.valid) {
          callback(null, {
            valid: true,
            code: data.code,
            discount_percent: data.discount_type === 'percentage' ? data.discount_value : 0,
            discount_value: data.discount_type === 'fixed' ? data.discount_value : 0,
            discount_amount: data.discount_amount || 0,
            discount_type: data.discount_type || 'percentage',
            description: data.description,
          });
        } else if (data && !data.valid) {
          callback(null, {
            valid: false,
            code: code.trim().toUpperCase(),
            error: data.error || 'Cod promo\u021Bional invalid.',
          });
        } else {
          // Răspuns ambiguu — fallback local
          var localResult = validatePromoLocal(code, cartTotal);
          callback(null, localResult);
        }
      })
      .catch(function (err) {
        // Doar la erori de rețea folosim fallback-ul local
        console.warn('[shop] Promo validation API error, using local fallback:', err.message);
        var localResult = validatePromoLocal(code, cartTotal);
        callback(null, localResult);
      });
  }

  function validatePromoLocal(code, cartTotal) {
    var localPromos = {
      'CHAMP35': { discountPercent: 35, discount_type: 'percentage', discount_value: 35, description: 'Promo\u021Bie de var\u0103 -35%', minOrder: 0 },
      'GLOVES25': { discountPercent: 25, discount_type: 'percentage', discount_value: 25, description: 'Reducere m\u0103nu\u0219i -25%', minOrder: 0 },
      'KICKS20': { discountPercent: 20, discount_type: 'percentage', discount_value: 20, description: 'Reducere \u00EEnc\u0103l\u021B\u0103minte -20%', minOrder: 0 },
      'HEAD15': { discountPercent: 15, discount_type: 'percentage', discount_value: 15, description: 'Reducere c\u0103\u0219ti -15%', minOrder: 0 },
      'ALL10': { discountPercent: 10, discount_type: 'percentage', discount_value: 10, description: 'Reducere general\u0103 -10%', minOrder: 0 },
      'BOXING20': { discountPercent: 20, discount_type: 'percentage', discount_value: 20, description: 'Reducere campion -20%', minOrder: 200 },
      'WELCOME20': { discountPercent: 20, discount_type: 'percentage', discount_value: 20, description: '20% reducere pentru noii membri', minOrder: 0 },
      'BOXER10': { discountPercent: 10, discount_type: 'percentage', discount_value: 10, description: '10% reducere la produse', minOrder: 0 },
      'CAMP2025': { discountPercent: 0, discount_value: 100, discount_type: 'fixed', description: '100 RON reducere tab\u0103r\u0103', minOrder: 0 },
    };

    var normalized = code.trim().toUpperCase();
    var promo = localPromos[normalized];

    if (!promo) {
      return { valid: false, code: normalized, error: 'Cod promo\u021Bional invalid.' };
    }

    if (cartTotal < promo.minOrder) {
      return {
        valid: false,
        code: normalized,
        error: 'Necesit\u0103 comand\u0103 minim\u0103 de ' + promo.minOrder + ' RON.',
        min_order: promo.minOrder,
      };
    }

    return {
      valid: true,
      code: normalized,
      discount_percent: promo.discountPercent || 0,
      discount_value: promo.discount_value || 0,
      discount_type: promo.discount_type || 'percentage',
      description: promo.description,
      min_order: promo.minOrder,
    };
  }

  /* ========================================================================
     Cart Drawer UI
     ======================================================================== */

  function createCartDrawer() {
    if (document.getElementById('cart-drawer')) return;

    var drawerHTML = '' +
      '<div class="cart-drawer-overlay" id="cart-drawer-overlay" aria-hidden="true"></div>' +
      '<aside class="cart-drawer" id="cart-drawer" aria-label="Co\u0219 de cump\u0103r\u0103turi" aria-hidden="true">' +
      '  <div class="cart-drawer__header">' +
      '    <h3 class="cart-drawer__title"><i class="fa-solid fa-cart-shopping"></i> Co\u0219ul t\u0103u</h3>' +
      '    <span class="cart-drawer__count" id="cart-drawer-count">0 articole</span>' +
      '    <button class="cart-drawer__close" id="cart-drawer-close" aria-label="\u00CEnchide co\u0219ul">&times;</button>' +
      '  </div>' +
      '  <div class="cart-drawer__body" id="cart-drawer-body">' +
      '    <div class="cart-drawer__empty">' +
      '      <span class="cart-drawer__empty-icon"><i class="fa-solid fa-box-open"></i></span>' +
      '      <p>Co\u0219ul t\u0103u este gol.</p>' +
      '      <p class="cart-drawer__empty-hint">Adaug\u0103 produse din catalog pentru a \u00EEncepe.</p>' +
      '    </div>' +
      '  </div>' +
      '  <div class="cart-drawer__footer" id="cart-drawer-footer">' +
      '    <div class="cart-drawer__promo" id="cart-drawer-promo">' +
      '      <input type="text" class="cart-drawer__promo-input" id="cart-promo-input" placeholder="Cod promo\u021Bional..." maxlength="20" aria-label="Cod promo\u021Bional">' +
      '      <button class="cart-drawer__promo-btn" id="cart-promo-apply">Aplic\u0103</button>' +
      '    </div>' +
      '    <div class="cart-drawer__promo-msg" id="cart-promo-msg"></div>' +
      '    <div class="cart-drawer__totals">' +
      '      <div class="cart-drawer__subtotal">' +
      '        <span>Subtotal</span>' +
      '        <span id="cart-drawer-subtotal">0 RON</span>' +
      '      </div>' +
      '      <div class="cart-drawer__discount" id="cart-drawer-discount-row" style="display:none">' +
      '        <span>Reducere <span id="cart-drawer-discount-label"></span></span>' +
      '        <span class="cart-drawer__discount-amount" id="cart-drawer-discount-amount">-0 RON</span>' +
      '      </div>' +
      '      <div class="cart-drawer__total">' +
      '        <span>Total</span>' +
      '        <span id="cart-drawer-total">0 RON</span>' +
      '      </div>' +
      '    </div>' +
      '    <button class="cart-drawer__checkout-btn" id="cart-checkout-btn" disabled>' +
      '      <i class="fa-solid fa-credit-card"></i> Finalizeaz\u0103 comanda' +
      '    </button>' +
      '  </div>' +
      '</aside>';

    var container = document.createElement('div');
    container.innerHTML = drawerHTML;
    document.body.appendChild(container.firstElementChild);
    document.body.appendChild(container.firstElementChild);

    injectCartStyles();
    bindCartDrawerEvents();
  }

  function injectCartStyles() {
    if (document.getElementById('cart-drawer-styles')) return;

    var styles = '' +
      '.cart-drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 6000; opacity: 0; pointer-events: none; transition: opacity 0.35s; }' +
      '.cart-drawer-overlay--visible { opacity: 1; pointer-events: auto; }' +
      '.cart-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: #111; z-index: 6001; display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); box-shadow: -4px 0 40px rgba(0,0,0,0.6); }' +
      '.cart-drawer--open { transform: translateX(0); }' +
      '.cart-drawer__header { display: flex; align-items: center; gap: 1rem; padding: 1.2rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }' +
      '.cart-drawer__title { font-family: "Oswald", "Arial Black", sans-serif; font-size: 1.2rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; color: #d4a843; }' +
      '.cart-drawer__count { font-size: 0.78rem; color: #aaa; margin-left: auto; }' +
      '.cart-drawer__close { background: none; border: none; color: #aaa; font-size: 1.8rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }' +
      '.cart-drawer__close:hover { color: #d4a843; }' +
      '.cart-drawer__body { flex: 1; overflow-y: auto; padding: 1.2rem 1.5rem; }' +
      '.cart-drawer__empty { text-align: center; padding: 3rem 1rem; color: #aaa; }' +
      '.cart-drawer__empty-icon { font-size: 3rem; display: block; margin-bottom: 1rem; opacity: 0.5; }' +
      '.cart-drawer__empty-hint { font-size: 0.82rem; opacity: 0.6; margin-top: 0.4rem; }' +
      '.cart-drawer__item { display: flex; gap: 0.9rem; align-items: center; padding: 0.9rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); }' +
      '.cart-drawer__item-img { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: #1a1a1a; flex-shrink: 0; }' +
      '.cart-drawer__item-info { flex: 1; min-width: 0; }' +
      '.cart-drawer__item-name { font-family: "Oswald", "Arial Black", sans-serif; font-size: 0.88rem; color: #eee; margin-bottom: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' +
      '.cart-drawer__item-price { font-size: 0.85rem; color: #d4a843; }' +
      '.cart-drawer__item-qty { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }' +
      '.cart-drawer__qty-btn { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: #ccc; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; padding: 0; line-height: 1; }' +
      '.cart-drawer__qty-btn:hover { border-color: #d4a843; color: #d4a843; }' +
      '.cart-drawer__qty-val { font-size: 0.88rem; color: #eee; min-width: 24px; text-align: center; }' +
      '.cart-drawer__item-remove { background: none; border: none; color: #f44336; cursor: pointer; font-size: 0.85rem; padding: 0.2rem; opacity: 0.6; transition: opacity 0.2s; }' +
      '.cart-drawer__item-remove:hover { opacity: 1; }' +
      '.cart-drawer__footer { padding: 1.2rem 1.5rem; border-top: 1px solid rgba(255,255,255,0.08); flex-shrink: 0; }' +
      '.cart-drawer__promo { display: flex; gap: 0.5rem; margin-bottom: 0.8rem; }' +
      '.cart-drawer__promo-input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0.55em 0.8em; color: #eee; font-size: 0.82rem; outline: none; transition: border-color 0.2s; }' +
      '.cart-drawer__promo-input:focus { border-color: #d4a843; }' +
      '.cart-drawer__promo-btn { font-family: "Oswald", "Arial Black", sans-serif; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.5em 1em; border-radius: 8px; border: 1px solid #d4a843; background: transparent; color: #d4a843; cursor: pointer; transition: all 0.2s; white-space: nowrap; }' +
      '.cart-drawer__promo-btn:hover { background: #d4a843; color: #000; }' +
      '.cart-drawer__promo-msg { font-size: 0.75rem; margin-bottom: 0.6rem; min-height: 1.2em; }' +
      '.cart-drawer__promo-msg--success { color: #4caf50; }' +
      '.cart-drawer__promo-msg--error { color: #f44336; }' +
      '.cart-drawer__promo-applied { display: flex; align-items: center; gap: 0.5rem; background: rgba(76,175,80,0.1); border: 1px solid rgba(76,175,80,0.3); border-radius: 8px; padding: 0.45em 0.8em; margin-bottom: 0.8rem; font-size: 0.78rem; }' +
      '.cart-drawer__promo-applied-code { font-weight: 700; color: #4caf50; letter-spacing: 0.06em; }' +
      '.cart-drawer__promo-applied-remove { margin-left: auto; background: none; border: none; color: #f44336; cursor: pointer; font-size: 1rem; padding: 0; line-height: 1; }' +
      '.cart-drawer__totals { margin-bottom: 1rem; }' +
      '.cart-drawer__subtotal, .cart-drawer__discount, .cart-drawer__total { display: flex; justify-content: space-between; align-items: center; padding: 0.35em 0; font-size: 0.88rem; }' +
      '.cart-drawer__subtotal { color: #aaa; }' +
      '.cart-drawer__discount { color: #4caf50; }' +
      '.cart-drawer__discount-amount { font-weight: 700; }' +
      '.cart-drawer__total { font-family: "Oswald", "Arial Black", sans-serif; font-size: 1.15rem; color: #d4a843; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 0.6em; margin-top: 0.4em; }' +
      '.cart-drawer__checkout-btn { width: 100%; font-family: "Oswald", "Arial Black", sans-serif; font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.8em; border: none; border-radius: 12px; background: linear-gradient(135deg, #d4a843, #b8860b); color: #000; cursor: pointer; font-weight: 700; transition: all 0.3s; box-shadow: 0 4px 20px rgba(212,168,67,0.25); }' +
      '.cart-drawer__checkout-btn:hover:not(:disabled) { box-shadow: 0 6px 28px rgba(212,168,67,0.4); transform: translateY(-1px); }' +
      '.cart-drawer__checkout-btn:disabled { background: #333; color: #666; cursor: not-allowed; box-shadow: none; }' +
      '@media (max-width: 480px) { .cart-drawer { width: 100vw; } }';

    var styleEl = document.createElement('style');
    styleEl.id = 'cart-drawer-styles';
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }

  function bindCartDrawerEvents() {
    var overlay = document.getElementById('cart-drawer-overlay');
    var closeBtn = document.getElementById('cart-drawer-close');
    var checkoutBtn = document.getElementById('cart-checkout-btn');
    var promoInput = document.getElementById('cart-promo-input');
    var promoApply = document.getElementById('cart-promo-apply');

    if (overlay) overlay.addEventListener('click', closeCartDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeCartDrawer);

    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', function () {
        if (Cart.isEmpty()) return;
        checkout({ onSuccess: function () { closeCartDrawer(); } });
      });
    }

    if (promoApply && promoInput) {
      promoApply.addEventListener('click', function () {
        var code = promoInput.value.trim();
        if (!code) return;
        applyPromoCodeAction(code);
      });
      promoInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var code = promoInput.value.trim();
          if (!code) return;
          applyPromoCodeAction(code);
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var drawer = document.getElementById('cart-drawer');
        if (drawer && drawer.classList.contains('cart-drawer--open')) {
          closeCartDrawer();
        }
      }
    });
  }

  function openCartDrawer() {
    createCartDrawer();
    updateCartUI();
    var overlay = document.getElementById('cart-drawer-overlay');
    var drawer = document.getElementById('cart-drawer');
    if (overlay) { overlay.classList.add('cart-drawer-overlay--visible'); overlay.setAttribute('aria-hidden', 'false'); }
    if (drawer) { drawer.classList.add('cart-drawer--open'); drawer.setAttribute('aria-hidden', 'false'); }
    document.body.style.overflow = 'hidden';
  }

  function closeCartDrawer() {
    var overlay = document.getElementById('cart-drawer-overlay');
    var drawer = document.getElementById('cart-drawer');
    if (overlay) { overlay.classList.remove('cart-drawer-overlay--visible'); overlay.setAttribute('aria-hidden', 'true'); }
    if (drawer) { drawer.classList.remove('cart-drawer--open'); drawer.setAttribute('aria-hidden', 'true'); }
    document.body.style.overflow = '';
  }

  function updateCartUI() {
    var body = document.getElementById('cart-drawer-body');
    var countEl = document.getElementById('cart-drawer-count');
    var subtotalEl = document.getElementById('cart-drawer-subtotal');
    var totalEl = document.getElementById('cart-drawer-total');
    var discountRow = document.getElementById('cart-drawer-discount-row');
    var discountLabel = document.getElementById('cart-drawer-discount-label');
    var discountAmount = document.getElementById('cart-drawer-discount-amount');
    var checkoutBtn = document.getElementById('cart-checkout-btn');
    var promoMsg = document.getElementById('cart-promo-msg');
    if (!body) return;

    var subtotal = Cart.getSubtotal();
    var total = Cart.getTotal();
    var count = Cart.getCount();
    var hasPromo = Cart.appliedPromoCode && Cart.appliedPromoDiscount > 0;
    var discountValue = hasPromo ? Math.round((subtotal - total) * 100) / 100 : 0;

    if (countEl) countEl.textContent = count + ' articol' + (count === 1 ? '' : 'e');
    if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString('ro-RO') + ' RON';
    if (discountRow) discountRow.style.display = hasPromo ? 'flex' : 'none';
    if (discountLabel) discountLabel.textContent = hasPromo ? '(' + Cart.appliedPromoCode + ' -' + Cart.appliedPromoDiscount + '%)' : '';
    if (discountAmount) discountAmount.textContent = '-' + discountValue.toLocaleString('ro-RO') + ' RON';
    if (totalEl) totalEl.textContent = total.toLocaleString('ro-RO') + ' RON';
    if (checkoutBtn) checkoutBtn.disabled = Cart.isEmpty();

    if (Cart.isEmpty()) {
      body.innerHTML = '<div class="cart-drawer__empty"><span class="cart-drawer__empty-icon"><i class="fa-solid fa-box-open"></i></span><p>Co\u0219ul t\u0103u este gol.</p><p class="cart-drawer__empty-hint">Adaug\u0103 produse din catalog pentru a \u00EEncepe.</p></div>';
    } else {
      var itemsHTML = '';
      for (var i = 0; i < Cart.items.length; i++) {
        var item = Cart.items[i];
        var imgSrc = item.image || '/images/product-gloves.jpg';
        var lineTotal = Math.round(item.price * item.quantity * 100) / 100;
        itemsHTML += '<div class="cart-drawer__item" data-cart-item="' + item.id + '">' +
          '<img class="cart-drawer__item-img" src="' + escapeHTML(imgSrc) + '" alt="' + escapeHTML(item.name) + '" loading="lazy" onerror="this.src=\'/images/product-gloves.jpg\'">' +
          '<div class="cart-drawer__item-info"><div class="cart-drawer__item-name">' + escapeHTML(item.name) + '</div><div class="cart-drawer__item-price">' + lineTotal.toLocaleString('ro-RO') + ' RON</div></div>' +
          '<div class="cart-drawer__item-qty"><button class="cart-drawer__qty-btn" data-cart-dec="' + item.id + '" aria-label="Scade cantitatea">\u2212</button><span class="cart-drawer__qty-val">' + item.quantity + '</span><button class="cart-drawer__qty-btn" data-cart-inc="' + item.id + '" aria-label="Cre\u0219te cantitatea">+</button></div>' +
          '<button class="cart-drawer__item-remove" data-cart-remove="' + item.id + '" aria-label="Elimin\u0103 ' + escapeHTML(item.name) + '" title="Elimin\u0103"><i class="fa-solid fa-trash"></i></button></div>';
      }
      body.innerHTML = itemsHTML;
      bindCartItemEvents();
    }

    if (promoMsg) {
      if (hasPromo) {
        promoMsg.innerHTML = '<div class="cart-drawer__promo-applied"><span><i class="fa-solid fa-ticket"></i> Cod <span class="cart-drawer__promo-applied-code">' + escapeHTML(Cart.appliedPromoCode) + '</span> aplicat (-' + Cart.appliedPromoDiscount + '%)</span><button class="cart-drawer__promo-applied-remove" id="cart-promo-remove" aria-label="Elimin\u0103 codul promo\u021Bional">&times;</button></div>';
        var removeBtn = document.getElementById('cart-promo-remove');
        if (removeBtn) removeBtn.addEventListener('click', function () { Cart.removePromo(); updateCartUI(); showToast('Codul promo\u021Bional a fost eliminat.', 'info', 2500); });
      } else {
        promoMsg.innerHTML = '';
      }
    }

    updateCartIcon(count);
  }

  function bindCartItemEvents() {
    var decBtns = document.querySelectorAll('[data-cart-dec]');
    for (var i = 0; i < decBtns.length; i++) {
      decBtns[i].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-cart-dec'), 10);
        var item = findCartItem(id);
        if (item) { Cart.setQuantity(id, item.quantity - 1); updateCartUI(); }
      });
    }
    var incBtns = document.querySelectorAll('[data-cart-inc]');
    for (var j = 0; j < incBtns.length; j++) {
      incBtns[j].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-cart-inc'), 10);
        var item = findCartItem(id);
        if (item) { Cart.setQuantity(id, item.quantity + 1); updateCartUI(); }
      });
    }
    var removeBtns = document.querySelectorAll('[data-cart-remove]');
    for (var k = 0; k < removeBtns.length; k++) {
      removeBtns[k].addEventListener('click', function () {
        var id = parseInt(this.getAttribute('data-cart-remove'), 10);
        var item = findCartItem(id);
        Cart.remove(id);
        updateCartUI();
        if (item) showToast('<i class="fa-solid fa-trash"></i> ' + escapeHTML(item.name) + ' eliminat din co\u0219.', 'info', 2500);
      });
    }
  }

  function findCartItem(id) {
    for (var i = 0; i < Cart.items.length; i++) { if (Cart.items[i].id === id) return Cart.items[i]; }
    return null;
  }

  function applyPromoCodeAction(code) {
    var promoInput = document.getElementById('cart-promo-input');
    var promoMsg = document.getElementById('cart-promo-msg');
    var subtotal = Cart.getSubtotal();
    validatePromoCode(code, subtotal, function (err, result) {
      if (err || !result) {
        if (promoMsg) { promoMsg.textContent = 'Eroare la validarea codului.'; promoMsg.className = 'cart-drawer__promo-msg cart-drawer__promo-msg--error'; }
        return;
      }
      if (result.valid) {
        var discountPercent = result.discount_percent || 0;
        Cart.applyPromo(result.code, discountPercent);
        updateCartUI();
        if (promoMsg) { promoMsg.textContent = ''; promoMsg.className = 'cart-drawer__promo-msg'; }
        if (promoInput) promoInput.value = '';
        showToast('Cod promo\u021Bional aplicat: -' + discountPercent + '%', 'success', 3000);
      } else {
        if (promoMsg) { promoMsg.textContent = result.error || 'Cod promo\u021Bional invalid.'; promoMsg.className = 'cart-drawer__promo-msg cart-drawer__promo-msg--error'; }
      }
    });
  }

  var _cartIconEl = null;

  function getCartIconEl() {
    if (!_cartIconEl) {
      _cartIconEl = document.getElementById('cart-floating-icon');
      if (!_cartIconEl) {
        _cartIconEl = document.createElement('button');
        _cartIconEl.id = 'cart-floating-icon';
        _cartIconEl.className = 'cart-floating-icon';
        _cartIconEl.setAttribute('aria-label', 'Deschide co\u0219ul de cump\u0103r\u0103turi');
        _cartIconEl.innerHTML = '<span class="cart-floating-icon__icon"><i class="fa-solid fa-cart-shopping"></i></span><span class="cart-floating-icon__count" id="cart-floating-count">0</span>';
        _cartIconEl.addEventListener('click', function (e) { e.preventDefault(); openCartDrawer(); });
        document.body.appendChild(_cartIconEl);
        var iconStyles = '.cart-floating-icon { position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 5000; width: 56px; height: 56px; border-radius: 50%; border: 2px solid #d4a843; background: rgba(10,10,10,0.9); backdrop-filter: blur(10px); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }' +
          '.cart-floating-icon:hover { border-color: #fff; box-shadow: 0 6px 28px rgba(212,168,67,0.35); transform: translateY(-2px); }' +
          '.cart-floating-icon__icon { font-size: 1.3rem; color: #d4a843; }' +
          '.cart-floating-icon__count { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; border-radius: 50%; background: #d4a843; color: #000; font-size: 0.7rem; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: "Arial", sans-serif; transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.27, 1.55); }' +
          '.cart-floating-icon__count--pulse { transform: scale(1.4); }' +
          '@media (max-width: 480px) { .cart-floating-icon { width: 48px; height: 48px; bottom: 1rem; right: 1rem; } .cart-floating-icon__count { min-width: 20px; height: 20px; font-size: 0.65rem; top: -5px; right: -5px; } }';
        var iconStyleEl = document.createElement('style');
        iconStyleEl.textContent = iconStyles;
        document.head.appendChild(iconStyleEl);
      }
    }
    return _cartIconEl;
  }

  function updateCartIcon(count) {
    var countSpan = document.getElementById('cart-floating-count');
    if (countSpan) {
      var prevCount = parseInt(countSpan.textContent, 10) || 0;
      countSpan.textContent = count;
      if (count !== prevCount && count > 0) {
        countSpan.classList.add('cart-floating-icon__count--pulse');
        setTimeout(function () { countSpan.classList.remove('cart-floating-icon__count--pulse'); }, 400);
      }
    }
  }

  /* ========================================================================
     Shop State
     ======================================================================== */
  var state = {
    products: [],
    categories: [],
    pagination: null,
    activeCategory: '',
    sort: '',
    search: '',
    page: 1,
    limit: 12,
    loading: false,
    searchDebounce: null,
  };

  var CATEGORY_LABELS = {
    'general': 'Generale', 'gloves': 'M\u0103nu\u0219i', 'headgear': 'C\u0103\u0219ti', 'footwear': '\u00CEnc\u0103l\u021B\u0103minte',
    'apparel': '\u00CEmbr\u0103c\u0103minte', 'protection': 'Protec\u021Bie', 'accessories': 'Accesorii', 'equipment': 'Echipament',
  };

  var FALLBACK_PRODUCTS = [
    { id: 1, name: 'M\u0103nu\u0219i Profesionale Gold', slug: 'manusi-profesionale-gold', price: 349.99, category: 'gloves', image: '/images/shop-gloves.jpg', stock: 25, is_active: true },
    { id: 2, name: 'Casc\u0103 de Protec\u021Bie Elite', slug: 'casca-protectie-elite', price: 249.99, category: 'headgear', image: '/images/shop-headgear.jpg', stock: 18, is_active: true },
    { id: 3, name: '\u00CEnc\u0103l\u021B\u0103minte Box RingMaster', slug: 'incaltaminte-box-ringmaster', price: 449.99, category: 'footwear', image: '/images/shop-shoes.jpg', stock: 12, is_active: true },
    { id: 4, name: 'Bandaje M\u00E2ini Premium 5m', slug: 'bandaje-maini-premium', price: 49.99, category: 'accessories', image: '/images/product-gloves.jpg', stock: 50, is_active: true },
    { id: 5, name: 'Gur\u0103 de Protec\u021Bie Pro', slug: 'gura-protectie-pro', price: 79.99, category: 'protection', image: '/images/product-gloves.jpg', stock: 0, is_active: true },
    { id: 6, name: 'M\u0103nu\u0219i Antrenament Lite', slug: 'manusi-antrenament-lite', price: 199.99, category: 'gloves', image: '/images/product-gloves.jpg', stock: 33, is_active: true },
    { id: 7, name: 'Top F\u0103r\u0103 M\u00E2neci BC Pro', slug: 'top-fara-maneci-bc-pro', price: 129.99, category: 'apparel', image: '/images/shop-gloves.jpg', stock: 40, is_active: true },
    { id: 8, name: 'Sac Box 45kg Heavy Duty', slug: 'sac-box-heavy-duty', price: 699.99, category: 'equipment', image: '/images/product-gloves.jpg', stock: 5, is_active: true },
  ];

  var FALLBACK_CATEGORIES = [
    { category: 'gloves', productCount: 2 }, { category: 'headgear', productCount: 1 }, { category: 'footwear', productCount: 1 },
    { category: 'accessories', productCount: 1 }, { category: 'protection', productCount: 1 }, { category: 'apparel', productCount: 1 }, { category: 'equipment', productCount: 1 },
  ];

  /* ========================================================================
     Helpers
     ======================================================================== */
  function escapeHTML(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function getCategoryLabel(cat) {
    return CATEGORY_LABELS[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
  }

  async function safeFetch(url, opts) {
    if (typeof fetchJSON === 'function') return fetchJSON(url, opts);
    var res = await fetch(url, opts || {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* ========================================================================
     Product Card Builder
     ======================================================================== */

  function buildProductCard(product) {
    var name = escapeHTML(product.name);
    var category = escapeHTML(getCategoryLabel(product.category));
    var image = escapeHTML(product.image || '/images/product-gloves.jpg');
    var stock = product.stock !== null && product.stock !== undefined ? Number(product.stock) : null;
    var price = Number(product.price) || 0;
    var promo = getProductPromo(product);

    var tags = [];
    if (promo) tags.push('<span class="product-card__tag product-card__tag--promo">' + escapeHTML(promo.label) + '</span>');
    if (!promo && product.id > 5) tags.push('<span class="product-card__tag product-card__tag--new">Nou</span>');
    if (product.id === 1 || product.id === 4) tags.push('<span class="product-card__tag product-card__tag--bestseller">Best Seller</span>');

    var stockInfo = '';
    if (stock !== null) {
      if (stock === 0) { stockInfo = '<span class="product-card__stock product-card__stock--out"><span class="product-card__stock-dot"></span>Stoc epuizat</span>'; tags.push('<span class="product-card__tag product-card__tag--outofstock">Epuizat</span>'); }
      else if (stock <= 5) { stockInfo = '<span class="product-card__stock product-card__stock--low"><span class="product-card__stock-dot"></span>Ultimele ' + stock + ' buc.</span>'; tags.push('<span class="product-card__tag product-card__tag--lowstock">Stoc limitat</span>'); }
      else { stockInfo = '<span class="product-card__stock"><span class="product-card__stock-dot"></span>\u00CEn stoc</span>'; }
    }

    var tagsHTML = tags.length > 0 ? '<div class="product-card__tags">' + tags.join('') + '</div>' : '';

    var pricingHTML = '';
    if (promo) {
      pricingHTML = '<div class="product-card__pricing"><span class="product-card__price--old">' + promo.originalPrice.toLocaleString('ro-RO') + ' RON</span><span class="product-card__discount-badge">-' + promo.discountPercent + '%</span></div>' +
        '<div class="product-card__price"><span class="currency">RON</span>' + promo.discountedPrice.toLocaleString('ro-RO') + '</div>';
    } else {
      pricingHTML = '<div class="product-card__price"><span class="currency">RON</span>' + price.toLocaleString('ro-RO') + '</div>';
    }

    var actionsHTML = '';
    if (stock === null || stock > 0) {
      actionsHTML = '<div class="product-card__actions"><button class="product-card__action-btn" title="Adaug\u0103 \u00EEn co\u0219" aria-label="Adaug\u0103 ' + name + ' \u00EEn co\u0219" data-add-cart="' + product.id + '"><i class="fa-solid fa-cart-plus"></i></button><button class="product-card__action-btn" title="Vezi detalii" aria-label="Detalii ' + name + '" data-view-detail="' + product.id + '"><i class="fa-solid fa-magnifying-glass"></i></button></div>';
    }

    var isOutOfStock = (stock !== null && stock === 0);
    var addBtnHTML = '<button class="product-card__add-btn" ' + (isOutOfStock ? 'disabled' : 'data-add-cart="' + product.id + '"') + '>' + (isOutOfStock ? 'Epuizat' : 'Adaug\u0103 \u00EEn co\u0219') + '</button>';

    return '<div class="product-card glass glass--card reveal" data-product-id="' + product.id + '">' +
      '<div class="product-card__img"><img src="' + image + '" alt="' + name + '" loading="lazy" width="300" height="300" onerror="this.src=\'/images/product-gloves.jpg\'">' + tagsHTML + actionsHTML + '</div>' +
      '<div class="product-card__category">' + category + '</div><h3 class="product-card__name">' + name + '</h3>' + pricingHTML +
      '<div class="product-card__footer">' + stockInfo + addBtnHTML + '</div></div>';
  }

  function buildSkeletons(count) {
    count = count || 6;
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<div class="product-card-skeleton glass glass--card" aria-hidden="true"><div class="product-card-skeleton__img"></div><div class="product-card-skeleton__line product-card-skeleton__line--lg"></div><div class="product-card-skeleton__line product-card-skeleton__line--md"></div><div class="product-card-skeleton__line product-card-skeleton__line--sm"></div><div class="product-card-skeleton__line product-card-skeleton__line--price"></div></div>';
    }
    return html;
  }

  function buildEmptyState() {
    if (state.search || state.activeCategory) {
      return '<div class="shop-empty glass glass--card reveal"><div class="shop-empty__icon" aria-hidden="true"><i class="fa-solid fa-magnifying-glass"></i></div><h3 class="shop-empty__title">Niciun produs g\u0103sit</h3><p class="shop-empty__text">Nu am g\u0103sit produse care s\u0103 corespund\u0103 criteriilor tale. \u00CEncearc\u0103 s\u0103 modifici filtrele sau termenii de c\u0103utare.</p><button class="btn btn--outline" id="shop-clear-filters">Reseteaz\u0103 filtrele</button></div>';
    }
    return '<div class="shop-empty glass glass--card reveal"><div class="shop-empty__icon" aria-hidden="true"><i class="fa-solid fa-box-open"></i></div><h3 class="shop-empty__title">Magazinul se preg\u0103te\u0219te</h3><p class="shop-empty__text">Momentan nu sunt produse disponibile. Revino \u00EEn cur\u00E2nd \u2014 echipamentele de top sunt pe drum!</p></div>';
  }

  /* ========================================================================
     Pagination
     ======================================================================== */

  function buildPagination(pagination) {
    var container = document.getElementById('shop-pagination');
    if (!container) return;
    if (!pagination || pagination.totalPages <= 1) { container.innerHTML = ''; return; }

    var current = pagination.page;
    var total = pagination.totalPages;
    var html = '<button class="shop__page-btn" data-page="' + (current - 1) + '"' + (current <= 1 ? ' disabled aria-disabled="true"' : '') + ' aria-label="Pagina anterioar\u0103"><i class="fa-solid fa-chevron-left"></i></button>';
    var maxVisible = 5;
    var start = Math.max(1, current - Math.floor(maxVisible / 2));
    var end = Math.min(total, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
    if (start > 1) { html += '<button class="shop__page-btn" data-page="1">1</button>'; if (start > 2) html += '<span class="shop__page-ellipsis">&hellip;</span>'; }
    for (var p = start; p <= end; p++) {
      html += '<button class="shop__page-btn' + (p === current ? ' shop__page-btn--active' : '') + '" data-page="' + p + '"' + (p === current ? ' aria-current="page"' : '') + '>' + p + '</button>';
    }
    if (end < total) { if (end < total - 1) html += '<span class="shop__page-ellipsis">&hellip;</span>'; html += '<button class="shop__page-btn" data-page="' + total + '">' + total + '</button>'; }
    html += '<button class="shop__page-btn" data-page="' + (current + 1) + '"' + (current >= total ? ' disabled aria-disabled="true"' : '') + ' aria-label="Pagina urm\u0103toare"><i class="fa-solid fa-chevron-right"></i></button>';
    container.innerHTML = html;

    container.querySelectorAll('.shop__page-btn:not([disabled])').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var page = parseInt(btn.getAttribute('data-page'), 10);
        if (page && page !== state.page) { state.page = page; loadProducts(); document.getElementById('shop-grid').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    });
  }

  /* ========================================================================
     Render Products
     ======================================================================== */

  function renderProducts(products, pagination) {
    var grid = document.getElementById('shop-grid');
    var countEl = document.getElementById('shop-count');
    if (!grid) return;
    if (!products || products.length === 0) {
      grid.innerHTML = buildEmptyState();
      if (countEl) countEl.innerHTML = '<strong>0</strong> produse g\u0103site';
      buildPagination(null);
      var clearBtn = document.getElementById('shop-clear-filters');
      if (clearBtn) clearBtn.addEventListener('click', resetFilters);
      return;
    }
    grid.innerHTML = products.map(function (p) { return buildProductCard(p); }).join('');
    if (countEl) { var total = pagination ? pagination.total : products.length; countEl.innerHTML = '<strong>' + total + '</strong> produse g\u0103site'; }
    buildPagination(pagination);
    bindProductActions();
    if (typeof refreshScrollReveal === 'function') refreshScrollReveal();
  }

  function bindProductActions() {
    var addButtons = document.querySelectorAll('[data-add-cart]');
    addButtons.forEach(function (btn) {
      var newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var productId = parseInt(newBtn.getAttribute('data-add-cart'), 10);
        addToCart(productId, newBtn);
      });
    });
  }

  /* ========================================================================
     Add to Cart
     ======================================================================== */

  function addToCart(productId, btnElement) {
    var product = null;
    for (var i = 0; i < state.products.length; i++) { if (state.products[i].id === productId) { product = state.products[i]; break; } }
    if (!product) {
      for (var j = 0; j < FALLBACK_PRODUCTS.length; j++) { if (FALLBACK_PRODUCTS[j].id === productId) { product = FALLBACK_PRODUCTS[j]; break; } }
    }
    if (!product) return;

    // Prețul original (din produs, fără reducere).
    // Reducerile se aplică doar prin coduri promoționale la checkout.
    var originalPrice = Number(product.price) || 0;

    Cart.add({ id: product.id, name: product.name, price: originalPrice, image: product.image || null, category: product.category || 'general' }, 1);

    if (btnElement) {
      btnElement.classList.add('product-card__add-btn--added');
      var originalText = btnElement.textContent;
      btnElement.textContent = '\u2713 Ad\u0103ugat';
      setTimeout(function () { btnElement.classList.remove('product-card__add-btn--added'); btnElement.textContent = originalText; }, 1500);
    }

    showCartToast(product.name);
    updateCartUI();

    var countSpan = document.getElementById('cart-floating-count');
    if (countSpan) { var cur = parseInt(countSpan.textContent, 10) || 0; updateCartIcon(cur + 1); }
  }

  function showCartToast(productName) {
    var toast = document.getElementById('cart-toast');
    if (!toast) return;
    var totalItems = Cart.getCount();
    toast.textContent = '<i class="fa-solid fa-cart-shopping"></i> ' + escapeHTML(productName) + ' ad\u0103ugat \u00EEn co\u0219  (' + totalItems + ')';
    toast.classList.add('shop__cart-toast--visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function () { toast.classList.remove('shop__cart-toast--visible'); }, 2500);
  }

  /* ========================================================================
     Data Loading
     ======================================================================== */

  async function loadProducts() {
    var grid = document.getElementById('shop-grid');
    if (!grid) return;
    grid.innerHTML = buildSkeletons(state.limit);
    state.loading = true;
    var params = '?page=' + state.page + '&limit=' + state.limit + '&is_active=true';
    if (state.activeCategory) params += '&category=' + encodeURIComponent(state.activeCategory);
    if (state.sort) params += '&sort=' + encodeURIComponent(state.sort);
    if (state.search) params += '&search=' + encodeURIComponent(state.search.trim());

    try {
      var response = await safeFetch('/api/products' + params);
      var products = response.data || [];
      var pagination = response.pagination || null;
      state.products = products;
      state.pagination = pagination;
      renderProducts(products, pagination);
    } catch (err) {
      console.error('[shop] API error:', err);
      var filtered = filterFallbackProducts();
      state.products = filtered;
      state.pagination = { page: state.page, limit: state.limit, total: filtered.length, totalPages: Math.ceil(filtered.length / state.limit) || 1 };
      renderProducts(filtered, state.pagination);
      showToast('Se afi\u0219eaz\u0103 datele offline. Conecteaz\u0103-te la server pentru informa\u021Bii actualizate.', 'info', 4000);
    } finally { state.loading = false; }
  }

  function filterFallbackProducts() {
    var filtered = FALLBACK_PRODUCTS.slice();
    if (state.activeCategory) filtered = filtered.filter(function (p) { return (p.category || '').toLowerCase() === state.activeCategory.toLowerCase(); });
    if (state.search && state.search.trim()) {
      var q = state.search.trim().toLowerCase();
      filtered = filtered.filter(function (p) { return (p.name || '').toLowerCase().indexOf(q) !== -1 || (p.description || '').toLowerCase().indexOf(q) !== -1 || (p.category || '').toLowerCase().indexOf(q) !== -1; });
    }
    if (state.sort) {
      var isDesc = state.sort.startsWith('-');
      var field = isDesc ? state.sort.slice(1) : state.sort;
      filtered.sort(function (a, b) { var va = a[field]; var vb = b[field]; if (typeof va === 'string') va = va.toLowerCase(); if (typeof vb === 'string') vb = vb.toLowerCase(); if (va < vb) return isDesc ? 1 : -1; if (va > vb) return isDesc ? -1 : 1; return 0; });
    }
    return filtered;
  }

  async function loadCategories() {
    var filtersContainer = document.getElementById('shop-filters');
    if (!filtersContainer) return;
    try {
      var response = await safeFetch('/api/products/categories');
      var categories = response.data || [];
      if (categories.length === 0) categories = FALLBACK_CATEGORIES;
      state.categories = categories;
      renderCategories(categories);
    } catch (err) {
      console.error('[shop] Categories API error:', err);
      state.categories = FALLBACK_CATEGORIES;
      renderCategories(FALLBACK_CATEGORIES);
      showToast('Categoriile se afi\u0219eaz\u0103 offline.', 'info', 3000);
    }
  }

  function renderCategories(categories) {
    var container = document.getElementById('shop-filters');
    if (!container) return;
    var html = '<button class="shop__filter' + (state.activeCategory === '' ? ' shop__filter--active' : '') + '" data-category="" role="radio" aria-checked="' + (state.activeCategory === '' ? 'true' : 'false') + '">Toate</button>';
    categories.forEach(function (cat) {
      var label = getCategoryLabel(cat.category);
      var count = cat.productCount || 0;
      var isActive = state.activeCategory === cat.category;
      html += '<button class="shop__filter' + (isActive ? ' shop__filter--active' : '') + '" data-category="' + escapeHTML(cat.category) + '" role="radio" aria-checked="' + (isActive ? 'true' : 'false') + '">' + label + ' <span class="shop__filter-count">' + count + '</span></button>';
    });
    container.innerHTML = html;
    container.querySelectorAll('.shop__filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.getAttribute('data-category') || '';
        if (cat === state.activeCategory) return;
        state.activeCategory = cat;
        state.page = 1;
        container.querySelectorAll('.shop__filter').forEach(function (b) { b.classList.remove('shop__filter--active'); b.setAttribute('aria-checked', 'false'); });
        btn.classList.add('shop__filter--active');
        btn.setAttribute('aria-checked', 'true');
        loadProducts();
      });
    });
  }

  function resetFilters() {
    state.activeCategory = ''; state.sort = ''; state.search = ''; state.page = 1;
    var searchInput = document.getElementById('shop-search'); if (searchInput) searchInput.value = '';
    var sortSelect = document.getElementById('shop-sort'); if (sortSelect) sortSelect.value = '';
    renderCategories(state.categories);
    loadProducts();
  }

  function initSearch() {
    var searchInput = document.getElementById('shop-search');
    if (!searchInput) return;
    searchInput.addEventListener('input', function () {
      clearTimeout(state.searchDebounce);
      state.searchDebounce = setTimeout(function () { state.search = searchInput.value; state.page = 1; loadProducts(); }, 350);
    });
  }

  function initSort() {
    var sortSelect = document.getElementById('shop-sort');
    if (!sortSelect) return;
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; state.page = 1; loadProducts(); });
  }

  function initPromoCountdown() {
    var countdownEl = document.getElementById('promo-countdown');
    if (!countdownEl || !PROMO_CONFIG.globalEndDate) return;
    function updateCountdown() {
      var now = new Date().getTime();
      var end = new Date(PROMO_CONFIG.globalEndDate).getTime();
      var diff = end - now;
      if (diff <= 0) { countdownEl.textContent = 'Ofert\u0103 expirat\u0103'; return; }
      var days = Math.floor(diff / (1000 * 60 * 60 * 24));
      var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      var minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      var parts = [];
      if (days > 0) parts.push(days + 'z');
      if (hours > 0 || days > 0) parts.push(hours + 'h');
      parts.push(minutes + 'm');
      countdownEl.textContent = '<i class="fa-regular fa-clock"></i> ' + parts.join(' ');
    }
    updateCountdown();
    setInterval(updateCountdown, 60000);
  }

  function handleReturnParams() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      var orderNum = params.get('order') || '';
      showToast('Plata a fost procesat\u0103 cu succes! Comanda #' + orderNum, 'success', 6000);
      Cart.clear();
      updateCartUI();
      if (window.history && window.history.replaceState) { window.history.replaceState({}, document.title, window.location.pathname); }
    } else if (params.get('canceled') === 'true') {
      showToast('Plata a fost anulat\u0103. Po\u021Bi \u00EEncerca din nou.', 'info', 4000);
      if (window.history && window.history.replaceState) { window.history.replaceState({}, document.title, window.location.pathname); }
    } else if (params.get('simulated') === 'true') {
      var simOrder = params.get('order') || '';
      showToast('Comand\u0103 simulat\u0103 #' + simOrder + ' (mod test)', 'info', 5000);
      if (window.history && window.history.replaceState) { window.history.replaceState({}, document.title, window.location.pathname); }
    }
  }

  async function loadConfig() {
    try {
      var config = await safeFetch('/api/config');
      if (config) {
        if (config.stripe_publishable_key) {
          STRIPE_CONFIG.publishableKey = config.stripe_publishable_key;
          STRIPE_CONFIG.configured = config.stripe_configured;
          STRIPE_CONFIG.mode = (config.mode === 'stripe') ? 'stripe' : 'simulation';
        }
        // Sincronizează promoțiile din server cu afișarea locală
        if (config.promo_codes && Array.isArray(config.promo_codes) && config.promo_codes.length > 0) {
          syncPromosFromServer(config.promo_codes);
        }
      }
    } catch (err) {
      console.log('[shop] Config API indisponibil\u0103, se folose\u0219te configura\u021Bia implicit\u0103.');
      STRIPE_CONFIG.mode = 'simulation';
    }
  }

  /**
   * Sincronizează promoțiile din server în PROMO_CONFIG local.
   * Păstrează fallback-urile hardcodate ca bază, dar le îmbogățește
   * cu datele reale din baza de date.
   */
  function syncPromosFromServer(serverPromos) {
    var merged = [];
    var seenCodes = {};

    // Adaugă promoțiile din server primele (prioritate)
    for (var i = 0; i < serverPromos.length; i++) {
      var sp = serverPromos[i];
      var code = (sp.code || '').toUpperCase();
      if (!code) continue;

      var discountPercent = sp.discount_type === 'percentage' ? sp.discount_value : 0;
      merged.push({
        id: 'server-' + code,
        targetType: sp.applies_to || 'all',
        targetId: null,
        discountPercent: discountPercent,
        label: sp.description || ('Reducere -' + discountPercent + '%'),
        code: code,
        active: true,
        discount_type: sp.discount_type,
        discount_value: sp.discount_value,
      });
      seenCodes[code] = true;
    }

    // Adaugă fallback-urile locale care nu există deja pe server
    var localPromos = PROMO_CONFIG.promos || [];
    for (var j = 0; j < localPromos.length; j++) {
      var lp = localPromos[j];
      var lpCode = (lp.code || '').toUpperCase();
      if (lpCode && seenCodes[lpCode]) continue;
      // Păstrăm promoțiile per-produs fără cod (nu vin din server)
      if (!lpCode) {
        merged.push(lp);
      }
      // Păstrăm și codurile locale care nu sunt pe server
      if (lpCode && !seenCodes[lpCode]) {
        merged.push(lp);
        seenCodes[lpCode] = true;
      }
    }

    PROMO_CONFIG.promos = merged;
  }

  function setCurrentYear() {
    var el = document.getElementById('current-year');
    if (el) el.textContent = new Date().getFullYear();
  }

  function init() {
    setCurrentYear();
    Cart.load();
    createCartDrawer();
    updateCartUI();
    handleReturnParams();
    loadConfig();
    initSearch();
    initSort();
    initPromoCountdown();
    loadCategories().then(function () { return loadProducts(); });
    document.addEventListener('click', function (e) { if (e.target && e.target.id === 'shop-clear-filters') { resetFilters(); } });
    getCartIconEl();
  }

  window.BoxingChampions = BC;
  BC.Shop = {
    Cart: Cart,
    openCart: openCartDrawer,
    closeCart: closeCartDrawer,
    updateCartUI: updateCartUI,
    checkout: checkout,
    validatePromoCode: validatePromoCode,
    getProductPromo: getProductPromo,
    state: state,
    STRIPE_CONFIG: STRIPE_CONFIG,
    PROMO_CONFIG: PROMO_CONFIG,
  };

  domReady(init);
})();