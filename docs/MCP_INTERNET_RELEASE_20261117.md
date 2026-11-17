# MCP internetes pilot – kiadási napló, 2026-11-17

Frissítés: az „Átnézendő tartalmak” bővítés külön kiadása `d42d7f50719cab40392de13712f4c4bb9329f195`, `dep-dbu3taon74is73fc4hlg`, LIVE 2026-11-17 11:48:06 UTC. Az új HTTPS/MCP-próba 16/16 PASS, az adatmegőrzési összehasonlítás 8 könyv/87 erőforrás PASS, élő asztali/mobilméretű olvasási próba PASS. Részletek és fennmaradó korlátok a [tartalomátnézési naplóban](CONTENT_REVIEW_20261117.md). Az alábbi korábbi kiadási eredmények történeti adatok.

## Felhatalmazás és hatókör

A felhasználó 2026-11-17-én engedélyezte a szükséges commitot, a `codex/wedding-internet-pilot` ág pusholását és a meglévő díjmentes, elkülönített pilot kiadását. Main, éles MemoryBook, meglévő pilotadatok változatlanul megőrzendők. Új fizetős szolgáltatás és modellhívás nem megengedett.

## Kiadás előtti tényleges ellenőrzés

- Pilot: `srv-dbng6ojrjlhs738notk0`, Free, Frankfurt, manuális deploy; kizárólag `codex/wedding-internet-pilot`.
- HTTPS-origin: `https://memorybook-wedding-text-pilot-ukd0.onrender.com`.
- DB: `dpg-dbng6e3rjlhs738nntd0-a`, `memorybook_wedding_internet_pilot`, Free PostgreSQL 17, 8,43% / 1 GB. Lejárat 2026-12-07 10:53:45 UTC.
- Ellenőrzött workspace-keret: 3,93/750 ingyenes óra, 22/500 pipeline-perc, 147 MB/5 GB sávszélesség. Nincs csomagváltás vagy új erőforrás.
- Éles szolgáltatás: `srv-dabepfid0e5s73e8p12g`; külön `main` ág. Távoli main ellenőrzött SHA: `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`.
- Korábbi élő pilotkód: `11bcbcac50668bf066f719b631146e4e776fd5d3`; deploy `dep-dbnjakm417fc73du2itg`.

## Adatmegőrzés

A felhasználó külön engedélyezte a saját gép egyetlen /32 IP-címének ideiglenes engedélyezését kizárólag mentésre. `pg_dump` csak olvasható kapcsolat, TLS 1.3, `verify-full` és megbízható CA-tár mellett készült. Az ideiglenes szabályt a mentés után eltávolítottuk; Render MCP visszaellenőrzés: `ipAllowList: []`. A kapcsolati titkot tartalmazó ideiglenes helyi fájlt töröltük.

- Mentés: `test-results/mcp-pilot/internet-backup/memorybook-pilot-before-mcp.dump` (Gitből kizárt), 19 337 917 bájt.
- SHA-256: `283238ea2bc9a05fa4c516e597fb29c55c89df41a06545932699452d6af2f6fe`.
- Új helyi adatbázisba visszaállítás PASS: 16 tábla, 71 rekord; 10 eredeti kép, 15 432 987 eredeti képbájt.
- V5/V6 + auth migráció a visszaállított másolaton PASS: a meglévő könyvek, beküldések, képek, annotációk, tulajdonosok, tesztrendelések és jogosultságok eredeti mezőértékei változatlanok.
- Bizonyíték: `backup-manifest.json`, `restore-verification.json`, `migration-verification.json` ugyanebben a kizárt könyvtárban.

## Kiadási sorrend és elhatárolás

