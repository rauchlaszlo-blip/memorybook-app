# Fotóra kézírás és rajzolás – 2026-11-07

Kiinduló ág: codex/wedding-internet-pilot, HEAD 0c8720b, tiszta munkafa. Nincs alkalmazandó AGENTS.md a munkapéldányban. A meglévő fotópilot dokumentációját és a rajzolási kódot áttekintettük. A meglévő egyszerű szín/vonalvastagság/visszavonás mintát követjük; a teljes Fabric könyvszerkesztőt nem töltjük be. Kis, pointeres SVG rajzfelület készült, kerek vonalvégekkel, külön HU/EN/DE feliratokkal.

## Működés

Opcionális Írás / rajzolás a képre. Fekete, fehér, piros, kék, arany; három vastagság. Visszavonás/Újra, megerősített törlés. A Kész a vendégoldali összeállított előnézetet módosítja, nem küld be; újranyitható. Mégse a szerkesztés előtti réteget hagyja meg. Képcsere vagy eltávolítás rajz mellett megerősítést kér. A rajz nélküli fotó és a csak szöveges út változatlan.

Pointer capture, egy aktív elsődleges pointer, touch-action:none kizárólag a rajzfelületen. A szerszámok és a felületen kívüli görgetés használhatók. Pointercancel elveti az éppen félbehagyott vonalat. A rajz végleges pontjai az EXIF szerint tájolt kép szélességéhez/magasságához képest 0..1 koordináták. Vonalvastagság a rövidebb oldal 0,003/0,007/0,014 része. Átméretezés/forgatás nem változtatja a réteget. Sem kivágás, sem további felhasználói forgatás nincs; az egyetlen képtranszformáció az EXIF szerinti automatikus tájolás és arányos illesztés. Böngésző és szerver azonos vonalmodellt használ.

## Adatok, határok és tranzakció

Additív v3 migráció: event_media_annotations, a fotóhoz FK-val kötve. Külön JSONB szerkeszthető layer (version=1, space=exif-oriented-normalized, strokes), kanonikus SHA-256 rétegazonosító, külön előnézeti és nagy JPEG összeállítás. A formátum verziózott, az adott beküldés változatát a hash rögzíti; nem tárolunk minden szerkesztési lépésből szerveroldali történetet. Az eredeti fotó és az előző fotóderivátumok változatlanok. A szerver a tájolt megjelenítési fotóra rendereli a validált vonalakat, nem fogad el kliens által küldött tetszőleges SVG-t vagy lapított képet.

Legfeljebb 200 vonal, összesen 10 000 pont, 300 000 karakteres réteg; HTTP JSON maximum 340 KiB. Szigorú kulcslista, verzió, színek, vastagságok, véges és tartományon belüli koordináták. Nincs URL, script, külső erőforrás vagy általános Fabric JSON. A pilotban 50 visszavonási állapot van a megnyitott rajzszerkesztőben.

A feltöltött fotó az eddigi kulccsal azonosítható. A végső beküldés egy tranzakcióban ellenőrzi a könyvet, kulcsot, lejáratot, rajzot, tárhelykeretet; elkészíti a származtatott képeket, elmenti a réteget és a bejegyzést, majd csatolja a fotót. Kvótahiba vagy bármely megszakítás visszagörgeti az egész végleges mentést. A rajzos kompozitálás globális tranzakciós kvótazár alatt sorosított; a könyvzár a lezárással is egyeztet. Ismételt beküldésnél a réteg hash-e is egyezzen; megváltoztatott rajz ugyanazzal a kulccsal 409. Bizonytalan válasz után a kliens zárolja a szerkesztést és ugyanazt a változatot próbálja újra, a már feltöltött eredetit újrahasznosítva.

A szöveg és a rajz a nyitott oldalon hálózati hibánál megmarad; a sessionStorage best-effort draft a réteget is menti. A fájl lapújratöltés után újrakiválasztandó, tartós offline ígéret nincs. A kompozit csak a végső tranzakcióban keletkezik: sikertelen tranzakciónál nincs árva kompozit. A félbehagyott eredeti az eddigi 1 órás uploaded TTL/takarítással kezelhető; a média törlése FK CASCADE révén a rajzot is törli, attached adatot a takarítás nem töröl.

Minden kép és a /api/wedding/media/:id/annotation JSON is ugyanazzal a tulajdonosi session+könyvtulajdon-ellenőrzéssel védett. Nincs nyilvános rajzelérés. A lista/nagy nézet az összeállítást mutatja; másodlagos gombbal az átvett eredeti fotó is megtekinthető és letölthető.

## Tárhely és költség

Az ellenőrzött meglévő külön Render szolgáltatás és PostgreSQL továbbra is Free; nincs új erőforrás, csomag vagy tárhelyszolgáltató. A 6 MiB/kép, 24 MP, 50 MiB/könyv és 200 MiB teljes médiakeret marad; a rajz és kompozit mérete is beleszámít mindkét tárhelykvótába. Adatbázis-lejárat 2026-12-07 11:53:45 Budapest. HEIC/HEIF továbbra sem támogatott. A teljes szolgáltatói ingyenes keret továbbra sem korlátlan.

## Ellenőrzés

Build, frontend és backend típusellenőrzés, érintett lint PASS. 37 teszt együtt PASS, majd egy további álló/fekvő kompozit-képpontteszt PASS: összesen 38 külön sikeres teszt. A végső illeszkedési ellenőrzés WebKit szintetikus egérkoordinátáinak CSS-pixelre kerekítését legfeljebb kb. 1 pixel toleranciával kezeli; ez nem változtat az alkalmazás pontleképezésén.

API: rajzos/rajz nélküli fotó, eredeti bájtpontosság, tájolás és előnézet/nagy kép közepén a rajz tényleges képpontjai, réteg mentése, tiltott szerkezet/típus/pont/kvóta, másik könyv/tulajdonos kizárása, névtelen eredeti/előnézet/nagy kép/rajz tiltása, ismételt és párhuzamos beküldés, rollback, lezárás. Korábbi auth/szöveges/fotós tesztek megmaradtak.

Chromium és WebKit: rajz kezdőpontja a pointer helyén, átméretezéskor változatlan útvonal, Visszavonás/Újra/Kész/Mégse, törlés megerősítése, képcsere elutasítása/elfogadása, szerkesztés újranyitása, elveszett válasz és dupla kattintás, egyetlen feltöltés és bejegyzés, tulajdonosi Frissítés új képpel és új navigáció nélkül, nagy és eredeti nézet. A Frissítés működése helyes, erre külön kódjavítás nem kellett. A korábbi hiba egy régi, már nyitott alkalmazásverzióhoz kapcsolódott; új funkció első telepítése után egyszer az új oldalkódot kell megnyitni, későbbi bejegyzésekhez elég a Frissítés.

A valódi Samsung/iPhone rajzolás, ujjbeviteli illeszkedés és telefonforgatás NYITOTT. A korábbi telefonos fotó/szöveg PASS megőrizve, rajzos PASS-t nem előlegezünk meg. Telepített eredmények külön kerülnek rögzítésre.
