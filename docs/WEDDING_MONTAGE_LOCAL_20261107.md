# Esküvői montázs – helyi, nem telepített fejlesztés

## 2026-11-08: egyszerűsített alapfolyamat

A felhasználó a montázsoldal/gomb elérését PASS-nak jelezte, majd egyszerűbb automatikus folyamatot kért. A montázscím alapból egyszerű könyv/PDF-oldalt mutat. Üres vagy hiányos könyvnél automatikusan csoportosít minden beküldést a stabil vendégazonosító alapján, és elkészíti a PDF-előnézetet. Teljes meglévő változatot nem ír felül. A kézi szerkesztő a `?szerkesztes=1` másodlagos linken marad elérhető. A PDF egyszerű A4/A5 anyag, nyomdai követelmény nélkül nem nyomdakész. Jóváhagyatlan előnézet is letölthető, egyértelmű „jóváhagyásra vár” jelzéssel; a korábbi, tulajdonosi jóváhagyáshoz kötött végleges letöltés megmarad. A nyomdai profil külön, összecsukott lehetőségből érhető el, a korábbi PDF/verzió megőrzésével.

Új `/automatic` végpont: helyi sablonos csoportosítás, nem valódi AI-hívás, nem fogyaszt mock/AI-kreditet. Tartalomlenyomat és adatbáziszár biztosítja, hogy ismétléskor ugyanaz a változat térjen vissza. A kizárások és azonos méretnél zárolások megmaradnak. `/preview-pdf` csak a tulajdonosnak, előnézeti jelzéssel érhető el; nincs jogosultsági megkerülés. A meglévő kézi változatok és az eredeti média megmaradnak.

Ellenőrzés: frontend build, frontend/backend típusellenőrzés, érintett lint PASS. 100 beküldős szerverteszt kiegészítve automatikus újrapróbálással, változat- és kreditszámlálással, előnézet/végleges PDF különbségével és idegen tulajdonos tiltásával: PASS. Chromium mobilnézet és PDF-letöltés: PASS. A helyi próbafiók egyszerű oldala és kétoldalas A4-előnézete ellenőrizve; az előnézet jelölése és lapmérete helyes. A WebKit futtatókörnyezet 2026-11-08-án már induláskor összeomlik (exitCode 3236495362); ezért az új egyszerű nézet WebKit/Safari ellenőrzése NYITOTT, a korábbi napi PASS nem helyettesíti. Fizikai telefonos új PASS nincs. Nem történt commit/push/deploy; az internetes pilot változatlan.

2026-11-07. Repository: memorybook-app-m1, ág: codex/wedding-internet-pilot; kiinduló HEAD 8f93f5c. A munkafa kezdetben tiszta volt, alkalmazandó AGENTS.md nem volt. Az eredmény szándékosan nincs commitolva, pusholva vagy Renderre telepítve. Éles fizetés, számlázás, main, éles adatbázis és internetes pilot nem változott. Új díjas szolgáltatás vagy AI-hívás nem történt.

## Kipróbálás a notebookon

- Belépés: http://127.0.0.1:5188/pilot/account
- Fiktív fiók: montage@example.test, jelszó: aaaa.
- Könyv: http://127.0.0.1:5188/wedding/books/bb5ea230-1065-41dc-b9e9-a852a4477d89/montage
- Négy fiktív beküldő, köztük két azonos nevű, két szintetikus kép. A könyv beküldése lezárt, így jóváhagyás is próbálható. A két mintarendezés az átadáskor még nem fogyott.
- 1. Kijelölés → 2. Új teljes mintatervezet → elem mozgatása/méretezése a meglévő Fabric-felületen, vagy kiválasztása a mezőből → képkivágás/rajzhelyzet/szövegformázás → mentés és újranyitás → lefedettség/ellenőrzés → jóváhagyás → ellenőrző PDF.
- Második mintarendezéshez A5 is választható; az A4 változat a verziólistában megmarad. Az oldalpár kapcsoló az előnézetben két oldalt, a PDF-ben két készméretet ad egy lapra. A kézi változatok, visszavonás/újra, jóváhagyás és PDF nem fogyasztanak rendezést.
- A helyi példány csak a notebookról érhető el. A notebooknak és a helyi PostgreSQL-nek futnia kell. Samsung/iPhone fizikai próba NYITOTT; az internetes változat nem frissült.

Újraindítás PowerShellből, a repo könyvtárában: állítsd DATABASE_URL=postgresql://memorybook_test@127.0.0.1:55439/memorybook_wedding_test, NODE_ENV=test, WEDDING_LOCAL_DATABASE_ACK=yes környezeti változókat, majd `node --import tsx scripts/montage-local-demo.ts`. A localDatabaseUrl védelme kizár távoli/éles DB-t. A script csak a `montage_local_demo` sémában dolgozik, meglévő adatokat nem töröl, meglévő fiókjelszót nem ír át. A tesztek külön, véletlen nevű sémákat használnak.

