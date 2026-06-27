// ---------------------------------------------------------------------------
// utils/email.js
// Serviciu centralizat de trimitere email-uri
//
// Citește configurările SMTP din tabela `settings` (key-value).
// Trimite email-uri folosind nodemailer (opțional).
// Dacă SMTP nu este configurat, loghează conținutul în consolă.
//
// Oferă:
//   - sendOrderConfirmation(order, recipientEmail)
//   - sendWelcomeEmail(user, generatedPassword)
//   - sendContactNotification(contactMessage)
//   - isSmtpConfigured()
//   - getSmtpConfig()
// ---------------------------------------------------------------------------

const { getDb } = require('../config/db');

// ---------------------------------------------------------------------------
// Constante
// ---------------------------------------------------------------------------

/** Numele site-ului (fallback) */
const DEFAULT_SITE_NAME = 'Boxing Champions';

/** Adresa admin (fallback) */
const DEFAULT_ADMIN_EMAIL = 'admin@boxingchampions.ro';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Citește configurarea SMTP din baza de date.
 *
 * @returns {{ host: string, port: number, user: string, pass: string, configured: boolean }}
 */
function getSmtpConfig() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings WHERE key LIKE ?').all('smtp%');
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return {
      host: config.smtp_host || '',
      port: parseInt(config.smtp_port, 10) || 587,
      user: config.smtp_user || '',
      pass: config.smtp_pass || '',
      configured: !!(config.smtp_host && config.smtp_user && config.smtp_pass),
    };
  } catch {
    return { host: '', port: 587, user: '', pass: '', configured: false };
  }
}

/**
 * Verifică dacă SMTP este configurat.
 *
 * @returns {boolean}
 */
function isSmtpConfigured() {
  const smtp = getSmtpConfig();
  return smtp.configured;
}

/**
 * Obține numele site-ului din setări.
 *
 * @returns {string}
 */
function getSiteName() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('site_name');
    return row ? row.value : DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

/**
 * Obține email-ul admin din setări.
 *
 * @returns {string}
 */
function getAdminEmail() {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_email');
    return row ? row.value : DEFAULT_ADMIN_EMAIL;
  } catch {
    return DEFAULT_ADMIN_EMAIL;
  }
}

/**
 * Încearcă să creeze un transporter nodemailer.
 * Returnează null dacă nodemailer nu este disponibil.
 *
 * @returns {object|null}
 */
function createTransporter() {
  const smtp = getSmtpConfig();
  if (!smtp.configured) return null;

  try {
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
  } catch {
    return null;
  }
}

/**
 * Trimite efectiv un email sau loghează dacă SMTP nu e configurat.
 *
 * @param {{ to: string, subject: string, text: string, html?: string }} options
 * @returns {Promise<{ sent: boolean, mode: string, error?: string }>}
 */
