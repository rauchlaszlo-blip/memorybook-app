# MemoryBook értékesítési és tesztvásárlási pilot – 2026-11-07

Jelszóminimum-frissítés: 2026-11-07 15:28:35 Budapest, deploy dep-dbnjakm417fc73du2itg LIVE, telepített commit 11bcbcac50668bf066f719b631146e4e776fd5d3. Csak a külön pilotban minimum 4 karakter, összetételi feltétel nélkül. Frontend és backend közös shared/pilot-auth.ts értéket használ; server/auth.ts és server/auth-factory.ts nem változott. Helyi 9 célzott teszt, build, frontend/backend típusellenőrzés és érintett lint PASS. Internetes WebKit-próba: 3 karakter backendből és űrlapon elutasítva, „aaaa” regisztráció és két kijelentkezés utáni belépés sikeres, korábban létrehozott hosszabb jelszavas fiók továbbra is belép. A felirat és az input minimuma is 4. Valódi telefonos jelszópróba külön felhasználói visszajelzésre vár.

Kiindulás: ac03420, codex/wedding-internet-pilot, tiszta munkafa. A korábbi szöveges, fotós és rajzos könyvek megmaradnak; main és éles szolgáltatás/adatbázis nem célpont. Nincs új szolgáltatás vagy fizetős csomag. A meglévő Render szolgáltatás Free státuszát ismét ellenőriztük.

## Felület és működő folyamat

A pilot gyökércíme /pilot-ra vezet: magyar, mobilos/asztali nyitóoldal, ünnepi könyv/vendégoldal illusztráció (fiktív bemutatóként jelölve), működési lépések, csomag, GYIK, belépés és Saját könyveim. Csak esküvő választható. Nincs kosár. 0 Ft tesztvásárlás, nem éles fizetés; 24 900 Ft nem jelenik meg. Hang/videó/AI/export fejlesztés alatt. A megőrzés, kereskedelmi össztárhely és végleges ár nyitott, nincs korlátlan ígéret.

Útvonalak: /pilot/account, /pilot/checkout?product=wedding, /pilot/books, /pilot/setup/:orderId, /pilot/ready/:orderId. A tényleges vendég és tulajdonosi lista továbbra is a /wedding útvonalakat használja. Sikeres tesztvásárlás közvetlenül a személyre szabáshoz vezet. Félbehagyott jogosultság a Saját könyveim oldalon folytatható, másik eszközön ugyanazzal a fiókkal elérhető. Könyv neve, pár neve, dátum, egy kész klasszikus megjelenés. Mentés után stabil vendéglink, QR-kép, PNG-letöltés és nyomtatható QR-lap. Nincs tulajdonosi token a QR-ben.

## Hitelesítés és tesztlevelek

Nem készült második felhasználói rendszer. A meglévő Better Auth konfiguráció került közös auth-factory modulba, azonos users/auth_sessions/auth_accounts/auth_verifications modellekkel. Az éles konfiguráció működése megmarad; a külön pilot saját adatbázisában fut ugyanaz a hitelesítés. A pilot tartós auth-titka kriptográfiai véletlen, csak a védett tesztadatbázis settings táblájában van; újraindításkor nem cserélődik. A hitelesítési táblák migrációja az auth-motor indítása előtt lefut.

E-mail és legalább 4 karakteres jelszó (2026-11-07-i pilotmódosítás; nincs összetételi feltétel), külön felhasználónév nélkül. A kiválasztott terméket a visszatérési útvonal megőrzi, jelszó-visszaállításnál is. Google nincs bekötve, nem jelenik meg gomb. A vendéghez nem kell fiók.

