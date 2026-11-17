# Vendégoldali kamera és mikrofon – 2026-11-17

## Kiindulás és hatókör

A `codex/wedding-internet-pilot` ág korábbi JPEG/PNG feltöltést, natív fotókészítést kérő `capture` fájlválasztót, helyi előnézetet, külön rajz-/kézírásréteget és explicit beküldést tartalmazott. A vendégoldalon nem volt MediaRecorder-alapú videó- vagy hangfelvétel. A csomagleírásban szerepelt a 10 fotó / 2 videó / 2 hangüzenet keret, de csak a fotóútvonal volt aktív. A fotókorlát korábban csak a csomaghoz tartozó könyvekre vonatkozott.

A jelen fejlesztés a külön, fiktív internetes pilotot bővíti. A main és az éles MemoryBook nem célpont. Új fizetős szolgáltatás, AI-modellhívás vagy automatikus tartalomfelismerés nem tartozik a körhöz.

## Elvárt használat és korlátok

A vendég egy beküldéshez egy fotót, videót vagy hangüzenetet választ. A felvétel elkészülte nem indít beküldést. Előnézet/visszajátszás után a külön Beküldés gombbal kerül véglegesítésre. Fotóhoz szöveg és külön megőrzött kézírás-/rajzréteg kapcsolható. A felvétel elvethető és újra elkészíthető.

Könyvenként és sütiben tárolt vendégazonosítónként 10 fotó, 2 videó és 2 hangüzenet küldhető. Videó és hang legfeljebb 20 másodperces. Az azonosító egy böngésző tárolójához kötődik; másik böngésző és törölt sütik új azonosítót jelenthetnek. Ez nem személyazonosítás.

A felvételhez a böngésző engedélyt kér. Megtagadás, hiányzó eszköz vagy nem támogatott böngésző esetén a fájlfeltöltés megmarad. A használat közben látható a kamera/mikrofon állapota. Leállítás, elvetés, háttérbe kerülés vagy kilépés lezárja a médiafolyamot. A félbeszakadt felvétel nem küldődik be automatikusan.

A kvótát csak a végleges beküldés használja. A hibás fájl, elvetett előnézet és a már elfogadott kérés azonos kulcsú újraküldése nem fogyaszt további darabszámot. A még nem csatolt feltöltések az ideiglenes tárhelyet foglalhatják a lejáratig; ez külön technikai korlát, nem a vendég darabkerete.

Elveszett feltöltési válasz és oldalújratöltés után a vendég a saját sütijével, könyvlinkjével és mentett próbálkozási kulcsával visszakeresheti a sikeresen feltöltött fájl azonosítóját. A helyreállítás nem küldi be automatikusan az anyagot: az explicit újrapróbálás szükséges. Másik vendég azonosítójával a visszakeresés sem engedett. Ha az eredeti fájl sosem ért fel és a böngészőből már eltűnt, a felvétel bájtjai nem állíthatók vissza; új felvétel kell. Teljes offline vagy kilépés utáni helyi médiamegőrzést a pilot nem ígér.

## Szerveroldali ellenőrzés

A fájlnév és a böngésző MIME-adatának elfogadása helyett tényleges fájlszerkezet- és dekóderellenőrzés szükséges. Fotónál a meglévő teljes JPEG/PNG dekódolás, AV-nál FFprobe és teljes FFmpeg dekódolás mér tényleges időtartamot. A kliens időzítője nem jogosultsági ellenőrzés.

A mérés a teljes dekódolt képkocka végéig, illetve az összes hangmintáig tart; a konténer fejlécében megadott hossz és az utolsó képkocka kezdőideje önmagában nem elég. Az alkalmazáson belüli felvétel 19,5 másodpercnél áll le, hogy a böngésző lezárása és a kódoló végső mintái is beleférjenek a szigorú szerveroldali 20 másodpercbe.

Támogatott: JPEG/PNG; videónál MP4/MOV H.264 vagy HEVC, WebM VP8/VP9; hangnál M4A/MP4 AAC, WebM/Ogg Opus/Vorbis, támogatott PCM WAV. A videó legfeljebb 1920×1080 képpont (álló tájolás is), 60 fps; a hang legfeljebb 48 kHz, két csatorna. Az alkalmazás saját videófelvétele 720p/legfeljebb 30 fps beállítást kér. Más kodekek és HEIC/HEIF továbbra sem támogatottak. A közvetlen felvétel a böngésző által ténylegesen támogatott MIME/kodeket választja, AAC vagy Opus hanggal.

