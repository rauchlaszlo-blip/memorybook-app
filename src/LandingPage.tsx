import { useEffect, useState } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';
import { getAppLanguage, subscribeAppLanguage, type AppLanguage } from './i18n';

type Copy = {
  login: string;
  eyebrow: string;
  title: string;
  lead: string;
  primaryCta: string;
  howTitle: string;
  step1Title: string;
  step1Text: string;
  step2Title: string;
  step2Text: string;
  step3Title: string;
  step3Text: string;
  typesTitle: string;
  standardTitle: string;
  standardText: string;
  eventTitle: string;
  eventText: string;
  noAccount: string;
  bottomTitle: string;
  bottomText: string;
  bottomCta: string;
};

const COPY: Record<AppLanguage, Copy> = {
  hu: {
    login: 'Belépés',
    eyebrow: 'MemoryBook',
    title: 'Közös emlékek. Egyetlen könyvben.',
    lead: 'Hozz létre egy emlékkönyvet, hívd meg azokat, akik fontosak, ők pedig fotókkal és üzenetekkel töltik meg.',
    primaryCta: 'Nekem is kell',
    howTitle: 'Így működik',
    step1Title: '1. Készíts egy könyvet',
    step1Text: 'Válaszd ki, hogy személyes emlékkönyvet vagy rendezvény-vendégkönyvet szeretnél.',
    step2Title: '2. Hívd meg az embereket',
    step2Text: 'Küldj meghívót, vagy rendezvénynél oszd meg a QR-kódot.',
    step3Title: '3. Gyűjtsétek össze az emlékeket',
    step3Text: 'A meghívottak fotót és üzenetet adnak hozzá. Te látod és kezeled, mi kerül a könyvbe.',
    typesTitle: 'Kétféleképpen használhatod',
    standardTitle: 'Normál emlékkönyv',
    standardText: 'Minden meghívott saját oldalt kap. Megírja, megszerkeszti és elküldi neked.',
    eventTitle: 'Rendezvény-vendégkönyv',
    eventText: 'Tedd ki a QR-kódot. A vendégek telefonról azonnal küldhetnek fotót és üzenetet.',
    noAccount: 'A meghívottaknak nem kell MemoryBook-fiókot létrehozniuk.',
    bottomTitle: 'Te elindítod. Ők megtöltik emlékekkel.',
    bottomText: 'Születésnapra, ballagásra, osztálytalálkozóra, esküvőre vagy bármilyen közös alkalomra.',
    bottomCta: 'Nekem is kell',
  },
  en: {
    login: 'Sign in',
    eyebrow: 'MemoryBook',
    title: 'Shared memories. One book.',
    lead: 'Create a memory book, invite the people who matter, and let them fill it with photos and messages.',
    primaryCta: 'I want one too',
    howTitle: 'How it works',
    step1Title: '1. Create a book',
    step1Text: 'Choose a personal memory book or an event guestbook.',
    step2Title: '2. Invite people',
    step2Text: 'Send invitations, or share a QR code for an event.',
    step3Title: '3. Collect the memories',
    step3Text: 'Guests add photos and messages. You can see and manage what goes into the book.',
    typesTitle: 'Two ways to use MemoryBook',
    standardTitle: 'Standard memory book',
    standardText: 'Each invited person gets their own page to write, design and submit to you.',
    eventTitle: 'Event guestbook',
    eventText: 'Display the QR code. Guests can instantly send photos and messages from their phones.',
    noAccount: 'Invited contributors do not need to create a MemoryBook account.',
    bottomTitle: 'You start it. They fill it with memories.',
    bottomText: 'For birthdays, graduations, reunions, weddings or any shared occasion.',
    bottomCta: 'I want one too',
  },
  de: {
    login: 'Anmelden',
    eyebrow: 'MemoryBook',
    title: 'Gemeinsame Erinnerungen. In einem Buch.',
    lead: 'Erstelle ein Erinnerungsbuch, lade wichtige Menschen ein und lass sie es mit Fotos und Nachrichten füllen.',
    primaryCta: 'Das will ich auch',
    howTitle: 'So funktioniert es',
    step1Title: '1. Erstelle ein Buch',
    step1Text: 'Wähle zwischen einem persönlichen Erinnerungsbuch und einem Veranstaltungs-Gästebuch.',
    step2Title: '2. Lade Menschen ein',
    step2Text: 'Sende Einladungen oder teile bei einer Veranstaltung den QR-Code.',
    step3Title: '3. Sammelt eure Erinnerungen',
    step3Text: 'Die Eingeladenen fügen Fotos und Nachrichten hinzu. Du siehst und verwaltest, was ins Buch kommt.',
    typesTitle: 'Zwei Arten, MemoryBook zu nutzen',
    standardTitle: 'Normales Erinnerungsbuch',
    standardText: 'Jede eingeladene Person erhält eine eigene Seite zum Schreiben, Gestalten und Einsenden.',
    eventTitle: 'Veranstaltungs-Gästebuch',
    eventText: 'Zeige den QR-Code. Gäste können direkt vom Handy Fotos und Nachrichten senden.',
    noAccount: 'Eingeladene Mitwirkende müssen kein MemoryBook-Konto erstellen.',
    bottomTitle: 'Du startest. Sie füllen es mit Erinnerungen.',
    bottomText: 'Für Geburtstage, Abschlüsse, Klassentreffen, Hochzeiten oder jeden gemeinsamen Anlass.',
    bottomCta: 'Das will ich auch',
  },
};

