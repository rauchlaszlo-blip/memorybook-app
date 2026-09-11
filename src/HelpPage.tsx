import type { ReactNode } from 'react';

type HelpKind = 'quick' | 'detailed' | 'faq';

const TITLES: Record<HelpKind, string> = {
  quick: 'Gyors használati útmutató',
  detailed: 'Részletes használati útmutató',
  faq: 'Gyakran ismételt kérdések',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section style={s.section}><h2 style={s.h2}>{title}</h2>{children}</section>;
}

const List = ({ children }: { children: ReactNode }) => <ul style={s.list}>{children}</ul>;

function QuickGuide() {
  return <>
    <p style={s.lead}>A MemoryBookban digitális emlékkönyvet készíthetsz, amelybe mások meghívóval, dedikáláskor vagy rendezvényen QR-kóddal írhatnak.</p>
    <Section title="1. Belépés és könyvvásárlás"><List><li>Jelentkezz be, majd válaszd az <strong>Új könyv vásárlása</strong> gombot.</li><li>Válaszd ki a csomagot és a könyvtípust.</li><li>A Saját könyveim oldalon nevezd el, majd hozd létre a könyvet.</li></List></Section>
    <Section title="2. Könyvtípusok"><div style={s.grid}><Card title="Normál emlékkönyv">Személyes meghívóval gyűjthetsz oldalakat családtól, barátoktól vagy munkatársaktól.</Card><Card title="Dedikálás">Egymás után, ugyanazon a készüléken lehet fényképre írni vagy aláírni.</Card><Card title="QR-kódos vendégkönyv">A vendégek a rendezvényen kihelyezett QR-kód beolvasásával írhatnak.</Card></div></Section>
    <Section title="3. A könyv használata"><List><li>A fedőlapra koppintva szerkesztheted a borítót.</li><li>A <strong>Saját emlék</strong> gombbal saját oldalt készíthetsz.</li><li>Mobilon húzással, számítógépen a könyv melletti nyilakkal lapozhatsz.</li><li>A kijelölt elemek mozgathatók, méretezhetők és forgathatók.</li></List></Section>
    <Section title="4. Beküldések gyűjtése"><List><li><strong>Normál könyv:</strong> a Meghívó gombbal küldd el a személyes hivatkozást.</li><li><strong>Dedikálás:</strong> készíts vagy válassz képet, írj rá, majd mentsd el.</li><li><strong>QR-kódos könyv:</strong> állítsd be az időszakot, a korlátot és a kért adatokat, majd nyomtasd ki a QR-kódot.</li></List></Section>
    <Section title="5. Szerkesztés"><p style={s.p}>A Szöveg, Kép, Háttér, Rajz és Radír eszközökkel állíthatod össze az oldalt. A Vissza és Előre gombokkal javíthatod az utolsó lépéseket.</p></Section>
  </>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <article style={s.card}><h3 style={s.h3}>{title}</h3><p style={s.cardText}>{children}</p></article>;
}