Nincs engedélyezett levélküldő szolgáltatás, ezért egyetlen e-mail sem megy ki. Az e-mail-megerősítési és reset callback AES-256-GCM titkosítva menti a tesztlinket a pilot_test_mail táblába, legfeljebb 1 órás üzemeltetői elérhetőséggel. Csak az eredeti üzemeltetői session olvashatja ki. A nyilvános resetkérés nem ad vissza tokent/linket és nem ígér elküldött levelet. A Better Auth resetlink egyszer használható, a jelszócsere a korábbi munkameneteket visszavonja. E-mail-megerősítés a pilotban nem feltétele a próbának; éles induláshoz valódi levelezés és ennek végleges szabálya kell.

A régi, meghívóval létrehozott egyetlen pilot-tulajdonosi munkamenet kompatibilitási/üzemeltetői hozzáférésként megmarad. Nem általános második regisztrációs rendszer. Új vásárlásokhoz Better Auth fiók kell. Ha mindkét session jelen van, a könyvekhez a bejelentkezett vásárló azonosítója elsődleges; a régi könyvekhez a vásárlói fiókból kilépve az eredeti meghívós session tovább használható. Vásárlói fiók nem válik üzemeltetővé.

## Rendelés, kód és számlázási szimuláció

V4 additív migráció: pilot_test_codes, pilot_test_orders, pilot_book_entitlements, settings és tesztlevéltábla, opcionális oszlopok az event_books/event_submissions táblákhoz. Nem írjuk át a régi könyveket. Az új kód MB- prefix és 24 véletlen bájt base64url alakja (192 bit), csak SHA-256 tárolva. Lejárat 1–30 nap, alapértelmezés 7. Be nem váltott kód visszavonható. Kiadás csak a védett üzemeltetői felületen/parancsból; névtelen és vásárlói fiókkal tiltott.

A kódsor FOR UPDATE zára alatt egy tranzakció váltja be a kódot, menti a 0 HUF test_completed rendelést és az egykönyves jogosultságot. code_id és user+idempotency_key egyedi. Azonos kód ismétlése ugyanannak a fióknak az eredeti rendelést adja vissza (a számlázási snapshotot nem írja felül); másik fióknak 409. Lejárt vagy visszavont, még be nem váltott kód elutasított. A végleges mentés válaszának elvesztése nem veszti el a jogosultságot. A jogosultság zára és egyedi book_id kapcsolata biztosítja az egyetlen könyvet. Kódpróbálgatás szerveroldalon 30 írás/perc/IP kategóriánként korlátozott; operátori és könyvszerkesztési kategória külön. Hiányzó/idegen Origin íráskor tiltott.

Magánszemély/cég vagy e.v., fiktív név, 4 jegyű magyar irányítószám, település, cím. Cég/e.v. adószám formátumellenőrzés (8-1-2 számjegy), nem NAV- vagy létezésellenőrzés. A company lookup interfész nincs szolgáltatóhoz kötve, kézi kitöltés működik. Fiók e-mailje szerveroldalon kerül a snapshotba, ország HU, pénznem HUF, összeg 0; kliens nem írhatja felül. Nincs fizetési szolgáltatói tranzakció, számla, számlasorszám vagy NAV-adatszolgáltatás. Mintabizonylat nem készült.

## Időablak és tartalmi keretek

Központi, verziózott konfiguráció: shared/wedding-package.ts, v1; rendelésben snapshot, könyvben verzió. Új csomagváltozatot új verzióval kell bevezetni. Esküvő a vásárlás magyar napjától annak +12 naptári hónapjáig, PostgreSQL naptári hónapkezeléssel. Kezdés: esküvő mínusz 10 nap 00:00, inkluzív. Vége: esküvő plusz 8 nap 00:00, exkluzív, vagyis a +7. nap teljes egészében beküldhető. Minden konverzió Europe/Budapest, téli/nyári időszámítással. UI megjeleníti a határokat. Az első mentéskor rögzített zárási határidőt későbbre toló dátummódosítás tiltott. Korábbi dátum megengedett a vásárlási tartományban. Kézi lezárás elsőbbséget élvez, tesztóra sem oldja fel.

