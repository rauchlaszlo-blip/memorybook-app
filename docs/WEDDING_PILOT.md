> 2026-11-07: Ez helyi fejlesztési útmutató. A termék célja központi HTTPS-kiszolgálás, USB és közös hálózat nélkül. Irányadó: [célkövetelmények](PRODUCT_REQUIREMENTS_20261107.md), [internetes pilot terve](INTERNET_PILOT_PLAN_20261107.md). A helyi pilot=1 belépés nem internetes tulajdonosi hozzáférés.

# Esküvői szöveges pilot – M0/M1

## Jelszó nélküli helyi telefonos próba (2026-11-06)

A felhasználó kérésére a pilotindító `--passwordless-test` kapcsolóval is indítható.
Csak a `--grant-email=wedding-pilot@example.test` fiktív fiókkal, a meglevő helyi
belépési fájllal és ellenőrzött helyi tesztadatbázissal működik. A `/wedding?pilot=1`
link valódi sessiont hoz létre ehhez a fiókhoz, jelszóbeírás nélkül. A vendéglink
nem használja ezt a belépést. Alapértelmezetten a végpont kikapcsolt; éles NODE_ENV
és nem helyi próbaadatbázis mellett elutasított. A tesztmódban a LAN-on a linket
megnyitó személy a közös fiktív tulajdonost használja. Kikapcsolás: újraindítás a
`--passwordless-test` kapcsoló nélkül. A többi jogosultsági ellenőrzés megmarad.

## Hatókör

Egy bejelentkezett, kifejezetten engedélyezett helyi teszttulajdonos esküvői könyvet hozhat létre. QR/link → név és jókívánság → privát tulajdonosi lista → beküldés lezárása. Nincs új média-, AI-, fizetési vagy exportfunkció.

A `/wedding` UI és `/api/wedding` router különül el a régi útvonalaktól. A `WEDDING_ENABLED=true` szerveroldali kapcsoló engedélyezi az új API-t; hiányában/false értéknél minden új API-végpont 404-et ad. A frontend ekkor nem kínál használható létrehozást/beküldést. Kikapcsolás: környezeti változó módosítása és szerverújraindítás. Nem kell táblát törölni, régi adatot migrálni vagy a MemoryBookot visszaállítani.

## Adatok és jogosultság

- `event_books`: önálló `celebration` termék, eseménytípus, cím, személy/csoport megjelenítési adatok JSON-ban, opcionális kezdő- és végdátum, sablonazonosító/verzió. M1 kizárólag esküvőt hoz létre. Nem alakítja át a meglévő `books` táblát.
- A mostani névmező egy megjelenítési csoportot tárol; nem próbál két személyt automatikusan felismerni. A közös modell egy személyt és több csoporttagot is ábrázolhat.
- `event_submissions`: könyv-FK, privát név és szöveg, adatbázis-egyedi `(book_id,idempotency_key)`. A külön `occurred_on` most NULL marad; a beküldés `created_at` értéke nem lesz automatikusan az emlék eseménydátuma.
- Az `owner_user_id` a hitelesített Better Auth felhasználó azonosítója. Nincs új közös auth-tábla és nincs users-FK: az additív migráció üres adatbázison is futtatható, az API viszont kizárólag ellenőrzött sessionből vesz át tulajdonost. Fióktörlés és megőrzési életciklus nem M1-funkció.
- Az eredeti MemoryBook-API-k nem olvasnak az új táblákból. UUID kitalálása nem ad új hozzáférést.
- A vendégtoken 32 véletlen bájt base64url alakja. A vendég kizárólag címet, eseménydátumot, sablonazonosítót/verziót és lezárási jelzést kap; más beküldést, tulajdonosi azonosítót, e-mailt nem.
- A sablon: `shared/event-templates.ts`, `wedding-classic@1`, HU/EN/DE szövegek és megjelenés. Az alkalmazás meglévő nyelvválasztását és értesítéseit használja. Új verziót külön kell hozzáadni; a meglévő kiadott verzió jelentését ne változtasd meg.

