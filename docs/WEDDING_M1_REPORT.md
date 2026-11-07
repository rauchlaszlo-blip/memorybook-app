> 2026-11-07-i pontosítás: A Samsung USB-s próbáit a felhasználó részben visszaigazolta, de internetes/kábel nélküli PASS nincs. Az iPhone/Safari nyitott. Az aktuális készültségi táblát a [célkövetelmények](PRODUCT_REQUIREMENTS_20261107.md), a következő mérföldkövet az [internetes terv](INTERNET_PILOT_PLAN_20261107.md) rögzíti. Az alábbi jelentés a megvalósítás előzményét őrzi.

# M0/M1 megvalósítási jelentés – 2026-11-06

## Állapot

Az esküvői szöveges folyamat elkészült és helyileg kipróbálható. Teljes M0–M1 PASS NINCS: a teljes repository lintje örökölt hibákkal bukik, a fizikai Android/iPhone elfogadás NYITOTT. Nincs commit, push, deploy, éles adatbázis-módosítás, szolgáltatói beállításmódosítás vagy fizetős hívás.

Felhasználói eredmény: explicit tesztjogosultságú, bejelentkezett tulajdonos → esküvői cím/nevek és dátum → QR/link → fiók nélküli név és jókívánság → privát tulajdonosi lista → lezárás. A vendég nem kap oldalszerkesztőt. Hiba esetén szövegmegőrzés és azonos kulcsú retry; elveszett sikeres válasz utáni ismétlés lezárás után is visszaigazolható. Magyar, angol és német sablonszövegek.

## Git és munkakörnyezet

- A régi `C:\MemoryBook\memorybook-app` checkout a korábbi felmérésben hiányzott; a jelenlegi gyökérben továbbra is csak üres, remote nélküli Git-repository volt (`master`, nincs HEAD).
- Új, külön munkapéldány: `C:\Users\Laci\Documents\ChatGPT\Memorybook\memorybook-app-m1`.
- Remote: `https://github.com/rauchlaszlo-blip/memorybook-app.git`.
- A frissen klónozott `main` kiinduló HEAD-je: `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`.
- Feature branch: `codex/wedding-m1`. HEAD változatlan, nincs saját commit.
- Kiinduló munkafa tiszta. Végül 5 tracked fájl módosult; az új fájlok untracked állapotúak, staged változtatás nincs.
- Alkalmazandó AGENTS.md nem volt az ellenőrzött szülőkönyvtárakban vagy a checkoutban.
- A helyi PostgreSQL 17.11 külön klasztert kapott a `..\pilot-state\pgdata` alatt, 127.0.0.1:55439 címen. Más projekt adatbázisát nem használtuk; csak a rendelkezésre álló PostgreSQL binárisokat másoltuk helyi futtatókörnyezetként.
- Függőségek: lockfile-alapú telepítés; egy új fejlesztői függőség a Playwright. Nincs fizetős szolgáltatás.

## Változott fájlok

Meglévő fájlok:

- `.gitignore`: tesztképek/jelentések kizárása.
- `package.json`, `package-lock.json`: ellenőrző és pilotparancsok, Playwright.
- `server/index.ts`: router import/bekötés; négy meglévő nullable rowCount típushiba minimális javítása; opcionális BIND_HOST. Nem lett átírva a backend, a mentési/preview-folyamat nem változott.
- `src/main.tsx`: külön `/wedding` útvonalak.

Új fájlok:

- `server/migrations/20261106_event_guestbooks_v1.sql`.
- `server/wedding/router.ts`, `migrate.ts`, `migrate-cli.ts`, `local-db.ts`.
- `shared/event-templates.ts`.
- `src/wedding/WeddingPage.tsx`, `wedding.css`.
- `scripts/wedding-pilot.ts`, `wedding-no-dotenv.ts`.
- `tests/wedding.test.ts`, `full-flow.test.ts`.
- `tsconfig.server.json`.
- `docs/WEDDING_PILOT.md`, ez a jelentés.

## Tényleges eredmények

| Ellenőrzés | Eredmény | Határ |
|---|---|---|
| Kiinduló frontend build | PASS | >500 kB chunk figyelmeztetés már létezett |
| Végső frontend build | PASS | A chunk figyelmeztetés megmaradt |
| Kiinduló backend típusellenőrzés | FAIL | 4 nullable rowCount hiba |
| Végső backend + script + teszt típusellenőrzés | PASS | Külön tsconfig.server.json |
| Kiinduló teljes lint, összehasonlítható környezetben | FAIL | 133 hiba, 15 figyelmeztetés |
| Végső teljes lint | FAIL | Ugyanaz a 133 örökölt hiba és 15 figyelmeztetés |
| Új backend/UI/shared/script/teszt fájlok lintje | PASS | Nincs új lint-hiba |
| PostgreSQL API- és migrációs tesztek | PASS | 14 teszt, valódi elkülönített adatbázison |
| Teljes auth/legacy/böngészős folyamat | PASS | 1 összetett teszt, valódi Better Auth és headless Chrome |
| Összes automatizált teszt | PASS | 15/15 |
| Helyi pilot HTTP + belépés + explicit tesztjog | PASS | Fiktív helyi fiókkal ellenőrizve |
| Fizikai Android/Chrome | NEM FUTOTT | NYITOTT |
| Fizikai iPhone/Safari | NEM FUTOTT | NYITOTT |
| LAN indítás és telefonról elérhetőség | NEM FUTOTT | Az indító támogatja; a futó pilot loopbacken van |
| Preview-versenyhelyzet reprodukciója | NEM FUTOTT | A preview-útvonal nem változott; nincs reprodukált hibának nevezve |