async function sendOrLog(options) {
  const smtp = getSmtpConfig();

  if (!smtp.configured) {
    console.log(`[email] SMTP not configured. Would send to ${options.to}:`);
    console.log(`[email] Subject: ${options.subject}`);
    console.log(`[email] Body:\n${options.text}`);
    return { sent: false, mode: 'log' };
  }

  const transporter = createTransporter();
  if (!transporter) {
    console.log(`[email] nodemailer not available. Would send to ${options.to}:`);
    console.log(`[email] Subject: ${options.subject}`);
    console.log(`[email] Body:\n${options.text}`);
    return { sent: false, mode: 'log' };
  }

  try {
    const siteName = getSiteName();
    const fromAddress = smtp.user;

    await transporter.sendMail({
      from: `"${siteName}" <${fromAddress}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html || undefined,
    });

    console.log(`[email] Sent "${options.subject}" to ${options.to}`);
    return { sent: true, mode: 'smtp' };
  } catch (err) {
    console.error(`[email] Failed to send to ${options.to}:`, err.message);
    // Loghează conținutul ca fallback
    console.log(`[email] Fallback log - Subject: ${options.subject}`);
    console.log(`[email] Fallback log - Body:\n${options.text}`);
    return { sent: false, mode: 'error', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Email-uri specifice
// ---------------------------------------------------------------------------

/**
 * Trimite email de confirmare a comenzii.
 *
 * @param {object} order - comanda (cu order_number, items, total_amount, status, billing_address)
 * @param {string} recipientEmail - adresa de email a destinatarului
 * @returns {Promise<{ sent: boolean, mode: string, error?: string }>}
 */
async function sendOrderConfirmation(order, recipientEmail) {
  const siteName = getSiteName();
  const adminEmail = getAdminEmail();

  if (!recipientEmail || typeof recipientEmail !== 'string' || !recipientEmail.includes('@')) {
    console.log('[email] No valid recipient email for order confirmation.');
    return { sent: false, mode: 'skip' };
  }

  const itemsList = (order.items || []).map(
    item => `  • ${item.product_name} x ${item.quantity} — ${Number(item.line_total).toFixed(2)} RON`
  ).join('\n');

  const addressBlock = order.billing_address
    ? `\nAdresă facturare:\n${order.billing_address}\n`
    : '';

  const subject = `Comanda ${order.order_number} — Confirmare ${siteName}`;

  const text = `Bună ziua,

Îți confirmăm că am înregistrat comanda ${order.order_number}.

Detalii comandă:
${itemsList}

Total: ${Number(order.total_amount).toFixed(2)} RON
Status: ${order.status || 'pending'}${addressBlock}
Poți urmări statusul comenzii în contul tău.

Dacă ai întrebări, ne poți contacta la ${adminEmail}.

Cu respect,
Echipa ${siteName}`;

  return sendOrLog({ to: recipientEmail, subject, text });
}

/**
 * Trimite email de bun venit unui utilizator nou creat automat.
 * Include parola generată (doar dacă e furnizată).
 *
 * @param {object} user - utilizatorul ({ name, email })
 * @param {string} [generatedPassword] - parola generată automat
 * @returns {Promise<{ sent: boolean, mode: string, error?: string }>}
 */
async function sendWelcomeEmail(user, generatedPassword) {
  const siteName = getSiteName();
  const adminEmail = getAdminEmail();

  if (!user.email || typeof user.email !== 'string' || !user.email.includes('@')) {
    console.log('[email] No valid recipient email for welcome email.');
    return { sent: false, mode: 'skip' };
  }

  const subject = `Bun venit la ${siteName}, ${user.name || ''}`;

  const passwordBlock = generatedPassword
    ? `\nȚi-am creat automat un cont. Poți folosi următoarele date pentru autentificare:\n\n  Email: ${user.email}\n  Parolă: ${generatedPassword}\n\nTe rugăm să schimbi parola după prima autentificare.\n`
    : '\nȚi-am creat automat un cont pe baza acestei adrese de email. Poți solicita resetarea parolei din pagina de autentificare.\n';

  const text = `Bună ziua, ${user.name || ''}!

Îți urăm bun venit la ${siteName}.${passwordBlock}
Cu respect,
Echipa ${siteName}
${adminEmail}`;

  return sendOrLog({ to: user.email, subject, text });
}

/**
 * Trimite notificare către admin când se primește un mesaj de contact.
 *
 * @param {object} message - mesajul de contact ({ name, email, subject, message })
 * @returns {Promise<{ sent: boolean, mode: string, error?: string }>}
 */
async function sendContactNotification(message) {
  const adminEmail = getAdminEmail();

  if (!adminEmail) {
    return { sent: false, mode: 'skip' };
  }

  const subject = `Mesaj nou: ${message.subject || 'Fără subiect'} — de la ${message.name}`;

  const text = `Mesaj nou de pe site:

Nume: ${message.name}
Email: ${message.email}
Subiect: ${message.subject || 'Fără subiect'}

Mesaj:
${message.message}

---
Acest mesaj a fost trimis prin formularul de contact.`;

  return sendOrLog({ to: adminEmail, subject, text });
}

// ---------------------------------------------------------------------------
// Exporturi
// ---------------------------------------------------------------------------

module.exports = {
  sendOrderConfirmation,
  sendWelcomeEmail,
  sendContactNotification,
  isSmtpConfigured,
  getSmtpConfig,
  getSiteName,
  getAdminEmail,
};