from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Marker not found: {label}: {old[:140]!r}')
    return text.replace(old, new, 1)

# AuthPage
p = 'src/AuthPage.tsx'
text = read(p)
text = rep(text, "import { authClient } from './authClient';", "import { authClient } from './authClient';\nimport { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicText, usePublicUiLanguage } from './publicUiI18n';", 'auth imports')
text = rep(text, "export function AuthPage() {\n  const params", "export function AuthPage() {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);\n  const params", 'auth hook')
for old in [
    'A Google-belépés nem sikerült. Próbáld újra.',
    'A Google-belépés technikailag elő van készítve, de az OAuth kliens még nincs aktiválva.',
    'A Google-belépés nem sikerült.',
    'Add meg a neved.',
    'Add meg az e-mail-címed.',
    'A tesztjelszó legalább 8 karakter legyen.',
    'A tesztregisztráció nem sikerült.',
    'A tesztbelépés nem sikerült.',
    'Hiba történt.',
]:
    text = text.replace(f"'{old}'", f"t('{old}')")
text = rep(text, "      <section style={styles.card}>\n        <div style={styles.brand}>MemoryBook</div>", "      <section style={styles.card}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <div style={styles.brand}>MemoryBook</div>", 'auth switcher')
text = text.replace('<h1 style={styles.title}>Belépés vagy regisztráció</h1>', "<h1 style={styles.title}>{t('Belépés vagy regisztráció')}</h1>")
text = rep(text, "        <p style={styles.subtitle}>\n          Google-fiókkal egy lépésben beléphetsz. Ha még nincs MemoryBook-fiókod,\n          az első Google-belépéskor automatikusan létrejön.\n        </p>", "        <p style={styles.subtitle}>{t('Google-fiókkal egy lépésben beléphetsz. Ha még nincs MemoryBook-fiókod, az első Google-belépéskor automatikusan létrejön.')}</p>", 'auth subtitle')
text = text.replace('aria-label="Folytatás Google-fiókkal"', "aria-label={t('Folytatás Google-fiókkal')}")
text = text.replace("? 'Kapcsolódás...'", "? t('Kapcsolódás...')")
text = text.replace("? 'Google-belépés beállítás alatt'", "? t('Google-belépés beállítás alatt')")
text = text.replace("? 'Google-belépés ellenőrzése...'", "? t('Google-belépés ellenőrzése...')")
text = text.replace(": 'Folytatás Google-fiókkal'", ": t('Folytatás Google-fiókkal')")
text = rep(text, "            A Google OAuth kliens létrehozása után ez a gomb automatikusan aktiválódik.", "            {t('A Google OAuth kliens létrehozása után ez a gomb automatikusan aktiválódik.')}", 'auth setup notice')
text = text.replace('>Teszt / fejlesztői belépés e-maillel</summary>', ">{t('Teszt / fejlesztői belépés e-maillel')}</summary>")
text = rep(text, "              Ez a lehetőség az automatizált tesztek és a fejlesztés miatt marad meg.\n              A végleges felhasználói belépés elsődleges módja a Google.", "              {t('Ez a lehetőség az automatizált tesztek és a fejlesztés miatt marad meg. A végleges felhasználói belépés elsődleges módja a Google.')}", 'auth test text')
text = text.replace('>\n                Belépés\n              </button>', ">\n                {t('Belépés')}\n              </button>")
text = text.replace('>\n                Tesztregisztráció\n              </button>', ">\n                {t('Tesztregisztráció')}\n              </button>")
text = text.replace('                  Név\n                  <input', "                  {t('Név')}\n                  <input")
text = text.replace('placeholder="Neved"', "placeholder={t('Neved')}")
text = text.replace('                E-mail\n                <input', "                {t('E-mail')}\n                <input")
text = text.replace('                Tesztjelszó\n                <input', "                {t('Tesztjelszó')}\n                <input")
text = text.replace('placeholder="Legalább 8 karakter"', "placeholder={t('Legalább 8 karakter')}")
text = text.replace("? 'Folyamatban...'", "? t('Folyamatban...')")
text = text.replace("? 'Teszt belépés'", "? t('Teszt belépés')")
text = text.replace(": 'Tesztfiók létrehozása'", ": t('Tesztfiók létrehozása')")
text = rep(text, "  card: {\n    width: '100%',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 10 },\n  card: {\n    width: '100%',", 'auth style')
write(p, text)

