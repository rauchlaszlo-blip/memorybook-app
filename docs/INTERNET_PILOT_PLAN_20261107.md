# Elkülönített internetes szöveges pilot – terv (2026-11-07)

Állapot: terv, nem telepített szolgáltatás. Ez a módosítás nem indít szolgáltatást, nem költ, nem deployol, nem commitol/pushol és nem módosít éles adatot. A helyi munkát és tesztadatokat megőrzi.

## Következő kipróbálható eredmény

Külön HTTPS tesztcím, amelyen a meglévő szöveges esküvői folyamat Samsung mobilinternetről, USB és közös Wi-Fi nélkül működik. A tulajdonos notebookja kikapcsolható. Vendégoldal belépés nélkül; tulajdonos jelszó gépelése nélkül, ellenőrzött meghívással. Első körben csak fiktív szöveges adatok. Nem tartozik ide a teljes média-, vásárlási vagy PWA-csomag.

## 1. Előkészítés a meglévő munkapéldányban

- Külön tesztkonfiguráció és környezeti ellenőrzés; a jelenlegi helyi adatbázisvédelmet nem lazítjuk fel. Internetes migrációhoz külön, kifejezetten tesztadatbázisra korlátozott futtatás kell. A régi szerverindítás adatbázis-módosításait is fel kell mérni a tesztindítás előtt.
- Külön alkalmazásszolgáltatás, külön PostgreSQL-adatbázis és tesztfiókok; sem éles adatbáziscím, sem fizetési/OAuth/AI titok nem másolható át. A meglévő helyi DB-t nem költöztetjük el és nem töröljük.
- Frontend és API azonos HTTPS-origin alatt; stabil, külön teszt-auth titok, pontos engedélyezett origin, HTTPS-es Secure/HttpOnly session cookie és megfelelő SameSite. Tulajdonosellenőrzés, originellenőrzés és sebességkorlát megmarad. Újraindításkor ne vesszen el a hozzáférés pusztán újragenerált titok miatt.
- A vendéglink és QR ellenőrzött, konfigurált kanonikus HTTPS-alapcímből épüljön. A jelenlegi window.location.origin megoldást ehhez igazítani kell. Internetes módban localhost/helyi IP és hibás alapcím elutasítandó. QR-letöltés és nyomtatható megjelenítés kis külön feladatként.
- A helyi pilot-login megoldás internetes módban legyen kikapcsolva és ne legyen felkapcsolható pusztán pilot=1 paraméterrel. Helyette rövid élettartamú, egyszer használható, nagy entrópiájú tulajdonosi meghívó: szerveren csak hash, konkrét tesztfiók és jogosultság, tranzakciós egyszeri beváltás. A megnyitás utáni egyszerű folytatás ne igényeljen jelszót; GET/linkelőnézet ne fogyassza el a meghívót. A beváltás valódi sessiont adjon, a token tűnjön el a címből, ne kerüljön naplóba vagy továbbküldött refererbe. Lejárt vagy másik eszközös hozzáféréshez új ellenőrzött meghívó biztosítható. A tulajdonosi meghívó nem azonos a kihelyezhető vendég-QR-rel.
- Automatizált ellenőrzés: hiányzó/lejárt/újrafelhasznált meghívó elutasítása, vendég nem olvashat tulajdonosi listát, helyi belépési kerülőút tiltott, origin/cookie/kanonikus link, meglevő beküldés–retry–lezárás regressziók.

## 2. Konkrét környezet és költség bemutatása

Jelölt megoldás: külön Render webszolgáltatás és külön teszt-PostgreSQL, szolgáltatói HTTPS címmel. Ez választási javaslat, nem meglévő vagy lefoglalt erőforrás. A fiókban elérhető keretet, régiót, adatbázis-élettartamot, erőforrásokat és költségplafont a tényleges létrehozás előtt ellenőrizni kell. A publikus pilot is csak tesztfiókot és tesztadatot használhat.

A végrehajtás előtt bemutatandó: pontos erőforráslista, várható havi és esetleges használati költség, adatmegőrzés/mentés, leállítás és törlés módja. Új fizetős szolgáltatás csak külön felhasználói engedéllyel. Éles erőforrás módosítása nem része a tervnek. A jelenlegi commit/push/deploy tiltást nem oldja fel ez a tervezési feladat; a konkrét telepítési lépés külön egyeztetendő. Telepíthető forrás/artifact készülhet később a megőrzött munkapéldányból; Git-push nem történhet hallgatólagosan.