Lezárás után a könyv metaadatai még javíthatók, majd külön véglegesíthetők. Ez könyvadat-véglegesítés, nem kész PDF, könyvtördelés vagy AI-munka. Tartalomszerkesztő nem készült ebben a feladatban.

Üzemeltetői tesztóra csak új, package_version értékkel rendelkező könyvhöz állítható a védett felületen. Üres értékkel visszaáll a valós idő. Nincs publikus dátumkerülő paraméter, a régi könyvekre a művelet 404. A korábbi könyvek időablak és új eszközkeret nélkül, változatlanul működnek.

Új könyv: 10 véglegesen beküldött fotó/böngészőazonosító/könyv. HttpOnly, SameSite=Lax, HTTPS-en Secure, véletlen eszközsüti; szerver csak hash-t kapcsol a bejegyzéshez. Ez nem személyazonosítás: sütitörlés vagy más böngésző új eszköznek számíthat. Nincs öt beküldési alkalmas korlát. Szöveg önmagában tovább küldhető. A párhuzamos véglegesítések könyvzáron sorosodnak, az idempotens ismétlés az ellenőrzés előtt felismerhető, így nem fogyaszt új fotóhelyet. Sikertelen feltöltés/mentés nem fogyaszt bejegyzési keretet. A még be nem küldött fájlok továbbra is TTL szerint takaríthatók.

Csomagterv: 2 videó és 2 hangüzenet, mindegyik maximum 20 másodperc; 2 AI-rendezés (első + újra). Ezek csak verziózott konfiguráció/tervezett tartalom, nincs még megvalósított felvétel, feltöltés, AI-hívás vagy export. A működő fotós és rajzos utak megmaradnak. A pilot technikai 6 MiB/kép, 24 MP, 50 MiB/könyv és 200 MiB teljes médiahatár nem kereskedelmi összkeret.

## Üzemeltetés

Az eredeti tulajdonosi meghívóval megnyitott böngészőben /pilot/operator: Új egyszer használható kód – 7 nap; teljes kód csak kiadáskor látható, később státusz és visszavonás. Ugyanitt tesztlevelek és célzott tesztóra. Nem nyilvános kódgenerátor: minden művelet a korábbi üzemeltetői sessionnel és íráskor same-origin ellenőrzéssel védett.

Parancssori alternatíva: node --import tsx scripts/pilot-commerce-operator.ts issue | revoke CODE_ID | mail TEST_EMAIL | clock BOOK_ID ISO_TIME_OR_clear. A már meglévő ignorált test-results/internet-owner-state.local operátori munkamenetet használja, csak az izolált pilot hostname fogadható. A teljes kód/levél ignorált *.local fájlba kerül, nem logba/repositoryba. A kódot a jogosult tesztelőnek lehet átadni. Session lejáratakor új üzemeltetői meghívó szükséges, vásárlói fiók nem helyettesíti.

## Ellenőrzések és hiányok

Helyi build, frontend/backend típusellenőrzés, érintett lint PASS. 46 célzott teszt együttesen PASS. Új tesztek: regisztráció, valódi Better Auth login, e-mail-megerősítés tesztlinkkel, egyszeri jelszóreset és sessionvisszavonás, privát operátori műveletek, kódok állapotai és versengése, jogosultság/book egyediség, folytatás, fiókok elkülönítése, Budapest/DST időhatárok, tíz fotó és szabad újrapróbálás, cég kézi adatainak mentése, szerveroldali 0 HUF és fiók-email. Chromium és WebKit mobilon: honlap → regisztráció → checkout elveszett válasszal → félbehagyott setup → dupla mentés elveszett válasszal → tényleges QR-pixelösszevetés/PNG-letöltés/print CSS → anonim vendégüzenet → második eszközös belépés. Korábbi 38 auth/szöveg/fotó/rajz teszt regressziója is PASS. Képernyőképek megvizsgálva.