# PurchasePage
p = 'src/PurchasePage.tsx'
text = read(p)
text = rep(text, "import type { FormEvent } from 'react';", "import type { FormEvent } from 'react';\nimport { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';", 'purchase imports')
text = rep(text, "export function PurchasePage() {\n  const query", "export function PurchasePage() {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);\n  const query", 'purchase hook')
text = text.replace("'Töltsd ki a számlázáshoz szükséges adatokat.'", "t('Töltsd ki a számlázáshoz szükséges adatokat.')")
text = text.replace("'A vásárlás előkészítése nem sikerült.'", "t('A vásárlás előkészítése nem sikerült.')")
text = rep(text, "      <section style={styles.card}>\n        <a href={user ? '/my-books' : '/login'} style={styles.back}>← Vissza</a>", "      <section style={styles.card}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <a href={user ? '/my-books' : '/login'} style={styles.back}>{t('← Vissza')}</a>", 'purchase switcher/back')
text = text.replace('<h1 style={styles.title}>Emlékkönyv vásárlása</h1>', "<h1 style={styles.title}>{t('Emlékkönyv vásárlása')}</h1>")
text = text.replace('<p style={styles.lead}>A fizetési alapfolyamat elkészült. A PayPal és SimplePay tényleges fizetési indítása a következő integrációs lépés.</p>', "<p style={styles.lead}>{t('A fizetési alapfolyamat elkészült. A PayPal és SimplePay tényleges fizetési indítása a következő integrációs lépés.')}</p>")
text = text.replace('>Magamnak</button>', ">{t('Magamnak')}</button>")
text = text.replace('>Ajándékba</button>', ">{t('Ajándékba')}</button>")
text = text.replace('            Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.', "            {t('Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.')}")
text = text.replace('> Belépés / regisztráció</a>', "> {t('Belépés / regisztráció')}</a>")
for raw in ['Könyv típusa','Fizetési mód','Név','E-mail','Számlázási név','Számlázási e-mail','Ország','Irányítószám','Település','Cím','Adószám (ha szükséges)']:
    text = text.replace(f'>{raw}\n', f">{{t('{raw}')}}\n")
text = text.replace('>Normál emlékkönyv – 30 oldal</option>', ">{t('Normál emlékkönyv – 30 oldal')}</option>")
text = text.replace('>Rendezvény-vendégkönyv</option>', ">{t('Rendezvény-vendégkönyv')}</option>")
text = text.replace('<div style={styles.sectionTitle}>Vásárló azonosítása</div>', "<div style={styles.sectionTitle}>{t('Vásárló azonosítása')}</div>")
text = text.replace('<div style={styles.sectionTitle}>Számlázási adatok</div>', "<div style={styles.sectionTitle}>{t('Számlázási adatok')}</div>")
text = text.replace('<div style={styles.giftInfo}>Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.</div>', "<div style={styles.giftInfo}>{t('Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.')}</div>")
text = text.replace("{loading ? 'Mentés...' : 'Vásárlási adatok mentése'}", "{loading ? t('Mentés...') : t('Vásárlási adatok mentése')}")
text = text.replace('<strong>Vásárlási alap rögzítve.</strong><br />', "<strong>{t('Vásárlási alap rögzítve.')}</strong><br />")
text = text.replace('            Azonosító: {purchaseId}<br />', "            {f('Azonosító: {id}', { id: purchaseId })}<br />")
text = text.replace('            Még nem történt fizetés, ezért könyvjogosultság sem keletkezett. A következő lépésben ehhez kötjük a PayPal és SimplePay fizetést.', "            {t('Még nem történt fizetés, ezért könyvjogosultság sem keletkezett. A következő lépésben ehhez kötjük a PayPal és SimplePay fizetést.')}")
text = rep(text, "  card: { width: '100%',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },\n  card: { width: '100%',", 'purchase style')
write(p, text)

# GiftRedeemPage
p = 'src/GiftRedeemPage.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState } from 'react';", "import { useEffect, useState } from 'react';\nimport { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';", 'gift imports')
text = rep(text, "export function GiftRedeemPage({ token }: { token: string }) {\n  const [info", "export function GiftRedeemPage({ token }: { token: string }) {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);\n  const [info", 'gift hook')
text = text.replace("setError('Ez az ajándék-jogosultság nem található vagy még nincs kifizetve.')", "setError(t('Ez az ajándék-jogosultság nem található vagy még nincs kifizetve.'))")
text = text.replace("? 'Ezt az ajándékot már másik fiók beváltotta.' : 'Az ajándék beváltása nem sikerült.'", "? t('Ezt az ajándékot már másik fiók beváltotta.') : t('Az ajándék beváltása nem sikerült.')")
text = rep(text, "      <section style={styles.card}>\n        <div style={styles.brand}>MemoryBook</div>", "      <section style={styles.card}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <div style={styles.brand}>MemoryBook</div>", 'gift switcher')
text = text.replace('<h1 style={styles.title}>Ajándék emlékkönyv</h1>', "<h1 style={styles.title}>{t('Ajándék emlékkönyv')}</h1>")
text = text.replace('{loading && <div>Betöltés...</div>}', "{loading && <div>{t('Betöltés...')}</div>}")
text = text.replace("{info.bookType === 'event' ? 'Rendezvény-vendégkönyv' : `Normál emlékkönyv – ${info.includedPages} oldal`}", "{info.bookType === 'event' ? t('Rendezvény-vendégkönyv') : f('Normál emlékkönyv – {count} oldal', { count: info.includedPages })}")
text = text.replace("{working ? 'Beváltás...' : 'Ajándék beváltása'}", "{working ? t('Beváltás...') : t('Ajándék beváltása')}")
text = text.replace('>Belépés / regisztráció a beváltáshoz</a>', ">{t('Belépés / regisztráció a beváltáshoz')}</a>")
text = text.replace("{info.claimStatus === 'redeemed' ? 'Ezzel a jogosultsággal a könyvet már létrehozták.' : 'Ezt az ajándékot már egy fiókhoz hozzárendelték.'}", "{info.claimStatus === 'redeemed' ? t('Ezzel a jogosultsággal a könyvet már létrehozták.') : t('Ezt az ajándékot már egy fiókhoz hozzárendelték.')}")
text = rep(text, "  card: { width: '100%',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },\n  card: { width: '100%',", 'gift style')
write(p, text)

