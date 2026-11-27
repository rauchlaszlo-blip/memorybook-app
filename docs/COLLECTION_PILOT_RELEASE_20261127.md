# Anyaggyűjtési HTTPS-pilot – 2026. november 27.

A tulajdonos engedélyezte a külön ág commitját, pusholását és külön díjmentes
HTTPS-pilot telepítését. A `main`, az éles MemoryBook és a korábbi esküvői pilot
alkalmazása nem változik. Könyvrendezés és fizetős AI nincs ebben a kiadásban.

## Elkülönítés és konfiguráció

- Forrás: `codex/wedding-collection-20261126`, a `main` `5d2d4f5` állapotából.
- Új Render webszolgáltatás: Free, Frankfurt, kézi deploy; új fizetős erőforrás nélkül.
- Meglévő díjmentes pilotadatbázis, kizárólag az új `collection_pilot_20261127`
  séma. A keresési útvonal nem tartalmazza a korábbi `public` sémát.
- Az adatbázis meglévő `default_transaction_read_only=on` alapértéke változatlan.
  Kizárólag az új pilot saját kapcsolatai használnak írható munkamenetet;
  szerepkör- vagy adatbázis-szintű beállítást nem módosít a program.
- `COLLECTION_PILOT_ENABLED=yes`, `COLLECTION_DATABASE_SCHEMA=collection_pilot_20261127`.
- Fiktív könyv: `collection-wedding-pilot-20261127`. Az újraindítás nem írja felül
  a már meglévő könyvet, eseményeket vagy beküldéseket.
- `COLLECTION_PILOT_GUEST_TOKEN`: külön véletlen QR-kulcs; nem kerül a repositoryba.
- `COLLECTION_PILOT_TRIAL`: a fiktív könyv, tulajdonos, cím, lejárat és a próbakulcs
  SHA-256 lenyomata. Nyers tulajdonosi kulcs nem kerül a szerverkonfigurációba.
- A tulajdonosi próbalink töredékében kapott kulcsot a böngésző egy azonos eredetű
  kérésben váltja Secure, HttpOnly, SameSite=Strict sütire. Ez kizárólag a kijelölt
  könyv anyaggyűjtő felületét és annak API-műveleteit engedi elérni.
- A rendes bejelentkezés, OAuth és fizetés nincs konfigurálva az új pilotban.
- Az eredetik, a szerkeszthető adatok és a külön előnézetek PostgreSQL-ben élnek;
  a pilot vászonelőnézete sem igényel Cloudinary-kapcsolatot.

Indítás: `node --import tsx server/index.ts`. Build:
`npm ci --include=dev && npm run build && npm run typecheck:collection && node --import tsx scripts/check-collection-media.ts`.
Node: 24.22.1. A szokásos gyűjtési korlátok és a részletes mentés/visszaállítás
leírása a [fejlesztési átadásban](WEDDING_COLLECTION_20261126.md) található.
Render HTTP állapotfigyelés: `/api/health`.

## Díjmentes kapacitás és érvényesség

A Render kezelőfelületén kiadás előtt ellenőrzött havi használat:
13,38 / 750 ingyenes gépóra, 503 MB / 5 GB adatforgalom,
37 / 500 buildperc, 11 / 25 szolgáltatás. A meglévő próbaadatbázis 1 GB-os,
10,09%-os foglaltsággal; nincs automatikus tárhelybővítés. A hálózati külső
engedélylista üres marad: kizárólag belső kapcsolattal dolgozik az új alkalmazás.

**A meglévő ingyenes adatbázis 2026. december 7-én lejár.** Ez időben korlátozott
telefonos tesztkörnyezet, nem tartós esküvői archívum. A próba tulajdonosi linkje
2026. december 6. 22:59:59 UTC-ig érvényes. A szükséges eredetiket és adatjegyzéket
a lejárat előtt le kell menteni. Automatikus fizetős átállítás nem történik.

## Ellenőrzési bizonyíték