Létrehozási jog: együttesen kell a funkció engedélyezése, `NODE_ENV=development` vagy `test`, `WEDDING_PILOT_CREATE_ENABLED=true`, és az aktuális felhasználó pontos azonosítója a `WEDDING_PILOT_USER_IDS` vesszővel elválasztott listában. Éles környezetben a pilotengedély nem működik. A régi fizetési jogosultságokat nem lazítottuk fel.

## Beküldési szerződés

`POST /api/wedding/guest/:token/submissions`

```json
{"name":"Fiktív vendég","message":"Sok boldogságot!","idempotencyKey":"egy érvényes UUID"}
```

Név: 1–100, szöveg: 1–4000 JavaScript-karakter trim után; tiltott vezérlőkarakterek elutasítva. A jelenlegi pilotra vonatkozó bemeneti korlátok, nem végleges csomag- vagy árkorlátok. JSON-kérés legfeljebb 32 KB. A UI szövegként jeleníti meg a tartalmat, nem HTML-ként.

- Első siker: 201 `{accepted:true,replayed:false}`.
- Azonos könyv/kulcs és azonos normalizált tartalom: 200 `{accepted:true,replayed:true}`, lezárás után is.
- Azonos kulcs, eltérő tartalom: 409; semmi nem íródik felül.
- Lezárt könyv, új kulcs: 410.
- Hibás/ismeretlen token: 404. Hibás bemenet: 400; túl nagy JSON: 413.
- Más tulajdonos: 404; hiányzó session tulajdonosi műveletnél: 401.

A beküldés tranzakcióban `FOR UPDATE` zárolja az eseménykönyvet. A lezárás ugyanazt a sort frissíti. Amelyik előbb szerzi meg a zárat, az történik előbb: lezárás után új beszúrás nincs; lezárás előtti sikeres beszúrás megmarad. Az újrapróbálás vizsgálata megelőzi a lezárásvizsgálatot.

A kliens szinkron ref-zárral védi a dupla kattintást. Bizonytalan hálózati eredménynél ugyanazt a tartalmat és kulcsot tartja meg; a mezők lezárva maradnak a megismételt beküldéshez. Nincs böngészőbezárást túlélő offline ígéret.

Kéréskorlátozás: folyamatonként, IP-alapon külön olvasási/írási percenkénti keret, korlátos memóriatáblával. Ez egyfolyamatos pilothoz készült, nem elosztott üzemi limiter. A same-origin ellenőrzés az új író végpontokon működik; a régi CORS-beállítást nem alakítja át.

## Migráció és helyi indítás

Előfeltétel: Node és a lockfile szerint telepített függőségek, PostgreSQL. Csak külön helyi adatbázist használj. A meglévő backend továbbra is automatikusan inicializálja a saját régi sémáját; az esküvői migrációt NEM hívtuk be ebbe.

```powershell
$env:DATABASE_URL='postgresql://memorybook_test@127.0.0.1:55439/memorybook_wedding_pilot'
$env:NODE_ENV='development'
$env:WEDDING_LOCAL_DATABASE_ACK='yes'
node --import tsx server/wedding/migrate-cli.ts
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node --import tsx scripts/wedding-pilot.ts
```

A migrációs parancs loopback címet, `memorybook_wedding_pilot` vagy `memorybook_wedding_test` kezdetű adatbázisnevet és kifejezett visszaigazolást követel; távoli/éles célt elutasít. Migrációs napló, tranzakció és advisory lock védi az ismétlést/párhuzamos futtatást. Az ismételt futtatás nem töröl adatot. A `20261106_event_guestbooks_v1.sql` táblái additívak. Nincs automatikus down/törlő migráció.

A pilotindító kizárja az örökölt `.env`, fizetési, Cloudinary és külső OAuth-kulcsokat; csak a külön adatbázist és generált helyi auth-titkot adja át. Alapértelmezetten `127.0.0.1:3001` címen figyel. Újraindítás után új bejelentkezés kell. A konzolra nem kerül jelszó vagy kapcsolati titok.

Első alkalommal a `/login?returnTo=%2Fwedding` oldalon regisztrálj helyi tesztfiókot. Állítsd le a pilotot, majd explicit engedéllyel indítsd újra:

```powershell
node --import tsx scripts/wedding-pilot.ts --grant-email=helyi-tesztfiok@example.test
```

