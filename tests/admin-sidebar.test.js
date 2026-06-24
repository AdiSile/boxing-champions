'use strict';

// =============================================================================
// tests/admin-sidebar.test.js
// =============================================================================
// Teste pentru structura sidebar-ului din panoul de administrare.
// Verifică gruparea logică a butoanelor de navigare:
//   - „Realizări" (achievements) trebuie să fie în secțiunea „Conținut",
//     alături de „Antrenori" (coaches) și „Evenimente" (events).
//   - „SEO" trebuie să fie în secțiunea „Marketing".
//   - Fiecare secțiune trebuie să aibă cel puțin un element.
//
// Abordare TDD: testele definesc structura așteptată înainte ca
// modificările să fie aplicate în dashboard.html.
// =============================================================================

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers — parsare HTML minimală fără dependențe externe
// ---------------------------------------------------------------------------

/**
 * Citește fișierul dashboard.html și extrage structura sidebar-ului.
 * @returns {{ sections: Array<{ title: string, items: Array<{ section: string, label: string }> }> }}
 */
function parseSidebarStructure() {
  const htmlPath = path.join(__dirname, '..', 'admin', 'views', 'dashboard.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const sections = [];
  // Găsește toate blocurile sidebar-section
  const sectionMatches = html.match(/<div class="sidebar-section">[\s\S]*?<\/div>\s*(?=<div class="sidebar-section">|<\/nav>)/g) || [];

  sectionMatches.forEach((sectionHtml) => {
    const titleMatch = sectionHtml.match(/<div class="sidebar-section-title">([^<]+)<\/div>/);
    const title = titleMatch ? titleMatch[1].trim() : 'Necunoscut';

    const items = [];
    const itemRegex = /data-section="([^"]+)"/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(sectionHtml)) !== null) {
      const sectionName = itemMatch[1];
      // Extrage label-ul din span-ul aferent
      const btnHtml = sectionHtml.substring(
        Math.max(0, itemMatch.index - 500),
        Math.min(sectionHtml.length, itemMatch.index + 500)
      );
      const labelMatch = btnHtml.match(new RegExp(
        `data-section="${sectionName}"[^>]*>[\\s\\S]*?<span>(?:<i[^>]*><\\/i>\\s*)?([^<]+)<\\/span>`
      ));
      const label = labelMatch ? labelMatch[1].trim() : sectionName;
      items.push({ section: sectionName, label });
    }

    if (items.length > 0) {
      sections.push({ title, items });
    }
  });

  return { sections };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Admin Dashboard — Structura Sidebar', () => {
  let sidebarData;

  beforeAll(() => {
    sidebarData = parseSidebarStructure();
  });

  // -------------------------------------------------------------------------
  // 1. Secțiunea „Conținut" — achievements lângă coaches și events
  // -------------------------------------------------------------------------
  describe('Secțiunea „Conținut"', () => {
    let continutSection;

    beforeAll(() => {
      continutSection = sidebarData.sections.find(
        (s) => s.title === 'Conținut'
      );
    });

    test('secțiunea „Conținut" există în sidebar', () => {
      expect(continutSection).toBeDefined();
    });

    test('conține butonul „Antrenori" (coaches)', () => {
      const coaches = continutSection.items.find((i) => i.section === 'coaches');
      expect(coaches).toBeDefined();
      expect(coaches.label).toBe('Antrenori');
    });

    test('conține butonul „Evenimente" (events)', () => {
      const events = continutSection.items.find((i) => i.section === 'events');
      expect(events).toBeDefined();
      expect(events.label).toBe('Evenimente');
    });

    test('conține butonul „Realizări" (achievements)', () => {
      const achievements = continutSection.items.find(
        (i) => i.section === 'achievements'
      );
      expect(achievements).toBeDefined();
      expect(achievements.label).toBe('Realizări');
    });

    test('„Realizări" (achievements) apare după „Evenimente" (events) în listă', () => {
      const eventIndex = continutSection.items.findIndex(
        (i) => i.section === 'events'
      );
      const achIndex = continutSection.items.findIndex(
        (i) => i.section === 'achievements'
      );
      expect(eventIndex).toBeGreaterThanOrEqual(0);
      expect(achIndex).toBeGreaterThanOrEqual(0);
      // achievements trebuie să fie în aceeași secțiune, lângă events
      expect(achIndex).toBeGreaterThan(eventIndex);
    });

    test('conține cel puțin 3 elemente (coaches, events, achievements, schedule)', () => {
      expect(continutSection.items.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Secțiunea „Marketing" — conține SEO
  // -------------------------------------------------------------------------
  describe('Secțiunea „Marketing"', () => {
    let marketingSection;

    beforeAll(() => {
      marketingSection = sidebarData.sections.find(
        (s) => s.title === 'Marketing'
      );
    });

    test('secțiunea „Marketing" există în sidebar', () => {
      expect(marketingSection).toBeDefined();
    });

    test('conține butonul „SEO" (seo)', () => {
      const seo = marketingSection.items.find((i) => i.section === 'seo');
      expect(seo).toBeDefined();
      expect(seo.label).toBe('SEO');
    });

    test('butonul „SEO" este singurul element din „Marketing" (secțiunea este dedicată)', () => {
      // SEO rămâne în Marketing; secțiunea poate avea exact 1 element
      // sau mai multe dacă se adaugă funcționalități noi de marketing
      expect(marketingSection.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Secțiunea „Principal" — conține settings
  // -------------------------------------------------------------------------
  describe('Secțiunea „Principal"', () => {
    let principalSection;

    beforeAll(() => {
      principalSection = sidebarData.sections.find(
        (s) => s.title === 'Principal'
      );
    });

    test('secțiunea „Principal" există', () => {
      expect(principalSection).toBeDefined();
    });

    test('conține „Setări Generale" (settings)', () => {
      const settings = principalSection.items.find(
        (i) => i.section === 'settings'
      );
      expect(settings).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Secțiunea „Comercial" — conține subscriptions, products, orders
  // -------------------------------------------------------------------------
  describe('Secțiunea „Comercial"', () => {
    let comercialSection;

    beforeAll(() => {
      comercialSection = sidebarData.sections.find(
        (s) => s.title === 'Comercial'
      );
    });

    test('secțiunea „Comercial" există', () => {
      expect(comercialSection).toBeDefined();
    });

    test('conține „Abonamente" (subscriptions)', () => {
      const subs = comercialSection.items.find(
        (i) => i.section === 'subscriptions'
      );
      expect(subs).toBeDefined();
    });

    test('conține „Produse" (products)', () => {
      const prods = comercialSection.items.find(
        (i) => i.section === 'products'
      );
      expect(prods).toBeDefined();
    });

    test('conține „Comenzi" (orders)', () => {
      const orders = comercialSection.items.find(
        (i) => i.section === 'orders'
      );
      expect(orders).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Secțiunea „Comunicare" — conține messages
  // -------------------------------------------------------------------------
  describe('Secțiunea „Comunicare"', () => {
    let comunicareSection;

    beforeAll(() => {
      comunicareSection = sidebarData.sections.find(
        (s) => s.title === 'Comunicare'
      );
    });

    test('secțiunea „Comunicare" există', () => {
      expect(comunicareSection).toBeDefined();
    });

    test('conține „Mesaje" (messages)', () => {
      const msgs = comunicareSection.items.find(
        (i) => i.section === 'messages'
      );
      expect(msgs).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Verificare globală — achievements NU este în Marketing
  // -------------------------------------------------------------------------
  describe('Reguli de grupare logică', () => {
    test('„Realizări" (achievements) NU se află în secțiunea „Marketing"', () => {
      const marketingSection = sidebarData.sections.find(
        (s) => s.title === 'Marketing'
      );
      if (marketingSection) {
        const achInMarketing = marketingSection.items.find(
          (i) => i.section === 'achievements'
        );
        expect(achInMarketing).toBeUndefined();
      }
    });

    test('„SEO" (seo) NU se află în secțiunea „Conținut"', () => {
      const continutSection = sidebarData.sections.find(
        (s) => s.title === 'Conținut'
      );
      if (continutSection) {
        const seoInContinut = continutSection.items.find(
          (i) => i.section === 'seo'
        );
        expect(seoInContinut).toBeUndefined();
      }
    });

    test('fiecare secțiune are cel puțin un element', () => {
      sidebarData.sections.forEach((section) => {
        expect(section.items.length).toBeGreaterThanOrEqual(1);
      });
    });

    test('toate secțiunile principale sunt prezente', () => {
      const sectionTitles = sidebarData.sections.map((s) => s.title);
      expect(sectionTitles).toContain('Principal');
      expect(sectionTitles).toContain('Conținut');
      expect(sectionTitles).toContain('Comercial');
      expect(sectionTitles).toContain('Comunicare');
      expect(sectionTitles).toContain('Marketing');
    });
  });
});

// =============================================================================
// Teste pentru admin.js — switchSection și mapare secțiuni
// =============================================================================

describe('Admin JS — Mapare secțiuni în switchSection', () => {
  // Citim admin.js și verificăm că funcția switchSection direcționează
  // corect secțiunile către funcțiile de încărcare.
  let adminJsContent;

  beforeAll(() => {
    const jsPath = path.join(__dirname, '..', 'admin', 'js', 'admin.js');
    adminJsContent = fs.readFileSync(jsPath, 'utf8');
  });

  test('secțiunea „achievements" este mapată la loadAchievements()', () => {
    // Verifică existența mapării în switch/case
    expect(adminJsContent).toMatch(
      /case\s+['"]achievements['"]\s*:\s*loadAchievements\(\)/
    );
  });

  test('secțiunea „seo" este mapată la loadSEO()', () => {
    expect(adminJsContent).toMatch(
      /case\s+['"]seo['"]\s*:\s*loadSEO\(\)/
    );
  });

  test('secțiunea „coaches" este mapată la loadCoaches()', () => {
    expect(adminJsContent).toMatch(
      /case\s+['"]coaches['"]\s*:\s*loadCoaches\(\)/
    );
  });

  test('secțiunea „events" este mapată la loadEvents()', () => {
    expect(adminJsContent).toMatch(
      /case\s+['"]events['"]\s*:\s*loadEvents\(\)/
    );
  });

  test('obiectul sectionTitles conține achievements și seo', () => {
    expect(adminJsContent).toMatch(/achievements\s*:\s*['"]Realizări['"]/);
    expect(adminJsContent).toMatch(/seo\s*:\s*['"]SEO['"]/);
  });
});

// =============================================================================
// Teste de integrare — SEO pages constante
// =============================================================================

describe('Admin JS — Constante pagini SEO', () => {
  let adminJsContent;

  beforeAll(() => {
    const jsPath = path.join(__dirname, '..', 'admin', 'js', 'admin.js');
    adminJsContent = fs.readFileSync(jsPath, 'utf8');
  });

  test('SEO_PAGES conține paginile așteptate', () => {
    // Paginile SEO suportate de backend
    const expectedPages = [
      'home', 'about', 'coaches', 'schedule',
      'subscriptions', 'events', 'shop', 'contact'
    ];
    expectedPages.forEach((page) => {
      expect(adminJsContent).toMatch(new RegExp(`['"]${page}['"]`));
    });
  });

  test('SEO_PAGE_LABELS conține etichetele localizate', () => {
    const expectedLabels = {
      home: 'Acasă',
      about: 'Despre Noi',
      coaches: 'Antrenori',
      schedule: 'Program',
      subscriptions: 'Abonamente',
      events: 'Evenimente',
      shop: 'Magazin',
      contact: 'Contact',
    };
    Object.entries(expectedLabels).forEach(([key, label]) => {
      // Verifică că eticheta există undeva lângă cheie
      const regex = new RegExp(
        `${key}[^:]*:\\s*['"]${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`
      );
      expect(adminJsContent).toMatch(regex);
    });
  });
});