A végső helyi regresszió **33/33 PASS, 0 kihagyott teszt**. Produkciós build,
TypeScript, érintett modulok ESLintje, FFmpeg/ffprobe indítása és diff-check PASS.
A korábbi 23 próba mellett külön ellenőriztük a zárt sémaindítást, a valódi
pilot vászonmentést külső képtár nélkül, az újraindítás utáni adatmegőrzést,
a szűk tulajdonosi próbasütit és a régi pilot hash-ellenőrzőjét.
Az internetes környezet csak olvasható adatbázis-alapértékét külön reprodukáltuk:
az új pilot írhat, a szokásos kapcsolatok továbbra is csak olvashatnak, a régi
táblák és az alapérték változatlanok. A HTTPS-próba segédeszköze is célzott tesztet kapott.
Helyi bizonyíték: `test-results/collection-release-20261127/final-tests-33.log`.
Az új szolgáltatás: `srv-dc4qhtrl550s73abg4v0`,
[HTTPS alkalmazás](https://memorybook-collection-pilot-20261127.onrender.com).
A `daf4dcd` futtatott változat `dep-dc4qlcm1egvs739fq1h0` kiadása LIVE állapotú,
a `/api/health` kívülről HTTP 200-at adott.

Külső HTTPS-próba kizárólag egy fiktív beküldéssel, három ártalmatlan fájllal:
JPEG, 2 másodperces hang, 2 másodperces videó. Igazolt a darabos feltöltés
folytatása és ismétlésvédelme; a tulajdonosnál ténylegesen megfigyelt állapotok:
feltöltés, feldolgozás, kész. A külön előnézet és a szerkeszthető szöveg/rajz
mentése, az egyszeri véglegesítés, az ismételt nyugta és újratöltés utáni
nyugta-visszaolvasás sikeres. Mindhárom letöltött eredeti SHA-256 értéke egyezik
a bemenettel. A ZIP 6 bejegyzése, ellenőrzőösszegei, adatjegyzéke és eredetijei
ellenőrizve; vendégbelépő kulcsot nem tartalmaznak.
Hang és videó: teljes válasz HTTP 200, részletkérés 206; valódi asztali Chrome
390 px-es nézetében mindkét lejátszó idővonala ténylegesen elindult, automatikus
lejátszás nélkül. A telefonméret szimuláció, nem fizikai telefon.
Nyolc tiltott próbaútvonal és három bejelentkezés nélküli eredetiletöltés tiltva.
A teljes internetes ellenőrző **PASS**: a tulajdonosi link beváltása,
tényleges hang/videó-lejátszás, kilépés utáni hozzáférésmegvonás és a többi
beküldés változatlansága is igazolt. A megismételt futások ugyanazt az egy
beküldést és fájlazonosítókat használták, új kvótafelhasználás nélkül.
Bizonyíték: `test-results/collection-release-20261127/https-verification.json`;
az első feltöltési állapotok külön: `https-first-run-evidence.json`.

Az első lejátszási teszt 400 ms-os várakozása túl rövidnek bizonyult a hálózati
hangindításhoz. A diagnosztika 900 ms-nál már haladó idővonalat igazolt, médiahiba
nélkül. A teszt ezután a tényleges elindulást várja korlátos ideig; az alkalmazás
lejátszója emiatt nem változott.

A kiadási indítás a régi adatbázis **mind a 36 public táblájának** darabszámát
és teljes sortartalmának SHA-256 lenyomatát összehasonlította. Mind az indítás
előtt/után, mind az első kiadási kísérlethez képest azonosak. Bizonyíték:
`test-results/collection-release-20261127/public-preservation.json`.
A korábbi pilot első, olvasási ellenőrzése 2 tulajdonosi könyv, 42 beküldés,
42 eredeti, 30 kiadási média és 1 PDF állomány hashét rögzítette.
A régi külön operátori munkamenet lejárt, ezért ez önmagában nem teljes körű
régiadat-ellenőrzés. A fenti teljes adatbázis-lenyomat ezt külön kiegészíti.
A régi adatokat a kiadás nem migrálja. A korábbi pilot és az éles szolgáltatás
ága, utolsó kiadása és konfigurációjának módosítási időpontja változatlan.

Fizikai Samsung/Chrome és iPhone/Safari: **NYITOTT**.
Az automatizált böngészőpróba és a szimulált kamera nem helyettesíti ezeket.
A rövid telefonos átvételi lista a fejlesztési átadásban található.

Titkos kapcsolati címek, sütiértékek és belépőkulcsok nincsenek ebben a jelentésben.