export function LandingPage() {
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );

  useEffect(() => subscribeAppLanguage(setLanguage), []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 640px)');
    const syncMobile = () => setIsMobile(mediaQuery.matches);

    syncMobile();
    mediaQuery.addEventListener('change', syncMobile);
    return () => mediaQuery.removeEventListener('change', syncMobile);
  }, []);

  const copy = COPY[language];

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <a href="/" style={styles.brand}>MemoryBook</a>
        <div style={styles.headerActions}>
          <LanguageSwitcher />
          <a href="/login" style={styles.loginLink}>{copy.login}</a>
        </div>
      </header>

      <a
        href="/purchase"
        style={isMobile ? { ...styles.floatingCta, ...styles.floatingCtaMobile } : styles.floatingCta}
        aria-label={copy.primaryCta}
      >
        {copy.primaryCta}
      </a>

      <section style={styles.hero}>
        <div style={styles.eyebrow}>{copy.eyebrow}</div>
        <h1 style={styles.heroTitle}>{copy.title}</h1>
        <p style={styles.heroLead}>{copy.lead}</p>
      </section>

      <section id="how" style={styles.section}>
        <h2 style={styles.sectionTitle}>{copy.howTitle}</h2>
        <div style={styles.stepsGrid}>
          <article style={styles.stepCard}>
            <h3 style={styles.cardTitle}>{copy.step1Title}</h3>
            <p style={styles.cardText}>{copy.step1Text}</p>
          </article>
          <article style={styles.stepCard}>
            <h3 style={styles.cardTitle}>{copy.step2Title}</h3>
            <p style={styles.cardText}>{copy.step2Text}</p>
          </article>
          <article style={styles.stepCard}>
            <h3 style={styles.cardTitle}>{copy.step3Title}</h3>
            <p style={styles.cardText}>{copy.step3Text}</p>
          </article>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>{copy.typesTitle}</h2>
        <div style={styles.typesGrid}>
          <article style={styles.typeCard}>
            <div style={styles.typeTag}>Standard</div>
            <h3 style={styles.typeTitle}>{copy.standardTitle}</h3>
            <p style={styles.cardText}>{copy.standardText}</p>
          </article>
          <article style={styles.typeCard}>
            <div style={styles.typeTag}>Event</div>
            <h3 style={styles.typeTitle}>{copy.eventTitle}</h3>
            <p style={styles.cardText}>{copy.eventText}</p>
          </article>
        </div>
        <p style={styles.noAccount}>{copy.noAccount}</p>
      </section>

      <section style={styles.bottomCta}>
        <h2 style={styles.bottomTitle}>{copy.bottomTitle}</h2>
        <p style={styles.bottomText}>{copy.bottomText}</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    color: '#0f172a',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
    padding: '0 18px 48px',
  },
  header: {
    width: '100%',
    maxWidth: 1080,
    margin: '0 auto',
    minHeight: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    color: '#0f172a',
    textDecoration: 'none',
    fontSize: 20,
    fontWeight: 900,
    letterSpacing: -0.4,
  },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10 },
  loginLink: {
    minHeight: 42,
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 13px',
    border: '1px solid #cbd5e1',
    borderRadius: 9,
    color: '#334155',
    textDecoration: 'none',
    fontWeight: 700,
    background: '#ffffff',
  },
  hero: {
    width: '100%',
    maxWidth: 820,
    margin: '52px auto 74px',
    textAlign: 'center',
  },
  eyebrow: {
    display: 'inline-block',
    marginBottom: 14,
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#64748b',
  },
  heroTitle: {
    margin: '0 auto',
    maxWidth: 780,
    fontSize: 'clamp(38px, 8vw, 64px)',
    lineHeight: 1.02,
    letterSpacing: -2.1,
  },
  heroLead: {
    maxWidth: 680,
    margin: '22px auto 0',
    fontSize: 'clamp(18px, 4vw, 22px)',
    lineHeight: 1.55,
    color: '#475569',
  },
  heroActions: {
    marginTop: 30,
    display: 'flex',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  primaryButton: {
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 18px',
    borderRadius: 10,
    background: '#0f172a',
    color: '#ffffff',
    textDecoration: 'none',
    fontWeight: 800,
  },
  secondaryButton: {
    minHeight: 48,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 18px',
    borderRadius: 10,
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    textDecoration: 'none',
    fontWeight: 800,
  },
  floatingCta: {
    position: 'fixed',
    top: '32vh',
    right: 'clamp(12px, 3vw, 36px)',
    zIndex: 20,
    minHeight: 48,
    maxWidth: 'min(260px, calc(100vw - 24px))',
    padding: '12px 17px',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    background: '#0f172a',
    color: '#ffffff',
    textDecoration: 'none',
    textAlign: 'center',
    fontWeight: 900,
    lineHeight: 1.25,
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.24)',
  },
  floatingCtaMobile: {
    top: 'auto',
    right: 12,
    bottom: 'calc(16px + env(safe-area-inset-bottom))',
    minHeight: 40,
    maxWidth: 170,
    padding: '9px 14px',
    fontSize: 14,
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.22)',
  },
  section: { width: '100%', maxWidth: 980, margin: '0 auto 70px' },
  sectionTitle: {
    margin: '0 0 22px',
    textAlign: 'center',
    fontSize: 'clamp(28px, 6vw, 38px)',
    letterSpacing: -1,
  },
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    gap: 14,
  },
  stepCard: {
    padding: 24,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
  },
  cardTitle: { margin: '0 0 9px', fontSize: 19, lineHeight: 1.3 },
  cardText: { margin: 0, color: '#64748b', lineHeight: 1.6, fontSize: 16 },
  typesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: 16,
  },
  typeCard: {
    padding: 26,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
  },
  typeTag: {
    display: 'inline-block',
    padding: '5px 8px',
    marginBottom: 12,
    borderRadius: 999,
    background: '#e2e8f0',
    color: '#475569',
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  typeTitle: { margin: '0 0 10px', fontSize: 24 },
  noAccount: {
    maxWidth: 700,
    margin: '18px auto 0',
    textAlign: 'center',
    color: '#475569',
    fontWeight: 700,
    lineHeight: 1.5,
  },
  bottomCta: {
    width: '100%',
    maxWidth: 900,
    margin: '0 auto',
    padding: '42px 24px',
    boxSizing: 'border-box',
    textAlign: 'center',
    borderRadius: 22,
    background: '#ffffff',
    border: '1px solid #e2e8f0',
  },
  bottomTitle: { margin: 0, fontSize: 'clamp(28px, 6vw, 40px)', letterSpacing: -1 },
  bottomText: { maxWidth: 660, margin: '14px auto 24px', color: '#64748b', lineHeight: 1.6, fontSize: 17 },
};