## Megvalósítás

A meglévő MemoryBookEditor kapott montázsmódot és változtatható oldalmagasságot. Ugyanaz a Fabric-vászon, érintési kijelölés, mozgatás, méretezés, mentési sor, visszavonás/ismétlés működik; nincs párhuzamos vászonszerkesztő. A montázs gazdaforrrásokból származó fotó- és szövegelemeket használ. A fotócsere, kivágás, rajz x/y/arány, szöveg helye, betűmérete, színe, oldalak hozzáadása/törlése/sorrendje, elemáthelyezés, háttér és könyvszintű visszavonás is elérhető. Az eredeti üzenet módosítása külön tulajdonosi megerősítést kér. A saját tartalom hozzáadása az eredeti gyűjteményből kézi művelet.

A szerver nem tárol és nem futtat tetszőleges Fabric JSON-t. Verziózott, validált mm-koordinátás modellből készül a Fabric-megjelenítés. Forrás: beküldésazonosító, fotóazonosító; a fotó annotációja az eredeti külön rajzrétegre hivatkozik. A nézethez átmeneti összetett kép készül, de a szerkeszthető adatok, kivágás és rajztranszformáció külön megmaradnak. Eredeti fotó és rajz nem íródik felül. Az EXIF-orientációt és az eredeti képfelbontást a montázs külön kezeli. A képek 1600 px-es előnézetet használnak; PDF az eredeti képből készül.

Beküldőazonosság: a meglévő átlátszatlan böngésző/eszköz-azonosító; a vendégoldal ezt régi könyvnél is kiosztja az új beküldésekhez. Azonos név nem jelent azonos személyt. Régi, azonosító nélküli beküldés saját beküldésazonosítót kap a lefedettséghez; nem találgatunk személyazonosságot. Cookie-törlés vagy másik böngésző új technikai vendéget jelent, nem hitelesített személyazonosítást.

A kiválasztás nem töröl eredetit. Kifejezett vendégkizárás a következő kézi változat nyomtatási elemeiből is eltávolítja az érintett vendéget; az eredeti és régi változat megmarad. Lefedettség: legalább egy teljes, eredeti vagy a tulajdonos által kifejezetten módosított üzenet vendégenként. Hosszú üzenet egymás után következő forrástartományokra oszlik: egyetlen karaktert sem törlünk vagy fogalmazunk át. Csak médiát küldő vendégnél külön jelzés, nincs kitalált üzenet.

## Tervező, verziók, jóváhagyás

NINCS AI-szolgáltató bekötve. A PlanProvider csak forrásazonosítókból és ellenőrzött sablonazonosítókból álló strukturált tervet fogad. Jelenleg determinisztikus mock használatos, ezt a felület is kiírja. A4 több beküldést oszt el egy oldalon, A5 külön tördelési szabályt és kisebb képkártyát kap; nem A4-kicsinyítés. Hosszú szövegnél további oldalak keletkeznek, a betűméret nem csökken olvashatatlanra. A szerkesztő minimum 10 pontos, a mock 12 pontos szöveget használ.

V5 additív migráció: event_montage_versions. Minden mentés új, teljes változat; a korábbi változat és a szülőkapcsolat megmarad. Zárolt oldal és zárolt elem az újrarendezésben változatlanul átkerül, a kézi feloldás/szerkesztés továbbra is megengedett. Két sikeres mock futás = két teljes könyvtervezet. A szerver könyvzár és tranzakció alatt számol; sikertelen futás nem kerül be a számlálóba. Akciókulcs és kéréslenyomat biztosítja az ismétlést; megváltoztatott kérés azonos kulccsal 409. Elveszett válasz és dupla kattintás ugyanazt a változatot adja.

A jóváhagyás csak lezárt vagy ténylegesen lejárt beküldési ablakú könyvnél történik, hiányzó szöveges vendég és szövegtúlcsordulás nélkül. Jóváhagyás konkrét verzióhoz, tulajdonoshoz és időponthoz kötött. A következő módosítás új, nem jóváhagyott változat. PDF csak jóváhagyott pillanatképből tölthető le, a privát tulajdonosi munkamenettel. A tervezet, előnézeti képek és export másik tulajdonosnak/névtelenül nem elérhető; nincs nyilvános exporttoken.

