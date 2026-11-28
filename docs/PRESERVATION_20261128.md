# Adatmegőrzés és költözés – 2026. november 28.

## Állapot: folyamatban, a lejáró forrás átállítása még nem történt meg

A tulajdonos engedélyezte a vizsgálatot, mentést és az új anyaggyűjtő pilot
elkülönített átköltöztetését a meglévő fizetős PostgreSQL-példányra. Új fizetős
erőforrás és tárhelybővítés nincs engedélyezve. A forrást és a mentéseket megőrizzük.

## Tényleges kapcsolatok az induláskor

A Render kezelőfelületén az élő `DATABASE_URL` célját külön ellenőriztük, és
összevetettük a mentéshez használt, helyben védett kapcsolatfájlokkal. A titkos
értékek nem kerülnek ebbe a dokumentumba.

| Szolgáltatás | Példány | Logikai adatbázis / séma |
| --- | --- | --- |
| `memorybook-app` | fizetős `dpg-daatfdjtqb8s73b5qk20-a` | `memorybook_db` |
| `memorybook-wedding-text-pilot-ukd0` | ugyanaz a fizetős példány | `memorybook_wedding_internet_pilot` |
| `memorybook-collection-pilot-20261127` | lejáró `dpg-dbng6e3rjlhs738nntd0-a` | `memorybook_wedding_internet_pilot`, `collection_pilot_20261127` séma |

A lejáró példány: 2026. december 7. 11:53:45 magyar idő. Az új pilot tényleges
tulajdonosi próbabeállítása még 2026. december 6. 23:59:59 magyar időig érvényes.
A kért új határidő 2027. január 31. 23:59:59, azaz `2027-01-31T22:59:59Z`.

A szolgáltatásleltárban nincs külön MemoryBook cron vagy worker; az előző pilot
PDF-feldolgozója a saját alkalmazásfolyamatában működik. Az új gyűjtő feldolgozása
kéréshez kötött. A régi Blueprint szüneteltetett, automatikus szinkronja kikapcsolt.
A `codex/wedding-internet-pilot` ág `d3bc49d` javítása a `DATABASE_URL` beállítást
`sync: false` értékre cseréli, hogy egy későbbi kézi szinkron ne állítsa vissza a
lejáró kapcsolatot. A régi adatbázis deklarációja megmarad; szinkron és törlés nem
történt. Az éles `main` továbbra is `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`.

## Elkészült, visszaállítással ellenőrzött mentések

Tartós, a lejáró Render-erőforrástól független helyi könyvtár:

