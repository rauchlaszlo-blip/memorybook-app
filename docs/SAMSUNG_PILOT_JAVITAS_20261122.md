# Samsung beküldési hibák – pilotjavítás, 2026-11-22

## Bejelentés és bizonyíték

Érintett fiktív könyv: `4b6039a5-329c-4444-97f8-c299ec3d93a1`. A felhasználó fizikai Samsung-próbája: kamerafotó PASS, galériafotó FAIL, kameravideó FAIL, galériavideó PASS, hangfelvétel PASS. A két FAIL végén megjelent konkrét sikerüzenet nincs megerősítve. A javított kiadás fizikai Samsung-újratesztje minden érintett folyamatra **NYITOTT**.

A telepítés előtti, csak olvasó HTTPS-vizsgálat 41 beküldést talált, összesen 34 fotóval, 3 videóval és 4 hanggal. A november 22-i sikeresen csatolt eredetik: JPEG 4000×3000, 2 465 773 bájt; AAC/MP4 hang 2,794666 s, 46 979 bájt; HEVC/AAC MP4 videó 1920×1080, 2,901333 s, 4 622 843 bájt. A fájlokból csak formátum- és méretadatokat olvastunk, személyes tartalmat nem használtunk tesztmintának.

A régi alkalmazásnaplóban nem volt a hibás fájlválasztáshoz vagy beküldéshez kapcsolható diagnosztika. Az elérhető HTTP-kérésnapló üres; a korábbi időszakra szűrt második naplólekérés szolgáltatói 503 hibával meghiúsult. A közvetlen adatbázis-eszköz a szándékosan üres külső IP-engedélylista miatt nem érte el az adatbázist. A tűzfal változatlan maradt; helyette a pilotba szigorúan tulajdonosi, kijelölt fiktív könyvre szűkített, csak metaadatot olvasó diagnosztika került.

**A két konkrét Samsung-kísérlet pontos oka még nem bizonyított.** A korábbi feltöltési állapotból és naplóhiányból nem következik, hogy a fájl soha nem érkezett meg vagy elveszett. A régi rendszer a még nem csatolt feltöltéseket lejárat után törölhette; ennek egyedi előfordulását nem lehet visszamenőleg bizonyítani a rendelkezésre álló naplóval.

## Igazolt, javított hibák

1. A régi fotóellenőrző elutasította a szabályos, deklarált JPEG + rövid MP4 Motion Photo v1 mintát. Az új ellenőrzés pontos JPEG-határokat, XML-névtereket, deklarált komponenshosszakat és a videórész teljes dekódolását vizsgálja. Az eredeti teljes fájl megmarad; az előnézet a fotórészből készül.
2. Valódi helyi Chromium MediaRecorder VP8/Opus, VP9/Opus és alapértelmezett WebM kimenetén hiányzott a képkockánkénti időtartammező. A régi ellenőrző `MEDIA_INVALID` választ adott. A javítás a teljesen dekódolt, monoton időbélyegekből mér; az utolsó képkockára konzervatív időközt használ. A szerveroldali 20 másodperces korlát érvényes marad.
3. A kliens bármely sikeres HTTP-válasz után kész beküldést jelzett. Külön teszt reprodukálta, hogy egy szimulált `202 {accepted:false,state:'processing'}` válasz adatbázis-commit nélkül is törölte a korábbi űrlapot. Az új kliens csak a `committed` állapotot, beküldésazonosítót és az elvárt médiaazonosítót tartalmazó visszaigazolást fogadja el.
4. A már nyitva hagyott tulajdonosi lista nem frissült az oldalra visszatéréskor. A javítás visszatéréskor és látható oldalon 10 másodpercenként frissít; aktív feldolgozásnál 3 másodpercenként kér állapotot. A folyamatban lévő tartalmi döntésszerkesztést nem indítja újra.

A formátumok részletes korlátai és reprodukciói: [technikai diagnosztika](SAMSUNG_CAPTURE_DIAGNOSTICS_20261122.md). Nem lett általános HEIC/HEIF-, régi SEF/MicroVideo- vagy 4K-támogatás; az ismeretlen formátumok ellenőrzése továbbra is szigorú.

## Tartós feltöltési folyamat