# InviteCtaPage
p = 'src/InviteCtaPage.tsx'
text = read(p)
text = rep(text, "export function InviteCtaPage() {", "import { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicText, usePublicUiLanguage } from './publicUiI18n';\n\nexport function InviteCtaPage() {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);", 'cta imports/hook')
text = rep(text, "      <section style={styles.card}>\n        <div style={styles.brand}>MemoryBook</div>", "      <section style={styles.card}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <div style={styles.brand}>MemoryBook</div>", 'cta switcher')
text = text.replace('<h1 style={styles.title}>Nekem is kell emlékkönyv</h1>', "<h1 style={styles.title}>{t('Nekem is kell emlékkönyv')}</h1>")
text = rep(text, "          Készíts saját online emlékkönyvet, hívd meg azokat, akik fontosak neked,\n          és gyűjtsd össze az emlékeiteket egy közös könyvbe.", "          {t('Készíts saját online emlékkönyvet, hívd meg azokat, akik fontosak neked, és gyűjtsd össze az emlékeiteket egy közös könyvbe.')}", 'cta text')
text = text.replace('>Saját MemoryBook létrehozása</a>', ">{t('Saját MemoryBook létrehozása')}</a>")
text = text.replace('<p style={styles.note}>A létrehozás regisztrációval indul.</p>', "<p style={styles.note}>{t('A létrehozás regisztrációval indul.')}</p>")
text = rep(text, "  card: {\n    width: '100%',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },\n  card: {\n    width: '100%',", 'cta style')
write(p, text)

# PublicPage
p = 'src/PublicPage.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState } from 'react';", "import { useEffect, useState } from 'react';\nimport { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';", 'public imports')
text = rep(text, "export function PublicPage({ token }: PublicPageProps) {\n  const [page", "export function PublicPage({ token }: PublicPageProps) {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);\n  const [page", 'public hook')
text = text.replace("setError('Ez az oldal nem nyilvános vagy már nem érhető el.')", "setError(t('Ez az oldal nem nyilvános vagy már nem érhető el.'))")
text = text.replace('return <div style={styles.message}>Oldal betöltése...</div>;', "return <div style={styles.message}>{t('Oldal betöltése...')}</div>;")
text = text.replace("{error || 'Az oldal nem található.'}", "{error || t('Az oldal nem található.')}")
text = rep(text, "      <section style={styles.header}>\n        <div style={styles.brand}>MemoryBook</div>", "      <section style={styles.header}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <div style={styles.brand}>MemoryBook</div>", 'public switcher')
text = text.replace('<div style={styles.subtitle}>Nyilvánosan megosztott oldal · {page.pageNumber}. oldal</div>', "<div style={styles.subtitle}>{f('Nyilvánosan megosztott oldal · {page}. oldal', { page: page.pageNumber })}</div>")
text = text.replace('alt={`MemoryBook ${page.pageNumber}. oldal`}', "alt={f('MemoryBook {page}. oldal', { page: page.pageNumber })}")
text = text.replace('<div style={styles.message}>Ehhez az oldalhoz nincs előnézeti kép.</div>', "<div style={styles.message}>{t('Ehhez az oldalhoz nincs előnézeti kép.')}</div>")
text = rep(text, "  brand: {\n    color: '#64748b',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },\n  brand: {\n    color: '#64748b',", 'public style')
write(p, text)

