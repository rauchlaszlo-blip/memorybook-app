# Adatmegőrzés és költözés – 2026. november 28.

## Állapot: átállítva; újraindítás és leállított forrás melletti működés PASS

Az új anyaggyűjtő pilot már a meglévő fizetős PostgreSQL-példány külön
adatbázisát használja. A teljes forrásmentések, helyi próba-visszaállítások,
célba visszaállítás, jogosultsági ellenőrzés és az első fiktív HTTPS-beküldés
**PASS**. Az újraindítás és a leállított forrás melletti ismételt HTTPS-próba is
**PASS**. Az ideiglenes hálózati hozzáférést visszavontuk; a forrás megmaradt,
ismét elérhető a Render belső hálózatán, külső IP-engedélylistája üres.
Az ellenőrzött MemoryBook-adatok és a három alkalmazás működése már nem függ
a december 7-én lejáró adatbázistól.
Új fizetős erőforrás, tárhelybővítés és modellhívás nem indult.

## Jelenlegi kapcsolatok és változatlan hozzáférés

| Szolgáltatás | Példány | Logikai adatbázis / séma |
| --- | --- | --- |
| `memorybook-app` | fizetős `dpg-daatfdjtqb8s73b5qk20-a` | `memorybook_db`, változatlan |
| `memorybook-wedding-text-pilot-ukd0` | ugyanaz a fizetős példány | `memorybook_wedding_internet_pilot`, változatlan |
| `memorybook-collection-pilot-20261127` | ugyanaz a fizetős példány | új `memorybook_collection_pilot`, kizárólag `collection_pilot_20261127` séma |

A lejáró `dpg-dbng6e3rjlhs738nntd0-a` teljes adata és mentése megmarad; nem
töröltük. Lejárata 2026. december 7. 11:53:45 magyar idő. Az új gyűjtő már nem
ezt az adatbázist használja. A forráspéldány felfüggesztése mellett az új gyűjtő
újraindult, és az ismételt HTTPS-próba is sikeres volt.
Ugyanekkor a hagyományos alkalmazás adatbázist használó `/api/health` végpontja
15:07:07 UTC-kor, a régi pilot `/healthz` végpontja 15:07:45 UTC-kor HTTP 200
választ adott. A forrást ezután visszakapcsoltuk; a Render állapota `available`,
`not_suspended`, `ipAllowList=[]`, módosítási ideje 15:09:23 UTC.

A gyűjtő címe változatlan:
<https://memorybook-collection-pilot-20261127.onrender.com>.
A tulajdonosi próbabeállítás mentett lejárata **2027. január 31. 23:59:59
magyar idő**, azaz `2027-01-31T22:59:59Z`. A könyvazonosító, tulajdonos, cím,
vendégkulcs és tulajdonosi kulcs/hash változatlan; jogosultságbővítés nincs.
A régi süti lejáratát az eredeti tulajdonosi próbalink újbóli megnyitása frissíti.
A vendégoldalak külön, 14 napos szerkesztési szabályát ez nem hosszabbítja meg.
Titkos kapcsolatérték vagy belépési kulcs nem szerepel ebben a dokumentumban.

LIVE: `dep-dc5el3ui0phs73dg1c7g`, `b407248`, 2026-11-28 14:53:01 UTC.
A HTTPS `/api/health` 200-as választ és adatbázis-időt adott. A fizetős célon
tényleges alkalmazáskapcsolat látszott `memorybook_collection_app` felhasználóval,
14:52:55.787 UTC kapcsolódási idővel; ez külön bizonyítja a futó kapcsolat célját.
Az éles `main` továbbra is `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`.