- A fájl fogadása, feldolgozása, sikeres feltöltése és végleges vendégbeküldése külön állapot. A fájl teljes beérkezése után az eredeti bájtok korlátozott, nem nyilvánosan kiszolgált adatbázis-területre kerülnek. A szerver továbbra is szinkron validál; új háttérszolgáltatás vagy fizetős feldolgozó nem indult.
- A tulajdonosi **Feltöltések feldolgozása** lista megmutatja a folyamatban lévő, hibás és vendégvéglegesítésre váró tételeket. A megőrzött eredeti újrafeldolgozható. Az újrafeldolgozás nem talál ki vendégnevet vagy üzenetet, és nem helyettesíti a vendég külön Beküldés műveletét.
- Siker csak a beküldés és médiakapcsolata közös adatbázis-commitja után jelenik meg. A visszajelzés tartalmazza a beküldés azonosítóját. Hiba vagy bizonytalan hálózati válasz esetén az űrlap és a helyi fájl megmarad az adott oldalon; az eredeti kulcs ismételt használata nem dupláz és nem fogyaszt új darabkeretet.
- Újraindulás vagy megszakadás után a lejárt feldolgozási zárolás újrapróbálható. A beérkezett eredetik automatikus lejárati törlése megszűnt; a lejárt feltöltés ugyanazokkal a bájtokkal és azonosítókkal helyreállítható. Az egymással párhuzamos próbák zároltak, a fájlazonosságot SHA-256 és adatbázis-korlát ellenőrzi.
- A 10 fotó / 2 videó / 2 hang könyvenkénti, vendégböngészőnkénti keret változatlan. A karanténban megőrzött sikertelen feldolgozások a tárhelykorlátba beleszámítanak, a vendég darabkeretébe nem. Az annotációs tárhelyellenőrzés ezeket is számolja.

## Diagnosztika és korlátok

A célzott kliensdiagnosztika csak engedélyezett hibakódot, műveletszakaszt, médiatípust, forrást, normalizált MIME-ot, méretet és hibahivatkozást küldhet. A szerver végrehajtási naplója szintén kódokat és azonosítókat használ. Nincs fájlnév, név, üzenet, fájltartalom, vendégmeghívó vagy hozzáférési token a naplóban. A kliens által közölt MIME és forrás diagnosztikai megfigyelés, nem szerveroldali bizonyíték; a fájldekóder a bájtokat ellenőrzi.

A feltöltés előtti diagnosztika engedélyezett mezőkre szűkített, vendéghez és könyvhöz kötött, percenként korlátozott naplóesemény. Nem végleges beküldés és nem személyazonosítás. A feldolgozási kísérlet és megőrzött eredeti adatbázisban marad. Oldalbezáráskor a még fel sem töltött fájl teljes helyi megőrzése továbbra sem garantált; nem történt teljes offline médiatár bevezetése.

A sikertelen eredetik megőrzése miatt a díjmentes pilot korlátozott tárhelye megtelhet. Ez látható hibát ad; nincs automatikus fizetős bővítés vagy engedély nélküli törlés. A meglévő pilotadatbázis lejárata december 7.; az alkalmazás-próbalink december 6. végéig érvényes.

## Tesztek és kiadás

- Előzetes megőrzési másolat: **8 könyv / 123 HTTPS-erőforrás PASS**. Eredetik, annotációk, korábbi mentett tervek, pillanatképek, döntések és PDF-ek külön hash-ellenőrzéssel.
- Új formátumtesztek: **5/5 PASS**, benne valódi helyi MediaRecorder-felvételek és 20,2 másodperces WebM elutasítása.
- Meglévő AV- és AV/PDF-regresszió: **8/8 PASS**.
- Tartós feldolgozás és fotóregresszió: **21/21 PASS**, beleértve a tárhelyhibát, újraindulást, tulajdonosváltást, párhuzamos sikertelen commitot, annotációs kvótát és az eredeti bájtok megőrzését.
- Jogosultság, MCP-elkülönítés, tartalmi döntések, szerkesztés/jóváhagyás/PDF, próbamenet és diagnosztika: **21/21 PASS**.
- Célzott beküldési és kamera/mikrofon-böngészőtesztek: **5/5 PASS**; korábbi könyvszerkesztő, alkalmazáspróba, fotó és rajz: **6/6 PASS**. Helyi Chromium és WebKit, ártalmatlan színminták és szintetikus eszközök.
- Meglévő könyvdomén és ismételt migráció: **14/14 PASS**; blokkolt böngészőtárhely melletti indulás: **2/2 PASS**. Az utóbbi teszt régi, nem szabványos `{success:true}` válaszmintáját az új, szigorú beküldési ACK-ra frissítettük; az első futás ezt helyesen nem fogadta el sikernek.
- Frontend build, szerver TypeScript, érintett lint és diff-ellenőrzés: **PASS**.

A végső böngészős, internetes és telepítési eredmények az átadáskor egészülnek ki. A fizikai Samsung újratesztelés és az iPhone/Safari-próba **NYITOTT**.