# JoinPage
p = 'src/JoinPage.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';", "import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';\nimport { LanguageSwitcher } from './LanguageSwitcher';\nimport { publicFormat, publicText, usePublicUiLanguage } from './publicUiI18n';", 'join imports')
text = rep(text, "export function JoinPage({ token }: JoinPageProps) {\n  const [invite", "export function JoinPage({ token }: JoinPageProps) {\n  const language = usePublicUiLanguage();\n  const t = (key: string) => publicText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => publicFormat(language, key, values);\n  const [invite", 'join hook')
for old in [
    'Ez a vendégkönyv-meghívó nem érhető el.',
    'JPG, PNG vagy WEBP képet válassz.',
    'A kép legfeljebb 3 MB lehet.',
    'A képet nem sikerült beolvasni.',
    'Erről az eszközről már elküldted az engedélyezett számú bejegyzést.',
    'Az üzenetet nem sikerült elküldeni. Próbáld újra.',
]:
    text = text.replace(f"setError('{old}')", f"setError(t('{old}'))")
text = text.replace('if (loading) return <div style={styles.message}>Vendégkönyv betöltése...</div>;', "if (loading) return <div style={styles.message}>{t('Vendégkönyv betöltése...')}</div>;")
text = text.replace('if (!invite) return <div style={styles.message}>A vendégkönyv nem található.</div>;', "if (!invite) return <div style={styles.message}>{t('A vendégkönyv nem található.')}</div>;")
text = rep(text, "        <section style={styles.card}>\n          <div style={styles.eyebrow}>MemoryBook vendégkönyv</div>", "        <section style={styles.card}>\n          <div style={styles.languageRow}><LanguageSwitcher /></div>\n          <div style={styles.eyebrow}>{t('MemoryBook vendégkönyv')}</div>", 'join submitted switcher')
text = text.replace('<h2 style={styles.thankYou}>Köszönjük, {name.trim()}!</h2>', "<h2 style={styles.thankYou}>{f('Köszönjük, {name}!', { name: name.trim() })}</h2>")
text = text.replace('<p style={styles.intro}>Az üzeneted bekerült a rendezvény vendégkönyvébe.</p>', "<p style={styles.intro}>{t('Az üzeneted bekerült a rendezvény vendégkönyvébe.')}</p>")
text = text.replace('<div style={styles.remaining}>Erről az eszközről még {remaining} bejegyzést küldhetsz.</div>', "<div style={styles.remaining}>{f('Erről az eszközről még {count} bejegyzést küldhetsz.', { count: remaining })}</div>")
text = text.replace('>Újabb bejegyzés</button>', ">{t('Újabb bejegyzés')}</button>")
text = text.replace('<div style={styles.remaining}>Erről az eszközről elérted a rendezvényhez engedélyezett bejegyzésszámot.</div>', "<div style={styles.remaining}>{t('Erről az eszközről elérted a rendezvényhez engedélyezett bejegyzésszámot.')}</div>")
text = rep(text, "      <section style={styles.card}>\n        <div style={styles.eyebrow}>MemoryBook vendégkönyv</div>", "      <section style={styles.card}>\n        <div style={styles.languageRow}><LanguageSwitcher /></div>\n        <div style={styles.eyebrow}>{t('MemoryBook vendégkönyv')}</div>", 'join form switcher')
text = text.replace('<p style={styles.intro}>Írj egy üzenetet vagy emléket a rendezvény vendégkönyvébe.</p>', "<p style={styles.intro}>{t('Írj egy üzenetet vagy emléket a rendezvény vendégkönyvébe.')}</p>")
text = rep(text, "          Erről az eszközről legfeljebb <strong>{deviceLimit}</strong> bejegyzés küldhető ebbe a vendégkönyvbe.", "          {f('Erről az eszközről legfeljebb {count} bejegyzés küldhető ebbe a vendégkönyvbe.', { count: deviceLimit })}", 'join limit')
text = text.replace('            Neved\n            <input', "            {t('Neved')}\n            <input")
text = text.replace('            Üzeneted\n            <textarea', "            {t('Üzeneted')}\n            <textarea")
text = text.replace('            Fotó (opcionális)\n            <input', "            {t('Fotó (opcionális)')}\n            <input")
text = text.replace('{photoName && <div style={styles.photoInfo}>Kiválasztott kép: {photoName}</div>}', "{photoName && <div style={styles.photoInfo}>{f('Kiválasztott kép: {name}', { name: photoName })}</div>}")
text = text.replace("{submitting ? 'Küldés...' : 'Bejegyzés elküldése'}", "{submitting ? t('Küldés...') : t('Bejegyzés elküldése')}")
text = rep(text, "  card: { width: '100%',", "  languageRow: { display: 'flex', justifyContent: 'flex-end', marginBottom: 8 },\n  card: { width: '100%',", 'join style')
write(p, text)

print('PUBLIC_UI_I18N_PATCH_APPLIED')
