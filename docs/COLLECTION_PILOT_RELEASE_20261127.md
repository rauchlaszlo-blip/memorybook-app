# Anyaggyűjtési HTTPS-pilot – 2026. november 27.

A tulajdonos engedélyezte a külön ág commitját, pusholását és külön díjmentes
HTTPS-pilot telepítését. A `main`, az éles MemoryBook és a korábbi esküvői pilot
alkalmazása nem változik. Könyvrendezés és fizetős AI nincs ebben a kiadásban.

## Elkülönítés és konfiguráció

- Forrás: `codex/wedding-collection-20261126`, a `main` `5d2d4f5` állapotából.
- Új Render webszolgáltatás: Free, Frankfurt, kézi deploy; új fizetős erőforrás nélkül.
- Meglévő díjmentes pilotadatbázis, kizárólag az új `collection_pilot_20261127`
  séma. A keresési útvonal nem tartalmazza a korábbi `public` sémát.
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

A végső helyi regresszió **30/30 PASS, 0 kihagyott teszt**. Produkciós build,
TypeScript, érintett modulok ESLintje, FFmpeg/ffprobe indítása és diff-check PASS.
A korábbi 23 próba mellett külön ellenőriztük a zárt sémaindítást, a valódi
pilot vászonmentést külső képtár nélkül, az újraindítás utáni adatmegőrzést,
a szűk tulajdonosi próbasütit és a régi pilot hash-ellenőrzőjét.
Helyi bizonyíték: `test-results/collection-release-20261127/final-tests.log`.
A telepítés és az internetes próba eredményeit a kiadás után egészítjük ki.
A korábbi pilot első, olvasási ellenőrzése 2 tulajdonosi könyv, 42 beküldés,
42 eredeti, 30 kiadási média és 1 PDF állomány hashét rögzítette.
A régi külön operátori munkamenet lejárt, ezért ez önmagában nem teljes körű
régiadat-ellenőrzés. A régi adatokat a kiadás nem migrálja.

Fizikai Samsung/Chrome és iPhone/Safari: **NYITOTT**.
Az automatizált böngészőpróba és a szimulált kamera nem helyettesíti ezeket.
A rövid telefonos átvételi lista a fejlesztési átadásban található.

Titkos kapcsolati címek, sütiértékek és belépőkulcsok nincsenek ebben a jelentésben.