Nincs külön MemoryBook cron vagy worker. A régi pilot PDF-feldolgozója saját
folyamatában fut; az új gyűjtő feldolgozása kéréshez kötött. A régi Blueprint
szüneteltetett, automatikus szinkronja kikapcsolt. A régi ág `d3bc49d` módosítása
a `DATABASE_URL`-t `sync: false` értékkel kezeli; a kézzel beállított kapcsolat
így meglévő szolgáltatásnál megmarad. A régi adatbázis deklarációja archivált
hivatkozásként megmaradt; Blueprint-szinkron és törlés nem történt.
[Render hivatalos szabály](https://render.com/docs/blueprint-spec#setting-environment-variables).

## Teljes mentések és visszaállítási bizonyíték

Védett, a Render erőforrásaitól független helyi könyvtár:
`C:\Users\Laci\MemoryBook-private-backups\20261128\`.
A `20261126` könyvtár is megmarad. Ez a számítógép helyi lemeze, nem a Render
átmeneti fájlrendszere; nem jelent külön földrajzi helyen őrzött másolatot.

| Mentés | Méret | Táblák | Valódi helyi visszaállítás |
| --- | ---: | ---: | --- |
| `paid-main-before.dump` | 13 544 874 bájt | 13 | PASS |
| `paid-wedding-before.dump` | 34 151 808 bájt | 36 | PASS |
| `source-initial.dump` | 35 699 711 bájt | 51 | PASS |
| `source-final.dump` | 35 699 711 bájt | 51 | PASS |
| `collection-final.dump` | 3 021 364 bájt | 15 | PASS |

SHA-256:

- `paid-main-before.dump`: `62d041befe40e87a6c954fb48757ad1171ce647248518bece46cb29c5f74b93d`
- `paid-wedding-before.dump`: `43c732478b590ee47842165d9d79a987c88ad146a9fe65baf9d26fe635d51fee`
- `source-initial.dump`: `d191d21824e89790e0ee96172a0dba45b9ccfc915bc486a3c614082377ec1786`
- `source-final.dump`: `771f8b083e498394e2b1b595c96e862c117d64e52b0c540c29c2d34871cb570e`
- `collection-final.dump`: `0da0915f5cbbe3d55934124e2cb22aa02b485deb60d575bf5d71a2bbcdf6b979`

Minden mentés teljes PostgreSQL custom archívum, konzisztens pillanatképből,
az összes felhasználói sémával. A forrásban 36 régi `public` és 15 gyűjtőtábla
van. A végső mentés előtt csak a gyűjtő szolgáltatását függesztettük fel;
14:40:52 UTC-kor aktív alkalmazáskapcsolat és tranzakció nem maradt.
Az induló és végső forrás táblái, bináris tartalma, szerkezete, szekvenciái
és konfigurációja egyeznek. A külön helyi visszaállítások az adatok, bináris
tartalom, szerkezet és szekvenciák egyezését igazolták. A helyi tulajdonos,
ACL-ek és szerepkör-beállítások szándékosan eltérnek; ezt a jelentések
`configurationChanged=true` értékkel jelzik.

PostgreSQL 17 → 18 összevetésnél kizárólag a NOT NULL feltételek új katalógus-
bejegyzéseinek eltérése normalizált. Minden oszlop nullázhatósága és minden
egyéb feltétel továbbra is összehasonlított; a valódi eltérést a teszt elutasítja.
A jelszavak nem részei a leltárnak; szerepkör-/ACL-beállításokat nem játszunk
vissza automatikusan a közös fizetős példányra.

A forrás régi `public` sémájának mind a 308 sora megtalálható a fizetős régi
pilotban; ott további 3 sor van. A forrás nem írta felül ezt a frissebb állapotot.
A régi pilot 53 eredeti médiájának és 30 fagyasztott médiapillanatképének,
összesen **83 bináris elemének** SHA-256 ellenőrzése PASS. A kész PDF,
szerkesztési adatok, előnézetek, audit és feltöltési állapotok is megmaradtak.

A hagyományos alkalmazás 62 Cloudinary-fájlja újra letöltve: a méretek és SHA-k
egyeznek a korábbi másolattal (7 647 930 bájt). Két WebP-borító és egy profilkép
külön mentve. Ezek származtatott képek is lehetnek, nem minősítjük őket utólag
eredeti feltöltésnek. Könyvtárak: `paid-main-cloudinary-fresh/`,
`paid-main-supplemental-media/`. A gyűjtő API-vészmentése:
`collection-owner-emergency-beforemigration-20261128/`; ez a teljes dumpot
nem helyettesíti, mert részleges darabok és belső állapotok kimaradhatnak belőle.

## Elkülönített cél és tényleges átállás

Új logikai adatbázis: `memorybook_collection_pilot`; tulajdonosa és alkalmazás-
szerepköre `memorybook_collection_app`, legfeljebb 10 kapcsolat. Nem superuser,
nem hozhat létre szerepkört/adatbázist, nincs öröklés, replikáció vagy RLS-megkerülés.
A cél adatbázisból a PUBLIC CONNECT/CREATE/TEMP, a `public` sémából a PUBLIC
CREATE visszavonva. A séma keresési útvonala kizárólag `collection_pilot_20261127`.

Az ideiglenes admin SET-tagság megszűnt. Egy pontosan ellenőrzött PostgreSQL-
létrehozói sor marad: `postgres` adta a `memorybook_db_user` szerepkörnek az új
szerepkör ADMIN opcióját, **INHERIT=false, SET=false** értékekkel. Az alkalmazás
egyik másik szerepkörnek sem tagja. A régi alkalmazásszerepkörök nem kapcsolódhatnak
az új adatbázishoz és nem válthatnak át az új szerepkörre.

Az új szerepkör a régi adatbázisokban meglévő PUBLIC CONNECT/TEMP jogot örököl,
de védett táblához, séma-létrehozáshoz vagy SECURITY DEFINER rutinon át nincs
hozzáférése. A két régi védett táblára végzett `SELECT ... LIMIT 0` próbát a
szerver 42501 jogosultsági hibával elutasította; felhasználói tartalmat nem olvastunk.
A régi ACL-eket és alapbeállításokat nem módosítottuk; normál munkameneteik
`default_transaction_read_only=off` értéke változatlan.

A végső archívumból egy tranzakcióban, `--clean` nélkül pontosan 15 gyűjtőtábla,
5 bináris oszlop és 1 szekvencia állt vissza. Az ellenőrzött TOC-lista a séma
létrehozását is tartalmazza; a régi `public` tartalom nem került a célba.
Adat-, szerkezet- és szekvenciaegyezés PASS. Mindhárom korábbi eredeti fájl
azonosítója, könyv-/oldalkapcsolata, mérete és SHA-256 lenyomata pontosan egyezik.
Nincs külső sémafüggőség vagy nagyobjektum; a PL/pgSQL beépített függőség.

A létrehozási kapacitáskapu 116 246 650 bájt mért adatbázisméret és 64 MiB
tartalék mellett 183 355 514 bájttal számolt, a 400 000 000 bájtos védelmi
határ alatt. A szolgáltatói 1 GB-os tárhely kezdeti foglaltsága 19,3% volt;
az automatikus tárhelybővítés kikapcsolva maradt.

Az első HTTPS-próba egy új, jelölt fiktív beküldést használt, JPEG/hang/videó
fájllal. Feltöltés, ismétlésvédelem, véglegesítés, tulajdonosi eredetiletöltés,
lejátszás és jogosultsági próbák PASS. Az új oldal és három fájl csak a fizetős
célon található; a forrás helyben visszaállított másolatában egyik sem létezik.
A régi három eredeti változatlan. A forrás zárolásakor mind a 15 gyűjtőtábla
egyezett a végső mentéssel; feloldás után a teljes 51 táblás leltár is változatlan.

A gyűjtő új példánya 15:05:00 UTC-kor indult, 15:05:17-kor állt készen.
A felfüggesztett forrás mellett ugyanazon próbaellenőrzés ismétlése PASS;
nem keletkezett új oldal, fájl vagy beküldés. A tartalom, minden bináris adat,
szerkezet és a korábbi használati napló változatlan. A szigorú teljes leltár
egyetlen várt eltérést jelzett: a QR-ellenőrző GET egy `qr_opened` naplósort
fűzött hozzá (9 → 10), és növelte a kapcsolódó szekvenciát. Ezt nem rejtettük el:
a korábbi 9 sor hash-egyezése és az egyetlen új esemény külön igazolt.

A végső célmentés már mind a 6 eredetit tartalmazza: a 3 megőrzött és a 3 új
fiktív fájlt. Mindegyik azonosítója, mérete és SHA-256 lenyomata egyezik a friss
helyi visszaállítással. Az újraindítás utáni állapot és a végső mentés teljes
adat-/szerkezet-/szekvenciaegyezése PASS. A két régi fizetős adatbázis adatai,
szerkezete, szekvenciái, meglévő szerepkörei és saját beállításai változatlanok;
a globális szerepkörleltár kizárólag az engedélyezett új gyűjtőszerepkörrel bővült.

Az ideiglenes, kizárólag a mentőgép aktuális `/32` címére szóló forrásengedély
megszűnt; a kezelőfelület is 0 engedélyezett tartományt mutat. A fizetős példány
korábban meglévő `0.0.0.0/0` szabályát nem módosítottuk, tehát nem állítjuk, hogy
annak külső elérése is tiltott. A fizetős csomag változatlan: `0.1c-256mb`, 1 GB,
automatikus bővítés nélkül. Az éles és a régi pilot szolgáltatásbeállításainak
módosítási ideje is változatlan maradt.

## A leltár határai

A forráspéldányon az alkalmazás-adatbázison kívül csak `postgres`, `template0`
és `template1` volt. A `postgres` szolgáltatói adatbázis nem üres: benne
`postgres` tulajdonú `public.primarytable`, továbbá `render_mgmt` tulajdonú
SCRAM-nézet és rutin található. Azonos szolgáltatói objektumok vannak a fizetős
példányon. Alkalmazásszerepkör tulajdonában levő objektumot, nagyobjektumot vagy
egyéni bővítményt itt nem találtunk. A szolgáltatói tábla sorainak olvasását a
42501 jogosultsági hiba tiltotta; tartalmát és hitelesítési hash-eket nem
olvastunk vagy másoltunk. Ez nem az 51 alkalmazástábla mentésének hiányossága,
hanem a Render belső üzemeltetési adatainak elkülönítése.

Fő bizonyítékok a védett könyvtárban: `*.backup.json`, `*.manifest.json`,
`*.sha256`, `*.toc.txt`, `source-final.collection-restore.json`,
`source-final.collection-originals.json`, `collection-target-created.json`,
`target-restored-isolation.isolation.json`, `cutover-runtime-proof-confirmed.json`,
`migration-fixture-location-confirmed.json`, `collection-before-restart.manifest.json`.
A korábbi, túl szigorú guard-névfelismerésből adódó jelentések is megmaradtak;
a külön javított bizonyíték az ellenőrzött konkrét kapcsolatot azonosítja.
HTTPS-részletek: `test-results/collection-release-20261127/runs/migration-20261128/`.
Záró bizonyíték: `collection-restart-classified-comparison.json`,
`collection-final-original-integrity.json`, `legacy-config-after.json`,
`collection-final-local-restore.local-restore.json`, `paid-main-after.manifest.json`,
`paid-wedding-after.manifest.json`.
További bizonyíték: `source-postgres-classification.postgres-objects.json`,
`paid-postgres-classification.postgres-objects.json`,
`https-verification-migration-20261128/`, `final-render-state.json`.
A végső segédprogramok külön, változatlan példánya: `recovery-tools-completed/`.

## Visszaállás és hátralévő ellenőrzések

1. Hiba esetén csak a gyűjtő új írásait állítsuk le. Először a **jelenlegi fizetős
   célról** készüljön új teljes mentés és fájlonkénti leltár; az új beküldés már
   nincs benne a régi forrásmentésben. Ne állítsuk egyszerűen vissza a régi URL-t.
2. Szükség esetén az aktuális célmentésből új, üres, elkülönített adatbázisba
   állítsunk vissza a működő fizetős példányon. Az eredetik, részleges darabok,
   nyugták, szerkeszthető adatok és azonosítók együtt maradjanak meg. Egyezés és
   hozzáférési ellenőrzés után változhat a szolgáltatás kapcsolata.
3. December 7. után a lejárt ingyenes adatbázis nem visszaállási cél. A megtartott
   dumpokból helyi vagy külön, ellenőrzött fizetős logikai adatbázisba lehet
   visszaállni. A forrást, dumpokat, kapcsolatfájlokat és korábbi bizonyítékokat
   nem töröljük, és a visszaállítást nem végezzük `--clean` paranccsal meglévő célon.

A kipróbált helyi visszaállítás parancsa a munkakönyvtárból:

```powershell
node pilot-state/preservation-20261128.cjs localrestore collection-final collection-recovery-new --ack-local-only
```

A címke minden futásnál új legyen; a program meglévő kimenetet nem ír felül,
és csak új, véletlen nevű adatbázist hoz létre a `127.0.0.1:55448` ellenőrző
PostgreSQL 18 szerveren. Szükséges a meglévő Node-környezet `pg` függősége,
a megőrzött `20261126/postgresql18/pgsql/bin` eszközkészlet és a védett helyi
kapcsolatfájl. A script elején rögzített helyi útvonalakat másik gépen ellenőrizni
kell. A mentés előtt és visszaállítás után SHA-256, teljes tábla-/szerkezet-/
szekvencia- és bináris összevetés történik. A szerepkörök jelszavait nem állítja
vissza a dump: azokat a megőrzött privát kapcsolatfájlokból vagy új, szűk
jogosultságú szerepkörrel kell külön biztosítani. A közös példány globális
szerepköreit soha nem szabad vakon visszajátszani.

Friss teljes célmentéshez ugyanennek a segédprogramnak a
`backup collection-target <új-egyedi-címke>` művelete használható; a mentést
mindig új `localrestore` ellenőrzés kövesse. A 2026. november 28-i dumpok
pillanatképek, nem helyettesítik a később érkező beküldések rendszeres mentését.

- **PASS:** újraindítás utáni tartalom- és eredetiegyezés; az egyetlen új
  QR-használati naplósor külön, a szigorú eltérés megtartásával ellenőrzött.
- **PASS:** a felfüggesztett lejáró forrás melletti ismételt HTTPS-működés.
- **PASS:** az ideiglenesen jóváhagyott `/32` hálózati kivétel visszavonása,
  a teljes külső tiltás és a forrás megőrzött, újraindult állapota.
- Fizikai Samsung/Chrome és iPhone/Safari átvétel továbbra is **NYITOTT**;
  a szimulált böngészőméret és szintetikus média nem fizikai telefonos PASS.