function DetailedGuide() {
  return <>
    <p style={s.lead}>Teljes kézikönyv könyvtulajdonosoknak, meghívottaknak és rendezvényvendégeknek.</p>
    <Section title="1. A MemoryBook működése"><p style={s.p}>Minden megvásárolt jogosultságból egy könyv hozható létre. A tulajdonos kezeli a könyvet, meghívja a résztvevőket, saját emléket készíthet, szerkeszti a fedőlapot és áttekinti az elkészült oldalakat.</p><List><li><strong>Tulajdonos:</strong> létrehoz, szerkeszt, meghív és kezeli a beküldéseket.</li><li><strong>Meghívott:</strong> a kapott hivatkozással elkészíti és beküldi a saját oldalát.</li><li><strong>Rendezvényvendég:</strong> a QR-kóddal, a nyitvatartási időn belül készít bejegyzést.</li></List></Section>
    <Section title="2. Belépés, vásárlás és létrehozás"><List><li>Jelentkezz be vagy regisztrálj.</li><li>Az Új könyv vásárlása oldalon válaszd ki, hogy magadnak, ajándékba vagy cégként vásárolsz.</li><li>Válaszd ki a könyvtípust, és add meg a szükséges számlázási adatokat.</li><li>Sikeres fizetés után a Saját könyveim oldalon nevezd el és hozd létre a könyvet.</li></List><Note>Ajándékvásárlásnál a megajándékozott a számára készített beváltó hivatkozással veheti át a könyvet.</Note></Section>
    <Section title="3. Könyvnézet és lapozás"><p style={s.p}>A fedőlapot a beküldött emlékek, a szerkesztés alatt álló vagy meghívott oldalak, végül a szabad oldalak követik. Mobilon oldalirányú húzással, számítógépen a lap melletti nyilakkal lapozhatsz.</p></Section>
    <Section title="4. Fedőlap és oldalszerkesztő"><List><li><strong>Szöveg:</strong> új szövegdoboz; a keret és a betűméret külön állítható.</li><li><strong>Kép:</strong> fénykép hozzáadása, mozgatása, méretezése és forgatása.</li><li><strong>Háttér:</strong> saját kép, kamera vagy a beépített gyűjtemény.</li><li><strong>Rajz:</strong> ceruza, filctoll vagy ecset, választható színnel és vonalvastagsággal.</li><li><strong>Radír:</strong> a szabadkézi rajz javítása, állítható mérettel.</li><li><strong>Vissza / Előre:</strong> szerkesztési lépések visszavonása és újbóli alkalmazása.</li></List><Note>Egyszerre egy elem jelölhető ki. A kijelölés megszüntetéséhez koppints az elem mellé.</Note></Section>
    <Section title="5. Meghívás normál emlékkönyvbe"><List><li>Nyisd meg a könyvet, és válaszd a Meghívó gombot.</li><li>Írd be a megszólítást és a személyes üzenetet.</li><li>Küldd el a hivatkozást megosztással vagy e-mailben.</li><li>A meghívott elkészíti, majd beküldi az emlékoldalt.</li></List></Section>
    <Section title="6. Dedikálás készítése"><List><li>Válaszd az Új dedikálás gombot.</li><li>Készíts fényképet, vagy válassz képet a galériából.</li><li>Írj vagy rajzolj a képre jól látható színnel.</li><li>Ellenőrizd az elhelyezést, majd mentsd el.</li></List></Section>
    <Section title="7. QR-kódos vendégkönyv"><List><li>Állítsd be a kezdés és befejezés dátumát és időpontját.</li><li>Add meg az egy telefonról engedélyezett bejegyzések számát.</li><li>Válaszd ki a bekért adatokat.</li><li>Mentsd a beállításokat, majd nyisd meg és nyomtasd ki a QR-kódot.</li><li>Olvasd be próbaként egy másik telefonnal.</li></List><Note>A telefononkénti korlát visszaéléscsökkentő megoldás, nem személyazonosításra alkalmas védelem.</Note></Section>
    <Section title="8. Képek és jó minőségű eredmény"><List><li>Használj éles, jól megvilágított képet.</li><li>Fontos arcot, szöveget vagy aláírást ne helyezz közvetlenül a lap szélére.</li><li>Mentés előtt ellenőrizd, hogy a szöveg jól olvasható-e.</li><li>Tartsd be a megjelenő fájlméret- és formátumkorlátot.</li></List></Section>
    <Section title="9. Biztonság és adatvédelem"><List><li>Tulajdonosi belépési adatot és személyes meghívót ne ossz meg nyilvánosan.</li><li>A QR-kódot csak a rendezvény résztvevőinek tedd elérhetővé.</li><li>Csak valóban szükséges vendégadatot kérj be.</li><li>Közös készüléken használat után jelentkezz ki.</li></List></Section>
    <Section title="10. Rendezvény előtti ellenőrzőlista"><ul style={s.check}><li>□ A könyv neve és fedőlapja megfelelő.</li><li>□ A kezdési és befejezési időpont helyes.</li><li>□ A telefononkénti korlát be van állítva.</li><li>□ Csak a szükséges adatok vannak bekérve.</li><li>□ A QR-kódot másik telefonnal kipróbáltad.</li><li>□ A helyszínen van mobilinternet vagy Wi-Fi.</li></ul></Section>
  </>;
}

