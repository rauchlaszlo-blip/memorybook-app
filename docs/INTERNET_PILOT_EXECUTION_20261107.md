# Internetes pilot – végrehajtási állapot (2026-11-07)

A felhasználó engedélyezte a külön pilotág commit/push műveleteit és az igazoltan új díj nélküli külön HTTPS szolgáltatás/adatbázis telepítését. Az éles erőforrások és main nem módosíthatók.

## Elkészített kód

- Önálló server/pilot indítás; nem tölti be a régi szervert, fizetést vagy auth-indítást.
- Csak explicit elkülönített pilot-konfigurációval és memorybook_wedding_internet_pilot nevű adatbázissal indul. A helyi DB-védelem változatlan.
- 256 bites egyszer használható meghívó, szerveren SHA-256 hash, lejárat, tranzakciós beváltás. Kiadó parancs: npm run invite:internet-pilot; 60 perc élettartam, a link kizárt .local fájlba kerül, nem konzolra.
- Meghívó URL fragmentben, első megnyitáskor címsorból eltávolítva; külön gomb váltja be. GET/linkelőnézet nem váltja be.
- Külön DB-ben tárolt, 7 napos, visszavonható/lejáró munkamenet; Secure, HttpOnly, SameSite=Strict, __Host- cookie. A szerver újraindítása nem törli a munkamenetet.
- Az internetes kiszolgáló nem regisztrál nyilvános feliratkozást vagy helyi pilot-belépést. A pilot=1 nem ad hozzáférést.
- Pontos originellenőrzés minden API-íráson, beleértve a hiányzó Origin elutasítását; sebességkorlátozás megmarad.
- Kanonikus, szerver által megadott HTTPS vendégcím és letölthető QR. A helyi fejlesztési mód továbbra is használható.

## Tényleges helyi ellenőrzések

- 6 új internetes pilot API/jogosultsági teszt: sikeres.
- 14 meglévő vendégkönyv API/adatbázis teszt: sikeres.
- 1 valódi auth + legacy regresszió + Chrome böngészős teszt: sikeres.
- Frontend build és TypeScript ellenőrzések sikeresek; az új és érintett pilotfájlok lintje sikeres.
- Ezek helyi automatizált eredmények. Telepített HTTPS környezet és telefonos internetes PASS még nincs.

## Fiókellenőrzés – igazolt, 2026-11-07

A felhasználó kijelölte a My Workspace munkaterületet. A Render Dashboard szerint 0,47/750 ingyenes futásóra, 2/500 buildperc, 5 MB/5 GB sávszélesség és 11/25 szolgáltatás foglalt. Az új adatbázis 0 USD/hó Free csomagja kiválasztható, 1 GB tárhellyel és 30 napos lejárattal. Meglévő fizetési mód mellett kerettúllépés díjköteles lehet; a pilot ingyenes csomagjai nem jelentenek korlátlan ingyenes használatot.

Külön render.pilot.yaml: új free web + új free PostgreSQL, Frankfurt, kizárólag codex/wedding-internet-pilot ág, automatikus deploy kikapcsolva. Adatbázis külső kapcsolatok tiltva, belső URL-t a Blueprint kapcsolja össze. Éles erőforrás nincs a konfigurációban. A régi lejárt hirportal-test adatbázishoz nem nyúlunk.

Az éles MemoryBook a main ágról fut; távoli main HEAD ellenőrizve: 5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff. A helyi munka és tesztadatok megőrzöttek.

## Telepített környezet

- HTTPS: https://memorybook-wedding-text-pilot-ukd0.onrender.com
- Render szolgáltatás: srv-dbng6ojrjlhs738notk0; Free, Frankfurt, automatikus deploy kikapcsolva.
- Adatbázis: dpg-dbng6e3rjlhs738nntd0-a; Free, PostgreSQL 17, külső elérés tiltva; kizárólag fiktív adatok.
- Adatbázis lejárat: 2026-12-07 10:53:45 UTC / 11:53:45 Europe/Budapest. Nem frissül automatikusan fizetős csomagra. Ingyenes mentés nincs; lejárat előtt külön adatmegőrzési lépés szükséges.
- Inaktivitás után 15 perccel a webszolgáltatás elalhat; az első megnyitás körülbelül egy percet igényelhet.
- Telepített alkalmazáskód: 08503b19463966c8a50596f201d78de9910d0f9a, külön codex/wedding-internet-pilot ág. Main nem módosult.
- Blueprint létrehozás és tervezés a Render API-val validált, csak két új free erőforrás szerepelt. Render CLI nem volt telepítve. A terv alkalmazását a felhasználó engedélyezte.