`C:\Users\Laci\MemoryBook-private-backups\20261128\`

Ez a felhasználó számítógépének helyi lemezén található, nem a Render futó
szolgáltatásának átmeneti fájlrendszerén. A november 26-i mentési könyvtár is
változatlanul megmarad. Ez nem külön földrajzi helyen tárolt másolat.

| Mentés | Méret | Táblák | Valódi helyi visszaállítás |
| --- | ---: | ---: | --- |
| `paid-main-before.dump` | 13 544 874 bájt | 13 | PASS |
| `paid-wedding-before.dump` | 34 151 808 bájt | 36 | PASS |

SHA-256:

- `paid-main-before.dump`: `62d041befe40e87a6c954fb48757ad1171ce647248518bece46cb29c5f74b93d`
- `paid-wedding-before.dump`: `43c732478b590ee47842165d9d79a987c88ad146a9fe65baf9d26fe635d51fee`

A mentések teljes PostgreSQL custom archívumok, minden felhasználói sémával.
A dump és a leltár ugyanazt a konzisztens olvasási pillanatképet használta.
Mindkét visszaállítás külön, új helyi PostgreSQL 18 adatbázisba történt. Táblánként
a teljes tartalom SHA-256 lenyomata és darabszáma, minden bináris oszlop, a
szerkezet és a számlálók állapota egyezik. A szerepkörök, jogosultságok és
adatbázis-beállítások külön leltárban szerepelnek; jelszót nem tartalmaznak.
A helyi visszaállítás szándékosan helyi tulajdonost használ, nem játssza vissza a
közös fizetős példány szerepköreit.

Bizonyítékok ugyanitt: `*.manifest.json`, `*.backup.json`, `*.sha256`,
`*.toc.txt`, `paid-main-local-restore.local-restore.json`,
`paid-wedding-local-restore.local-restore.json`.

A hagyományos adatbázisban 64 könyv és 1626 oldal van. A régi esküvői adatbázisban
10 könyv, 62 beküldés, 53 eredeti média, 30 kiadási médiapillanatkép és 1 kész PDF
található. A szerkesztési adatok, előnézetek, audit, jogosultságok és feltöltési
állapotok is benne vannak a teljes mentésben.

Az új gyűjtő működő tulajdonosi felületéről külön vészmentés is készült:
`collection-owner-emergency-beforemigration-20261128/`. Ez a tulajdonosi listát,
adatjegyzéket, ZIP-csomagot, szerkesztési pillanatképet/előnézetet és külön
letöltött eredetiket tartalmazza. Egy beküldés három eredetije összesen
1 087 094 bájt. Mindháromnál az API-ban tárolt SHA-256, a ZIP-ben levő fájl
és a külön eredetiletöltés lenyomata egyezik. A lista és az adatjegyzék a
letöltés előtt/után azonos. Új beküldés vagy könyvátírás nem történt.
A ZIP 6 bejegyzése 1 196 000 bájt; SHA-256:
`7a933aa31cfa19849a74d4e39b35fdf873b86570c09de27df3e92b041b3332b0`.
Ez **nem helyettesíti a teljes adatbázismentést**: részleges feltöltési darabok,
belső állapotok és eltávolított elemek az API-csomagból kimaradhatnak.

A hagyományos alkalmazás hivatkozott képei külön fájlmentésben is megmaradnak.
A 62 Cloudinary-fájlt most ismét letöltöttük: mind a 62 mérete és SHA-256
lenyomata egyezik a korábbi helyi másolattal, eltérés vagy elérhetetlen fájl nincs.
Összesen 7 647 930 bájt, külön új `paid-main-cloudinary-fresh/` könyvtárban.
További két, az alkalmazás címén tárolt WebP-borító és egy profilkép frissen
letöltve, méret/típus/SHA-256 szerint ellenőrizve:
`paid-main-supplemental-media/`. A korábban tömörített vagy átalakított képeket
ez a mentés sem állítja eredeti feltöltésnek.

## Kapacitás

A kezelőfelület a meglévő fizetős 1 GB tárhely 19,3%-os foglaltságát mutatta;
az automatikus tárhelybővítés kikapcsolt. Az adatbázisoldali méretek:
`memorybook_db` 40 335 039, régi esküvői 44 480 191, `postgres` 7 853 759 bájt.
A terv új, külön `memorybook_collection_pilot` logikai adatbázis és
`memorybook_collection_app` korlátozott szerepkör ugyanazon a példányon.
Létrehozásuk a forrás teljes mentésének ellenőrzéséig nem történt meg.

## Visszaállítási és átállási szabályok

1. A forrás minden felhasználói sémájáról teljes mentés és külön helyi
   próba-visszaállítás szükséges; a régi `public` tartalmat is össze kell vetni a
   már átköltöztetett régi pilot adatbázisával.
2. Rövid időre kizárólag az új gyűjtő szolgáltatását kell leállítani; a könyv
   beküldési kapcsolója önmagában nem zár minden szerkesztést. A forrás meglévő
   olvasási alapbeállítása sem fagyasztja be a gyűjtő írható munkameneteit.
3. Aktív írók megszűnése után új végső pillanatkép készül. Csak ebből állítható
   vissza a teljes gyűjtőséma az üres, elkülönített célba. Eredetik, származtatott
   média, szöveg/rajz, részleges darabok, nyugták és azonosítók együtt költöznek.
4. A szolgáltatás címe, könyv- és tulajdonosazonosítója, vendégkulcsa és
   tulajdonosi kulcshashe megmarad. Csak az új pilot adatbázis-kapcsolata és a
   tulajdonosi próba lejárata változhat.
5. Visszaállítás után, az első új írás előtt teljes séma- és fájlonkénti
   méret/SHA-egyezést kell igazolni. Ezután jelölt fiktív HTTPS-beküldés,
   ismétlésvédelem, tulajdonosi letöltés/lejátszás, jogosultságok és újraindítás
   ellenőrzése következik. A régi adatbázisok tartalmát újra össze kell vetni.
6. Új célba érkezett beküldések után a visszaállás nem lehet puszta URL-csere:
   előbb leállítás és új teljes célmentés, majd az új adatokat is megőrző
   visszamásolás szükséges. A régi forrást és a mentéseket nem töröljük.

A helyi `pilot-state/preservation-20261128.cjs` csak pontosan felsorolt célokon
készít mentést/leltárt, és csak új, elkülönített helyi adatbázisba állít vissza.
A `pilot-state/collection-target-20261128.cjs` külön ellenőrző/létrehozó/visszaállító
lépéseket használ; meglévő céladatbázist nem tisztít és nem ír felül. A távoli
kapcsolatok TLS-t használnak, az új segéd ellenőrzi a kiszolgáló tanúsítványát is.

## Nyitott pontok

Az előkészített segédekhez öt helyi hash/archívum/célkorlátozási teszt és egy
valódi helyi PostgreSQL-t használó hozzáféréshosszabbítási teszt sikeres.
Produkciós build, a gyűjtő TypeScript-ellenőrzése és diff-check PASS.
Ezek az alkalmazás tényleges költözését még nem bizonyítják.

- A lejáró adatbázis külső engedélylistája üres; a Render olvasási csatlakozója
  ezt ténylegesen visszaigazolta. Egyetlen ideiglenes `/32` cím szabálya
  előkészítve, de nincs elmentve; a böngészővezérlés kötelező, közvetlen
  felhasználói jóváhagyására vár.
- A lejáró teljes forrásmentés, a költözés és a január végi tényleges hosszabbítás
  még nincs kész. A december 7-i lejárat veszélye ezért még nincs megszüntetve.
- A hosszabbítás jogosultságait helyi adatbázisteszt igazolta, de ez nem helyettesíti
  az internetes környezet átállítás utáni ellenőrzését. A meglévő süti lejárata az
  eredeti tulajdonosi próbalink újbóli megnyitásakor frissül.
- Fizikai Samsung/Chrome és iPhone/Safari ellenőrzés nem történt.