Rövid teszthez lehetséges nulla szolgáltatói költség, ha a fiók szabad kerete engedi. A Render ingyenes webszolgáltatása 15 perc inaktivitás után leállhat, indulása körülbelül egy perc; az ingyenes PostgreSQL 30 nap után lejár, nincs mentése. Egy munkaterületen csak egy ingyenes PostgreSQL lehet. Használati keretek és számlázási beállítások is számítanak: nulla költség nem ígérhető fiókellenőrzés nélkül. Tartós rendezvényhasználathoz megbízhatóbb tárhely és mentett adatbázis külön költségtervet igényel.

| Tétel | Következő szöveges pilot |
| --- | --- |
| HTTPS alkalmazáskiszolgáló | Szükséges; szabad ingyenes keret ellenőrizendő |
| Elkülönített PostgreSQL | Szükséges; tesztadat megőrzése/mentése a lejárat előtt megtervezendő |
| Saját domain | Nem kötelező a rövid pilothoz; tartós nyomtatott QR előtt címstratégia kell |
| Média objektumtár, videófeldolgozás, AI | Nem szükséges ebben a lépésben; későbbi költségterv |
| E-mail szolgáltató | Nem előfeltétel a kézzel átadott tesztmeghívóhoz |

Forrás, ellenőrizve 2026-11-07: https://render.com/docs/free és https://render.com/pricing . Szolgáltatást nem indítottunk és fiókkeretet nem igazoltunk ebben a tervezési lépésben.

## 3. Valódi internetes elfogadás

A telepítés után pontos tulajdonosi és vendégcímet kell adni, a QR célját ténylegesen ellenőrizni. Helyi tunnel/ADB nem elfogadható a tulajdonosi notebooktól független kiszolgálás bizonyítékának.

1. Samsungon USB kihúzva, Wi-Fi kikapcsolva, mobilinternet bekapcsolva nyissa meg a tulajdonosi meghívót. Jelszó gépelése nélkül hozzon létre új fiktív könyvet.
2. A könyv QR-jét a notebook képernyőjéről kamerával olvassa be; külön ellenőrizze a letöltött/nyomtatott QR-t is. Azonos HTTPS-vendégcímre vezessenek.
3. Vendégként kijelentkezett vagy privát böngészőből küldjön ékezetes jókívánságot. Dupla koppintással is egy bejegyzés keletkezzen.
4. A tulajdonosi listában jelenjen meg a bejegyzés. Másik saját eszköz ellenőrzött tulajdonosi hozzáférésével ugyanaz a könyv legyen elérhető.
5. Beküldés közben szakítsa meg a telefon internetét: szöveg maradjon meg, siker ne jelenjen meg igazolatlanul. Visszakapcsolás és újrapróbálás után pontosan egy példány legyen.
6. A tulajdonos zárja le a könyvet. Ezután új vendégbeküldést utasítson el a rendszer; egy korábbi sikeres beküldés ismételt visszaigazolása ne hozzon létre új sort.
7. Külön nyitott tesztkönyv vendégoldala és beküldése kikapcsolt notebook mellett is működjön. Később a tulajdonos ellenőrizze a beérkezett üzenetet.
8. iPhone/Safari külön fizikai próba; nem helyettesíti Samsung vagy automatizált böngészőeredmény.

Minden fizikai eredményt a felhasználótól kérünk be. A Samsung internetes elfogadás addig NYITOTT, amíg a kábel nélküli megnyitást, beküldést és tulajdonosi megjelenést nem igazolta vissza. Az iPhone/Safari külön NYITOTT marad. A tesztjegyzőkönyv eszközt, hálózatot, lépést és tényleges eredményt rögzítsen.

## Későbbi fejlesztési sorrend

1. HTTPS szöveges pilot és fenti elfogadás.
2. PWA telepíthetőség és többeszközös tulajdonosi hozzáférés; külön asztali/Android/iPhone telepítési próba. Vásárlási jogosultság véglegesítése külön munkacsomag.
3. Fotó kamera/galéria, előnézet, feltöltési állapot és hibatűrés, elkülönített médiatárolás; utána külön réteges kézírás/rajz. Valódi Android/iPhone és engedélymegtagadási tesztek.
4. Hangüzenet, majd videó kamera/galéria; méret-, idő-, formátum- és költségkorlátok, újrapróbálás és médiás duplikációvédelem.
5. Könyvbe rendezés, korábban tervezett AI/export és adatmegőrzési életciklus külön specifikáció és elfogadás alapján. Más események a közös profil/sablonmodellben.

Egy munkacsomag elkészülése nem jelenti a következő elkészültét. A teljes fotó/videó/rajz csomagot nem kezdjük egyszerre.
