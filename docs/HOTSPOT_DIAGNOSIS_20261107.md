> Termékirány-pontosítás: A hotspot hiba nincs megoldottnak minősítve. A következő termékmérföldkő külön HTTPS internetes pilot, nem helyi hálózati kiszolgálás. Lásd: [internetes pilot terve](INTERNET_PILOT_PLAN_20261107.md).

# Telefonos kapcsolat vizsgálata – 2026-11-07

## Igazolt USB-útvonal

Az `adb reverse --list` eredménye `UsbFfs tcp:3001 tcp:3001` volt.
A pilot ekkor kizárólag `127.0.0.1:3001` címen figyelt. A telefon
`localhost:3001` címe az ADB USB-porttovábbításán keresztül érte el a notebookot.
Ez nem USB-internetmegosztás: a notebook aktív hálózati adaptere Wi-Fi,
az Ethernet interfésznek csak 169.254.x.x link-local címe volt.

A felhasználó visszajelzése szerint Samsungon USB-vel működik a pilot és a kamerás
QR-megnyitás. A beküldés/tulajdonosi megjelenés, lezárási állapot, megszakítás utáni
szövegmegőrzés és újrapróbálás (egy példány) korábban szintén visszaigazolt.

## LAN-vizsgálat

- Notebook Wi-Fi: 10.247.238.29; átjáró: 10.247.238.17; nyilvános Windows-profil.
- Adatbázis változatlanul kizárólag 127.0.0.1:55439, elkülönített pilot-adatkönyvtár.
- Az ADB reverse 3001-es szabályát eltávolítottuk, hogy ne fedje el a hálózati hibát.
- A pilot újraindítva `--lan-origin=http://10.247.238.29:3001 --passwordless-test`
  beállítással, a fiktív pilotfiókra. A figyelő socketet ellenőriztük.
- A szűk Windows-szabály a nyilvános profilon, Wi-Fi interfészen, TCP 3001 portra
  10.247.238.29 célcímet és 10.247.238.17 forráscímet enged. A tűzfal nincs kikapcsolva.
- A vendéglink és QR a megnyitott oldal originjét használja, ezért a LAN-címen
  megnyitott/frissített tulajdonosi oldalt kell használni, nem egy régi localhost lapot.

## Feltárt eltérés / még tisztázandó ok

A csatlakoztatott Samsung `ip -4 addr show` kimenetében csak loopback és a mobilhálózati
rmnet_data7 interfésznek volt IPv4-címe; aktív hotspot IPv4-interfész nem szerepelt.
A `ip route get 10.247.238.29` a mobilhálózati rmnet_data7 útvonalat adta vissza,
nem a notebookhoz vezető közvetlen hotspot-útvonalat. Ez a shell útválasztási
bizonyítéka, nem a böngésző minden lehetséges hálózatválasztásának bizonyítása.

A hotspot szolgáltató telefonjának és a tesztelő telefonnak az azonossága, valamint
a hotspot tényleges bekapcsolt állapota felhasználói tisztázásra vár. Az USB-t
eközben kihúzták, további telefonoldali lekérdezés nem volt elérhető.
A notebook SSID-jét a Windows helyhozzáférési beállítása miatt a netsh nem adta ki;
ezt a beállítást nem módosítottuk.

## Elfogadási állapot

Valódi hotspot/LAN: NYITOTT, nem PASS. Feltétel: kihúzott USB-kábellel a Samsungon
megnyíló pilot, sikeres beküldés és a tulajdonosi listában való megjelenés,
a felhasználó visszajelzésével. iPhone/Safari továbbra is NYITOTT.
Nem történt deploy, commit, push vagy tesztadat-törlés.
