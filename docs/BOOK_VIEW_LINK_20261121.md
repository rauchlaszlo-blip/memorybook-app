# Emlékkönyv megtekintése név és jelszó nélkül

A tulajdonos 2026-11-21-i kérése alapján külön megtekintési link készül a fiktív próbakönyv már jóváhagyott, 16 oldalas PDF-jéhez. A link birtokosa felhasználónév, jelszó és vendégbeküldés nélkül nyithatja meg a könyvet. Ez a rögzített kiadás megtekintése, nem szerkesztői vagy általános tulajdonosi munkamenet. Az újabb beküldések nem változtatják meg észrevétlenül a kiadást.

## Hatókör és működés

- Útvonal: `GET /wedding/view/:token`, valamint a PDF-olvasók számára `HEAD` és egyszeres bájttartomány-kérés. A válasz közvetlen, böngészőben megnyitható PDF. Nincs átirányítás a belépő- vagy vendégbeküldő oldalra.
- Csak a külön internetes pilotba épül be; az éles alkalmazás nem kap ilyen útvonalat.
- Az operátori `PILOT_BOOK_VIEW_GRANT` beállítás egyetlen könyvhöz, exporthoz, jóváhagyott kiadáshoz, mentett változathoz és pillanatképhez kötött. Tartalmazza az engedélyezési időpontot, lejáratot, fiktív könyvcímet, a tartalmi felülvizsgálat revízióját és a PDF ellenőrzőösszegét. A véletlen, 32 bájtos linkkulcsnak csak SHA-256 lenyomata kerül a szolgáltató beállításába.
- Minden megnyitáskor új ellenőrzés történik a könyv zárolása mellett: a kötött azonosítók, jóváhagyás, változatlan terv és PDF-bájtok, lejárat, valamint a **megosztható kiadás szigorúbb tartalmi szabályai**. A korábbi privát alapértékű kiadás és a tulajdonosi jóváhagyás változatlan marad; a most kért megtekintési engedély külön hozzáférés.
- Függő jelzés, „Csak privát könyvbe”, kihagyás vagy későbbi, érintett tartalmi szigorítás visszatartja az elérést. A régi linket egy újabb tulajdonosi jóváhagyás önmagában nem éleszti újra; új megtekintési engedély szükséges. A már letöltött példány nem vonható vissza.
- Nincs tulajdonosi süti, listázási, szerkesztési, jóváhagyási vagy eredetimédia-jogosultság. Hibás, módosított, lejárt link és további útvonal/lekérdezési paraméter 404-et kap. Az üres beállítás letiltja a funkciót; a hibás konfiguráció nem indíthat nyitott hozzáférést.
- A válasz nem gyorsítótárazható, keresőindexelése tiltott, külső hivatkozási fejlécet nem küld. A beállítás eltávolítása/cseréje és alkalmazása visszavonja a régi linket. A szolgáltatónál elmentett konfiguráció az új telepítés után válik aktívvá.

## Konkrét próbakönyv

Könyv: `4b6039a5-329c-4444-97f8-c299ec3d93a1`. Jóváhagyott változat: `22b41a68-6838-49c1-b79c-b20706809fd6`. Export: `7e8cbe2a-1d51-4ab3-8240-a622698a7d44`. A PDF 16 oldalas, 805 903 bájt; SHA-256: `41b346bbfafe85e837f3859210d86e4b8bc7b255c433f73ac8f295712a6f24ee`.

A megtekintési link tervezett lejárata **2026-12-06 23:59:59 magyar idő**. A meglévő díjmentes pilotadatbázis szolgáltatói lejárata december 7. A link nem fizetős hosszabbítás vagy tartós megőrzési ígéret.

A megtekintési linket a kért átadás tartalmazza; teljes kulcsa nem kerül a verziókezelt jelentésbe. A helyi példány és konfiguráció a gitből kizárt `test-results/book-view/grant.local` fájlban van.

## Ellenőrzés és megőrzés

- Telepítés előtti HTTPS-helyreállítási másolat: **8 könyv / 95 erőforrás PASS**; benne a jelenlegi beküldések, eredeti médiabájtok, annotációk, mentett tervek, pillanatképek és kész PDF-ek. Ez alkalmazásszintű másolat, nem teljes adatbázismentés. A korábbi mentések megmaradtak; külső adatbázis-hozzáférés nem nyílt.
- A megtekintés engedélyezése előtti, megosztható változatra végzett tartalmi ellenőrzés: **PASS**, revízió 2, nincs blokkolt elem vagy további átnézési követelmény.
- Az új útvonal helyi, elkülönített PostgreSQL-próbája **9/9 PASS** (8 részteszt és az összefogó teszt). Ellenőrzött: pontos PDF-bájtegyezés, névtelen olvasás, hibás kulcs/azonosító/útvonal/paraméter, módosított PDF és tervhash, lejárat és visszavonás, könyvzárolás közbeni visszavonás, függő/privát/kihagyott tartalom tiltása, új tulajdonosi jóváhagyástól független régi linktiltás, megváltozott forrásra adott döntés öröklésének tiltása.
- Meglévő hitelesítési, könyvfolyamat-, tartalmi átnézési, PDF- és MCP-könyvelkülönítési regresszió: **12/12 PASS**.
- Frontend build, frontend/backend TypeScript és az érintett fájlok lintje **PASS**. Az alkalmazás felületi fájlja változatlan: `index-BOI_M8t9.js`.
- A meglévő PDF változatlan bájtjaival, az új útvonal válaszfejléceivel végzett helyi Chrome-próbán a 16 oldalas böngészős PDF-olvasó és a könyv első oldala ténylegesen megjelent. Az eredeti PDF első és utolsó oldalát külön is megnyitottuk.
- Az élő telepítés eredménye az átadás előtt kerül rögzítésre.

A fizikai Samsung/Chrome és iPhone/Safari megnyitási próba **NYITOTT**. Az asztali böngésző és a mobil emuláció nem helyettesíti ezt.
