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
- A HTTPS-kiadási ellenőrzés még folyamatban; végleges eredménye a kiadás után kerül ide. Fizikai telefonos vagy valódi ChatGPT-próba jelen dokumentum alapján nem állítható sikeresnek.