A címnek már létező helyi felhasználót kell azonosítania. Az indító annak pontos user ID-jét adja az allowlistnek. Engedély nélkül a belépés működik, az új könyv létrehozása nem.

Kikapcsolási próba:

```powershell
$env:WEDDING_ENABLED='false'
node --import tsx scripts/wedding-pilot.ts --grant-email=helyi-tesztfiok@example.test
```

Ezután az új API-k 404-et adnak, a régi MemoryBook-útvonalak tovább működnek. Visszakapcsolás: `WEDDING_ENABLED=true`, majd újraindítás. Az adatokat nem törli.

## Automatizált ellenőrzés

```powershell
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node node_modules/typescript/bin/tsc -p tsconfig.server.json
node node_modules/eslint/bin/eslint.js .
node node_modules/eslint/bin/eslint.js server/wedding shared src/wedding scripts tests
$env:DATABASE_URL='postgresql://memorybook_test@127.0.0.1:55439/memorybook_wedding_test'
$env:NODE_ENV='test'
$env:WEDDING_LOCAL_DATABASE_ACK='yes'
node --import tsx --test tests/wedding.test.ts tests/full-flow.test.ts
```

Npm-parancsok: `build`, `lint`, `typecheck:server`, `migrate:wedding`, `test:wedding`, `test:full-flow`, `pilot:wedding`.

A teljes folyamat tesztje helyben telepített Chrome-ot használ (`channel: chrome`); alternatív Chromium útvonala `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Nem igényel éles szolgáltatást. A 3003-as helyi portnak szabadnak kell lennie. A tesztek saját véletlen sémát hoznak létre, és csak ezt törlik a végén. A teljes backend és a valódi Better Auth is fut; tesztkulcs, session vagy jelszó nem kerül a jelentésbe. A routerteszt külön injektált identitáskezelője nincs bekötve az alkalmazásba.

## Fizikai telefonos elfogadás – NYITOTT

A localhost cím a telefonról nem a számítógépet jelenti. A jelenleg futó loopback pilot csak a számítógépen érhető el. Telefonos próbához a két készülék és a számítógép ugyanazon megbízható helyi Wi-Fi-n legyen.

Állítsd le a loopback pilotot, keresd ki a számítógép tényleges privát IPv4-címét, és indítsd az alábbi alakban (a jelölt IP-t cseréld ki):

```powershell
node --import tsx scripts/wedding-pilot.ts --grant-email=helyi-tesztfiok@example.test --lan-origin=http://SAJAT_PRIVAT_IPV4:3001
```

A LAN-opció kizárólag privát IPv4-címet és 3001-es HTTP-portot fogad el. Nem nyit tűzfalat és nem hoz létre internetes alagutat. Ha a tűzfal nem engedi a kapcsolatot, a telefonos próba blokkolt marad. A tulajdonosi felületet is a kiírt LAN-címen nyisd meg, hogy a QR ezt a címet tartalmazza. Ez a szöveges helyi próba HTTP-n működhet; a későbbi kamera/mikrofonfunkcióhoz nem tesz HTTPS-kompatibilitási ígéretet.

Android/Chrome ÉS iPhone/Safari készüléken külön:

1. Tulajdonos: belépés, új fiktív esküvő létrehozása, QR megnyitása.
2. Telefon saját kamerája: QR beolvasása, böngészőben megnyitás; nincs fiókkérés.
3. Írj ékezetes nevet és üzenetet. Billentyűzet mellett görgess a Beküldés gombig.
4. Dupla koppintás. Tulajdonosnál Frissítés: pontosan egy új üzenet.
5. Új, nyitott könyvnél kapcsold ki a telefon hálózatát küldés előtt. A szöveg maradjon meg; hálózat vissza, újrapróbálás: egy üzenet.
6. Tulajdonos zárja le a beküldést. Másik telefonról új beküldés nem sikerülhet.
7. Ellenőrizd az oldalt HU/EN/DE nyelven, álló és fekvő helyzetben. Rögzítsd a készülék/OS/böngésző verzióját és az eredményt.

Az elveszett szerverválasz utáni retry és a közben végrehajtott lezárás automatizált böngészőtesztben bizonyított. Ez nem fizikai készülékes PASS. A telefonos feltételek lezárásáig nincs teljes M0–M1 PASS.