1. Ellenőrzött kód commit/push kizárólag a pilotágra.
2. Első kiadás explicit üres `MEMORYBOOK_MCP_ALLOWED_BOOK_IDS` értékkel: minden MCP-könyvhozzáférés tiltott.
3. Meglévő tulajdonosi fiók alatt új, egyértelműen fiktív tesztkönyv készül az alkalmazás saját HTTP API-ján; korábbi könyv nem módosul. Kizárólag szintetikus képek és szövegek.
4. A kijelölt új könyv UUID-ja kerül az egyetlen elemű deployment-engedélylistába. OAuth-hozzájárulás ezen felül szükséges; régi grant sem kerülheti meg a korlátot.
5. Új kiadás és hivatalos MCP SDK-val HTTPS OAuth, eszközfelfedezés, képbájtok, verziómentés, tulajdonosi jóváhagyás és védett PDF-export ellenőrzés. A technikai próba grantjét visszavonjuk.
6. Tulajdonosi böngészős próba és pontos felhasználói kapcsolódási útmutató.

Az internetes végrehajtás tényleges eredményei alább szerepelnek. A hivatalos SDK-próba nem tényleges ChatGPT-kapcsolat; a mobil nézet nem fizikai telefonos PASS. Titkos tokenek és belépési adatok nem kerülnek ebbe a naplóba vagy Gitbe.

## Tényleges internetes végrehajtás

- `22ca4188d3fb8962c7a1a2b3b173fd326d61a590`: teljes MCP/szerkesztő pilotcommit. Első kiadás `dep-dbtuht8n74is73etegc0`, live 05:42:26 UTC, explicit üres MCP-engedélylistával.
- Új külön tesztkönyv az alkalmazás HTTP API-jával: `4b6039a5-329c-4444-97f8-c299ec3d93a1`, **MCP internetpilot – fiktív e2e27b2e**. Meglévő fiktív tesztfiók; új 0 Ft-os tesztjogosultság, fizetési szolgáltató vagy modell nélkül. 10 technikai vendégcsoport, 30 beküldés, 30 szintetikus kép, 2 rajzréteg. A HTTP-vendégvégpont szöveget követel; média-only beküldést ezen az internetes próbán nem állítottunk elő.
- Az első szintetikus rajzot a szerver helyesen elutasította (`ANNOTATION_INVALID`). A tesztszkript kanonikus színekkel/vonalvastagsággal és előzetes helyi validálással folytatta ugyanazt az új könyvet. Korábbi könyvet nem módosított.
- `7b7e772401d85e6fff4e1142a61f4d586811e892`: internetes ellenőrző szkriptek. Második kiadás `dep-dbtuk2cipgvc73a6vnp0`, live 05:47:19 UTC; deployment-lista pontosan az új tesztkönyv UUID-ja.
- Élő HTTPS és hivatalos MCP SDK: **14 ellenőrzés PASS**. DCR, S256, tulajdonosi hozzájárulás, stabil callback/state/issuer ellenőrzés, 13 eszköz, kizárólag egy könyv, másik saját könyv tiltása, valódi dekódolt PNG, lapozott pillanatkép, idempotens verziómentés/visszaolvasás, jóváhagyás előtti exporttiltás, tulajdonosi végponton végzett technikai jóváhagyás, tartós export, védett letöltés és grant-visszavonás. A callbacket a teszt elfogta; nem hívta a ChatGPT-t.
- Külön névtelen/origin-ellenőrzés: **8 PASS**. HTTPS-health és discovery; tulajdonosi API, workflow és MCP hitelesítés nélkül tiltott; idegen Origin, idegen callback és helyi belépési kerülőút elutasított.
- Jóváhagyott tesztverzió: `22b41a68-6838-49c1-b79c-b20706809fd6`; PDF-munka: `7e8cbe2a-1d51-4ab3-8240-a622698a7d44`. PDF: 805 903 bájt, SHA-256 `41b346bbfafe85e837f3859210d86e4b8bc7b255c433f73ac8f295712a6f24ee`. 16 A4-oldal, 30 kép, beágyazott DejaVu, magyar ékezetek, oldalsorrend és minden TrimBox ellenőrzött. Mind a 16 renderelt oldal áttekintve; nincs észlelt levágás. Ellenőrző PDF, nem PDF/X vagy nyomdai megfelelőségi igazolás.
- Élő adatmegőrzési próba: a mentéshez képest **7 régi könyv, 17 beküldés, 10 kép és 4 annotáció változatlan**. Könyv-/szövegmezők, eredeti képek SHA-256 lenyomata és teljes rajz-JSON összehasonlítva a tulajdonosi HTTPS API válaszaival.
- Az első telepített böngészős próba asztali és 390 px érintéses mobil-emulációban PASS: a mentett/jóváhagyott változat, 30 kép, font és PDF-link megjelent, vízszintes túlcsordulás és író kérés nélkül. Egy kisebb PDF-link térközproblémát a végső felületjavítás kezel; annak külön végellenőrzését alább rögzítjük.
- Megvizsgált friss Render alkalmazásnapló: nincs hibaszintű esemény vagy tokenmintázat. Ez az elérhető naplók vizsgálata, nem a szolgáltató belső proxymegőrzésének független auditja. A megfigyelt folyamatmemória a 512 MiB-os csomaghatáron belül volt.

