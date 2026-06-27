# Boxing Champions

Aplicație web full-stack de lux pentru un club de box profesionist — site de prezentare, magazin online integrat și panou de administrare complet funcțional.

---

## Cuprins

- [Descriere](#descriere)
- [Arhitectură](#arhitectur%C4%83)
- [Stack Tehnologic](#stack-tehnologic)
- [Structură Proiect](#structur%C4%83-proiect)
- [Instalare](#instalare)
- [Configurare .env](#configurare-env)
- [Pornire](#pornire)
- [Endpoint-uri API](#endpoint-uri-api)
- [Panoul de Administrare](#panoul-de-administrare)
- [Sistemul de Promoții](#sistemul-de-promo%C8%9Bii)
- [Securitate](#securitate)
- [Design](#design)
- [Deploy](#deploy)
- [Testare](#testare)
- [Licență](#licen%C8%9B%C4%83)

---

## Descriere

**Boxing Champions** este o platformă web completă pentru un club de box care include:

- **Site public** – 6 pagini dinamice (Home, Evenimente, Program, Abonamente, Magazin, Contact) cu design imersiv premium.
- **Magazin online** – catalog de produse, coș de cumpărături persistent (localStorage), checkout Stripe (mod test) și sistem de coduri promoționale.
- **Panou de administrare** – interfață completă pentru gestionarea conținutului: antrenori, evenimente, program, abonamente, produse, comenzi, mesaje de contact, promoții și setări generale.

Toate datele afișate pe site-ul public sunt încărcate din API. Modificările din panoul de administrare se reflectă instant pe paginile publice după reîncărcare.

---

## Arhitectură

┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Public   │  │  Shop    │  │  Admin   │  │  assets/     │ │
│  │ 6 HTML   │  │ shop.js  │  │ Panel    │  │  css, js,    │ │
│  │ pages    │  │ localStorage│ admin.js│  │  images,     │ │
│  │          │  │ Cart     │  │ CRUD UI  │  │  video       │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────────────┘ │
└───────┼──────────────┼─────────────┼────────────────────────┘
        │    fetch()   │   fetch()   │   fetch()
        ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                   SERVER (Express.js)                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   MIDDLEWARE                          │   │
│  │  requestLogger → corsMiddleware → Helmet →            │   │
│  │  globalApiRateLimiter → bodyParser → cookieParser →   │   │
│  │  bodySizeLimit → globalSanitize →                     │   │
│  │  requireJsonContentType → nonceMiddleware →           │   │
│  │  cspMiddleware                                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                            │                                 │
│  ┌─────────────────────────┴───────────────────────────┐    │
│  │                    RUTE API                           │    │
│  │  auth  settings  coaches  events  schedule  plans    │    │
│  │  products  orders  contact  checkout  promotions     │    │
│  └──────────────────────────────────────────────────────┘    │
│                            │                                 │
│  ┌─────────────────────────┴───────────────────────────┐    │
│  │              MODELE & UTILITARE                      │    │
│  │  settingsModel.js  promo-validator.js                │    │
│  └──────────────────────────────────────────────────────┘    │
│                            │                                 │
│                     ┌──────┴──────┐                         │
│                     │   SQLite    │                         │
│                     │  (better-   │                         │
│                     │  sqlite3)   │                         │
│                     └─────────────┘                         │
└─────────────────────────────────────────────────────────────┘
### Flux de date

1. Browserul face cereri `fetch()` către API-ul Express
2. Middleware-ul procesează cererea (logging, CORS, rate limiting, validare, sanitizare)
3. Rutele verifică autentificarea/autorizarea prin `middleware/auth.js`
4. Rutele execută operații CRUD pe baza de date SQLite prin `better-sqlite3`
5. Răspunsul JSON este returnat browserului
6. Frontend-ul (HTML + JS) randă datele dinamic

---

## Stack Tehnologic

| Strat          | Tehnologie                                |
|----------------|-------------------------------------------|
| **Backend**    | Node.js 20 + Express 4.21                 |
| **Bază date**  | SQLite (better-sqlite3) cu mod WAL        |
| **Autentificare** | JWT (jsonwebtoken) + bcrypt              |
| **Securitate** | Helmet 8, CSP cu nonces, rate limiting    |
| **Plăți**      | Stripe (mod test)                         |
| **Frontend**   | HTML5, CSS3, Vanilla JavaScript (ES6+)    |
| **Fonturi**    | Bebas Neue, Montserrat, Oswald (Google)   |
| **Iconițe**    | Font Awesome 6 (CDN)                      |

---

## Structură Proiect

boxing-champions/
├── server.js                     # Punct principal de intrare Express
├── package.json                  # Dependințe și scripturi
├── .env                          # Variabile de mediu
├── .node-version                 # Specifică Node 20
├── plan.md                       # Planul original al proiectului
│
├── config/
│   └── db.js                     # Inițializare SQLite, tabele, seed
│
├── models/
│   └── settingsModel.js          # Model key-value pentru setări
│
├── middleware/
│   ├── auth.js                   # JWT auth, CSRF, role-based access
│   ├── security.js               # Helmet, CSP, CORS, rate limiting
│   └── validate.js               # Validare input pe scheme
│
├── routes/
│   ├── auth.js                   # POST /api/auth/login, GET /api/auth/check
│   ├── settings.js               # GET/PUT /api/settings
│   ├── coaches.js                # CRUD /api/coaches
│   ├── events.js                 # CRUD /api/events
│   ├── schedule.js               # GET/PUT /api/schedule (batch)
│   ├── plans.js                  # CRUD /api/plans
│   ├── products.js               # CRUD /api/products + categorii
│   ├── orders.js                 # GET/POST/PUT /api/orders
│   ├── contact.js                # GET/POST/PUT/DELETE /api/contact
│   ├── checkout.js               # POST /api/checkout (Stripe)
│   └── promotions.js             # CRUD /api/promotions + validare publică
│
├── utils/
│   └── promo-validator.js        # Validare centralizată coduri promo
│
├── public/                       # Site-ul public
│   ├── index.html                # Home
│   ├── events.html               # Evenimente
│   ├── schedule.html             # Program săptămânal
│   ├── pricing.html              # Abonamente
│   ├── shop.html                 # Magazin
│   ├── contact.html              # Contact
│   ├── css/
│   │   └── style.css             # Stiluri globale
│   ├── js/
│   │   ├── shared.js             # Particule, cursor, animații, fetch
│   │   └── shop.js               # Coș, checkout, promoții, randare produse
│   ├── images/                   # Imagini statice
│   └── video/                    # Video hero
│
├── admin/                        # Panoul de administrare
│   ├── views/
│   │   ├── login.html            # Pagina de login
│   │   └── dashboard.html        # Dashboard complet
│   ├── css/
│   │   └── admin.css             # Stiluri admin
│   └── js/
│       └── admin.js              # Logică completă dashboard
│
└── tests/                        # Teste automate
    ├── run.js                    # Test runner minimal
    ├── test-auth.js              # Teste autentificare
    ├── test-coaches.js           # Teste CRUD antrenori
    ├── test-events.js            # Teste CRUD evenimente
    ├── test-products.js          # Teste CRUD produse
    └── test-checkout.js          # Teste checkout + promoții
---

## Instalare

### Cerințe

- **Node.js** >= 20.x
- **npm** >= 9.x
- **SQLite** (nu necesită instalare separată — better-sqlite3 se compilează automat)

### Pași

# 1. Clonează proiectul
git clone <repo-url> boxing-champions
cd boxing-champions

# 2. Instalează dependințele
npm install

# 3. Configurează variabilele de mediu (vezi secțiunea următoare)
cp .env.example .env   # sau editează .env existent

# 4. Pornește serverul
npm start
Serverul va porni pe portul configurat în `.env` (implicit 3000).

---

## Configurare .env

Creează un fișier `.env` în rădăcina proiectului cu următoarele variabile:

# Portul serverului
PORT=3000

# Secret JWT (minim 32 caractere, generat aleator)
JWT_SECRET=A6WCIFpSx9UdAtUVObUnFlORhZtdhuWzlCS5YhDTEAOEJVzy9M4IBQw6QK8Ax5t9

# Cheia secretă Stripe (mod test: sk_test_..., mod real: sk_live_...)
# Pentru testare locală, lasă sk_test_placeholder — checkout-ul va fi simulat.
STRIPE_KEY=sk_test_placeholder

# Mediu: development | production
NODE_ENV=development

# Opțional: credentiale admin personalizate
# ADMIN_EMAIL=admin@boxingchampions.ro
# ADMIN_PASSWORD=boxing2026
# ADMIN_NAME=Boxing Champions Admin

# Opțional: origini permise CORS (separate prin virgulă)
# ALLOWED_ORIGINS=https://exemplu.ro,https://www.exemplu.ro

# Opțional: TTL pentru token-uri JWT
# JWT_ACCESS_TTL=15m
# JWT_REFRESH_TTL=7d
### Generare JWT_SECRET

node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
---

## Pornire

# Development (cu auto-reload la modificări)
npm run dev

# Production
NODE_ENV=production npm start
### Verificare

# Testează API-ul
curl http://localhost:3000/api/settings

# Testează autentificarea
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@boxingchampions.ro","password":"boxing2026"}'
---

## Endpoint-uri API

### Autentificare

| Metodă  | Rută                   | Autentificare | Descriere                            |
|---------|------------------------|---------------|--------------------------------------|
| `POST`  | `/api/auth/login`      | Nu            | Login (returnează JWT în cookie)     |
| `GET`   | `/api/auth/check`      | Opțional      | Verificare sesiune                   |
| `POST`  | `/api/auth/logout`     | Da            | Logout + revocare token              |
| `POST`  | `/api/auth/refresh`    | Refresh Token | Reîmprospătare token                 |

### Setări

| Metodă  | Rută              | Auth  | Descriere                |
|---------|-------------------|-------|--------------------------|
| `GET`   | `/api/settings`   | Nu    | Setări publice           |
| `PUT`   | `/api/settings`   | Admin | Actualizare setări       |

### Antrenori

| Metodă    | Rută                | Auth  | Descriere                |
|-----------|---------------------|-------|--------------------------|
| `GET`     | `/api/coaches`      | Nu    | Listare (pag, sort, search) |
| `GET`     | `/api/coaches/:id`  | Nu    | Detalii antrenor         |
| `POST`    | `/api/coaches`      | Admin | Creare antrenor          |
| `PUT`     | `/api/coaches/:id`  | Admin | Actualizare antrenor     |
| `DELETE`  | `/api/coaches/:id`  | Admin | Ștergere antrenor        |

### Evenimente

| Metodă    | Rută               | Auth  | Descriere                |
|-----------|--------------------|-------|--------------------------|
| `GET`     | `/api/events`      | Nu    | Listare (pag, sort, filtru) |
| `GET`     | `/api/events/:id`  | Nu    | Detalii eveniment        |
| `POST`    | `/api/events`      | Admin | Creare eveniment         |
| `PUT`     | `/api/events/:id`  | Admin | Actualizare eveniment    |
| `DELETE`  | `/api/events/:id`  | Admin | Ștergere eveniment       |

### Program

| Metodă  | Rută             | Auth  | Descriere                        |
|---------|------------------|-------|----------------------------------|
| `GET`   | `/api/schedule`  | Nu    | Program grupat pe zile           |
| `PUT`   | `/api/schedule`  | Admin | Înlocuire completă (batch)       |

### Abonamente

| Metodă    | Rută              | Auth  | Descriere                |
|-----------|-------------------|-------|--------------------------|
| `GET`     | `/api/plans`      | Nu    | Listare (pag, sort, filtru) |
| `GET`     | `/api/plans/:id`  | Nu    | Detalii plan             |
| `POST`    | `/api/plans`      | Admin | Creare plan              |
| `PUT`     | `/api/plans/:id`  | Admin | Actualizare plan         |
| `DELETE`  | `/api/plans/:id`  | Admin | Ștergere plan            |

### Produse

| Metodă    | Rută                       | Auth  | Descriere                |
|-----------|----------------------------|-------|--------------------------|
| `GET`     | `/api/products`            | Nu    | Listare (pag, sort, filtru) |
| `GET`     | `/api/products/categories` | Nu    | Categorii cu număr       |
| `GET`     | `/api/products/:id`        | Nu    | Detalii produs (ID)      |
| `GET`     | `/api/products/slug/:slug` | Nu    | Detalii produs (slug)    |
| `POST`    | `/api/products`            | Admin | Creare produs            |
| `PUT`     | `/api/products/:id`        | Admin | Actualizare produs       |
| `DELETE`  | `/api/products/:id`        | Admin | Ștergere produs          |

### Comenzi

| Metodă  | Rută               | Auth        | Descriere                |
|---------|--------------------|-------------|--------------------------|
| `GET`   | `/api/orders`      | Da          | Listare (admin: toate; user: proprii) |
| `GET`   | `/api/orders/:id`  | Da          | Detalii comandă          |
| `POST`  | `/api/orders`      | Opțional    | Creare comandă           |
| `PUT`   | `/api/orders/:id`  | Admin       | Actualizare status       |

### Contact

| Metodă    | Rută                | Auth  | Descriere                |
|-----------|---------------------|-------|--------------------------|
| `GET`     | `/api/contact`      | Admin | Listare mesaje           |
| `GET`     | `/api/contact/:id`  | Admin | Detalii mesaj            |
| `POST`    | `/api/contact`      | Nu    | Trimitere mesaj (public) |
| `PUT`     | `/api/contact/:id`  | Admin | Marchează citit          |
| `DELETE`  | `/api/contact/:id`  | Admin | Ștergere mesaj           |

### Checkout

| Metodă  | Rută                                  | Auth | Descriere                     |
|---------|---------------------------------------|------|-------------------------------|
| `POST`  | `/api/checkout`                       | Nu   | Creează sesiune Stripe        |
| `GET`   | `/api/config`                         | Nu   | Config public (cheie Stripe)  |
| `GET`   | `/api/checkout/validate-promo/:code`  | Nu   | Validare cod promoțional      |

### Promoții

| Metodă    | Rută                              | Auth  | Descriere                |
|-----------|-----------------------------------|-------|--------------------------|
| `GET`     | `/api/promotions`                 | Admin | Listare promoții         |
| `POST`    | `/api/promotions`                 | Admin | Creare promoție          |
| `PUT`     | `/api/promotions/:id`             | Admin | Actualizare promoție     |
| `DELETE`  | `/api/promotions/:id`             | Admin | Ștergere promoție        |
| `GET`     | `/api/promotions/validate/:code`  | Nu    | Validare publică cod     |

### Parametri comuni de query (listare)

| Parametru | Tip     | Descriere                              |
|-----------|---------|----------------------------------------|
| `page`    | integer | Pagina curentă (implicit: 1)           |
| `limit`   | integer | Elemente per pagină (max 100)          |
| `sort`    | string  | Câmp de sortare, prefix `-` = descendent |
| `search`  | string  | Căutare text liberă                    |

Exemplu: `GET /api/coaches?page=1&limit=6&sort=-created_at&search=ion`

---

## Panoul de Administrare

### Acces

1. Deschide `http://localhost:3000/admin` – vei fi redirecționat către pagina de login.
2. Autentifică-te cu credențialele implicite:
   - **Email:** `admin@boxingchampions.ro`
   - **Parolă:** `boxing2026`

### Secțiuni disponibile

| Secțiune           | Funcționalitate                                         |
|--------------------|---------------------------------------------------------|
| **Dashboard**      | Statistici generale (antrenori, evenimente, comenzi)    |
| **Antrenori**      | CRUD complet: nume, specializare, certificări, poză     |
| **Evenimente**     | CRUD complet: titlu, dată, locație, descriere           |
| **Produse**        | CRUD complet: nume, preț, stoc, categorie, imagine      |
| **Abonamente**     | CRUD complet: nume, preț, beneficii, plan popular       |
| **Program**        | Gestiune sesiuni săptămânale (batch update)             |
| **Comenzi**        | Vizualizare și actualizare status comenzi               |
| **Mesaje Contact** | Vizualizare, marcare citit, ștergere                    |
| **Promoții**       | CRUD coduri promoționale (procent/sumă fixă)            |
| **Setări**         | Nume club, contact, social media, program               |

---

## Sistemul de Promoții

### Arhitectură

Sistemul de promoții este **complet sincronizat** între cele trei componente:

1. **Baza de date** (`promotions` table) – sursa autoritară
2. **API** (`routes/promotions.js` + `routes/checkout.js`) – CRUD + validare
3. **Frontend** (`public/js/shop.js` + `admin/js/admin.js`) – aplicare + afișare

### Tipuri de discount

- **Procent** (`percentage`): reducere procentuală (ex: 20% din subtotal)
- **Sumă fixă** (`fixed`): reducere în RON (ex: 50 RON)

### Context de aplicare (`applies_to`)

- `all` – orice tip de comandă
- `products` – doar produse din magazin
- `plans` – doar abonamente
- `events` – doar evenimente

### Validare

Promoțiile sunt validate automat:
- Perioada de valabilitate (`start_date` – `end_date`)
- Limita de utilizări (`usage_limit`)
- Status activ/inactiv
- Contextul de aplicare (`applies_to`)

### Flow

Client introduce cod → GET /api/promotions/validate/:code
                   → promo-validator.js verifică DB
                   → Returnează discount calculat
                   → Se aplică la checkout
                   → usage_count se incrementează
---

## Securitate

### Implementat

| Măsură                        | Detalii                                             |
|-------------------------------|-----------------------------------------------------|
| **Helmet**                    | X-Frame-Options: DENY, X-Content-Type-Options       |
| **CSP cu nonces**             | Content-Security-Policy cu nonce-uri criptografice  |
| **HSTS**                      | Strict-Transport-Security (1 an)                    |
| **CORS**                      | Same-origin strict                                  |
| **Rate Limiting**             | 200 req/min global, 5/15min auth, 5/10min contact  |
| **JWT HttpOnly**              | Cookie-uri securizate, SameSite=Strict              |
| **CSRF Defense-in-Depth**     | Token CSRF + header custom pentru mutații           |
| **bcrypt**                    | Hash parole (cost 12)                               |
| **Prepared Statements**       | Toate query-urile SQL folosesc parametri legați     |
| **Validare Input**            | Middleware de validare pe scheme cu sanitizare XSS  |
| **JWT Blacklist**             | Token-uri revocate la logout                        |
| **Refresh Token Rotation**    | Token refresh cu rotație și revocare                |
| **Body Size Limit**           | Max 1 MB per cerere                                 |
| **Erori generice**            | Fără scurgeri de detalii interne în producție       |

### Configurare pentru producție

Înainte de deploy, modifică în `.env`:

NODE_ENV=production
JWT_SECRET=<secret-puternic-generat-aleator>
STRIPE_KEY=sk_live_...
---

## Design

### Temă

- **Negru profund:** `#0a0a0a` (fundal)
- **Auriu:** `#d4af37`, `#f0c040` (accente)
- **Roșu închis:** `#8b0000`, `#c62828` (butoane, badge-uri)

### Caracteristici vizuale

- **Glassmorphism** – carduri, navbar și formulare cu efect de sticlă
- **Particule canvas aurii** – fundal animat interactiv cu mouse-ul
- **Cursor personalizat** – cerc auriu cu trail (nu pe touch)
- **Animații la scroll** – Intersection Observer cu fade-in
- **Preloader** – animație de încărcare cu fade-out
- **Fonturi Google** – Bebas Neue (titluri), Montserrat (corp), Oswald (subtitluri)

### Responsive

- **320px – 2560px** – complet responsive
- Hamburger menu la sub 768px
- Grid-uri adaptive (1-4 coloane)
- Tabele cu scroll orizontal pe mobil
- Butoane și formulare full-width pe ecrane mici

---

## Deploy

### Opțiunea 1: VPS / Server dedicat

# 1. Instalează Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clonează proiectul
git clone <repo-url> /var/www/boxing-champions
cd /var/www/boxing-champions

# 3. Instalează dependințe
npm ci --production

# 4. Configurează .env pentru producție
nano .env

# 5. Pornește cu PM2
npm install -g pm2
pm2 start server.js --name boxing-champions
pm2 save
pm2 startup
### Opțiunea 2: Platformă PaaS (Railway, Render, Fly.io)

1. Asigură-te că `package.json` are `"start": "node server.js"`
2. Setează variabilele de mediu din dashboard-ul platformei
3. Platforma va detecta automat Node.js și va rula `npm start`

### Verificare deploy

curl https://domeniul-tau.ro/api/settings
# Ar trebui să returneze un obiect JSON cu setările
---

## Testare

Testele folosesc un test runner minimal, fără dependințe externe.

# Rulează toate testele
node tests/run.js

# Sau individual
node tests/test-auth.js
node tests/test-coaches.js
node tests/test-events.js
node tests/test-products.js
node tests/test-checkout.js
Testele acoperă:
- **Autentificare** – login, check, logout, credențiale invalide
- **Antrenori** – CRUD complet (create, read, update, delete)
- **Evenimente** – CRUD complet
- **Produse** – CRUD complet
- **Checkout** – creare comandă, validare promoții, simulare Stripe

Pentru a rula testele, serverul trebuie să fie pornit (`npm start` într-un terminal separat).

---

## Licență

UNLICENSED — Proiect privat. Toate drepturile rezervate.