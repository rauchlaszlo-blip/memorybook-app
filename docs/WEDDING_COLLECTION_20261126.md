# Esküvői anyaggyűjtés – átadási munkalap, 2026-11-26

Ez a november 26-i fejlesztési állapot leírása. A november 27-én engedélyezett
külön HTTPS-kiadás aktuális eredményei: [kiadási munkalap](COLLECTION_PILOT_RELEASE_20261127.md).

Fejlesztési ág: `codex/wedding-collection-20261126`. Kiindulás: a GitHubról
2026-11-26-án frissített `main`, `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`.
A korábbi `codex/wedding-internet-pilot` munkapéldány, a main és a telepített
alkalmazások változatlanok. Ez a fejlesztés nincs telepítve.

Irányadó: a november 26-i felhasználói kérés és a
[MemoryBook mester tudástár](https://docs.google.com/document/d/1ja54ZD95pi_IQWWanMdvhI8badtkE8dqnj7NJXzb-QE).
Az ellenőrzött repositoryban és szülőkönyvtáraiban nem volt `AGENTS.md`.
A mester korábbi PASS-jelölései történeti eredmények, nem e változtatás tesztjei.
Az AI-integráció és a könyvrendezés nem része ennek a munkaszakasznak.

## Elkészült működés

- A meglévő rendezvény-QR, `/join/:token` és `/p/:token` útvonal, a fotó-,
  szöveg- és Fabric-rajzszerkesztő megmarad. A hagyományos és dedikációs
  könyvek nem lépnek be az új gyűjtési API-ba.
- A rendezvényoldalhoz egy beküldési csoport és több külön fájl tartozik.
  A szerkesztő fotója az eredeti feltöltése után kap tömörített vászonváltozatot;
  a `collectionAssetId` összekapcsolja a szerkeszthető képet az eredetivel.
- Hang- és videófájlválasztás, támogatott böngészőben közvetlen felvétel,
  visszajátszás, eltávolítás és új felvétel. A felvételhez tudatos indítás kell;
  a megtekintő nem indít automatikusan hangot/videót. Engedélyhiba esetén a
  fájlválasztás elérhető marad. Háttérbe kerüléskor/leállításkor megszűnik
  a kamera és mikrofon használata.
- HU/EN/DE feliratok; előre látható, konfigurációból érkező darab-, méret- és
  időkorlátok. Sorrendezhető esemény- és helyszínlisták, „Nincs megadva” választás.
- A végleges **Beküldés** előtt a vászon mentése lezárul. Egy adatbázis-tranzakció
  rögzíti a beküldést, az oldalt, a vendégadatokat, az esemény/helyszín akkori
  megnevezését, a szerkeszthető JSON-t és a privát JPEG-előnézetet.
  Siker kizárólag a megfelelő beküldésazonosítót tartalmazó tartós nyugta után jelenik meg.
- A hiba nem bontja le a már betöltött szerkesztőt. A fájl UUID-ja, SHA-256 lenyomata,
  az elkészült darabok és a véglegesítés kulcsa teszi ismételhetővé a kéréseket.
  A hálózati válasz elvesztése után állapotlekérdezés egyezteti a mentést.
- A tulajdonosi könyvoldalról nyílik a `/my-books/:bookId/materials` lista:
  beküldő-, dátum-, esemény-, helyszín- és állapotszűrés; részleges/feldolgozás
  alatti/hibás anyagok; lejátszás, eredetiletöltés és feldolgozás újrapróbálása.
- Az összes letöltés ZIP-et, `manifest.json` adatjegyzéket és `snapshots.json`
  szerkeszthető pillanatképeket ad. A fájl- és beküldésazonosítók megőrzik a
  kapcsolatokat. Az eltávolított mellékletek nincsenek a beküldés ZIP-jében;
  korábban feltöltött bájtjaik külön megmaradnak.

## Tárolás, adatok, jogosultság

Az additív `collection_*` táblák a meglévő TEXT könyv- és oldalazonosítókhoz
kapcsolódnak. Az eredeti bájtok, ideiglenes feltöltési darabok, előnézetek,
lejátszási változatok és pillanatképek PostgreSQL-ben maradnak; a szerver átmeneti
fájlrendszere csak a dekódolás alatt használatos. Új tárhelyszolgáltatás nincs.
A migráció tranzakciós és ismételhető; nem nevezi át a régi tömörített képeket
eredetinek. A régi oldalak és Cloudinary-anyagok külön, nem igazolt eredetiségű
előzményként látszanak.

A teljes fájl szerveroldali SHA-256 ellenőrzése után a tényleges dekóder ellenőrzi
a formátumot, képméretet, hang- és videóképkockákat, valamint az időtartamot.
A MIME-becslés külön marad a megállapított típustól. Az eredetit a feldolgozás
nem írhatja át; adatbázis-trigger védi. A JPEG-előnézet és az MP4-lejátszási
változat külön származtatott fájl, nem az eredeti.

A készítési idő kizárólag olvasható EXIF/container metaadatból jön. Az időzóna
nélküli EXIF-idő időzóna nélküli szövegként marad, külön forrásjelöléssel.
A hiányzó idő `null`; sem a feltöltés ideje, sem a böngésző `lastModified` értéke
nem helyettesíti. A metaadat kamerába írt adat, nem hitelesített időbizonyíték.
A böngésző eszközazonosítója csak keretkezelési jel, nem igazolt személyazonosság.

Minden tulajdonosi lekérés a meglévő Better Auth munkamenetet és a könyv
tulajdonosát ellenőrzi. Vendég csak a saját oldalmeghívójának fájljaihoz fér hozzá;
a könyv közös QR-linkje nem ad tulajdonosi jogosultságot. Az eredetiket nem
szolgálja ki nyilvános statikus könyvtár. Privát/no-store válaszok, lejáratellenőrzés,
Origin-védelem és védett Range-lejátszás működik. A megosztási hozzájárulás régi
szabályai megmaradnak; ez a gyűjtési fázis nem hoz létre új nyilvános kiadást.

256 KiB-os darabokkal folytatható a feltöltés. Azonos darab ismétlése nem dupláz;
eltérő bájt ugyanazzal az azonosítóval hibát ad. A dekódolás tartós, lejáró
foglalást használ. Újraindításkor a félbemaradt feldolgozás látható és újrapróbálható.
A sikertelen dekódolás eredeti bájtjai a tulajdonos számára letölthetők maradnak.
Az eltávolítás nem fizikai törlés; a megtartott bájtok tárhelyet foglalnak.

## Konfiguráció

A korábbi `DATABASE_URL`, Better Auth, HTTPS és Cloudinary-beállítások továbbra
is szükségesek a teljes meglévő alkalmazáshoz. Jelszót/kulcsot csak szolgáltatói
titoktárba vagy figyelmen kívül hagyott helyi környezeti fájlba szabad tenni.

| Változó | Alapérték |
|---|---:|
| `COLLECTION_PHOTO_MAX_BYTES` | 25 MiB |
| `COLLECTION_AUDIO_MAX_BYTES` | 20 MiB |
| `COLLECTION_VIDEO_MAX_BYTES` | 64 MiB |
| `COLLECTION_MAX_DURATION_SECONDS` | 20 másodperc |
| `COLLECTION_PHOTO_MAX_COUNT` | 10 / böngészőazonosító / könyv |
| `COLLECTION_AUDIO_MAX_COUNT` | 2 / böngészőazonosító / könyv |
| `COLLECTION_VIDEO_MAX_COUNT` | 2 / böngészőazonosító / könyv |
| `COLLECTION_BOOK_MAX_BYTES` | 200 MiB |
| `COLLECTION_TOTAL_MAX_BYTES` | 600 MiB |
| `COLLECTION_FFMPEG_PATH`, `COLLECTION_FFPROBE_PATH` | csomagolt helyi binárisok |

A megengedett maximumokat a szerver is korlátozza. Az adatbázis teljes méretére
700 MiB-os védelmi határ érvényes. A tárhelykeret az eredetik, megtartott darabok,
származtatott fájlok és pillanatképek együttesére vonatkozik. A fenti kis
alapkeret korlátozott esküvői próba számára való: a vendéglétszámhoz és tényleges
fájlméretekhez szükséges kapacitást élesítés előtt fel kell mérni. Fizetős
kapacitást ez a változtatás nem rendel és nem aktivál.

Támogatott: JPEG/PNG/WebP fotó (legfeljebb 40 MP), támogatott Google Motion Photo
JPEG-boríték, H.264/HEVC MP4/MOV és VP8/VP9 WebM videó legfeljebb 1080p/60 fps,
AAC MP4/M4A, Opus/Vorbis WebM/Ogg, PCM WAV hang legfeljebb 48 kHz/stereo.
HEIC/HEIF, MP3, 4K videó, speciális Samsung SEF és további Motion Photo
változatok elfogadása nincs megvalósítva/igazolva. Az ilyen fájl nem kap hamis
sikerjelzést; a fájlválasztás és a támogatott új felvétel továbbra is elérhető.
Részleges helyi böngészőtárolás nem jelent garantált offline beküldést.

## Mentés és visszaállítás

1. A teljes PostgreSQL-adatbázisról titkosított, hozzáférésvédett célra készüljön
   `pg_dump --format=custom --no-owner --no-acl --file <mentés.dump> <adatbázis>`.
   A kapcsolati adatokat környezeti változó vagy szolgáltatói titoktár adja;
   jelszó ne kerüljön parancsargumentumba, naplóba vagy repositoryba.
2. Az összes alkalmazástábla együtt kell: `books`, `pages`, meghívók, kapcsolódó
   felhasználói/jogosultsági adatok és minden `collection_*` tábla. A feltöltési
   darabok is szerepeljenek, különben a folyamatban lévő feltöltés nem folytatható.
3. A korábbi Cloudinary-fájlok nincsenek az adatbázismentésben, csak a hivatkozásuk.
   Ezekhez külön szolgáltatói mentés/export és URL/azonosító-jegyzék szükséges.
   Az új gyűjtési eredetik és privát pillanatképek teljes bájtjai benne vannak.
4. Visszaállítás először új, üres, elkülönített adatbázisba:
   `pg_restore --exit-on-error --no-owner --no-acl --dbname <cél> <mentés.dump>`.
   Ne használj éles adatbázison `--clean` opciót ellenőrizetlenül.
5. Ellenőrizd a darabszámokat, könyv/beküldés/fájl kapcsolatokat, a meghívó- és
   tulajdonosi elkülönítést, valamint minden eredeti SHA-256 lenyomatát a tárolt
   lenyomattal. Próbálj folytatni egy fiktív félbemaradt feltöltést.
6. A futó alkalmazást és a szolgáltatói titkokat csak az ellenőrzött visszaállítás
   után irányítsd át. A forrásadatbázist és az előző mentést addig őrizd meg.

A helyi automatizált próba két új, kizárólag fiktív adatbázis között tényleges
PostgreSQL 17.11 `pg_dump`/`pg_restore` műveletet végzett. Az eredeti SHA-256,
a szöveg/rajz, a beküldési nyugta és a részleges feltöltési darab visszaállt.
Ez nem szolgáltatói vagy éles Cloudinary-visszaállítási teszt.

## Telefonos átvétel – Android/Chrome és iPhone/Safari külön

Mindkét fizikai készüléken, az engedélyezett külön HTTPS-telepítés után:

1. Nyisd meg a QR-t mobilinterneten, belépés nélkül. Ellenőrizd a könyv címét,
   a korlátokat, majd válassz eseményt/helyszínt vagy „Nincs megadva” értéket.
2. Készíts fotót és válassz galériából másikat. Az egyikhez adj szöveget és
   kézírást/rajzot. Távolíts el egy mellékletet; a többi maradjon meg.
3. Készíts hangot és videót, hallgasd/nézd vissza, töröld a kiválasztásból és
   vedd újra; próbáld ki a fájlválasztást is. Ellenőrizd a 20 másodperces határt.
4. Tagadd meg az engedélyt, válts háttérbe felvétel közben, majd térj vissza.
   A készülék kamera/mikrofon-jelzője álljon le; fájlt továbbra is lehessen választani.
5. Repülő móddal szakíts meg nagyobb feltöltést; visszakapcsolás után próbáld
   újra, és frissítés után is ellenőrizd a folytatást. A végleges Beküldésre
   koppints kétszer. Egy beküldés és egy fájlazonosító maradjon fájlonként.
6. A tulajdonos másik készüléken lássa az állapotokat és a végleges anyagot;
   szűrj névre/dátumra/eseményre/helyszínre, nyisd meg a rajzot, játszd le az AV-t.
7. Töltsd le az eredetiket és a ZIP-et. Számítógépen SHA-256-tal hasonlítsd össze
   a kiinduló fájlokkal; a szöveg/rajz JSON és az azonosítókapcsolatok legyenek a csomagban.
8. Kijelentkezve és másik tulajdonossal az eredetiletöltés legyen tiltva.

Fizikai Android/Chrome: **NYITOTT**. Fizikai iPhone/Safari: **NYITOTT**.
Új HTTPS-telepítés, mobilinternetes teszt, éles felhasználói Google/OAuth-belépés,
éles Cloudinary mentés/visszaállítás és esküvői terheléspróba: **NYITOTT**.
Ezekre a helyi automatizált próbák nem jelentenek PASS-t.

## Ellenőrzési eredmények

Végleges futás a javított függőségekkel: **23/23 PASS, 0 kihagyott teszt**.

| Ellenőrzés | Eredmény |
|---|---|
| Média: tényleges típus, sérült fájl, méret/pixel/időkorlát, EXIF, külön MP4, ZIP-bájtok | 6/6 PASS |
| Valódi PostgreSQL: darabfolytatás, ismétlés, eredetivédő trigger, könyvelkülönítés, CSRF, Range, lejárat, pillanatképek, kvótaverseny, lejárt feldolgozó, szöveges piszkozat | 8/8 PASS |
| Tényleges pg_dump/pg_restore, eredeti SHA, részleges darab és szerkeszthető adatok | 1/1 PASS |
| Teljes main-szerver indítása, régi standard/event/dedication véglegesítés, új guard, valódi Better Auth sütik két fiktív tulajdonossal | 1/1 PASS |
| Vendég teljes felülete: válaszvesztés, megszakítás, IndexedDB/sessionStorage hiba, szimulált eszközzel valódi Chrome MediaRecorder, hibás mentés, HU/EN/DE | 4/4 PASS |
| Tulajdonosi felület: szűrés, frissülő állapot, konfliktus, letöltés, jogosulatlan API-válasz, időzóna, 390 px nézet | 2/2 PASS |
| Böngésző + valódi gyűjtési API/PG/dekóder: 3 média egy beküldés, pontos eredetiletöltés, hang/videó lejátszás, újratöltött nyugta | 1/1 PASS |
| `tsc -b` és Vite 8.2.4 produkciós build | PASS |
| `tsc -p tsconfig.collection.json`, új modulok/tesztek és érintett meghívóoldal ESLint | PASS |
| FFmpeg/ffprobe helyi indíthatóság | PASS |
| `git diff --check` | PASS |
| npm függőségaudit a kompatibilis frissítések után | 0 ismert sérülékenység |

A böngészős szerződéstesztekben az API válaszai szimuláltak. A külön teljes
böngészős folyamat valódi gyűjtési API-t, adatbázist, dekódert és lejátszást használ;
csak a régi Cloudinary vászonmentés helyett kapott helyi, verzióellenőrzött
tesztadaptert. A teljes main-szerver és a valódi Better Auth süti külön tesztben
futott; fiktív helyi email/jelszó-regisztrációval, külső email- vagy Google-hívás nélkül.
A Chromium mikrofonja/kamerája szintetikus eszköz volt, nem fizikai telefon.

A meglévő `MemoryBookEditor.tsx` teljes lintje a kiinduló mainnel egyezően
7 korábbi `any` hibát és 1 hook-figyelmeztetést tartalmaz; ezek nem új eltérések.
A build a nagy közös JavaScript-csomagra figyelmeztet (kb. 262 kB gzip), de sikeres.
Az eredeti ág és a pilot tiszta maradt; a fejlesztés külön munkafában, még
commit/push/deploy nélkül áll áttekintésre.

Az audit a mainből örökölt 18 csomagjelzést talált. Kompatibilis csomagfrissítések
után 0 maradt; többek között Better Auth 1.7.28 és proxy-addr 2.0.8 futott a végső
regresszióban. A build a javított Vite 8.2.4 ágon maradt. A Windows
alkalmazásvezérlési házirendjét nem módosítottuk. Az audit 0 nem teljes biztonsági audit.

Helyi reprodukálás PowerShellben, előre elkészített, kizárólag tesztadatokat
tartalmazó loopback PostgreSQL-adatbázissal:

```powershell
npm ci
npm run build
npm run typecheck:collection
node --import tsx scripts/check-collection-media.ts
$env:DATABASE_URL = '<helyi, _test végű tesztadatbázis kapcsolati címe>'
$env:WEDDING_LOCAL_DATABASE_ACK = 'yes'
$env:COLLECTION_TEST_DATABASE_URL = $env:DATABASE_URL
$env:COLLECTION_PG_BIN = '<PostgreSQL pg_dump/pg_restore bin könyvtára>'
npm run test:collection
npm run test:collection:browser
```

Az adatbázistesztek saját véletlen sémát, a visszaállítási teszt két saját
ideiglenes adatbázist használ, és csak ezeket takarítja ki. A tesztfelhasználónak
ehhez helyi sémalétrehozási, a visszaállítási teszthez adatbázis-létrehozási jog kell.
Ne irányítsd ezeket a teszteket éles vagy valódi pilotadatbázisra.
A böngészős tesztek telepített asztali Chrome-ot használnak.

Helyi részletes bizonyíték: `test-results/collection/final-tests.log`.
Képek: `test-results/collection-owner/mobile.png`,
`test-results/collection-guest/mobile-unconfirmed.png`,
`test-results/collection-guest/actual-api-ready.png`.

Telepítés előtt még szükséges: a kész változtatás tulajdonosi áttekintése,
a meglévő tesztkörnyezet adatbázis-kapacitásának és mentésének ellenőrzése,
a migráció és médiaeszközök ellenőrzése azon a környezeten, majd külön HTTPS-es
telefonos átvétel. Új fizetős infrastruktúra vagy modellhívás nem indult.