Ha az adott böngésző egy kiválasztott fájlt helyben nem tud dekódolni, ezt az előnézetnél külön jelzi. A fájl ettől még kiválasztható, és kizárólag a Beküldés után kerül a szerver tényleges vizsgálatára. Ez nem bizonyítja a helyi lejátszás sikerét; például a tesztgépen futó Windows WebKit H.264-támogatása eltérhet az iPhone Safariétól.

Alapkorlát: fotó 6 MiB / 24 MP, videó 24 MiB, hang 8 MiB. A korábbi 50 MiB/könyv és 200 MiB/összes pilot médiatárhely továbbra is érvényes; ezek a 10/2/2 darabkerettől független ideiglenes technikai korlátok. Nincs automatikus fizetős bővítés.

Az eredeti bájtok és ellenőrzőösszeg megmaradnak. A tulajdonosi lejátszás hitelesített; nincs nyilvános média-URL. A tartalmi jelzés, döntés, tartalomverzió és napló az új AV-elemekhez is kapcsolódik. A videó és a hang nem kerül képként vagy rejtett adatként PDF-be; nincs automatikus átirat vagy kitalált képaláírás.

## Fizikai telefonos elfogadás – NYITOTT

Az alábbi hat ellenőrzést a telepített HTTPS-vendégoldalon, valódi készülékkel külön kell elvégezni. Korábbi fotós pilot-visszajelzés és asztali böngésző/emuláció nem igazolja ezt az új kiadást.

| Készülék és böngésző | Fotó | Videó | Hang |
| --- | --- | --- | --- |
| Fizikai Samsung / Chrome | NYITOTT | NYITOTT | NYITOTT |
| Fizikai iPhone / Safari | NYITOTT | NYITOTT | NYITOTT |

Mindegyiknél: engedély megadása és megtagadása; előnézet/lejátszás; elvetés/újrafelvétel; külön Beküldés; tulajdonosi megjelenés/lejátszás. AV-nál 20 másodperces leállítás, háttérbe kerülés, eszközjelző kialvása; hálózatmegszakítás után azonos beküldés ismétlése és változatlan kvóta. Fotónál szöveg, kézírás és rajz megőrzése. Rögzítendő az eszköz, OS- és böngészőverzió, tesztidő és tényleges eredmény.

## Ellenőrzés és kiadás

