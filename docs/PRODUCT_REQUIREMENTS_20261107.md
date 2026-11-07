# MemoryBook – célműködés és követelmények (2026-11-07)

A felhasználó 2026-11-07-i pontosítása az irányadó termékkövetelmény. A jelenlegi M1 ennek szöveges részlete; nem a teljes termék. A már elkészült kód és tesztadat megőrzendő.

## Tulajdonos és könyv

A felhasználó emlékkönyvet vásárol; a jogosultság a fiókjához, nem az eszközéhez tartozik. Megfelelő azonosítással másik saját eszközéről is hozzáfér. A vásárlási jogosultság és a többeszközös használat teljes termékbeli elfogadása még nincs kész.

Telepíthető PWA a cél asztali gépen, notebookon, Androidon és iPhone-on, az adott platform telepítési lehetőségeivel. Böngészőből is használható. A telepítés kezelőfelületet ad: a központi internetes kiszolgáló fogadja az emlékeket akkor is, ha a tulajdonos eszköze ki van kapcsolva. A telepíthetőség nem jelent automatikus offline beküldési képességet.

A tulajdonos egyszerű lépésekben neveket, eseménydátumot, megjelenést állít be, és megjeleníti vagy letölti a QR-kódot. Első esemény az esküvő. A közös esemény- és sablonmodell később ballagást, szalagavatót, keresztelőt, születésnapot is kiszolgáljon alkalmazásmásolatok nélkül.

## QR és vendégfolyamat

A könyv tartós, nyilvánosan elérhető HTTPS-vendégcímet kap. Ugyanarra a könyvre mutat a letöltött, nyomtatott, meghívón, asztalon, táblán vagy képernyőn megjelenített QR. Nem függhet helyi IP-től, USB-től, közös Wi-Fi-től vagy a tulajdonos gépének futásától. A cím életciklusát és a későbbi szolgáltatóváltást a már kinyomtatott QR-ek megőrzésével kell tervezni; rövid tesztkörnyezet QR-je nem végleges rendezvény-QR.

A vendég mobilinternetről vagy tetszőleges megfelelő Wi-Fi-ről, telepítés, regisztráció és belépés nélkül nyitja meg az oldalt. Világosan látja az eseményt és a címzetteket. A vendéglink beküldési hozzáférés, nem tulajdonosi jogosultság; nem teszi olvashatóvá a privát listát.

## Összeállítható emlék

Választható és kombinálható szöveg, kézírás/rajz, kamerás vagy galériából választott fotó, kamerás vagy galériából választott videó. A hangüzenet továbbra is követelmény. A fotóhoz szöveg és kézírás/rajz adható; az eredeti fájl és a ráhelyezett rétegek külön maradnak. A vendég emléket állít össze, nem könyvoldalt tördel és nem teljes Fabric-szerkesztőt használ. A könyvbe rendezés külön, későbbi folyamat.

Beküldés előtt átnézhető és javítható az összeállítás. Jól látható Beküldés gomb, folyamatjelzés, csak tartós rögzítés után sikerjelzés. Hiba esetén lehetőség szerinti tartalommegőrzés és érthető újrapróbálás kell. A dupla koppintás és az ismételt hálózati kérés egy logikai beküldést eredményezzen, médiánál is. A tartalom az adott könyv privát tulajdonosi listájába kerül.

Kevés gomb, nagy érintési célok, olvasható feliratok, hétköznapi szöveg, egyértelmű következő lépés és csak szükséges adatbekérés. Androidon és iPhone-on külön fizikai kamera/galéria próba szükséges. Megtagadott engedély vagy nem támogatott felvétel esetén érthető fájlkiválasztási alternatíva kell.

## Készültség és bizonyíték

| Terület | Állapot |
| --- | --- |
| Esküvői szöveges létrehozás, QR/link, vendégbeküldés, privát lista, lezárás | Megvalósított helyi M1 |
| Szöveges ismétlésvédelem és hiba utáni újrapróbálás | Megvalósított; automatizált bizonyíték és részleges telefonos próba |
| Samsung USB: beküldés, listában megjelenés, lezárás, megszakítás után megmaradt szöveg, újrapróbálás egy példányban, kamerás QR | Felhasználó által visszaigazolt helyi eredmények |
| Samsung USB nélküli hotspot/LAN | Nem igazolt, nem PASS |
| Internetes HTTPS, mobilinternet, kikapcsolt tulajdonosi notebook | Még nincs elkülönített telepített pilot; NYITOTT |
| Fizikai dupla koppintás és privát/kijelentkezett vendégteszt | Külön visszaigazolás szükséges |
| iPhone/Safari | NYITOTT |
| PWA telepítés és teljes többeszközös vásárlási jogosultság | Még megvalósítandó/elfogadandó |
| Fotó, rajz/kézírás, hang, videó kombinált vendégfolyamat | Tervezett, nem kész |
| QR letöltése/nyomtatása és tartós internetes célcím | Következő internetes lépés része |

A helyi jelszó nélküli tesztbelépés csak az elkülönített helyi tesztadatbázishoz használható. Interneten a pilot=1 paraméter nem adhat tulajdonosi jogot. A pilotban a kézi jelszóbevitel elhagyása mellett is külön, ellenőrzött tulajdonosi hozzáférés szükséges.

A következő fejlesztési sorrendet az INTERNET_PILOT_PLAN_20261107.md rögzíti. A LAN/USB dokumentáció fejlesztési előzményként marad meg, nem a termék hálózati architektúrája.