function Note({ children }: { children: ReactNode }) { return <p style={s.note}>{children}</p>; }

const FAQ = [
  ['Mi a MemoryBook?', 'Online emlékkönyv, amelyben többen közösen gyűjthetnek fényképeket, üzeneteket, rajzokat és dedikálásokat.'],
  ['Kell fiók a meghívottaknak?', 'Nem. A meghívottak és a QR-kódos vendégek a kapott hivatkozáson keresztül használhatják a számukra megnyitott oldalt.'],
  ['Milyen könyvtípusok vannak?', 'Normál emlékkönyv, Dedikálás és QR-kódos vendégkönyv.'],
  ['Hogyan hozhatok létre könyvet?', 'Belépés után vásárolj könyvjogosultságot, majd a Saját könyveim oldalon nevezd el és hozd létre.'],
  ['Hogyan hívhatok meg valakit?', 'Nyisd meg a normál könyvet, válaszd a Meghívó gombot, írd meg az üzenetet, majd küldd el a hivatkozást.'],
  ['Melyik oldalt kapja a meghívott?', 'A rendszer automatikusan a következő szabad oldalt rendeli a meghívóhoz.'],
  ['A tulajdonos is írhat a saját könyvébe?', 'Igen. A Saját emlék gombbal a tulajdonos is készíthet emlékoldalt.'],
  ['Hogyan lapozhatok?', 'Mobilon húzd oldalra a könyvet, számítógépen használd a könyv melletti nyilakat.'],
  ['Hogyan szerkeszthetem a fedőlapot?', 'Nyisd meg a könyvet, koppints a fedőlapra, módosítsd, majd mentsd el.'],
  ['Mit lehet elhelyezni egy oldalon?', 'Szöveget, saját képet vagy fényképet, hátteret és szabadkézi rajzot.'],
  ['Hogyan működik a Dedikálás könyv?', 'Készíthetsz vagy választhatsz egy képet, amelyre közvetlenül írni és rajzolni lehet.'],
  ['Hogyan működik a QR-kódos vendégkönyv?', 'A tulajdonos beállítja az időszakot és a szabályokat, a vendég pedig a QR-kód beolvasásával nyitja meg a bejegyzést.'],
  ['Miért nem nyílik meg a QR-kód?', 'Lehet, hogy a vendégkönyv még nem nyílt meg, már lezárult, vagy nincs internetkapcsolat.'],
  ['Mit jelent a telefononkénti korlát?', 'A tulajdonos meghatározhatja, hány bejegyzés küldhető ugyanarról a készülékről és böngészőből.'],
  ['Milyen adatokat kérhet a szervező?', 'Nevet, e-mail-címet, telefonszámot, fesztivál- vagy belépőjegy-azonosítót.'],
  ['Miért nem tölthető fel a kép?', 'Ellenőrizd a kép formátumát és méretét, valamint az internetkapcsolatot.'],
  ['Miért nem látom rögtön a mentést?', 'Várj néhány másodpercet, ne zárd be az oldalt mentés közben, majd frissítsd a könyvet.'],
  ['Mit tegyek, ha a meghívó nem nyílik meg?', 'Ellenőrizd az internetkapcsolatot és azt, hogy a teljes hivatkozást nyitottad-e meg.'],
  ['Vásárolhatok könyvet ajándékba?', 'Igen. Sikeres vásárlás után beváltó hivatkozás készül, amelyet a megajándékozottnak kell elküldeni.'],
  ['Milyen nyelveken használható a MemoryBook?', 'A kezelőfelület magyar, angol és német nyelven használható.'],
];