## Valódi HTTPS ellenőrzés (asztali Chrome, automatizált)

Sikeres: meghívó beváltása; URL-fragment eltávolítása; Secure/HttpOnly/SameSite=Strict cookie; ismételten beváltott és érvénytelen meghívó elutasítása; anonim privátlista-elérés 401; pilot=1 nem ad jogot; helyi pilot-login és régi regisztrációs végpont 404; idegen vagy hiányzó Origin 403; fiók nélküli ékezetes beküldés; dupla kattintás egy kérés; sikeres szervermentés után elveszített válasz, megtartott szöveg és ugyanazzal a kulccsal újrapróbálva egy bejegyzés; tulajdonosi megjelenés; HTML szövegként; lezárás utáni új beküldés 410.

A meghívó lejárati és párhuzamos beváltási tesztje helyi valódi PostgreSQL-en sikeres, a HTTPS-próbában újrafelhasználási és érvénytelen tokenes ellenőrzés történt. A közvetlen felhős SQL-ellenőrzést a zárt külső DB-elérés blokkolta; ezt nem nyitottuk ki, a működést az alkalmazás API-ján és böngészőben igazoltuk.

A scripts/verify-internet-pilot.ts a kizárt pilot-verification.local konfigurációval fut; csak fiktív adatot küld az explicit pilotcímre. A scripts/verify-pilot-persistence.ts a teszt során mentett, kizárt munkamenettel ellenőrzi az újraindítás utáni állapotot. A test-results mappa képernyőképei és sessionadatai nem kerülnek Gitbe.

## Tulajdonosi meghívó kiadása

A telepített kiszolgáló induláskor csak a PILOT_OWNER_INVITE_HASH és PILOT_OWNER_INVITE_EXPIRES_AT operátori beállításból vesz át meghívót. Csak hash kerül a szolgáltatói konfigurációba. Lejárt meghívót nem éleszt fel; a meglevő hash állapotát nem írja felül. Új meghívóhoz új 32 bájtos véletlen token és legfeljebb 24 órás lejárat szükséges. A felhasználónak most kiadott meghívó 60 perces; a létrejött session 7 napos. A tulajdonosi linket nem szabad a vendég-QR-rel együtt kihelyezni.

A Blueprint a tartós telepítési beállítások forrása; a meghívó két operátori változója szándékosan kívül marad rajta, merge-alapú külön frissítéssel. A frissítés új deployt indít. A teljes URL a Gitből kizárt pilot-owner-invite.local fájlban van, a dokumentációban nincs titok.

## Telefonos elfogadás

Samsung mobilinterneten, kihúzott USB-vel, kikapcsolt notebookkal: PASS, a felhasználó „próba pass” visszajelzése alapján (2026-11-07). Az elfogadás a közvetlenül előtte kért megnyitás → ékezetes beküldés → tulajdonosi listában megjelenés próbára vonatkozik. A kamera/QR és privát böngésző szerepelt az átadott lépésekben, de külön részletes eredményt a felhasználó nem adott. Internetes fizikai lezárás, dupla koppintás és hálózatmegszakítás/újrapróbálás külön visszaigazolása továbbra is NYITOTT; az automatizált eredmények nem helyettesítik ezeket. iPhone/Safari külön NYITOTT.

A felhasználói próba számára nyitva marad a Samsung próba – Anna és Bence (fiktív) könyv. A korábbi automatizált próbakönyv lezárt, ez szándékos. A felhasználónak nem kell új könyvet létrehoznia az első internetes beküldéshez.

## Végső ellenőrzés

A dep-dbng8n1srm7s739bt9vg deploy 2026-11-07 10:59:35 UTC-kor live állapotú lett. Az újraindítás után a korábbi tulajdonosi session érvényes maradt, a Samsung-próbakönyv elérhető és nyitott, névtelen böngészőben a beküldőűrlap megnyílt. A ténylegesen megjelenített QR dekódolt PNG-képpontjai egyeznek a kanonikus HTTPS-vendégcímből készített QR-rel. Az első ellenőrzésben a PNG tömörített bájtjainak összevetése eltérést jelzett; a különböző böngészős és Node PNG-tömörítést figyelembe vevő képpontellenőrzés sikeres.

A végső Git-ellenőrzés szerint a távoli main változatlan. A későbbi dokumentációs/ellenőrzőszkript commit nem változtatja meg a telepített alkalmazáskódot; az automatikus deploy kikapcsolva marad.