Éles induláshoz hiányzik: végleges ár, megőrzés, mért kereskedelmi tárhelykeret; üzemeltető adószáma, székhelye, nyilvántartási száma, kapcsolati címe; végleges jogi/adatkezelési dokumentumok; engedélyezett e-mail-szolgáltatás és végleges megerősítési politika; opcionális Google OAuth; opcionális cégadat-lekérdező; éles fizetés/számlázás/NAV-bekötés. Hang/videó/AI/export külön fejlesztés. A pilot adatbázisa 2026-12-07 11:53 Budapestkor lejár. Nincs állítás ügyvédi ellenőrzésről vagy éles készültségről.

A fizikai Samsung/iPhone vásárlás–új könyv–QR próba NYITOTT. A korábbi fotós és rajzos felhasználói PASS nem helyettesíti ezt. Telepített eredmény és átadott új kód külön rögzítendő, a nyers kód csak az ignorált operátori fájlban és a jogosult felhasználónak adott válaszban szerepel.

## Internetes telepítés és átadás

2026-11-07 14:24:53 Budapest: Render deploy dep-dbnicmijnfac73cfcc3g LIVE, commit **9a8048fad20d7ec392ecc4b7aa901843b01e337d**, szolgáltatás srv-dbng6ojrjlhs738notk0. Cím: https://memorybook-wedding-text-pilot-ukd0.onrender.com/ . A meglévő Free szolgáltatás és tesztadatbázis frissült; új erőforrás, fizetős szolgáltatás vagy környezeti titokcsere nem történt. A main továbbra is 5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff. Éles MemoryBookhoz nem nyúltunk.

A scripts/verify-commerce-pilot.ts valós HTTPS-en, WebKittel végigpróbálta a nyitóoldaltól a regisztrációt, tesztkódos vásárlást elveszett válasszal és dupla kattintással, a félbehagyott személyre szabás folytatását, egyetlen rendelést/könyvet, a QR pixelazonosságát, anonim rajzos fotóbeküldést, az eredeti kép változatlanságát és a szerkeszthető rajzréteget. A tulajdonosi Frissítés navigáció nélkül betöltötte a kész képet. Másik böngészőben ugyanazzal a fiókkal a könyv elérhető. Névtelen rendeléslista/média, vásárlói operátori kódkezelés, idegen tulajdonos és a régi operátor hozzáférése az új vásárló könyvéhez elutasítva. PASS; szintetikus kép és fiktív adatok, fizikai kamera/telefon nem része ennek.

Külön, csak olvasó internetes regresszió: a korábbi telefonos könyv és QR változatlan, anonim űrlap elérhető; korábbi eredeti és összeállított kép SHA-256, rajzréteg és bejegyzésszám változatlan. PASS. A végső apró módosítások után az új 8 API/böngészőteszt ismét PASS; build, két típusellenőrzés és érintett lint PASS. A legacy bundle méretfigyelmeztetése továbbra is fennáll, nem buildhiba.

Átadási kód azonosítója: d4426c8c-54ec-4bbc-9f85-3a298fbc75c6. Kiadva 2026-11-07, lejár 2026-11-14 14:26:08 Budapest. Új, fel nem használt, egy könyvre jogosít; nyers értéke nincs a repóban. Későbbi kód: eredeti meghívós üzemeltetői böngésző → /pilot/operator → „Új egyszer használható kód – 7 nap”.

Következő felhasználói próba: mobilinternet, USB nélkül; nyitóoldal → esküvői könyv → saját fiktív fiók/4+ karakteres jelszó → fiktív magyar számlázási adatok + átadott kód → könyv neve/pár neve/mai esküvődátum → QR letöltése → másik telefonon/privát böngészőben vendégüzenet és fotó → Saját könyveim / Beérkezett emlékek / Frissítés. A mai dátum miatt az időablak azonnal nyitva. Ugyanazzal a fiókkal a másik telefonon is ugyanazt a könyvet kell látni. Samsung/iPhone új folyamatának eredményét kizárólag a felhasználó visszajelzése után lehet PASS-ra állítani.