function Faq() { return <div style={s.faqList}>{FAQ.map(([q, a]) => <details key={q} style={s.faq}><summary style={s.summary}>{q}</summary><p style={s.answer}>{a}</p></details>)}</div>; }

export function HelpPage({ kind }: { kind: HelpKind }) {
  return <main style={s.page}><header style={s.header}><a href="/" style={s.brand}>MemoryBook</a><a href="/" style={s.back}>← Vissza a főoldalra</a></header><article style={s.content}><p style={s.eyebrow}>Segítség</p><h1 style={s.h1}>{TITLES[kind]}</h1><nav style={s.nav}><a href="/help/quick" style={kind === 'quick' ? s.active : s.navLink}>Gyors útmutató</a><a href="/help/detailed" style={kind === 'detailed' ? s.active : s.navLink}>Részletes útmutató</a><a href="/faq" style={kind === 'faq' ? s.active : s.navLink}>GYIK</a></nav>{kind === 'quick' ? <QuickGuide /> : kind === 'detailed' ? <DetailedGuide /> : <Faq />}</article></main>;
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'Arial, sans-serif', padding: '0 18px 48px', boxSizing: 'border-box' },
  header: { maxWidth: 920, minHeight: 72, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  brand: { color: '#0f172a', textDecoration: 'none', fontSize: 20, fontWeight: 900 }, back: { color: '#334155', textDecoration: 'none', fontWeight: 700 },
  content: { maxWidth: 820, margin: '24px auto 0', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 22, padding: 'clamp(22px, 5vw, 48px)', boxSizing: 'border-box' },
  eyebrow: { margin: '0 0 8px', color: '#64748b', fontSize: 13, fontWeight: 900, letterSpacing: 1.4, textTransform: 'uppercase' }, h1: { margin: 0, fontSize: 'clamp(32px, 7vw, 48px)', lineHeight: 1.08, letterSpacing: -1.5 },
  lead: { margin: '18px 0 30px', color: '#475569', fontSize: 18, lineHeight: 1.65 }, nav: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '24px 0 32px', paddingBottom: 22, borderBottom: '1px solid #e2e8f0' },
  navLink: { color: '#334155', background: '#f1f5f9', padding: '9px 12px', borderRadius: 9, textDecoration: 'none', fontWeight: 700 }, active: { color: '#fff', background: '#0f172a', padding: '9px 12px', borderRadius: 9, textDecoration: 'none', fontWeight: 800 },
  section: { margin: '0 0 30px' }, h2: { margin: '0 0 12px', fontSize: 24, lineHeight: 1.3 }, h3: { margin: '0 0 8px', color: '#0f172a' }, p: { margin: '0 0 12px', color: '#334155', lineHeight: 1.7 }, list: { margin: '8px 0 0', paddingLeft: 23, color: '#334155', lineHeight: 1.75 }, check: { margin: 0, padding: 0, listStyle: 'none', color: '#334155', lineHeight: 1.85 },
  note: { margin: '14px 0 0', padding: 14, borderRadius: 10, background: '#f1f5f9', color: '#334155', lineHeight: 1.6 }, grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 12 }, card: { border: '1px solid #e2e8f0', borderRadius: 14, padding: 17 }, cardText: { margin: 0, color: '#475569', lineHeight: 1.55 },
  faqList: { display: 'grid', gap: 10 }, faq: { border: '1px solid #e2e8f0', borderRadius: 12, padding: '0 16px' }, summary: { cursor: 'pointer', padding: '16px 0', fontWeight: 800, lineHeight: 1.4 }, answer: { margin: '0 0 16px', color: '#475569', lineHeight: 1.65 },
};