Technikai helyi/pilot korlátok: 300 oldal, oldalanként 60 elem, 3 MB kérés, 200 változat/könyv, 25 MiB verzióadat/könyv, 64 MiB összes verzióadat. Nem kereskedelmi csomagígéretek. A mentés közös tanácsadói zárral védi a tárhelyösszesítést. Az eredeti média korábbi korlátai megmaradnak; átmeneti PDF/előnézet memóriaalapú, nem keletkezik takarítás nélküli fájl a szerveren.

## Nyomtatási profil és korlátok

Álló A4 210×297 mm, álló A5 148×210 mm; oldalpárnál kétszeres készszélesség. A kifutó, biztonsági és kötésmargó, DPI-figyelmeztetési határ, kért színprofil/PDF-követelmény, papír, borítószélesség/-magasság és gerincvastagság konfigurálható. A kezdő profil kizárólag próbabeállítás. Nincs kiválasztott nyomda vagy papír, ezért a borító mérete és gerince alapból ismeretlen; kész nyomdai borító nem készül.

PDFKit + beágyazott DejaVu Sans, a licenc a public/fonts könyvtárban. A tényleges kivágott felbontás, szövegtúlcsordulás, biztonsági/kötésmargó és rajz kivágáson kívülre kerülése ellenőrzött. A kép nem lesz jobb minőségű a felnagyítástól; nincs mesterséges felskálázás. Exportcélszint legfeljebb az eredeti felbontás és a max(300, kért DPI-határ) közül a kisebb. Nem PDF/X, nincs CMYK/nyomdai ICC-konverzió vagy nyomdai minősítés. A kért profil mezői követelményfeljegyzések, nem színkonverziót igazoló jelzések. Minden lapon „Ellenőrző PDF” felirat. Hang/videó nem működik, ezért nem kerül kitalált médialink vagy QR a könyvbe.

Szolgáltatói döntés kell: valódi AI-szolgáltató, adatküldési hozzájárulás és költségkeret. Nyomdai döntés kell: papír, kötés, végleges kifutó/margók, színprofil/PDF-változat, borító és gerinc. Nyomdakész minősítéshez tényleges mintanyomtatás szükséges.

## Tényleges ellenőrzések

- Frontend build, frontend/backend típusellenőrzés és érintett TS/TSX fájlok lintje PASS.
- Teljes regresszió: 50/50 PASS (korábbi hitelesítés, négykarakteres pilotjelszó, vásárlás, vendégszöveg, fotó, rajz és új montázs). A végső változtatások után a 6 érintett montázs/régi szerkesztő/rajz teszt ismét PASS, majd a végső montázs-API ellenőrzés is PASS.
- 100 fiktív, stabilan külön kezelt beküldő; 99 szöveges, 1 csak médiás; két azonos név. 99 szöveges lefedett, 0 véletlenül kimaradó, 1 csak médiás jelzés. Hosszú üzenet teljes tartalma megmarad. Kifejezett kizárás és hiány miatti jóváhagyás-elutasítás ellenőrzött.
- Hiba után nem fogyó alkalom, párhuzamos azonos kérés, eltérő tartalom ugyanazzal a kulccsal, harmadik rendezés elutasítása, kézi változat ingyenessége, zárolt oldal/elem megőrzése, régi jóváhagyás megőrzése és új változat jóváhagyatlansága PASS.
- Chromium és WebKit mobilnézet: elveszett rendezési válasz és dupla kattintás, mentés/újranyitás, kivágás, külön rajztranszformáció, Fabric-mozgatás, visszavonás/újra, jóváhagyás és tényleges PDF-letöltés PASS. Ez nem fizikai Samsung/iPhone próba.
- Privát tervezet, kép és PDF másik tulajdonostól/névtelenül védett. Eredeti képbájtok változatlanok. EXIF-fordítás és annotáció ismert képpozíciója ellenőrzött.
- PDF: A4 210×297 mm, 13 oldal; A5 148×210 mm, 102 oldal; A5 oldalpár 3 mm próbakifutóval 302×216 mm, 51 lap. Minden lap mérete ellenőrzött, betűk beágyazva, „Árvíztűrő tükörfúrógép” visszaolvasható. Az első oldalak és oldalpár PNG-renderben szemrevételezve; nincs észlelt levágás. Az eltérő oldalszám eltérő tördelést igazol, nem minőségi AI-állítás.
- Helyi demó: valódi Better Auth belépés és a négy beküldős montázsoldal megnyitása PASS, a felhasználó két mintarendezését ez az ellenőrzés nem fogyasztotta.

Ellenőrzési fájlok: test-results/montage/a4.pdf, a5.pdf, a5-spread.pdf, képernyőképek és PNG-nézetek. Fizikai Samsung/iPhone, valódi AI és nyomdai mintanyomtatás NYITOTT.
