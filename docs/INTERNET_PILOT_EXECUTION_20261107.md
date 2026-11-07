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

Telepítés és valódi internetes ellenőrzés: folyamatban, telefonos PASS nincs.
