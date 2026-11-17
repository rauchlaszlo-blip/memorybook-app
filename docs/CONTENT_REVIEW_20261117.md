# MemoryBook – tartalmi jelölések és tulajdonosi felülvizsgálat

Állapotnapló: 2026-11-17. A tartalmi felülvizsgálat a külön díjmentes internetes pilotban él. Alkalmazáscommit: `d42d7f50719cab40392de13712f4c4bb9329f195`; Render-kiadás: `dep-dbu3taon74is73fc4hlg`, LIVE 2026-11-17 11:48:06 UTC. A main és az éles MemoryBook nem változott. Az új HTTPS/MCP-próba 16/16 PASS, a kiadás előtti 8 könyv 87 összehasonlított erőforrása változatlan.

## Tulajdonosi használat

1. Belépés után nyisd meg a [fiktív próbakönyv átnézési felületét](https://memorybook-wedding-text-pilot-ukd0.onrender.com/wedding/books/4b6039a5-329c-4444-97f8-c299ec3d93a1/montage?szerkesztes=1#tartalom-atnezes).
2. Új kézi jelzéshez az „Átnézési állapot” szűrőben válaszd a „Nincs jelzés – nem ellenőrzött” vagy „Minden tartalom” lehetőséget. Az elemnél nyisd ki az „Új jelzés hozzáadása” részt, jelöld a kategóriákat, és írd be az indokot és az átnézés terjedelmét.
3. A függő tételek külön listában jelennek meg. A takart kép csak a „Kép megtekintése” gombbal nyílik meg. A tulajdonosi döntés ugyanitt menthető és később módosítható. A teljes kép/szöveg feloldásához teljes körű átnézést kell megadni; részleges döntés nem számít teljes ellenőrzésnek.
4. A szerkesztő „Kiadás célja” választója külön privát vagy megosztásra szánt változatot készít. A visszatartott elemek eltávolítása külön megerősítést kér, és az eredeti tartalmat megőrzi.
5. Új jelzés után a korábbi kiadás hozzáférése visszatartható. A döntések rendezése után az „Átnéztem, ezt a változatot újra jóváhagyom” gombbal lehet ugyanazt a változatot ismét engedélyezni. A már letöltött másolatok nem vonhatók vissza.

## A jelölés jelentése

A jelölés bizonytalan tartalmi észrevétel, amely tulajdonosi döntést kér. Nem bizonyított minősítés, nem automatikus törlési utasítás, és nem jelent elvégzett gépi vizsgálatot. Jelölés nélkül a tartalom `unreviewed`, vagyis nem vizsgált; ettől a jelenlegi pilotban még használható. A rendszer nem állítja róla, hogy biztonságosnak minősítették.

A kézi felület és az MCP három kategóriát ismer:

| Azonosító | Jelentés |
| --- | --- |
| `possible_sexual` | Lehetséges meztelenség vagy szexuális tartalom |
| `possible_extremist` | Lehetséges önkényuralmi vagy szélsőséges jelkép |
| `offensive_text` | Trágár, sértő szöveg |

Egy képen vagy szövegen több kategória és több eredetű jelzés is szerepelhet. Az alkalmazás tulajdonosi jelzése `manual`, az MCP által beküldött jelzés `mcp` eredetet kap. A `machine` adatbázisérték egy későbbi belső automatizmus számára fenntartott lehetőség; jelenleg nincs ilyen kliensművelet vagy automatikus felismerő. Az eredetet a szerver állapítja meg, a kliens nem állíthatja át.

Az azonos pontos tartalom, kategória és eredet ugyanazt a jelzést jelenti: új kéréskulcs sem duplázza meg. Eltérő kategória vagy eredet külön jelzésként megmarad. Azonos UUID kéréskulcs azonos normalizált kéréssel visszajátssza az eredményt; eltérő kérés `IDEMPOTENCY_CONFLICT` hibát ad. Új jelzés új revíziót hoz létre, a puszta ismétlés nem.

## Pontos cél és érintett rész

A cél beküldéshez, fotónál médiaazonosítóhoz, szerkesztett szövegnél mentett változathoz és elemhez kapcsolódik. A megjelenített név nem azonosító: azonos nevű vendégek nem vonódnak össze. Egy jelölt kép nem zárja ki a beküldő tiszta szövegét, és egy jelölt szöveg sem zárja ki automatikusan a többi képét.

A szerver maga számítja ki a tartalom lenyomatát. Szövegnél a pontos szöveg és forrásazonosító, fotónál az eredeti képbájtok és külön annotáció számít. Pillanatkép használatakor a befagyasztott képbájtok és annotáció az alap. A jelzés történeti bizonyítéka megőrzi a szöveget, illetve a média eredeti SHA-256 lenyomatát és annotációját; nem írja át az eredetit.

A kötelező `scope.kind` értékei `full`, `partial`, `unspecified`. A megjegyzés leírhatja a látott részletet vagy a bizonytalanságot. A sémában szereplő részleges időtartomány önmagában nem hang-/videótámogatás. Részleges vagy nem meghatározott körű „engedélyezett”/„téves jelzés” döntés nem oldja fel az egész képet vagy szöveget: a döntési előzmény megmarad, a tartalom továbbra is függő, amíg teljes körű átnézés nem történik.

Megváltozott tartalom más lenyomatot és más esetazonosítót kap. Korábbi döntését nem örökli. Az azonos logikai forrás korábbi jelzései ilyenkor történeti bizonyítékként jelennek meg, `contentChanged:true` és függő állapot mellett. A régi szövegelem új elem- vagy változatazonosítóval történő lemásolása nem kerüli meg a pontos tartalomra vonatkozó ellenőrzést. Szerkesztett szövegnél az eredeti forrásszöveg korlátozása és a szerkesztett szöveg saját jelzése egyaránt számít.

## Tulajdonosi döntések

Az MCP nem dönthet, nem oldhat fel jelzést és nem hagyhat jóvá kiadást. A négy döntés az alkalmazás hitelesített tulajdonosi munkamenetéhez kötött:

| Döntés | Hatás |
| --- | --- |
| `false_positive` | Téves jelzés; teljes körű döntés után a tartalom ismét használható. |
| `allowed` | Tulajdonos által engedélyezett; teljes körű döntés után használható. |
| `private_only` | A magánváltozatban használható; a megosztásra szánt változatból szerveroldalon kimarad. |
| `omit` | A feldolgozott könyvből kimarad, az eredeti beküldés és média megmarad. |

A döntések visszafordíthatók új döntéssel. A korábbi döntési sor nem módosul: megmarad a döntés, indok, érintett rész, tulajdonos, időpont és revízió. A felület az előzményt külön megjelenítheti. Jelölés nélküli célra nem adható előzetes „engedélyezett” állapot. Az opcionális `expectedContentHash` a kézi jelzésnél megakadályozza, hogy a megnyitott előnézet óta megváltozott forrás észrevétlenül kapja a döntéshez vezető jelzést. A döntés `expectedRevision` értéke a megtekintett lista revíziója: eltérésnél a szerver `CONTENT_REVIEW_CONFLICT` választ ad, így egy közben érkezett jelzést nem old fel a régi listára adott döntés. A mező a régi kliensekkel való együttműködés miatt opcionális az API-ban; az új tulajdonosi felület minden döntéshez elküldi. A már sikeresen elfogadott kérés azonos kulcsú újrapróbálása továbbra is idempotens.

Ez a tulajdonosi döntés az alkalmazáson belüli kiadási szabály. Nem módosítja és nem kerüli meg a külső modell- vagy szolgáltató saját tartalmi tiltásait. Nem indít fizetős modellhívást, nem ír adatkezelési vagy megosztási hozzájárulást, és nem tesz közzé tartalmat.

## Magánváltozat, megosztásra szánt változat és kiadási zár

A `Draft.editionVariant` értéke `private` vagy `shareable`; hiányzó értéknél a biztonságos alapértelmezés `private`. A `shareable` változatból a `private_only` tartalom szerveroldalon is kimarad. Függő és `omit` tartalom egyik változatba sem menthető vissza felhasznált elemként. A lefedettségi összesítés külön mutatja a felülvizsgálat miatti kimaradást, így a rendszer nem téveszti össze az eredetileg szöveget küldő vendéget a csak médiát beküldővel. Az `omittedItems` minden kihagyott képet/szöveget felsorol; az `omittedContributors` csak azokat a vendégeket jelenti, akiknek egyetlen beküldéséből sem maradt használható szöveg vagy média. A tiszta tartalommal továbbra is képviselt vendég részleges kimaradása a `partialOmissions` listába kerül. A gépi okkód mellett magyar indok is szerepel; függő esetnél pontosan: „Átnézésre váró tartalom miatt kimaradt.”

A változat mentése, jóváhagyása, exportindítása, exportfeldolgozása és PDF-letöltése ellenőrzi az aktuális szabályt. A régi HTTP-montázs útvonalak és PDF-aliasok sem adhatnak kerülőutat. A jelzések/döntések és az érdemi kiadási műveletek ugyanazt a könyvsort zárolják. Az exportfeldolgozó a renderelés után is ellenőriz: egy közben érkező tiltás miatt az elkészült bájtok nem válhatnak letölthetővé.

Új jelzés vagy szigorító döntés a korábban jóváhagyott, érintett kiadás letöltését is visszatartja. A már befagyasztott kiadás és PDF nem íródik át. Későbbi engedélyezés után is külön tulajdonosi kiadás-újraellenőrzés szükséges; ezt a változathoz tárolt revíziós feloldás jelzi. Blokkolt tartalomra nem adható ilyen feloldás. A korábban már letöltött vagy továbbadott fájlokat a szerver nem tudja visszahívni.

A `reviewCleanup:true` mentési út kizárólag tulajdonos számára elérhető. A szerver csak a ténylegesen blokkolt és az új tervből eltávolított elemeket veszi ki a korábbi zárolások összehasonlítási alapjából; a tiszta, zárolt elemek és oldalak védelme megmarad. A teljes új terv tartalmi ellenőrzése ezt megelőzi. Az eltávolított azonosítók a verziómentés auditjába kerülnek.

A „megosztásra szánt” PDF továbbra is hitelesített tulajdonosi letöltés. Nincs új nyilvános megosztási vagy médiacsomag-végpont. A változat kiválasztása nem helyettesíti a tényleges külső megosztáshoz szükséges külön hozzájárulást. A PDF továbbra is ellenőrző PDF, nem nyomdai tanúsítás vagy PDF/X igazolás.

## API és séma

A tulajdonosi útvonalak alapja `/api/book-workflow/:bookId`; a módosítások munkamenetet és megfelelő Origint igényelnek.

| Művelet | Szerződés |
| --- | --- |
| `GET /reviews` | Opcionális `category`, `status`, `sourceId`, `versionId`. A lista nem jelölt célokat is tartalmaz kézi jelöléshez. |
| `POST /reviews` | `{key,sourceId,mediaId?,versionId?,elementId?,expectedContentHash?,categories,reason,scope}`. `versionId` és `elementId` együtt, mentett szerkesztett szövegre használható. |
| `POST /reviews/:id/decision` | `{key,decision,note?,scope,expectedRevision?}`; csak tulajdonos. |
| `POST /review-draft` | `{draft,snapshotId?,versionId?}`; a konkrét terv blokkolt elemei és oldalai, tartalommódosítás nélkül. |
| `POST /versions/:id/approve` | `{expectedReviewRevision?}`; a felület a megjelenített revíziót küldi, így egy közben megváltozott felülvizsgálatot nem hagy jóvá észrevétlenül. |
| MCP `list_content_flags` | `bookId,category?,status?,sourceId?`; csak metaadat, a nyers szöveg és tulajdonosi előnézeti URL nélkül. |
| MCP `create_content_flag` | A jelzés mezői; eredet és döntés nem adható meg. Nincs MCP döntési vagy jóváhagyási eszköz. |

A lista állapotai: `all`, `pending`, `resolved`, `unreviewed`, `changed`; a `pending` szűrő a megváltozott, újra átnézendő célokat is tartalmazza. Az összesítésben `revision`, `pendingCount`, `pendingIds`, `totalCount` és `targetCount` szerepel. A `totalCount` a jelölt esetek száma, a `targetCount` az összes felsorolt cél száma. Az egyes esetek kategóriái, jelzései, pontos lenyomata, döntése és előzménye, érintett része, valamint változatonkénti oldalszámai külön mezők. Létrehozás/döntés válasza `{item,revision,replayed}`.

A kéréskulcsok és forrás-/média-/változatazonosítók UUID-k. A kategórialista 1–3 különböző érték; az indok 1–1000 karakter, a döntési és részletmegjegyzés legfeljebb 1000 karakter. Az ismeretlen, jogosultságot/eredetet/döntést befecskendező mezőket a domainréteg is elutasítja. A könyvtulajdon minden műveletnél ellenőrzött; MCP-hívásnál ezen felül az OAuth-könyvengedély és a telepítési MCP-engedélylista is külön korlát.

Az additív `20261117-v7` migráció egy revízióoszlopot ad az `event_books` táblához, és létrehozza az alábbi táblákat:

- `event_content_review_items`: pontos cél, lenyomat és történeti bizonyíték;
- `event_content_review_flags`: kategória, eredet, indok, érintett rész és jelző;
- `event_content_review_decisions`: hozzáfűzött tulajdonosi döntési előzmény;
- `event_content_review_requests`: idempotens kéréskulcsok és eredmények;
- `event_content_review_restrictions`: logikai célonként utolsó szigorító revízió;
- `event_content_release_clearances`: változatonkénti tulajdonosi kiadás-újraellenőrzés.

Az eset-, jelzés-, döntés- és kérésrekordok módosítását/törlését adatbázis-trigger tiltja. A műveleti auditba külön `content.flagged`, `content.decided` és `content.release_reviewed` bejegyzések kerülnek. A meglévő beküldések, képek, pillanatképek, változatok és kiadások nem íródnak át a migráció során. A domain: `server/wedding/content-review.ts`; közös típusok: `shared/content-review.ts`; integráció: `server/wedding/book-workflow.ts` és a régi montázs útvonalak.

## A pilot tényleges korlátai

- JPEG/PNG és külön rajz-/kézírás-annotáció támogatott. Hang- és videófeltöltés, átirat, képkocka-feldolgozás nem támogatott; `audio:false`, `video:false`, `automatedDetection:false`.
- A jelenlegi esküvői pilotban nincs meglévő, külön megerősített forrástörlési művelet. A törlés gomb tiltott, `delete:false`; az `omit` megőrzi az eredetit. Az alkalmazás más, régi könyvmodelljének korábban létező törlési viselkedése ettől nem változik.
- Nincs nyilvános megosztás, tartós média-QR vagy médiacsomag-export; `publicSharing:false`. A különböző kiadási változatok nem teremtenek új nyilvános hozzáférést.
- A jelölési indok és vendégtartalom nem végrehajtandó utasítás. A manuális/MCP-folyamat nem minőségi mérés egy gépi tartalomosztályozóról.
- Fizikai Samsung/iPhone és tényleges ChatGPT-fiók elfogadási próbáját a helyi Chromium-emuláció vagy MCP SDK-próba nem helyettesíti.

## Adatmegőrzési és ellenőrzési bizonyíték

A korábbi, MCP-bővítés előtti teljes adatbázismentés helyi visszaállítási próbája megtörtént. A mostani V7-kiadás előtt külön HTTPS-alapú, csak olvasási tartalommásolat készült: 8 könyv, 87 erőforrás. Ez **nem teljes adatbázismentés**: az elérhető alkalmazástartalom másolata nem igazolja valamennyi háttértábla, jogosultsági rekord vagy munkasor mentését. Az adatbázis külső tűzfala zárva maradt. A V7 migráció helyi ismétlési/adatmegőrzési próbája PASS; telepítés után mind a 87 rögzített erőforrás tartalma és lenyomata egyezett. Az új jelzések és döntések külön, hozzáfűzött rekordok. A mentésekben lévő érzékeny adatok nem kerülnek ebbe a dokumentumba vagy Gitbe.

| Ellenőrzés | E dokumentum készítésekor ismert eredmény |
| --- | --- |
| Új domain + workflow + régi API-regresszió + korábbi könyvworkflow + montázs | **12/12 PASS**, a revízióütközés új altesztjével együtt, elkülönített helyi PostgreSQL-sémákon, fiktív adatokkal. |
| MCP- és engedélylista-csoport | **7/7 PASS**, az MCP-részfeladat visszajelzése szerint. |
| Internetes technikai próba helyreállítási tesztjei | **7/7 PASS**, hálózat nélküli tesztek: saját jelzések ellenőrzése, idegen döntés megőrzése, döntési és kiadási revízióütközés, lezárt próba újranyitásának tiltása. |
| Wedding- és internetes pilot-integráció helyi regressziója | **21/21 PASS**, a kiadásvezető legutóbbi futtatása szerint. |
| Korábbi MCP-szerkesztő asztali/érintős böngészőpróba | **2/2 PASS**. |
| Montázs Chromium-próba | **1/1 PASS**. |
| Backend TypeScript, módosított domainfájlok lintje, diff-ellenőrzés | PASS. |
| Szélesebb helyi tesztfuttatás | Az együttes futás köztes eredménye **44/45** volt; az akkor hibás teljes felületi folyamat külön újrafuttatva **1/1 PASS**. Ez nem egyetlen 45/45-ös futás eredménye. |
| Új felülvizsgálati mobilfelület | **1/1 PASS** a végső felülettel: maszkolás, kézi jelzés, részleges vizsgálat, döntési napló, kiadásvisszatartás, új jóváhagyás, privát/megosztható váltás és zárolt oldal megtartása. Chromium mobilméretű emuláció; nem fizikai telefon. |
| Meglévő fotó-, rajzolási és webshop-böngészőpróbák | **5/5 PASS**: 3 Chromium és 2 WebKit. A korábban tapasztalt WebKit-indítási akadály ezen a futáson nem jelentkezett; OS-beállítás nem változott. |
| Megosztható próba-PDF bájtjai és renderelt képe | PASS: 1 oldal, 1 megmaradó kép; a privát próbaszöveg és a másik kép hiányzik, a tiszta üzenet szerepel. Nem került kizárt média a renderelőnek átadott médiakészletbe. |
| Új kiadás élő telepítése és ellenőrzése | LIVE; HTTPS/MCP **16/16 PASS**, névtelen/origin-védelem **8/8 PASS**, élő asztali/mobilméretű böngésző **PASS**. |

A csoportok átfedhetnek, ezért a sorok számai nem összeadandó független tesztesetszámok.

A frontend TypeScript/build és az összes érintett felületi fájl lintje PASS. A régi alkalmazás a felülvizsgálati képesség hiányában megtartja a korábbi felületét; a pilot kifejezetten meghirdeti az új képességet. Main/éles szerverre nem került új útvonal vagy telepítés.

Az internetes próba külön kapcsolóval indítható: `node --import tsx scripts/verify-mcp-internet.ts --content-review test-results/mcp-internet/config.local`. Csak a konfigurációban rögzített fiktív könyv egy jelzés nélküli szintetikus képére készít két jelzést. A próbát azonosító indok, eredet, kategóriák, azonosítók és tartalomlenyomat alapján ismeri fel. Saját jelzését tulajdonosi végponton téves jelzésként lezárja, ugyanazt a változatot újra jóváhagyja, és ellenőrzi a PDF eredeti lenyomatát. Közben érkező idegen jelzést vagy döntést nem ír felül: a döntés és az új jóváhagyás is revízióhoz kötött. A technikai OAuth-engedélyt végül visszavonja. Valódi ChatGPT-t nem hív.

A `tests/content-review.test.ts` ellenőrzi a szigorú paramétereket, hamis eredet/döntés tiltását, régi MCP-engedély korlátozását, párhuzamos idempotenciát, több kategóriát, azonos nevű beküldők külön kezelését, részleges döntés után fennmaradó zárat, változatlan auditot, megváltozott szöveget/képet és befagyasztott médiahash-t, másolt szerkesztett szöveg ellenőrzését és a kiadási újraellenőrzés szükségességét. Az új ütközési alteszt igazolja, hogy közben érkező jelzés után a régi revízióra adott döntés elutasított, két párhuzamos döntés közül egy kerül be, és a már elfogadott kérés azonos kulcsú ismétlése továbbra is működik. Külön állítás ellenőrzi, hogy egy vendég másik tiszta szövege vagy képe mellett csak részleges kimaradás jelenthető.

A `tests/content-review-workflow.test.ts` az integrált mentési/jóváhagyási/export-/letöltési zárat, régi PDF-aliasokat, magán/megosztásra szánt változatot, változatlan korábbi kiadást és renderelés közbeni új jelzés hatását vizsgálja. A korábbi workflow- és montázsteszt valódi PDF-et generál 30 szintetikus képpel, illetve 100 stabil vendégazonosítóval. A tesztműtermékek a Gitből kizárt `test-results/content-review`, `test-results/mcp` és a meglévő pilot-ellenőrzési mappákban vannak; nem éles vendégtartalmat használnak.

## Telepítés utáni tényleges eredmény

- A `d42d7f50719cab40392de13712f4c4bb9329f195` alkalmazáscommit a `codex/wedding-internet-pilot` ágról került a meglévő Free szolgáltatásra; `dep-dbu3taon74is73fc4hlg` LIVE 2026-11-17 11:48:06 UTC. Automatikus deploy kikapcsolva, új erőforrás/csomagváltás/modellhívás nélkül.
- A hivatalos MCP SDK-val végzett HTTPS-próba **16/16 PASS**: OAuth/DCR/PKCE, 15 eszköz, kizárólag a fiktív könyv, másik saját könyv tiltása, valós PNG-képbájtok, korábbi tervezet és export idempotens visszaolvasása. A próba ténylegesen létrehozott két külön kategóriájú MCP-jelzést egy ártalmatlan szintetikus képre; az ismétlés nem duplázott. Hamis döntés/eredet és más könyv elutasítva.
- Jelzés után a történeti pillanatkép képe, a korábbi tervezet MCP-lekérése és a kész PDF tulajdonosi letöltése tiltott; az export visszatartott állapotban letöltési URL-t sem ad. A saját technikai jelzés tulajdonosi végponton „Téves jelzés” döntést kapott, az eredeti változat új jóváhagyással ismét elérhető. A PDF változatlan: 805 903 bájt, SHA-256 `41b346bbfafe85e837f3859210d86e4b8bc7b255c433f73ac8f295712a6f24ee`. A teszt OAuth-engedélye visszavonva; aktív technikai grant nincs.
- A telepítés előtti HTTPS-másolat **8 könyvének 87 erőforrása** bájt-/értékazonos maradt: könyvmezők és beküldések, eredeti képek, annotációk, mentett tervezet, befagyasztott pillanatkép és képei, kész PDF. Bizonyíték: `test-results/content-review/pre-release/verification.json`. A döntési napló új rekordjai szándékos kiegészítések.
- Élő Chromium asztali (1280×1000) és mobilméretű (390×844) próba **PASS**. A jelzett kép sem az oldalon, sem az átnézési kártyán nem töltődött be a tudatos megnyitás előtt; utána megjelent. Nincs vízszintes túlcsordulás, JavaScript-hiba vagy hibás hálózati válasz. A könyv-, kiadás-, export- és átnézési állapot változatlan maradt; a próba minden író kérést tiltott. A névtelen mobilnézet 401-es védelmet és belépési linket adott, könyvtartalom nélkül.
- Külön névtelen/origin/discovery-ellenőrzés **8/8 PASS**. A telepítés után a meglévő tulajdonosi munkamenet, jóváhagyás, export és visszavont grant állapota megmaradt.
- A vizsgált 11 alkalmazásnapló-bejegyzésben nem volt hibamintázat vagy tokent/kapcsolati titkot jelző minta. A megfigyelt folyamatmemória legfeljebb körülbelül 131 MiB volt az 512 MiB-os keretből; ez rövid üzemeltetési ellenőrzés, nem terheléses mérés.
- A PostgreSQL továbbra is Free, külső IP-engedélylista `[]`. Az ingyenes adatbázis lejárata **2026-12-07 10:53:45 UTC**. A main SHA változatlan: `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`; az éles szolgáltatás `updatedAt` értéke változatlanul 2026-09-14 08:49:25 UTC.

Bizonyítékok: `test-results/mcp-internet/{verification,browser-verification,anonymous-security,restart-verification}.json`, `mobile-review-card-covered.png`, `mobile-review-card-revealed.png`, `mobile-review-panel.png`; mind Gitből kizárt. A későbbi dokumentációs/ellenőrzőszkript-commit nem módosítja a telepített alkalmazáskódot.

**Valódi ChatGPT-fiókos elfogadási próba és fizikai Samsung/iPhone: továbbra is NYITOTT.** A 15 eszközös kapcsolat beállítása a [bekötési útmutatóban](MCP_CONNECTION_20261117.md) szerepel; titkos token nem szükséges a jelentésből.