- A kiadás előtti HTTPS-tartalommentés: **8 könyv, 87 erőforrás PASS**, a meglévő eredetik, annotációk, pillanatképek, mentett változatok és PDF-ek. Ez alkalmazásszintű helyreállítási másolat, nem teljes adatbázismentés. A külső adatbázis-hozzáférés tiltva maradt.
- Szerveroldali AV: **7/7 PASS**; meglévő fotós tesztek: **12/12 PASS**. Valódi FFmpeg/FFprobe-dekódolás ártalmatlan generált fájlokkal, MOV/HEVC, MP4/AAC, WebM, WAV/Ogg, sérült és hamis fájlok, időhatár, ismétlés, párhuzamos kvótahatár, könyv/vendég elkülönítés, védett bájttartományos lejátszás és elveszett feltöltési válasz visszakeresése.
- Meglévő vendég-, internetpilot-, csomag- és MCP-könyvengedélyezési regresszió: **29/29 PASS**, helyi elkülönített adatbázison.
- Könyvfolyamat, tartalmi döntések, AV-pillanatkép, MCP és PDF együttes regresszió: **28/28 PASS**. A két MCP-könyvengedélyezési teszt az előző csoporttal közös; a csoportok darabszáma nem egyszerűen összeadandó.
- Új felvételi böngészőtesztek: **4/4 PASS**. Asztali Chrome szintetikus kamera/mikrofon valódi MediaRecorderrel: AAC-hang 19,456 s és H.264/AAC-videó 1,34365 s sikeresen beküldve; mind a 7 megszerzett médiatrack leállt, futásidejű hiba 0. Lefedett: engedélymegtagadás és késői engedélyválasz, háttérbe kerülés, elvetés/leállítás versenyhelyzete, automatikus időhatár, elveszett upload-válasz → újratöltés → visszakeresés → explicit ismétlés. WebKit fájlfeltöltési/natív választó alternatívája és szerveroldali 21 s elutasítása ellenőrizve; nem fizikai iPhone-próba.
- Meglévő fotós/rajzos Chromium és WebKit: **3/3 PASS**. Teljes böngészős bejelentkezés, vendégbeküldés, üzlet, tiltott böngészőtároló, MCP-szerkesztő asztali/érintéses nézet, tartalmi átnézés, jóváhagyás és PDF: **10/10 PASS**.
- Frontend/backend TypeScript, frontend build és érintett fájlok lintje PASS. Végleges felületi build: `index-BOI_M8t9.js`.
- Kiadott alkalmazás: `57e2434082ad0094d707d3e37b8dd67b9caa3181`, Render deploy `dep-dbu7tbjrjlhs739se70g`, **LIVE 2026-11-17 16:21:16 UTC**. Kizárólag a `codex/wedding-internet-pilot` ágon és a meglévő díjmentes tesztszolgáltatáson. Az automatikus deploy kikapcsolva maradt.
- Telepítés utáni szigorú adatmegőrzési összehasonlítás **8 könyv / 87 változatlan erőforrás PASS** (16:22:03 UTC). Az új fiktív beküldések után ugyanez **PASS** (16:26:09 UTC): csak a kijelölt tesztkönyv új beküldéseit engedő összehasonlítással, a korábbi beküldések és eredeti bájtok megváltozását továbbra is tiltva.
- Élő, kizárólag olvasó tulajdonosi szerkesztőpróba: desktop, 390 px mobil emuláció és névtelen mobilnézet **PASS**. A mentett változat és átnézési állapot változatlan, 0 író kérés, 0 JavaScript/HTTP-hiba, nincs vízszintes túlcsordulás. A fedett kép tudatos megnyitása/visszafedése, PDF-hivatkozás és belépési védelem ellenőrizve.
- Élő HTTPS API-próba: **9/9 PASS** (16:24:41 UTC). Mindhárom médiatípus egyszeri sikeres beküldése; hamis típus és 20,1 s hang elutasítása kvótafogyasztás nélkül; azonos kulcsú ismétlés; vendégazonosító-követelmény és saját feltöltés visszakeresése; névtelen/idegen tulajdonosi hozzáférés tiltása; videó/hang védett részleges lejátszása, változatlan eredeti bájtok és tiltott fotó-előnézeti útvonal.
- Élő Chrome HTTPS-böngészőpróba: **6/6 összesített ellenőrzés PASS**. Szintetikus kamerával/mikrofonnal tényleges MediaRecorder-videó és hang készült, a médiatrackek leálltak, az előnézet csak kifejezett indításra játszott. Külön Beküldés után a két felvétel és a fájlból választott fiktív fotó pontosan egyszer került a könyvbe. A hitelesített tulajdonos mindkét konkrét felvételt visszajátszotta; a fotó tényleges bájtjai betöltődtek. A fotó első automatikus ellenőrzése a görgetés előtti késleltetett betöltés miatt megállt; a teszt javítása és **kizárólag olvasó, minden írást tiltó** újrafuttatása 16:27:33 UTC-kor PASS, új beküldés nélkül. Ez asztali Chrome 390 px mobil emulációval, nem fizikai telefonos vagy valódi kamerás fotópróba.
- Végső HTTPS `/healthz`: `ok:true`; a kiadás óta lekérdezett alkalmazáshibanaplóban nem volt `error` szintű bejegyzés. Ez az ellenőrzött időszakra vonatkozik, nem folyamatos felügyeleti ígéret.
- Fizikai telefonos vagy valódi ChatGPT-próba jelen dokumentum alapján nem állítható sikeresnek.

## Próbalink és ellenőrzési fájlok

[Tulajdonosi fiktív próbakönyv](https://memorybook-wedding-text-pilot-ukd0.onrender.com/wedding/books/4b6039a5-329c-4444-97f8-c299ec3d93a1). Tulajdonosi belépés után a **Beküldési link** mezőből nyitható a vendégoldal; a link vagy a QR csak ehhez a fiktív könyvhöz használható. Titkos belépési adat és OAuth-token nem része a jelentésnek.

Helyi, gitből kizárt bizonyítékok: `test-results/guest-capture/pre-release/`, `test-results/guest-capture/internet/verification.json`, `test-results/guest-capture/internet-browser/`, `test-results/mcp-internet/browser-verification.json`. A helyreállítási másolatot és a próbák kulcsait nem szabad felülírni; a próbák újrafuttatása ugyanazokat a kulcsokat és szintetikus bájtokat használja.

Az ellenőrzött `main` változatlan: `5d2d4f5338a5ed891dd3b231cf131bed5b36a9ff`. Az éles MemoryBook szolgáltatás beállítása és 2026-09-14-i utolsó módosítási időpontja változatlan. A pilot adatbázis külső engedélyezési listája üres maradt; új fizetős erőforrás vagy modellhívás nem indult.

A meglévő díjmentes pilot adatbázis szolgáltatói lejárata a mostani ellenőrzés szerint 2026-12-07 10:53:45 UTC. A jelen feladat nem hosszabbította meg és nem váltotta fizetős csomagra. A fiktív könyv jelenlegi vendégbeküldési időszaka 2026-11-24 23:59:59 magyar időig tart.
