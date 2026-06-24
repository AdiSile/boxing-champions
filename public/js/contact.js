'use strict';

// ===========================================================================
// CONTACT FORM MODULE — Boxing Champions
// Validare live: regex email/telefon, cerințe minim caractere,
// mesaje eroare inline, submit prin fetch API la /api/messages, toast
// succes/eroare. Backend: routes/api.js (POST /api/messages)
//
// Depinde de: main.js (escapeHtml — se verifică existența, altfel polyfill)
// ===========================================================================

(function () {
  // ──────────────────────────────────────────────────────────────────────────
  // UTILITARE
  // ──────────────────────────────────────────────────────────────────────────

  /** Polyfill pentru escapeHtml în caz că main.js nu e încărcat */
  const escapeHtml = (typeof window.escapeHtml === 'function')
    ? window.escapeHtml
    : (function () {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return function (str) {
          if (typeof str !== 'string') return '';
          return str.replace(/[&<>"']/g, function (m) { return map[m]; });
        };
      })();

  const TOAST_DURATION = 3200;
  const API_BASE = window.API_BASE || '/api';
  const CONTACT_API = API_BASE + '/messages';

  // ──────────────────────────────────────────────────────────────────────────
  // REFERINȚE DOM
  // ──────────────────────────────────────────────────────────────────────────
  let form = null;
  let submitBtn = null;
  let btnText = null;
  let btnSpinner = null;
  let formStatus = null;
  let charCounter = null;
  let toastContainer = null;

  let isSubmitting = false;

  // ──────────────────────────────────────────────────────────────────────────
  // REGEX VALIDARE
  // ──────────────────────────────────────────────────────────────────────────
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
  const PHONE_REGEX = /^[+]?[\d\s()-]{7,20}$/;

  // ──────────────────────────────────────────────────────────────────────────
  // CONFIG VALIDARE — aliniat cu backend-ul routes/api.js (POST /api/messages)
  // ──────────────────────────────────────────────────────────────────────────
  const VALIDATORS = {
    name: {
      test: function (v) { return v.trim().length >= 2; },
      msg: 'Numele trebuie să conțină minimum 2 caractere.',
    },
    email: {
      test: function (v) { return EMAIL_REGEX.test(v.trim()); },
      msg: 'Adresa de email nu este validă.',
    },
    phone: {
      test: function (v) {
        // Phone is optional — empty is valid
        if (v.trim() === '') return true;
        return PHONE_REGEX.test(v.trim());
      },
      msg: 'Numărul de telefon nu este valid (minim 7 cifre, format: +40 721 234 567).',
    },
    subject: {
      test: function (v) { return v.trim().length >= 2; },
      msg: 'Subiectul trebuie să conțină minimum 2 caractere.',
    },
    message: {
      test: function (v) {
        var len = v.trim().length;
        return len >= 10 && len <= 5000;
      },
      msg: 'Mesajul trebuie să conțină între 10 și 5000 de caractere.',
    },
  };

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
    var dur = duration || TOAST_DURATION;
    var icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      info: 'fa-circle-info',
      warning: 'fa-triangle-exclamation',
    };
    var icon = icons[type] || icons.info;

    var toast = document.createElement('div');
    toast.className = 'toast toast--' + type;
    toast.innerHTML = '<i class="fa-solid ' + icon + '"></i><span>' + escapeHtml(message) + '</span>';
    toast.setAttribute('role', 'status');

    toastContainer.appendChild(toast);

    // Forțează reflow pentru animație
    void toast.offsetWidth;
    toast.classList.add('toast--visible');

    setTimeout(function () {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, { once: true });
      // Fallback removal
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 400);
    }, dur);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // VALIDARE LIVE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Găsește elementul iconiță de validare din același grup flotant.
   * @param {HTMLElement} input
   * @returns {HTMLElement|null}
   */
  function findValidationIcon(input) {
    var group = input.closest('.floating-group');
    if (!group) return null;
    return group.querySelector('.validation-icon');
  }

  /**
   * Validează un câmp și afișează eroarea / iconița.
   * @param {HTMLInputElement|HTMLTextAreaElement} input
   * @returns {boolean}
   */
  function validateField(input) {
    var fieldName = input.name;
    var validator = VALIDATORS[fieldName];
    var errorEl = document.getElementById('error-' + fieldName);
    var iconEl = findValidationIcon(input);

    if (!validator) return true;

    var value = input.value;
    var isValid = validator.test(value);
    var isRequired = input.hasAttribute('required');
    var isEmpty = value.trim() === '';

    // Câmp opțional gol — ignorăm validarea
    if (!isRequired && isEmpty) {
      input.classList.remove('input-valid', 'input-invalid');
      if (errorEl) errorEl.textContent = '';
      if (iconEl) iconEl.innerHTML = '';
      return true;
    }

    if (isValid) {
      input.classList.add('input-valid');
      input.classList.remove('input-invalid');
      if (errorEl) errorEl.textContent = '';
      if (iconEl) iconEl.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    } else {
      input.classList.add('input-invalid');
      input.classList.remove('input-valid');
      if (errorEl) errorEl.textContent = validator.msg;
      if (iconEl) iconEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
    }

    return isValid;
  }

  /**
   * Validează întreg formularul.
   * @returns {boolean}
   */
  function validateForm() {
    var allValid = true;
    var inputs = form.querySelectorAll('.floating-input');
    for (var i = 0; i < inputs.length; i++) {
      if (!validateField(inputs[i])) {
        allValid = false;
      }
    }
    return allValid;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTOR CARACTERE MESAJ
  // ──────────────────────────────────────────────────────────────────────────

  function updateCharCount() {
    var msg = document.getElementById('contact-message');
    if (!charCounter || !msg) return;

    var len = msg.value.length;
    charCounter.textContent = len + ' / 5000';

    if (len > 4500) {
      charCounter.style.color = 'var(--color-red-bright)';
    } else if (len > 3500) {
      charCounter.style.color = '#f59e0b';
    } else {
      charCounter.style.color = 'var(--color-gray-400)';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESET FORM
  // ──────────────────────────────────────────────────────────────────────────

  function resetFormState() {
    var inputs = form.querySelectorAll('.floating-input');
    for (var i = 0; i < inputs.length; i++) {
      inputs[i].classList.remove('input-valid', 'input-invalid');
    }

    var icons = form.querySelectorAll('.validation-icon');
    for (var j = 0; j < icons.length; j++) {
      icons[j].innerHTML = '';
    }

    var errors = form.querySelectorAll('.validation-error');
    for (var k = 0; k < errors.length; k++) {
      errors[k].textContent = '';
    }

    updateCharCount();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FORM STATUS — mesaje inline (sub butonul de submit)
  // ──────────────────────────────────────────────────────────────────────────

  function showFormStatus(type, message) {
    if (!formStatus) return;
    formStatus.textContent = message;
    formStatus.className = 'form-status form-status-' + type;
    formStatus.style.display = 'block';
    formStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideFormStatus() {
    if (!formStatus) return;
    formStatus.style.display = 'none';
    formStatus.className = 'form-status';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUBMIT — fetch API la /api/messages
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Trimite formularul prin fetch API la endpoint-ul /api/messages.
   * @param {SubmitEvent} e
   */
  async function handleSubmit(e) {
    e.preventDefault();

    if (isSubmitting) return;

    hideFormStatus();

    // Validare completă
    if (!validateForm()) {
      showFormStatus('error', '\u26a0\ufe0f Te rug\u0103m s\u0103 corectezi erorile din formular \u00eenainte de trimitere.');
      showToast('warning', 'Corecteaz\u0103 erorile din formular.', 3000);

      // Focus pe primul câmp invalid
      var firstInvalid = form.querySelector('.input-invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    // Pregătim UI pentru submit
    isSubmitting = true;
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnSpinner) btnSpinner.style.display = 'inline';

    // Construim payload-ul
    var payload = {
      name: document.getElementById('contact-name').value.trim(),
      email: document.getElementById('contact-email').value.trim(),
      phone: document.getElementById('contact-phone').value.trim(),
      subject: document.getElementById('contact-subject').value.trim(),
      message: document.getElementById('contact-message').value.trim(),
    };

    try {
      var response = await fetch(CONTACT_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      var data;
      try {
        data = await response.json();
      } catch (parseErr) {
        data = {};
      }

      if (response.ok) {
        // Succes
        var successMsg = data.message || 'Mesajul a fost trimis cu succes! Te vom contacta \u00een cel mai scurt timp.';
        showToast('success', successMsg, 4000);
        showFormStatus('success', '\u2705 ' + successMsg);

        // Resetează formularul
        form.reset();
        resetFormState();

        // Scroll la status
        if (formStatus) {
          setTimeout(function () {
            formStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 150);
        }
      } else {
        // Eroare de la server
        var errMsg = data.error || 'A ap\u0103rut o eroare la trimiterea mesajului.';
        if (data.details && Array.isArray(data.details)) {
          errMsg = data.details.join(' ');
        }
        showToast('error', errMsg, 5000);
        showFormStatus('error', '\u274c ' + errMsg);
      }
    } catch (err) {
      // Eroare de rețea
      var netErrMsg = 'Eroare de conexiune. Verific\u0103 conexiunea la internet \u0219i \u00eencearc\u0103 din nou.';
      showToast('error', netErrMsg, 5000);
      showFormStatus('error', '\u274c ' + netErrMsg);
    } finally {
      // Restaurăm UI
      isSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
      if (btnText) btnText.style.display = 'inline';
      if (btnSpinner) btnSpinner.style.display = 'none';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BIND EVENT LISTENERS
  // ──────────────────────────────────────────────────────────────────────────

  function bindEvents() {
    if (!form) return;

    // Live validation pe input + blur pentru fiecare câmp
    var inputs = form.querySelectorAll('.floating-input');
    for (var i = 0; i < inputs.length; i++) {
      (function (input) {
        // Debounce pentru input
        var debounceTimer;
        input.addEventListener('input', function () {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () {
            validateField(input);
            updateCharCount();
          }, 200);
        });

        input.addEventListener('blur', function () {
          clearTimeout(debounceTimer);
          validateField(input);
          updateCharCount();
        });
      })(inputs[i]);
    }

    // Submit formular
    form.addEventListener('submit', handleSubmit);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAPTURE DOM REFERENCES
  // ──────────────────────────────────────────────────────────────────────────

  function captureDomRefs() {
    form = document.getElementById('contact-form');
    if (!form) return;

    // Găsește butonul de submit — fie după ID (dacă există), fie după selector
    submitBtn = document.getElementById('contact-submit-btn')
      || form.querySelector('button[type="submit"]');

    btnText = submitBtn ? submitBtn.querySelector('.btn-text') : null;
    btnSpinner = submitBtn ? submitBtn.querySelector('.btn-spinner') : null;
    formStatus = document.getElementById('form-status');
    charCounter = document.getElementById('char-counter');

    // Asigură-te că elementele UI sunt în starea inițială
    if (btnSpinner) btnSpinner.style.display = 'none';
    if (btnText) btnText.style.display = 'inline';
    if (formStatus) {
      formStatus.style.display = 'none';
      formStatus.className = 'form-status';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────────────────

  function init() {
    captureDomRefs();

    // Dacă nu suntem pe pagina de contact, nu inițializăm
    if (!form) return;

    ensureToastContainer();
    bindEvents();
    updateCharCount();
  }

  // Pornim când DOM-ul e gata
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();