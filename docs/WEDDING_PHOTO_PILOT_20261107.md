# Fotós esküvői pilot – 2026-11-07

## Kiindulás és hatókör

Meglévő munkapéldány: memorybook-app-m1, ág codex/wedding-internet-pilot, kiinduló HEAD 608ddf8. A munkafában a felhasználói Samsung szöveges PASS dokumentálása volt módosítva; megőrizve. Nincs új teljes projektfelmérés. A main és az éles MemoryBook nem célpont.

Egy JPEG/PNG fotó + név + jókívánság beküldésenként, vagy változatlanul csak szöveg. Fotó készítése capture=environment fájlválasztóval, külön galériaválasztás capture nélkül. A rendszerablakot a telefon/böngésző határozza meg; nem garantálható azonos kameraablak. Engedélymegtagadásnál a galéria/fájlválasztás marad alternatíva. Nincs rajz, hang, videó, AI, export, PWA vagy új vásárlás.

## Tárhelydöntés és díj

A meglévő éles szerver Cloudinary-kódot használ, de annak kulcsait/anyagait nem másoljuk a pilotba; privát hozzáférésre és elkülönített díjmentes keretre nem tekintjük bizonyítéknak a meglévő kódot. A külön pilot PostgreSQL-je ellenőrzötten Free, 1 GB-os, külső kapcsolatoktól védett, és 2026-12-07 10:53:45 UTC-kor jár le. A Render számlázás ellenőrzésekor: 0,82/750 futásóra, 4/500 buildperc, 5 MB/5 GB forgalom, 13/25 szolgáltatás. Nem létesítünk új szolgáltatást, nem aktiválunk fizetős csomagot.

A korlátozott fotópilot képei BYTEA mezőkben, ugyanebben a külön adatbázisban vannak. Ez kis pilothoz választott átmeneti tárolási megoldás, nem a későbbi nagy rendezvényes médiatár terve. A Render ideiglenes fájlrendszerére nem kerül tartós kép. A DB-lejárat a képekre is vonatkozik; ingyenes automatikus mentés nincs. Kerettúllépésnél a szolgáltatói forgalmi díjak továbbra is alkalmazhatók, a pilotkeretek nem korlátlan ingyenes használatot jelentenek.

## Pilotkorlátok

| Beállítás | Alapérték |
| --- | --- |
| PILOT_PHOTO_MAX_BYTES | 6 MiB/fájl |
| PILOT_PHOTO_MAX_PIXELS | 24 millió képpont |
| PILOT_PHOTO_BOOK_BYTES | 50 MiB/könyv, eredeti + származtatott képek együtt |
| PILOT_PHOTO_TOTAL_BYTES | 200 MiB a pilot összes médiájára |
| PILOT_PHOTO_TTL_SECONDS | 3600 másodperc a még be nem küldött képre |

További fékek: 100 képrekord/könyv, 1000 összesen; 700 MiB fölötti tényleges adatbázisméretnél új kép nem fogadható; legfeljebb két egyidejű bináris feltöltés folyamatonként. A konfiguráció ésszerű felső korlátok közé szorított, a Sharp munkaszálainak száma 1 és képcache nincs. Korlátelérés nem kapcsol fizetős csomagra. A csak szöveges beküldés külön tovább használható.

## Eredeti és származtatott kép

Az HTTP-kérésben átvett eredeti fájl bájtjai változatlanul tárolódnak, SHA-256 ellenőrzőösszeggel, tényleges MIME-típussal, mérettel, szélesség/magasság adattal, könyvkapcsolattal és feldolgozási/kapcsolási állapottal. A telefon választója már JPEG-re alakíthatja vagy módosíthatja a képet. Csak a böngészőtől ténylegesen kapott fájl változatlanságát ígérjük, nem egy el nem küldött eredeti kamerafájlét.

JPEG/PNG aláírás + teljes dekódolás, hibás/truncált fájl elutasítása, képpontlimit. Sharp autoOrient korrigálja az EXIF-tájolást. Külön 1600×1600-ba illesztett JPEG megjelenítési kép és külön 480×480-ba illesztett JPEG előnézet készül, felnagyítás nélkül. A származtatott képekből a metaadatok eltávolítva, átlátszó háttér fehérre lapítva. Az eredeti EXIF megmarad az eredeti fájlban.

HEIC/HEIF ebben a körben nem támogatott. A telepített sharp 0.35.5 előre fordított HEIF bemenete AVIF-et jelez; a HEVC/HEIC dekódolásra nem támaszkodunk. A kliens és a szerver JPEG/PNG-t fogad el, a felhasználó érthető JPEG-másolatot kérő szöveget kap. Ha az iPhone választója JPEG-et ad át, az fogadható; teljes iPhone-fotótámogatást fizikai próba és HEIC-kezelés nélkül nem állítunk.

