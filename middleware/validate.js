// ---------------------------------------------------------------------------
// middleware/validate.js
// Validare strictă a input-ului pentru toate rutele
//
// Oferă:
//   - Schema-based validation (body, query, params)
//   - Sanitizare automată (XSS, trim, normalizare)
//   - Tipuri: string, number, integer, boolean, email, url, slug, enum, uuid, date, json
//   - Constrângeri: required, min, max, minLength, maxLength, pattern, oneOf
//   - Suport pentru obiecte și array-uri nested
//   - Validatori custom
//   - Middleware-uri predefinite pentru entitățile aplicației
// ---------------------------------------------------------------------------

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Lungimea maximă implicită pentru string-uri */
const DEFAULT_MAX_STRING = 4096;

/** Lungimea maximă pentru text lung (descrieri, bio, mesaje) */
const MAX_LONG_TEXT = 65535;

/** Lungimea maximă pentru slug-uri */
const MAX_SLUG = 128;

/** Dimensiunea maximă a unui payload JSON (în caractere) */
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

/** Regex pentru email */
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Regex pentru slug */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Regex pentru nume (litere, spații, cratime, apostrof) */
const NAME_RE = /^[\p{L}\p{M} '-]+$/u;

/** Regex pentru telefon */
const PHONE_RE = /^\+?[\d\s()\-.]{7,20}$/;

/** Regex pentru URL */
const URL_RE = /^https?:\/\/[\w\-]+(\.[\w\-]+)+[/#?]?.*$/;

/** Regex pentru UUID */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Regex pentru dată ISO 8601 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Regex pentru cod hex */
const HEX_RE = /^[0-9a-fA-F]+$/;

/** Tag-uri HTML și entități periculoase – eliminate prin sanitizare */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
  /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
  /<embed\b[^>]*>/gi,
  /javascript\s*:/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /on\w+\s*=\s*[^\s>]+/gi,
  /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
];

// ---------------------------------------------------------------------------
// Helpers – Sanitizare
// ---------------------------------------------------------------------------

/**
 * Elimină conținutul periculos (XSS) dintr-un string.
 * Păstrează textul curat, elimină tag-urile și event handler-ele.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return '';

  let cleaned = value;

  // Elimină pattern-uri XSS cunoscute
  for (const pattern of XSS_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Elimină orice tag rămas
  cleaned = cleaned.replace(/<[^>]*>/g, '');

  // Decodifică entitățile HTML comune și le elimină
  cleaned = cleaned
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, '');

  // Elimină caracterele NULL și alte caractere de control (exceptând newline și tab)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim și colapsează spațiile multiple
  cleaned = cleaned.trim().replace(/\s{2,}/g, ' ');

  return cleaned;
}

/**
 * Sanitizează un string destinat unui câmp text lung (descriere, bio).
 * Permite newline-uri dar elimină conținutul periculos.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeLongText(value) {
  if (typeof value !== 'string') return '';

  let cleaned = value;

  for (const pattern of XSS_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  cleaned = cleaned.replace(/<[^>]*>/g, '');
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return cleaned.trim();
}

/**
 * Sanitizează un slug: lowercase, doar litere, cifre și cratime.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeSlug(value) {
  if (typeof value !== 'string') return '';

  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalizează un nume: elimină spațiile duplicate, trim.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s{2,}/g, ' ');
}

/**
 * Sanitizează un număr de telefon: păstrează doar +, cifre, spații, cratime, paranteze.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizePhone(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^\d\s+\-()]/g, '').trim();
}

/**
 * Sanitizează un string JSON: încearcă parse/stringify pentru validare structurală.
 *
 * @param {string} value
 * @returns {string}
 */
function sanitizeJson(value) {
  if (typeof value !== 'string') return '[]';
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch {
    return '[]';
  }
}

// ---------------------------------------------------------------------------
// Helpers – Validare
// ---------------------------------------------------------------------------

/**
 * Verifică dacă o valoare este un număr valid (nu NaN, nu Infinity).
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidNumber(value) {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
}

/**
 * Verifică dacă o valoare este un întreg valid.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidInteger(value) {
  return Number.isSafeInteger(value);
}

/**
 * Verifică dacă un string reprezintă un email valid.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 254) return false; // RFC 5321 limit
  return EMAIL_RE.test(value);
}

/**
 * Verifică dacă un string este un slug valid.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidSlug(value) {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_SLUG) return false;
  return SLUG_RE.test(value);
}

/**
 * Verifică dacă un string este un nume valid.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidName(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > 128) return false;
  return NAME_RE.test(value);
}

/**
 * Verifică dacă un string este un URL valid.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 2048) return false;
  return URL_RE.test(value);
}

/**
 * Verifică dacă un string este un UUID valid.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidUuid(value) {
  if (typeof value !== 'string') return false;
  return UUID_RE.test(value);
}

/**
 * Verifică dacă un string este o dată ISO 8601 validă.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isValidDate(value) {
  if (typeof value !== 'string') return false;
  if (!DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Validator de schemă
// ---------------------------------------------------------------------------

/**
 * Validează un câmp conform definiției din schemă.
 *
 * @param {string} fieldName - numele câmpului
 * @param {*} value - valoarea de validat
 * @param {object} schema - definiția câmpului
 * @param {string} source - sursa ('body', 'query', 'params')
 * @returns {{ valid: boolean, value: *, errors: string[] }}
 */
function validateField(fieldName, value, schema, source) {
  const errors = [];
  let sanitized = value;
  const type = schema.type || 'string';

  // ------------------------------------------------------------------
  // 1. Verificare required
  // ------------------------------------------------------------------
  if (value === undefined || value === '' || (value === null && schema.nullable !== true)) {
    if (schema.required) {
      errors.push(`'${fieldName}' is required.`);
      return { valid: false, value: undefined, errors };
    }
    // Dacă nu e required și e empty, returnăm default-ul sau undefined/null
    if (schema.default !== undefined) {
      return { valid: true, value: schema.default, errors: [] };
    }
    // Păstrează null dacă valoarea originală e null (ex: pentru a șterge un câmp opțional)
    if (value === null) {
      return { valid: true, value: null, errors: [] };
    }
    return { valid: true, value: undefined, errors: [] };
  }

  // ------------------------------------------------------------------
  // 2. Sanitizare specifică tipului
  // ------------------------------------------------------------------
  switch (type) {
    case 'string':
      if (typeof value !== 'string') {
        // Coerciție blândă pentru numere
        if (typeof value === 'number' && !Number.isNaN(value)) {
          sanitized = String(value);
        } else {
          errors.push(`'${fieldName}' must be a string.`);
          return { valid: false, value: undefined, errors };
        }
      }
      sanitized = sanitizeString(sanitized);
      break;

    case 'text':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = sanitizeLongText(value);
      break;

    case 'name':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = sanitizeName(value);
      break;

    case 'email':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = value.trim().toLowerCase();
      break;

    case 'slug':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = sanitizeSlug(value);
      break;

    case 'phone':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = sanitizePhone(value);
      break;

    case 'url':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = value.trim();
      break;

    case 'number':
      if (typeof value === 'string' && value.trim() !== '') {
        const coerced = Number(value);
        if (!Number.isNaN(coerced)) {
          sanitized = coerced;
        } else {
          errors.push(`'${fieldName}' must be a number.`);
          return { valid: false, value: undefined, errors };
        }
      } else if (typeof value !== 'number') {
        errors.push(`'${fieldName}' must be a number.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = Number.isNaN(value) ? undefined : value;
      break;

    case 'integer':
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
        sanitized = parseInt(value, 10);
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        sanitized = Math.trunc(value);
      } else {
        errors.push(`'${fieldName}' must be an integer.`);
        return { valid: false, value: undefined, errors };
      }
      break;

    case 'boolean':
      if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true' || lower === '1') {
          sanitized = true;
        } else if (lower === 'false' || lower === '0') {
          sanitized = false;
        } else {
          errors.push(`'${fieldName}' must be a boolean.`);
          return { valid: false, value: undefined, errors };
        }
      } else if (typeof value !== 'boolean') {
        errors.push(`'${fieldName}' must be a boolean.`);
        return { valid: false, value: undefined, errors };
      }
      break;

    case 'enum':
      sanitized = sanitizeString(String(value));
      break;

    case 'uuid':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = value.trim().toLowerCase();
      break;

    case 'date':
      if (typeof value !== 'string') {
        errors.push(`'${fieldName}' must be a date string.`);
        return { valid: false, value: undefined, errors };
      }
      sanitized = value.trim();
      break;

    case 'json':
      if (typeof value !== 'string') {
        // Permitem și obiecte/array-uri deja parsate
        if (typeof value === 'object' && value !== null) {
          sanitized = JSON.stringify(value);
        } else {
          errors.push(`'${fieldName}' must be a JSON string or object.`);
          return { valid: false, value: undefined, errors };
        }
      }
      sanitized = sanitizeJson(typeof value === 'string' ? value : JSON.stringify(value));
      break;

    case 'array':
      if (!Array.isArray(value)) {
        // Încearcă să parseze string JSON
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              sanitized = parsed;
            } else {
              errors.push(`'${fieldName}' must be an array.`);
              return { valid: false, value: undefined, errors };
            }
          } catch {
            errors.push(`'${fieldName}' must be an array.`);
            return { valid: false, value: undefined, errors };
          }
        } else {
          errors.push(`'${fieldName}' must be an array.`);
          return { valid: false, value: undefined, errors };
        }
      }
      break;

    case 'object':
      if (typeof value === 'string') {
        try {
          sanitized = JSON.parse(value);
        } catch {
          errors.push(`'${fieldName}' must be an object.`);
          return { valid: false, value: undefined, errors };
        }
      }
      if (typeof sanitized !== 'object' || sanitized === null || Array.isArray(sanitized)) {
        errors.push(`'${fieldName}' must be an object.`);
        return { valid: false, value: undefined, errors };
      }
      break;

    default:
      // Tip custom – doar sanitizare de bază
      if (typeof value === 'string') {
        sanitized = sanitizeString(value);
      }
      break;
  }

  // Dacă după sanitizare valoarea e goală și câmpul e required
  if (
    schema.required &&
    (sanitized === undefined || sanitized === null || sanitized === '')
  ) {
    errors.push(`'${fieldName}' is required.`);
    return { valid: false, value: undefined, errors };
  }

  if (sanitized === undefined || sanitized === null || sanitized === '') {
    if (schema.default !== undefined) {
      return { valid: true, value: schema.default, errors: [] };
    }
    return { valid: true, value: undefined, errors: [] };
  }

  // ------------------------------------------------------------------
  // 3. Validări specifice tipului
  // ------------------------------------------------------------------
  switch (type) {
    case 'email':
      if (!isValidEmail(sanitized)) {
        errors.push(`'${fieldName}' must be a valid email address.`);
      }
      break;

    case 'slug':
      if (!isValidSlug(sanitized)) {
        errors.push(`'${fieldName}' must be a valid slug (lowercase letters, numbers, hyphens).`);
      }
      break;

    case 'name':
      if (!isValidName(sanitized)) {
        errors.push(`'${fieldName}' contains invalid characters.`);
      }
      break;

    case 'url':
      if (!isValidUrl(sanitized)) {
        errors.push(`'${fieldName}' must be a valid URL (http/https).`);
      }
      break;

    case 'uuid':
      if (!isValidUuid(sanitized)) {
        errors.push(`'${fieldName}' must be a valid UUID.`);
      }
      break;

    case 'date':
      if (!isValidDate(sanitized)) {
        errors.push(`'${fieldName}' must be a valid ISO 8601 date.`);
      }
      break;

    case 'number':
      if (!isValidNumber(sanitized)) {
        errors.push(`'${fieldName}' must be a valid number.`);
      }
      break;

    case 'integer':
      if (!isValidInteger(sanitized)) {
        errors.push(`'${fieldName}' must be a valid integer.`);
      }
      break;

    case 'enum':
      if (schema.oneOf && !schema.oneOf.includes(sanitized)) {
        errors.push(
          `'${fieldName}' must be one of: ${schema.oneOf.map(v => `"${v}"`).join(', ')}.`
        );
      }
      break;
  }

  // ------------------------------------------------------------------
  // 4. Constrângeri numerice
  // ------------------------------------------------------------------
  if ((type === 'number' || type === 'integer') && sanitized !== undefined) {
    if (schema.min !== undefined && sanitized < schema.min) {
      errors.push(`'${fieldName}' must be at least ${schema.min}.`);
    }
    if (schema.max !== undefined && sanitized > schema.max) {
      errors.push(`'${fieldName}' must be at most ${schema.max}.`);
    }
  }

  // ------------------------------------------------------------------
  // 5. Constrângeri de lungime (string-uri și array-uri)
  // ------------------------------------------------------------------
  if (typeof sanitized === 'string') {
    const effectiveMax = schema.maxLength || DEFAULT_MAX_STRING;

    if (schema.minLength !== undefined && sanitized.length < schema.minLength) {
      errors.push(`'${fieldName}' must be at least ${schema.minLength} characters.`);
    }
    if (sanitized.length > effectiveMax) {
      errors.push(`'${fieldName}' must be at most ${effectiveMax} characters.`);
    }
  }

  if (Array.isArray(sanitized)) {
    if (schema.minItems !== undefined && sanitized.length < schema.minItems) {
      errors.push(`'${fieldName}' must have at least ${schema.minItems} items.`);
    }
    if (schema.maxItems !== undefined && sanitized.length > schema.maxItems) {
      errors.push(`'${fieldName}' must have at most ${schema.maxItems} items.`);
    }
  }

  // ------------------------------------------------------------------
  // 6. Pattern matching
  // ------------------------------------------------------------------
  if (schema.pattern && typeof sanitized === 'string') {
    const regex = typeof schema.pattern === 'string'
      ? new RegExp(schema.pattern)
      : schema.pattern;

    if (!regex.test(sanitized)) {
      errors.push(
        schema.patternMessage
          ? `'${fieldName}' ${schema.patternMessage}`
          : `'${fieldName}' has an invalid format.`
      );
    }
  }

  // ------------------------------------------------------------------
  // 7. Validator custom
  // ------------------------------------------------------------------
  if (typeof schema.validate === 'function') {
    try {
      const customResult = schema.validate(sanitized);
      if (customResult === false) {
        errors.push(`'${fieldName}' is invalid.`);
      } else if (typeof customResult === 'string') {
        errors.push(`'${fieldName}' ${customResult}`);
      }
    } catch (customErr) {
      errors.push(`'${fieldName}' validation error: ${customErr.message}`);
    }
  }

  // ------------------------------------------------------------------
  // 8. Sanitizer custom (post-validare)
  // ------------------------------------------------------------------
  if (typeof schema.sanitize === 'function') {
    try {
      sanitized = schema.sanitize(sanitized);
    } catch {
      errors.push(`'${fieldName}' sanitization failed.`);
    }
  }

  return {
    valid: errors.length === 0,
    value: errors.length === 0 ? sanitized : undefined,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Factory: creează middleware de validare pe baza unei scheme
// ---------------------------------------------------------------------------

/**
 * Creează un middleware Express care validează req.body, req.query și req.params
 * conform schemei furnizate.
 *
 * Schema are forma:
 * {
 *   body: { fieldName: { type, required, ... }, ... },
 *   query: { ... },
 *   params: { ... },
 * }
 *
 * Returnează 400 cu erorile dacă validarea eșuează.
 * Înlocuiește req.body / req.query / req.params cu valorile sanitizate.
 *
 * @param {object} schema - Schema de validare
 * @param {object} [options] - Opțiuni
 * @param {boolean} [options.stripUnknown=false] - elimină câmpurile nedefinite în schemă
 * @param {boolean} [options.allowEmpty=false] - permite body gol chiar dacă schema.body e definit
 * @returns {import('express').RequestHandler}
 */
function validate(schema, options = {}) {
  const { stripUnknown = false, allowEmpty = false } = options;

  return function validateMiddleware(req, res, next) {
    const allErrors = [];
    const sources = ['body', 'query', 'params'];

    for (const source of sources) {
      const sourceSchema = schema[source];
      if (!sourceSchema || typeof sourceSchema !== 'object') {
        continue;
      }

      const data = req[source];
      if (!data || typeof data !== 'object') {
        continue;
      }

      // Verificare body gol
      if (source === 'body' && !allowEmpty) {
        const bodyKeys = Object.keys(data).filter(
          k => data[k] !== undefined && data[k] !== null
        );
        if (bodyKeys.length === 0 && Object.keys(sourceSchema).some(
          k => sourceSchema[k].required
        )) {
          allErrors.push('Request body is empty but required fields are expected.');
          continue;
        }
      }

      // Verificare dimensiune body
      if (source === 'body' && req.headers['content-type']?.includes('application/json')) {
        const bodySize = JSON.stringify(data).length;
        if (bodySize > MAX_BODY_SIZE) {
          return res.status(413).json({
            error: 'Request body too large.',
            code: 'BODY_TOO_LARGE',
            maxSize: MAX_BODY_SIZE,
          });
        }
      }

      const sanitizedData = {};

      for (const [fieldName, fieldSchema] of Object.entries(sourceSchema)) {
        const { valid, value, errors } = validateField(
          fieldName,
          data[fieldName],
          fieldSchema,
          source
        );

        if (!valid) {
          for (const err of errors) {
            allErrors.push(`${source}.${err}`);
          }
        } else if (value !== undefined) {
          sanitizedData[fieldName] = value;
        }
      }

      // Păstrează câmpurile necunoscute doar dacă nu e setat stripUnknown
      if (!stripUnknown) {
        for (const key of Object.keys(data)) {
          if (!(key in sourceSchema) && !(key in sanitizedData) && data[key] !== undefined) {
            // Sanitizare basic pentru câmpuri ne-specificate
            if (typeof data[key] === 'string') {
              sanitizedData[key] = sanitizeString(data[key]);
            } else {
              sanitizedData[key] = data[key];
            }
          }
        }
      }

      // Înlocuiește cu datele sanitizate
      req[source] = sanitizedData;
    }

    // ------------------------------------------------------------------
    // Răspuns cu erori
    // ------------------------------------------------------------------
    if (allErrors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        details: allErrors,
      });
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Scheme predefinite pentru entitățile aplicației
// ---------------------------------------------------------------------------

// -- Users -----------------------------------------------------------------

const userCreateSchema = {
  body: {
    name: { type: 'name', required: true, minLength: 2, maxLength: 128 },
    email: { type: 'email', required: true },
    password: {
      type: 'string', required: true, minLength: 8, maxLength: 128,
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]).{8,}$/,
      patternMessage: 'must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
    },
    role: { type: 'enum', oneOf: ['user', 'coach'], default: 'user' },
    phone: { type: 'phone' },
  },
};

const userUpdateSchema = {
  body: {
    name: { type: 'name', minLength: 2, maxLength: 128 },
    email: { type: 'email' },
    phone: { type: 'phone' },
    is_active: { type: 'boolean' },
  },
};

const loginSchema = {
  body: {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, minLength: 1 },
  },
};

const passwordChangeSchema = {
  body: {
    currentPassword: { type: 'string', required: true, minLength: 1 },
    newPassword: {
      type: 'string', required: true, minLength: 8, maxLength: 128,
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]).{8,}$/,
      patternMessage: 'must contain at least one uppercase letter, one lowercase letter, one number, and one special character.',
    },
  },
};

const paramsIdSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
};

const paramsSlugSchema = {
  params: { slug: { type: 'slug', required: true } },
};

// -- Coaches ---------------------------------------------------------------

const coachCreateSchema = {
  body: {
    name: { type: 'name', required: true, minLength: 2, maxLength: 128 },
    slug: { type: 'slug', required: true },
    title: { type: 'string', maxLength: 256 },
    bio: { type: 'text', maxLength: MAX_LONG_TEXT },
    specialties: { type: 'json', default: '[]' },
    certifications: { type: 'json', default: '[]' },
    email: { type: 'email' },
    phone: { type: 'phone' },
    image: { type: 'string', maxLength: 2048 },
    social_links: { type: 'json', default: '{}' },
    is_active: { type: 'boolean', default: true },
    sort_order: { type: 'integer', min: 0, default: 0 },
  },
};

const coachUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    name: { type: 'name', minLength: 2, maxLength: 128 },
    slug: { type: 'slug' },
    title: { type: 'string', maxLength: 256 },
    bio: { type: 'text', maxLength: MAX_LONG_TEXT },
    specialties: { type: 'json' },
    certifications: { type: 'json' },
    email: { type: 'email' },
    phone: { type: 'phone' },
    image: { type: 'string', maxLength: 2048 },
    social_links: { type: 'json' },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  },
};

// -- Events ----------------------------------------------------------------

const eventCreateSchema = {
  body: {
    title: { type: 'string', required: true, minLength: 2, maxLength: 256 },
    slug: { type: 'slug', required: true },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    type: { type: 'enum', oneOf: ['seminar', 'workshop', 'camp', 'competition', 'general'], default: 'general' },
    location: { type: 'string', maxLength: 256 },
    start_date: { type: 'date', required: true },
    end_date: { type: 'date' },
    time: { type: 'string', maxLength: 16 },
    price: { type: 'number', min: 0, default: 0 },
    capacity: { type: 'integer', min: 1 },
    image: { type: 'string', maxLength: 2048 },
    is_published: { type: 'boolean', default: true },
  },
};

const eventUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    title: { type: 'string', minLength: 2, maxLength: 256 },
    slug: { type: 'slug' },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    type: { type: 'enum', oneOf: ['seminar', 'workshop', 'camp', 'competition', 'general'] },
    location: { type: 'string', maxLength: 256 },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    time: { type: 'string', maxLength: 16 },
    price: { type: 'number', min: 0 },
    capacity: { type: 'integer', min: 1 },
    image: { type: 'string', maxLength: 2048 },
    is_published: { type: 'boolean' },
  },
};

// -- Schedule --------------------------------------------------------------

const scheduleCreateSchema = {
  body: {
    coach_id: { type: 'integer', min: 1 },
    title: { type: 'string', required: true, minLength: 2, maxLength: 256 },
    day_of_week: { type: 'integer', required: true, min: 0, max: 6 },
    start_time: { type: 'string', required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, patternMessage: 'must be in HH:MM format.' },
    end_time: { type: 'string', required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, patternMessage: 'must be in HH:MM format.' },
    location: { type: 'string', maxLength: 256 },
    max_participants: { type: 'integer', min: 1 },
    is_active: { type: 'boolean', default: true },
  },
};

const scheduleUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    coach_id: { type: 'integer', min: 1 },
    title: { type: 'string', minLength: 2, maxLength: 256 },
    day_of_week: { type: 'integer', min: 0, max: 6 },
    start_time: { type: 'string', pattern: /^([01]\d|2[0-3]):[0-5]\d$/, patternMessage: 'must be in HH:MM format.' },
    end_time: { type: 'string', pattern: /^([01]\d|2[0-3]):[0-5]\d$/, patternMessage: 'must be in HH:MM format.' },
    location: { type: 'string', maxLength: 256 },
    max_participants: { type: 'integer', min: 1 },
    is_active: { type: 'boolean' },
  },
};

/** Schemă pentru batch update (PUT /api/schedule) – înlocuire completă program */
const scheduleBatchUpdateSchema = {
  body: {
    entries: {
      type: 'array',
      required: true,
      minItems: 1,
      validate(value) {
        if (!Array.isArray(value)) return 'entries must be an array.';
        if (value.length === 0) return 'entries must have at least one entry.';
        for (let i = 0; i < value.length; i++) {
          const entry = value[i];
          if (typeof entry !== 'object' || entry === null)
            return `entries[${i}] must be an object.`;
          if (!entry.title || typeof entry.title !== 'string' || entry.title.trim().length < 2)
            return `entries[${i}].title is required (min 2 characters).`;
          if (entry.day_of_week === undefined || entry.day_of_week === null)
            return `entries[${i}].day_of_week is required.`;
          const dow = Number(entry.day_of_week);
          if (!Number.isInteger(dow) || dow < 0 || dow > 6)
            return `entries[${i}].day_of_week must be an integer between 0 and 6.`;
          if (!entry.start_time || typeof entry.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start_time))
            return `entries[${i}].start_time is required and must be in HH:MM format.`;
          if (!entry.end_time || typeof entry.end_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.end_time))
            return `entries[${i}].end_time is required and must be in HH:MM format.`;
          if (entry.coach_id !== undefined && entry.coach_id !== null) {
            const cid = Number(entry.coach_id);
            if (!Number.isInteger(cid) || cid < 1)
              return `entries[${i}].coach_id must be a positive integer.`;
          }
          if (entry.max_participants !== undefined && entry.max_participants !== null) {
            const mp = Number(entry.max_participants);
            if (!Number.isInteger(mp) || mp < 1)
              return `entries[${i}].max_participants must be a positive integer.`;
          }
          if (entry.location !== undefined && entry.location !== null && typeof entry.location === 'string' && entry.location.length > 256)
            return `entries[${i}].location must be at most 256 characters.`;
        }
        return true;
      },
    },
  },
};

// -- Plans -----------------------------------------------------------------

const planCreateSchema = {
  body: {
    name: { type: 'string', required: true, minLength: 2, maxLength: 128 },
    slug: { type: 'slug', required: true },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    price: { type: 'number', required: true, min: 0 },
    duration_days: { type: 'integer', required: true, min: 1, max: 365 },
    features: { type: 'json', default: '[]' },
    is_popular: { type: 'boolean', default: false },
    is_active: { type: 'boolean', default: true },
    sort_order: { type: 'integer', min: 0, default: 0 },
  },
};

const planUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    name: { type: 'string', minLength: 2, maxLength: 128 },
    slug: { type: 'slug' },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    price: { type: 'number', min: 0 },
    duration_days: { type: 'integer', min: 1, max: 365 },
    features: { type: 'json' },
    is_popular: { type: 'boolean' },
    is_active: { type: 'boolean' },
    sort_order: { type: 'integer', min: 0 },
  },
};

// -- Products --------------------------------------------------------------

const productCreateSchema = {
  body: {
    name: { type: 'string', required: true, minLength: 2, maxLength: 256 },
    slug: { type: 'slug', required: true },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    price: { type: 'number', required: true, min: 0 },
    category: { type: 'string', maxLength: 64, default: 'general' },
    image: { type: 'string', maxLength: 2048 },
    stock: { type: 'integer', min: 0 },
    is_active: { type: 'boolean', default: true },
  },
};

const productUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    name: { type: 'string', minLength: 2, maxLength: 256 },
    slug: { type: 'slug' },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    price: { type: 'number', min: 0 },
    category: { type: 'string', maxLength: 64 },
    image: { type: 'string', maxLength: 2048 },
    stock: { type: 'integer', min: 0 },
    is_active: { type: 'boolean' },
  },
};

// -- Orders ----------------------------------------------------------------

const orderCreateSchema = {
  body: {
    user_id: { type: 'integer', min: 1 },
    items: {
      type: 'json', required: true,
      validate(value) {
        try {
          const parsed = typeof value === 'string' ? JSON.parse(value) : value;
          if (!Array.isArray(parsed)) return 'items must be an array.';
          if (parsed.length === 0) return 'items must have at least one item.';
          for (const item of parsed) {
            if (!item.product_id || !item.quantity || !item.price) {
              return 'each item must have product_id, quantity, and price.';
            }
          }
          return true;
        } catch { return 'items must be valid JSON array.'; }
      },
    },
    billing_name: { type: 'name', minLength: 2, maxLength: 128 },
    billing_email: { type: 'email' },
    billing_phone: { type: 'phone' },
    notes: { type: 'text', maxLength: 2048 },
  },
};

const orderUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    status: { type: 'enum', oneOf: ['pending', 'confirmed', 'processing', 'completed', 'cancelled', 'refunded'] },
    billing_name: { type: 'name', minLength: 2, maxLength: 128 },
    billing_email: { type: 'email' },
    billing_phone: { type: 'phone' },
    notes: { type: 'text', maxLength: 2048 },
  },
};

// -- Contact Messages ------------------------------------------------------

const contactMessageSchema = {
  body: {
    name: { type: 'name', required: true, minLength: 2, maxLength: 128 },
    email: { type: 'email', required: true },
    subject: { type: 'string', maxLength: 256 },
    message: { type: 'text', required: true, minLength: 10, maxLength: 10000 },
  },
};

// -- Promotions ------------------------------------------------------------

const promotionCreateSchema = {
  body: {
    code: {
      type: 'string', required: true, minLength: 1, maxLength: 50,
      sanitize(value) { return typeof value === 'string' ? value.trim().toUpperCase() : value; },
    },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    discount_type: { type: 'enum', required: true, oneOf: ['percentage', 'fixed'] },
    discount_value: { type: 'number', required: true, min: 0 },
    applies_to: { type: 'enum', oneOf: ['all', 'plans', 'products', 'events'], default: 'all' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    usage_limit: { type: 'integer', min: 1 },
    is_active: { type: 'boolean', default: true },
  },
};

const promotionUpdateSchema = {
  params: { id: { type: 'integer', required: true, min: 1 } },
  body: {
    code: {
      type: 'string', minLength: 1, maxLength: 50,
      sanitize(value) { return typeof value === 'string' ? value.trim().toUpperCase() : value; },
    },
    description: { type: 'text', maxLength: MAX_LONG_TEXT },
    discount_type: { type: 'enum', oneOf: ['percentage', 'fixed'] },
    discount_value: { type: 'number', min: 0 },
    applies_to: { type: 'enum', oneOf: ['all', 'plans', 'products', 'events'] },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    usage_limit: { type: 'integer', min: 1 },
    is_active: { type: 'boolean' },
  },
};

/** Schemă pentru validare cod promoțional public (GET) */
const promoValidateSchema = {
  params: { code: { type: 'string', required: true, minLength: 1, maxLength: 50 } },
  query: {
    cart_total: { type: 'number', min: 0 },
    applies_to: { type: 'enum', oneOf: ['all', 'plans', 'products', 'events'] },
  },
};

/** Schemă pentru listare promoții (admin) – paginare + filtre specifice */
const promotionListSchema = {
  query: {
    page: { type: 'integer', min: 1, default: 1 },
    limit: { type: 'integer', min: 1, max: 100, default: 20 },
    sort: {
      type: 'string', maxLength: 32,
      validate(value) {
        if (/^-?[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return true;
        return 'must be a valid field name, optionally prefixed with "-" for descending.';
      },
    },
    search: { type: 'string', maxLength: 100 },
    is_active: { type: 'string', maxLength: 5 },
    applies_to: { type: 'enum', oneOf: ['all', 'plans', 'products', 'events'] },
  },
};

// -- Settings --------------------------------------------------------------

const settingsUpdateSchema = {
  body: {
    key: { type: 'string', required: true, minLength: 1, maxLength: 64, pattern: /^[a-z][a-z0-9_]*$/, patternMessage: 'must be a valid setting key (lowercase, underscores).' },
    value: { type: 'string', required: true, maxLength: MAX_LONG_TEXT },
  },
};

// -- Paginare --------------------------------------------------------------

const paginationSchema = {
  query: {
    page: { type: 'integer', min: 1, default: 1 },
    limit: { type: 'integer', min: 1, max: 100, default: 12 },
    sort: {
      type: 'string', maxLength: 32,
      validate(value) {
        if (/^-?[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) return true;
        return 'must be a valid field name, optionally prefixed with "-" for descending.';
      },
    },
    search: { type: 'string', maxLength: 256 },
  },
};

// ---------------------------------------------------------------------------
// Middleware de sanitizare globală
// ---------------------------------------------------------------------------

function globalSanitize(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body = sanitizeObjectStrings(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObjectStrings(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObjectStrings(req.params);
  }
  next();
}

function sanitizeObjectStrings(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = Array.isArray(obj) ? [] : {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObjectStrings(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Content-Type validation
// ---------------------------------------------------------------------------

function requireJsonContentType(req, res, next) {
  const methodsWithBody = ['POST', 'PUT', 'PATCH'];
  if (!methodsWithBody.includes(req.method)) return next();
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) {
    return res.status(415).json({ error: 'Unsupported Media Type. Use application/json.', code: 'UNSUPPORTED_MEDIA_TYPE' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Body size limit
// ---------------------------------------------------------------------------

function bodySizeLimit(maxSize = MAX_BODY_SIZE) {
  return function bodySizeLimitMiddleware(req, res, next) {
    const methodsWithBody = ['POST', 'PUT', 'PATCH'];
    if (!methodsWithBody.includes(req.method)) return next();
    const contentLength = parseInt(req.headers['content-length'], 10);
    if (!Number.isNaN(contentLength) && contentLength > maxSize) {
      return res.status(413).json({ error: 'Request body too large.', code: 'BODY_TOO_LARGE', maxSize });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Helper: combină mai multe scheme
// ---------------------------------------------------------------------------

function combineSchemas(...schemas) {
  const result = { body: {}, query: {}, params: {} };
  for (const schema of schemas) {
    if (schema.body) Object.assign(result.body, schema.body);
    if (schema.query) Object.assign(result.query, schema.query);
    if (schema.params) Object.assign(result.params, schema.params);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  validate,
  globalSanitize,
  requireJsonContentType,
  bodySizeLimit,
  userCreateSchema,
  userUpdateSchema,
  loginSchema,
  passwordChangeSchema,
  paramsIdSchema,
  paramsSlugSchema,
  coachCreateSchema,
  coachUpdateSchema,
  eventCreateSchema,
  eventUpdateSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
  scheduleBatchUpdateSchema,
  planCreateSchema,
  planUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  orderCreateSchema,
  orderUpdateSchema,
  contactMessageSchema,
  promotionCreateSchema,
  promotionUpdateSchema,
  promotionListSchema,
  promoValidateSchema,
  settingsUpdateSchema,
  paginationSchema,
  combineSchemas,
  sanitizeString,
  sanitizeLongText,
  sanitizeSlug,
  sanitizeName,
  sanitizePhone,
  sanitizeJson,
  isValidEmail,
  isValidSlug,
  isValidName,
  isValidUrl,
  isValidUuid,
  isValidDate,
  isValidNumber,
  isValidInteger,
  validateField,
  MAX_BODY_SIZE,
  DEFAULT_MAX_STRING,
  MAX_LONG_TEXT,
  MAX_SLUG,
  EMAIL_RE,
  SLUG_RE,
  NAME_RE,
  PHONE_RE,
  URL_RE,
  UUID_RE,
  DATE_RE,
};