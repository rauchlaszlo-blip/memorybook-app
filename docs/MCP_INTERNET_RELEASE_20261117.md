# MCP internetes pilot – kiadási napló, 2026-11-17

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

Az internetes ellenőrzés eredményeit a végrehajtás után alább kell rögzíteni. A hivatalos SDK-próba nem tényleges ChatGPT-kapcsolat; a mobil nézet nem fizikai telefonos PASS. Titkos tokenek és belépési adatok nem kerülnek ebbe a naplóba vagy Gitbe.