## Feltöltési és jogosultsági életciklus

1. A vendég lokális blob-URL előnézetet lát, cserélhet/eltávolíthat. Nem kerül base64 a JSON-kérésbe.
2. POST /api/wedding/guest/:token/media/:key: application/octet-stream bináris feltöltés, XHR valós upload-eseményből haladási százalék, utána külön feldolgozási állapot. A 100% feltöltés még nem sikeres beküldés.
3. A validált eredeti és két derivátum egy tranzakcióban lesz uploaded állapotú; hiányos stream nem hoz létre kész rekordot. Könyv+feltöltési kulcs egyedi, tartalomütközés 409. Meglévő sikeres feltöltés azonos hash esetén visszaadható új dekódolás/tárolás nélkül.
4. A kis JSON beküldés mediaId-t visz; az ugyanahhoz a könyvhöz és beküldési kulcshoz tartozó, nem lejárt média és a szöveg együtt válik tartós attached beküldéssé. Az ismétlés a szöveget és a médiát is összeveti. A lezárás és a beküldés/feltöltés azonos könyvsorzáron sorosodik.
5. A melléklet nélküli beküldés változatlan. A modell külön event_media sorokat kapcsol a submission_id-hoz, így később több médiát is befogadhat; a jelenlegi API egyet enged.
6. Siker csak a végleges beküldés commitja után. Hálózati hibánál szöveg/fájl marad az oldalon; ismert feltöltési azonosító esetén a fájl nem töltődik újra. Elveszett feltöltési válasznál ugyanaz a kulcs és fájl újraküldhető, új tartós másolat nélkül.
7. sessionStorage a szöveget és a próbálkozás kulcsát best-effort őrzi; fájlt nem tárol. Lapújratöltés után azonos kép újrakiválasztását kéri, a meglévő próbálkozás kulcsával és szerveroldali hash-ellenőrzéssel. Nincs tartós offline feltöltési ígéret.
8. A még be nem küldött képek 1 óra után nem csatolhatók. Takarítás induláskor, ébren futva 15 percenként és új feltöltés előtt; alvó szolgáltatásnál következő induláskor. Csak lejárt uploaded, submission_id nélküli sorokat töröl, attached képet soha. Folyamatban lévő csatolással a DB sorzára egyeztet. Az eredeti és a derivátumok együtt törlődnek, nincs külön objektumtárban maradó árva fájl.

GET /api/wedding/media/:id/{original|preview|display}: minden változathoz tényleges tulajdonosi session és könyvtulajdon-ellenőrzés kell. Vendégtoken nem helyettesít sessiont; pending képet még a tulajdonos sem olvashat. Privát/no-store válasz, nosniff; az eredeti fájl letöltésként, a derivátum JPEG-ként jön. Másik tulajdonos 404, anonim 401. Nincs nyilvános média-URL vagy kliensbe ágyazott szolgáltatói titok.

## Ellenőrzések

Új szerveroldali tesztek: JPEG/PNG+üzenet, szöveg fotó nélkül, SHA-256 és teljes eredeti bájtpontosság, tájolás, hibás típus/HEIC/sérülés/méret/képpontlimit, könyv- és globális kvóta, párhuzamos/ismételt feltöltés és beküldés, megszakadt stream, lezárás/feltöltés ütközés, idegen könyv és beküldési kulcs elutasítása, minden médiaváltozat jogosultsága, lejárat/takarítás, újraindítás és ismételt migráció utáni elérés.

Böngészős teszt: kamera/galéria vezérlők fájlinjektálással (nem valódi kamera), előnézet/eltávolítás, elveszett upload- és beküldési válasz, dupla kattintás, sikeres upload újrafelhasználása, tulajdonosi nagyobb nézet/visszalépés, offline hiba utáni szövegmegőrzés és lapújratöltéskor fájl-újrakiválasztás. Meglevő szöveges/auth/legacy regressziók is futnak.

Helyi ellenőrzés: frontend build PASS, backend típusellenőrzés PASS, érintett fájlok lint PASS, 30/30 teszt PASS (8 fotós API, 1 fotós böngészős, 21 korábbi). Az utolsó dekódolási memóriakorlát után a 8 fotós API-teszt ismét PASS. A telepített commit és HTTPS-próba a végső átadáskor kerül ide. Android kamerás/galériás fotópróba: NYITOTT. iPhone/Safari szöveges és fotós próba: NYITOTT, felhasználói eredmény nélkül nem PASS. A korábbi Samsung szöveges PASS megőrizve.