Bizonyítékok (Gitből kizárva): `test-results/mcp-internet/{seed-verification,verification,anonymous-security,preservation-verification,pdf-validation,browser-verification}.json`, `approved-proof.pdf`, `mcp-image.png`, PDF-oldalképek és böngészőképek. A próbarendezés determinisztikus tesztterv; nem állítjuk, hogy ChatGPT készítette.

**Valódi ChatGPT-fiókos eszközfelfedezés/képértés/írás és fizikai Samsung/iPhone: NYITOTT.** A felhasználói csatlakozási lépések és pontos HTTPS-/tulajdonosi címek a [bekötési útmutatóban](MCP_CONNECTION_20261117.md) találhatók. Az ingyenes adatbázis 2026-12-07-én lejár; a jelen mentés helyben megmarad, automatikus fizetős váltást nem kértünk.

## Végső kiadás és újraindítás utáni ellenőrzés

- Telepített alkalmazáscommit: `ee56f11b3e0af114acdb07a840bbe65bd5ef9045`; deploy `dep-dbtuorqfngtc73a9uc70`, **LIVE 2026-11-17 05:57:04 UTC**.
- A telefonos PDF-link térköze javítva, a kijelentkezett tulajdonos közvetlen próbalinkjén érthető belépési útmutató jelenik meg. Frontend típusellenőrzés/build és érintett lint PASS.
- Végső élő böngészőpróba: asztali + 390 px érintéses emuláció **PASS**. Mindkettőben a várt jóváhagyott verzió, 30 sikeres képválasz, beágyazott font és tényleges vászontartalom. A PDF-link már nem takarja a verziósort (mobilon 4 px térköz); vízszintes túlcsordulás 0. Névtelen mobilnézet 401-es védelem és tulajdonosi belépési link, privát könyvtartalom nélkül. Minden író kérés tiltva a próba során; a mentett szerverállapot változatlan.
- Új kiadás/újraindítás után **PASS**: meglévő tulajdonosi session, pillanatkép, mentett változat, jóváhagyás és exportmunka megmaradt. A letöltött PDF SHA-256 lenyomata azonos; aktív technikai MCP-grant 0 (a próba grantje visszavonva maradt).
- Az összes korábbi pilotadat élő HTTPS összehasonlítását a végső kiadás után ismételtük: 7 könyv, 17 beküldés, 10 eredeti kép és 4 rajzréteg továbbra is egyezik a kiadás előtti mentéssel.
- Main SHA változatlan: `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`. Az éles MemoryBook szolgáltatás beállításai és kiadása változatlanok. Új szolgáltatás, csomagváltás, külső modellhívás vagy fizetés nem történt.
- Végső bizonyíték: `restart-verification.json`, friss `preservation-verification.json` és `browser-verification.json`; képek: `mobile-workflow.png`, `mobile-anonymous-login.png`, asztali/mobil szerkesztő és vászon. Mind a `test-results/mcp-internet` könyvtárban, Gitből kizárva.

A napló ezt követő dokumentációs commitja nem módosítja a telepített alkalmazáskódot; az automatikus deploy kikapcsolva marad.