A legelső, node_modules alá kitett baseline másolaton mért lint 126 hibát adott. Ezt nem használtuk végső összehasonlításnak: a változatlan forrást külön külső másolatban, azonos szabályokkal újrafuttatva 133/15 az összehasonlítható baseline. A többletjelzések változatlan régi fájlokban vannak. A teljes lintet nem némítottuk el és nem alakítottuk át a régi komponenseket a feladaton kívül.

A tesztek bizonyítják: jogosultsági allowlist/éles tiltás; könyv- és tulajdonosizoláció; vendég olvasási korlátok; hibás token; párhuzamos azonos kulcs; megváltoztatott tartalom; lezárás és beküldés zárolása; lejárt/lezárt állapotbeli replay; adatbázis-FK/egyediség; HU szöveg; HTML-adatként megjelenítés; hossz/típus/dátum/JSON validálás; cross-origin tiltás; rate limit; funkciókapcsoló; migráció üres és régi könyves sémán, ismételten.

A teljes folyamat külön bizonyítja a régi belépést, jogosultság nélküli régi könyvlétrehozás elutasítását, könyvizolációt, oldalmentést és 409-et, meghívást és meghívásos mentést. A böngészőteszt 390 px mobilnézetben két kattintással indít, a szerveren sikeres mentés válaszát mesterségesen elveszíti, majd tulajdonosi lezárás után próbál újra. Egyetlen bejegyzés marad. A böngészőnézet nem valódi telefon.

## Helyi használat ezen a gépen

Futva hagyott cím: `http://localhost:3001/wedding`.

Fiktív helyi tesztfiók belépési adatai: `C:\Users\Laci\Documents\ChatGPT\Memorybook\pilot-state\pilot-login.local.txt`. A jelszó nem szerepel a repositoryban vagy a jelentésben. Belépés után a fióknak van explicit pilot-létrehozási joga. A próbaüzenetek csak a külön helyi adatbázisban élnek.

Újraindításhoz a PostgreSQL (ha nem fut):

```powershell
& 'C:\Users\Laci\Documents\ChatGPT\Memorybook\pilot-state\pgsql\bin\postgres.exe' -D 'C:\Users\Laci\Documents\ChatGPT\Memorybook\pilot-state\pgdata' -h 127.0.0.1 -p 55439
```

Másik PowerShell ablakban, a checkoutból:

```powershell
$env:DATABASE_URL='postgresql://memorybook_test@127.0.0.1:55439/memorybook_wedding_pilot'
$env:NODE_ENV='development'
$env:WEDDING_LOCAL_DATABASE_ACK='yes'
node --import tsx scripts/wedding-pilot.ts --grant-email=wedding-pilot@example.test
```

A gépen a Node elérhető, az npm nem volt a PATH-on; ezért az útmutató közvetlen Node-parancsokat is tartalmaz. Az auth-titok minden indításkor új, újból be kell jelentkezni. Ha a port foglalt, ne indíts második példányt. A klaszter csak helyi fiktív adatokhoz készült, loopback trust hitelesítéssel; nem éles telepítési konfiguráció.

A részletes indítás, kapcsolók, migrációs szerződés, LAN-opció és telefonos lépések: [WEDDING_PILOT.md](WEDDING_PILOT.md).

## Nyitott feltételek

1. Fizikai Android és iPhone elfogadás, tényleges QR-beolvasással és billentyűzettel.
2. Az örökölt teljes lint-hibák külön munkarészben rendezendők; ez az M1 nem állít zöld teljes repository-lintet.
3. LAN/tűzfal környezet ellenőrzése a telefonos próba előtt; jelenleg csak a localhost cím igazolt.
4. Többfolyamatos üzemi rate limit, valódi fizetős esküvői jogosultság, jelszó-visszaállítás/értesítés és a későbbi média/AI/export/megőrzés nem része ennek a pilotnak.

Nem állítunk éles kiadási készültséget vagy teljes termék-PASS-t. A most elkészült M1 kód és az automatizált próbák helyben áttekinthetők és folytathatók.