Források: https://render.com/docs/free ; https://sharp.pixelplumbing.com/api-constructor/ ; https://sharp.pixelplumbing.com/api-operation/ ; https://sharp.pixelplumbing.com/install/ .

## Telepített eredmény és Safari-vizsgálat

Fotós kód: 978c1d95a5ab67af2afc4fa305539044e9ae0781, deploy dep-dbngn71srm7s739cuec0. A végső, betöltési javítást is tartalmazó telepített kód: **4eeeb8b9f1aa1297ba81ac1ed5b2e627aebbda07**, deploy **dep-dbngpkff3r2c738k725g**, live 2026-11-07 11:35:46 UTC.

HTTPS ellenőrzés PASS: fiktív JPEG+szöveg, külön szöveges beküldés, eredeti bájtpontosság, EXIF-tájolás, minden médiaváltozat anonim tiltása, még nem csatolt kép tiltása, ismételt feltöltés és beküldés egyetlen példánya, hibás típus elutasítása, tulajdonosi lista és nagyított nézet, lezárás utáni elutasítás. A következő tényleges Render-telepítés után az eredeti kép SHA-256 értéke és bejegyzéskapcsolata változatlan. A régi telefonos könyvet nem zártuk le, a vendéglink és a QR képpontjai változatlanok, a korábbi tulajdonosi munkamenet működik.

Felhasználói visszajelzés: Samsungon a Render indulása után betölt a vendégoldal; iPhone-on fehér oldal, közben Render indulóképernyő, majd ismét üres oldal. Ez nem iPhone PASS. Az iOS verziója nem ismert. A pontos eszközoldali ok még nincs bizonyítva.

Reprodukált kódhiba: tiltott localStorage esetén a nyelvinicializálás SecurityError hibával leállt és üres root maradt. Javítás: tárolási kivétel kezelése olvasásnál és írásnál; a nyelvváltás ettől még működik. A vendégoldal nem inicializálja a régi auth/szerkesztő modulokat, kezdeti JS 817 kB helyett körülbelül 241 kB. Build-szintaxis cél Safari/iOS14 (ez nem fizikai iOS14 kompatibilitási tanúsítás). Indulási hiba esetén statikus betöltési/újrapróbálási felület és BETÖLTÉS-01 jelzés, JavaScript tiltásakor noscript segítség.

Új helyi teszt: Chromium és WebKit normál és tiltott local/sessionStorage mellett betölt, nyelvet vált, ékezetes üzenetet küld; blokkolt JS-fájl esetén látható hiba és újrapróbálás. Mindkettő PASS. A fotós böngészőteszt és teljes legacy/auth regresszió a javított builddel ismét PASS. Összesen 32 külön teszt (30 korábbi/fotós + 2 indulási teszt) sikeres; build, backend típusellenőrzés és érintett lint is PASS.

Telepített WebKit-próba 11:36:21 UTC: normál és tiltott tárolású anonim betöltés, szöveges és PNG-beküldés, tulajdonosi megjelenés, régi link és előző telepítés képadatainak megmaradása PASS. A telepítés átállása alatt indított első ellenőrzés még nem talált űrlapot; a live állapot után minden válasz 200, JS-hiba nélkül, a teljes ellenőrzés PASS. A teszt fájlinjektálás, nem fizikai kamera.

Újratesztelésre átadva a változatlan vendégútvonal ?proba=2 paraméterrel; ez nem jogosultság, nem új könyv. Fizikai iPhone-betöltés, Samsung kamera/galéria, iPhone kamera/galéria továbbra is NYITOTT a felhasználói visszajelzésig. HEIC/HEIF továbbra sem támogatott. A korábbi Samsung szöveges internetes PASS érvényes marad a saját korábbi körére.

Ellenőrző programok: scripts/verify-photo-pilot.ts, scripts/verify-webkit-pilot.ts, scripts/verify-pilot-persistence.ts. A nyers eredmények/képernyőképek és tesztmunkamenet az ignorált test-results könyvtárban maradnak. A meghívó 2026-11-07 11:58:23 UTC lejáratát ellenőriztük; az átadás ellenőrzésekor még nem járt le. A már beváltott tulajdonosi munkamenet ettől külön 7 napos.

Main távoli HEAD változatlan: 5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff. Új fizetős erőforrás vagy csomag nem készült; éles szolgáltatás/adatbázis nem módosult. A dokumentáció későbbi commitja automatikusan nem deployolódik (autoDeploy off).

Safari-vizsgálat forrásai: https://v8.vite.dev/config/build-options ; https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage .
