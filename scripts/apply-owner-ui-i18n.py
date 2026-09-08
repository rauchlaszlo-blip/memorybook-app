from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def rep(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Marker not found: {label}: {old[:120]!r}')
    return text.replace(old, new, 1)


helper = r'''import { useEffect, useState } from 'react';
import {
  getAppLanguage,
  subscribeAppLanguage,
  type AppLanguage,
} from './i18n';

type Translation = { en: string; de: string };

const translations: Record<string, Translation> = {
  'Nem sikerült betölteni a könyveidet.': { en: 'Could not load your books.', de: 'Deine Bücher konnten nicht geladen werden.' },
  'Adj nevet az emlékkönyvnek.': { en: 'Give the memory book a name.', de: 'Gib dem Erinnerungsbuch einen Namen.' },
  'A könyv létrehozásához felhasználható vásárlási jogosultság kell.': { en: 'An available purchase entitlement is required to create a book.', de: 'Zum Erstellen eines Buches wird eine verfügbare Kaufberechtigung benötigt.' },
  'A könyv létrehozásához vásárlási jogosultság szükséges.': { en: 'A purchase entitlement is required to create the book.', de: 'Zum Erstellen des Buches wird eine Kaufberechtigung benötigt.' },
  'Nem sikerült létrehozni az emlékkönyvet.': { en: 'Could not create the memory book.', de: 'Das Erinnerungsbuch konnte nicht erstellt werden.' },
  'Saját könyveim': { en: 'My books', de: 'Meine Bücher' },
  'Bejelentkezett felhasználó': { en: 'Signed-in user', de: 'Angemeldeter Benutzer' },
  'Kijelentkezés': { en: 'Sign out', de: 'Abmelden' },
  'Új emlékkönyv létrehozása': { en: 'Create a new memory book', de: 'Neues Erinnerungsbuch erstellen' },
  '{count} felhasználható könyvjogosultságod van. Egy jogosultság egy könyv létrehozására használható fel.': { en: 'You have {count} available book entitlement(s). One entitlement can be used to create one book.', de: 'Du hast {count} verfügbare Buchberechtigung(en). Eine Berechtigung kann für ein Buch verwendet werden.' },
  'Vásárlási jogosultság': { en: 'Purchase entitlement', de: 'Kaufberechtigung' },
  'Rendezvény-vendégkönyv': { en: 'Event guestbook', de: 'Veranstaltungs-Gästebuch' },
  'Normál emlékkönyv – {count} oldal': { en: 'Standard memory book – {count} pages', de: 'Normales Erinnerungsbuch – {count} Seiten' },
  '· ajándék': { en: '· gift', de: '· Geschenk' },
  'Például: Anna 40. születésnapja': { en: "For example: Anna's 40th birthday", de: 'Zum Beispiel: Annas 40. Geburtstag' },
  'Létrehozás...': { en: 'Creating...', de: 'Wird erstellt...' },
  'Emlékkönyv létrehozása': { en: 'Create memory book', de: 'Erinnerungsbuch erstellen' },
  'Új emlékkönyv': { en: 'New memory book', de: 'Neues Erinnerungsbuch' },
  'Új könyvet vásárlási jogosultsággal lehet létrehozni. A normál könyv 30 oldallal indul, később bővíthető.': { en: 'A new book can be created with a purchase entitlement. A standard book starts with 30 pages and can be expanded later.', de: 'Ein neues Buch kann mit einer Kaufberechtigung erstellt werden. Ein normales Buch startet mit 30 Seiten und kann später erweitert werden.' },
  'Új könyv vásárlása': { en: 'Buy a new book', de: 'Neues Buch kaufen' },
  'További könyv vásárlása vagy ajándékba vétele': { en: 'Buy another book or give one as a gift', de: 'Weiteres Buch kaufen oder verschenken' },
  'Betöltés...': { en: 'Loading...', de: 'Laden...' },
  'Még nincs emlékkönyved': { en: 'You do not have a memory book yet', de: 'Du hast noch kein Erinnerungsbuch' },
  'Vásárolj könyvjogosultságot, vagy válts be egy ajándékba kapott jogosultságot. A könyv csak ezután hozható létre.': { en: 'Buy a book entitlement or redeem one you received as a gift. The book can be created after that.', de: 'Kaufe eine Buchberechtigung oder löse eine geschenkte Berechtigung ein. Danach kann das Buch erstellt werden.' },
  '{count} bejegyzés': { en: '{count} entries', de: '{count} Einträge' },
  '{count} oldal': { en: '{count} pages', de: '{count} Seiten' },
  'Rendezvény kezelése': { en: 'Manage event', de: 'Veranstaltung verwalten' },
  'Oldalak és meghívók': { en: 'Pages and invitations', de: 'Seiten und Einladungen' },
  'Könyv megnyitása': { en: 'Open book', de: 'Buch öffnen' },
  'Beérkezett bejegyzések': { en: 'Received entries', de: 'Eingegangene Einträge' },

  'Nem sikerült betölteni az értesítéseket.': { en: 'Could not load notifications.', de: 'Benachrichtigungen konnten nicht geladen werden.' },
  'Értesítések': { en: 'Notifications', de: 'Benachrichtigungen' },
  '{count} olvasatlan': { en: '{count} unread', de: '{count} ungelesen' },
  '{count} új': { en: '{count} new', de: '{count} neu' },
  'Nincs értesítés.': { en: 'No notifications.', de: 'Keine Benachrichtigungen.' },
  '{name} visszaküldte a {page}. oldalt.': { en: '{name} submitted page {page}.', de: '{name} hat Seite {page} eingereicht.' },
  'Visszaérkezett a {page}. oldal.': { en: 'Page {page} was submitted.', de: 'Seite {page} wurde eingereicht.' },

  'A rendezvény beállításait nem sikerült betölteni.': { en: 'Could not load the event settings.', de: 'Die Veranstaltungseinstellungen konnten nicht geladen werden.' },
  'Beállítás mentve.': { en: 'Setting saved.', de: 'Einstellung gespeichert.' },
  'A beállítást nem sikerült menteni.': { en: 'Could not save the setting.', de: 'Die Einstellung konnte nicht gespeichert werden.' },
  'Rendezvény beállítások betöltése...': { en: 'Loading event settings...', de: 'Veranstaltungseinstellungen werden geladen...' },
  'Beküldési szabályok': { en: 'Submission rules', de: 'Einreichungsregeln' },
  'Hány bejegyzés jöhet egy telefonról?': { en: 'How many entries can come from one phone?', de: 'Wie viele Einträge dürfen von einem Gerät kommen?' },
  'Ezt minden rendezvénykönyvnél külön állítod be. Nagy koncertnél vagy fesztiválnál tipikusan 1, családi rendezvénynél 5 vagy 10 lehet.': { en: 'Set this separately for each event guestbook. For a large concert or festival, 1 is typical; for a family event, 5 or 10 may be appropriate.', de: 'Diese Einstellung gilt für jedes Veranstaltungs-Gästebuch separat. Bei einem großen Konzert oder Festival ist meist 1 sinnvoll, bei einer Familienfeier können es 5 oder 10 sein.' },
  'Bejegyzések száma egy eszközről': { en: 'Entries per device', de: 'Einträge pro Gerät' },
  'Mentés...': { en: 'Saving...', de: 'Speichern...' },
  'Beállítás mentése': { en: 'Save setting', de: 'Einstellung speichern' },
  'Azonosítás': { en: 'Identification', de: 'Identifikation' },
  'Azonosítás nélkül': { en: 'Without identification', de: 'Ohne Identifikation' },
  'Google-, e-mail- és rendezvényalkalmazás-azonosítás külön következő lépésben kapcsolható be. A mostani eszközlimit már működik.': { en: 'Google, email and event-app identification can be enabled in a later step. The current device limit already works.', de: 'Google-, E-Mail- und Veranstaltungs-App-Identifikation können in einem späteren Schritt aktiviert werden. Das aktuelle Gerätelimit funktioniert bereits.' },

  'MemoryBook vendégkönyv': { en: 'MemoryBook guestbook', de: 'MemoryBook Gästebuch' },
  'Nem sikerült betölteni a rendezvény QR-kódját.': { en: 'Could not load the event QR code.', de: 'Der QR-Code der Veranstaltung konnte nicht geladen werden.' },
  'Nem sikerült elkészíteni a QR-kódot.': { en: 'Could not generate the QR code.', de: 'Der QR-Code konnte nicht erstellt werden.' },
  'QR-kód készítése...': { en: 'Generating QR code...', de: 'QR-Code wird erstellt...' },
  '← Vissza a könyvhöz': { en: '← Back to the book', de: '← Zurück zum Buch' },
  'Olvasd be a QR-kódot, és írj a vendégkönyvbe!': { en: 'Scan the QR code and write in the guestbook!', de: 'Scanne den QR-Code und schreibe ins Gästebuch!' },
  'Rendezvény vendégkönyv QR-kód': { en: 'Event guestbook QR code', de: 'QR-Code des Veranstaltungs-Gästebuchs' },
  'A QR-kód ugyanarra a közös vendégkönyvre visz minden vendéget.': { en: 'The QR code takes every guest to the same shared guestbook.', de: 'Der QR-Code führt alle Gäste zum selben gemeinsamen Gästebuch.' },

  'A beérkezett bejegyzéseket nem sikerült betölteni.': { en: 'Could not load the received entries.', de: 'Die eingegangenen Einträge konnten nicht geladen werden.' },
  'A bejegyzés állapotát nem sikerült módosítani.': { en: 'Could not change the entry status.', de: 'Der Status des Eintrags konnte nicht geändert werden.' },
  'A csoport/tematika mentése nem sikerült.': { en: 'Could not save the group/theme.', de: 'Gruppe/Thema konnte nicht gespeichert werden.' },
  'A sorrend mentése nem sikerült.': { en: 'Could not save the order.', de: 'Die Reihenfolge konnte nicht gespeichert werden.' },
  'Bejegyzések betöltése...': { en: 'Loading entries...', de: 'Einträge werden geladen...' },
  'A könyv nem található.': { en: 'The book was not found.', de: 'Das Buch wurde nicht gefunden.' },
  'MemoryBook · rendezvény': { en: 'MemoryBook · event', de: 'MemoryBook · Veranstaltung' },
  'Itt te döntöd el, mely vendégbejegyzéseket tartod meg. A megtartott anyagokat kézzel rendezheted; később az AI javasolhat csoportokat és sorrendet, de nem dönt helyetted.': { en: 'Here you decide which guest entries to keep. You can arrange kept material manually; later AI may suggest groups and order, but it will not decide for you.', de: 'Hier entscheidest du, welche Gästebucheinträge du behältst. Behaltene Inhalte kannst du manuell ordnen; später kann die KI Gruppen und Reihenfolgen vorschlagen, entscheidet aber nicht an deiner Stelle.' },
  'Új': { en: 'New', de: 'Neu' },
  'Megtartott': { en: 'Kept', de: 'Behalten' },
  'Elutasított': { en: 'Rejected', de: 'Abgelehnt' },
  'Összes': { en: 'All', de: 'Alle' },
  'Megtartott bejegyzések rendezése': { en: 'Arrange kept entries', de: 'Behaltene Einträge ordnen' },
  'A ↑ / ↓ gombokkal állítsd be a sorrendet. A „Csoport / tematika” mezővel például Család, Barátok, Kollégák vagy Esti pillanatok csoportot adhatsz meg.': { en: 'Use the ↑ / ↓ buttons to set the order. In the “Group / theme” field you can enter groups such as Family, Friends, Colleagues or Evening moments.', de: 'Mit den Tasten ↑ / ↓ legst du die Reihenfolge fest. Im Feld „Gruppe / Thema“ kannst du z. B. Familie, Freunde, Kollegen oder Abendmomente eintragen.' },
  'AI-rendszerezési javaslat – később': { en: 'AI organization suggestion – later', de: 'KI-Sortierungsvorschlag – später' },
  'Az AI csak javasolhat csoportokat és sorrendet. Minden változtatást a tulajdonos hagy jóvá.': { en: 'AI may only suggest groups and order. The owner approves every change.', de: 'Die KI darf nur Gruppen und Reihenfolgen vorschlagen. Jede Änderung wird vom Eigentümer bestätigt.' },
  'Ebben a csoportban nincs bejegyzés.': { en: 'There are no entries in this group.', de: 'In dieser Gruppe gibt es keine Einträge.' },
  '{name} fotója': { en: "{name}'s photo", de: 'Foto von {name}' },
  'Csoport / tematika': { en: 'Group / theme', de: 'Gruppe / Thema' },
  'Például: Család': { en: 'For example: Family', de: 'Zum Beispiel: Familie' },
  'Tematika mentése': { en: 'Save theme', de: 'Thema speichern' },
  'Bejegyzés feljebb': { en: 'Move entry up', de: 'Eintrag nach oben' },
  'Bejegyzés lejjebb': { en: 'Move entry down', de: 'Eintrag nach unten' },
  '↑ Feljebb': { en: '↑ Up', de: '↑ Nach oben' },
  '↓ Lejjebb': { en: '↓ Down', de: '↓ Nach unten' },
  'Folyamatban...': { en: 'Working...', de: 'In Bearbeitung...' },
  'Megtartom': { en: 'Keep', de: 'Behalten' },
  'Elutasítom': { en: 'Reject', de: 'Ablehnen' },
  'Vissza az új bejegyzésekhez': { en: 'Return to new entries', de: 'Zurück zu den neuen Einträgen' },
  'Megtartva': { en: 'Kept', de: 'Behalten' },
  'Elutasítva': { en: 'Rejected', de: 'Abgelehnt' },

  'A könyvet nem sikerült betölteni.': { en: 'Could not load the book.', de: 'Das Buch konnte nicht geladen werden.' },
  'Az oldalt nem sikerült betölteni.': { en: 'Could not load the page.', de: 'Die Seite konnte nicht geladen werden.' },
  'A saját megjegyzést nem sikerült elmenteni.': { en: 'Could not save your note.', de: 'Deine Notiz konnte nicht gespeichert werden.' },
  '← Saját könyveim': { en: '← My books', de: '← Meine Bücher' },
  'Csak olvasható könyvnézet': { en: 'Read-only book view', de: 'Nur-Leseansicht des Buches' },
  'Előző oldal': { en: 'Previous page', de: 'Vorherige Seite' },
  '← Előző': { en: '← Previous', de: '← Zurück' },
  '{current} / {total} oldal': { en: '{current} / {total} pages', de: '{current} / {total} Seiten' },
  'Nincs oldal': { en: 'No pages', de: 'Keine Seiten' },
  'Következő oldal': { en: 'Next page', de: 'Nächste Seite' },
  'Következő →': { en: 'Next →', de: 'Weiter →' },
  'Oldal betöltése...': { en: 'Loading page...', de: 'Seite wird geladen...' },
  'Még nincs beküldött oldal ebben a könyvben.': { en: 'There are no submitted pages in this book yet.', de: 'In diesem Buch gibt es noch keine eingereichten Seiten.' },
  '{page}. oldal': { en: 'Page {page}', de: 'Seite {page}' },
  'Ehhez az oldalhoz nincs előnézeti kép.': { en: 'There is no preview image for this page.', de: 'Für diese Seite gibt es kein Vorschaubild.' },
  'Az emlék adatai': { en: 'Memory details', de: 'Details der Erinnerung' },
  'Nincs azonosítva': { en: 'Not identified', de: 'Nicht identifiziert' },
  'Küldési mód': { en: 'Delivery method', de: 'Versandart' },
  'Megosztás': { en: 'Share', de: 'Teilen' },
  'Nincs rögzítve': { en: 'Not recorded', de: 'Nicht erfasst' },
  'Meghívás dátuma': { en: 'Invitation date', de: 'Einladungsdatum' },
  'Beküldés dátuma': { en: 'Submission date', de: 'Einreichungsdatum' },
  'Saját megjegyzés': { en: 'My note', de: 'Eigene Notiz' },
  'Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…': { en: 'E.g. where we met or which event this memory is connected to…', de: 'Z. B. wo wir uns kennengelernt haben oder zu welchem Ereignis die Erinnerung gehört…' },
  'Mentés…': { en: 'Saving…', de: 'Speichern…' },
  'Megjegyzés elmentve': { en: 'Note saved', de: 'Notiz gespeichert' },
  'Megjegyzés mentése': { en: 'Save note', de: 'Notiz speichern' },
  'Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.': { en: 'This information block belongs to the online book. If printed later, only the memory page above will be included in the book.', de: 'Dieser Informationsblock gehört zum Online-Buch. Bei einem späteren Druck wird nur die oben gezeigte Erinnerungsseite in das Buch aufgenommen.' },

  'Nem sikerült betölteni a könyv oldalait.': { en: 'Could not load the book pages.', de: 'Die Buchseiten konnten nicht geladen werden.' },
  'Nem sikerült létrehozni a meghívót.': { en: 'Could not create the invitation.', de: 'Die Einladung konnte nicht erstellt werden.' },
  'Nem sikerült új címzettnek megnyitni az oldalt.': { en: 'Could not open the page for a new recipient.', de: 'Die Seite konnte nicht für einen neuen Empfänger geöffnet werden.' },
  'Nem sikerült módosítani az oldal állapotát.': { en: 'Could not change the page status.', de: 'Der Seitenstatus konnte nicht geändert werden.' },
  'A szerző nem járult hozzá a nyilvános megosztáshoz.': { en: 'The author did not approve public sharing.', de: 'Der Autor hat der öffentlichen Freigabe nicht zugestimmt.' },
  'Nem sikerült módosítani a nyilvános megosztást.': { en: 'Could not change public sharing.', de: 'Die öffentliche Freigabe konnte nicht geändert werden.' },
  'Másold ki a nyilvános linket:': { en: 'Copy the public link:', de: 'Öffentlichen Link kopieren:' },
  'Biztosan végleg törlöd a(z) {page}. oldal beküldött tartalmát?\n\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.': { en: 'Permanently delete the submitted content of page {page}?\n\nThis cannot be undone. The page will become empty again and can later be sent to someone else.', de: 'Den eingereichten Inhalt von Seite {page} endgültig löschen?\n\nDies kann nicht rückgängig gemacht werden. Die Seite wird wieder leer und kann später an jemand anderen gesendet werden.' },
  'Nem sikerült törölni a beküldött oldalt.': { en: 'Could not delete the submitted page.', de: 'Die eingereichte Seite konnte nicht gelöscht werden.' },
  'A könyv nyelvét nem sikerült módosítani.': { en: 'Could not change the book language.', de: 'Die Buchsprache konnte nicht geändert werden.' },
  'Könyv nyelve': { en: 'Book language', de: 'Buchsprache' },
  'A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.': { en: 'Guests can write in the event guestbook using a QR code. You decide what to keep from the received material.', de: 'Gäste können per QR-Code in das Veranstaltungs-Gästebuch schreiben. Du entscheidest über die eingegangenen Inhalte.' },
  'Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött oldalakat megtarthatod, archiválhatod vagy végleg törölheted.': { en: 'Each invitation belongs to one specific page. You can keep, archive or permanently delete submitted pages.', de: 'Jede Einladung gehört zu genau einer Seite. Eingereichte Seiten kannst du behalten, archivieren oder endgültig löschen.' },
  'Rendezvény vendégkönyv': { en: 'Event guestbook', de: 'Veranstaltungs-Gästebuch' },
  'Egy közös QR-kódot tehetsz ki a helyszínen. Minden vendég ugyanabba a vendégkönyvbe írhat.': { en: 'You can display one shared QR code at the venue. Every guest can write in the same guestbook.', de: 'Du kannst vor Ort einen gemeinsamen QR-Code aufstellen. Alle Gäste schreiben in dasselbe Gästebuch.' },
  'QR-kód megnyitása': { en: 'Open QR code', de: 'QR-Code öffnen' },
  'Elrejtve a könyvből, a tartalom megőrizve.': { en: 'Hidden from the book; content preserved.', de: 'Aus dem Buch ausgeblendet; Inhalt bleibt erhalten.' },
  'Könyvben marad.': { en: 'Remains in the book.', de: 'Bleibt im Buch.' },
  'Emlék:': { en: 'Memory:', de: 'Erinnerung:' },
  'Szerző jóváhagyása:': { en: 'Author approval:', de: 'Zustimmung des Autors:' },
  'Tulajdonosi jóváhagyás:': { en: 'Owner approval:', de: 'Zustimmung des Eigentümers:' },
  'igen': { en: 'yes', de: 'ja' },
  'nem': { en: 'no', de: 'nein' },
  'Nyilvános megosztás visszavonása': { en: 'Revoke public sharing', de: 'Öffentliche Freigabe widerrufen' },
  'Nyilvános megosztás jóváhagyása': { en: 'Approve public sharing', de: 'Öffentliche Freigabe genehmigen' },
  'Nyilvános link kimásolva': { en: 'Public link copied', de: 'Öffentlicher Link kopiert' },
  'Nyilvános link másolása': { en: 'Copy public link', de: 'Öffentlichen Link kopieren' },
  'Vissza a könyvbe': { en: 'Return to book', de: 'Zurück ins Buch' },
  'Elrejtés / archiválás': { en: 'Hide / archive', de: 'Ausblenden / archivieren' },
  'Végleges törlés': { en: 'Delete permanently', de: 'Endgültig löschen' },
  'A meghívó lejárt. Az oldal új címzettnek kiadható.': { en: 'The invitation has expired. The page can be assigned to a new recipient.', de: 'Die Einladung ist abgelaufen. Die Seite kann einem neuen Empfänger zugewiesen werden.' },
  'A meghívó 14 napig használható. Lejár: {date}': { en: 'The invitation is valid for 14 days. Expires: {date}', de: 'Die Einladung ist 14 Tage gültig. Ablauf: {date}' },
  'Készül...': { en: 'Preparing...', de: 'Wird vorbereitet...' },
  'Meghívás': { en: 'Invite', de: 'Einladen' },
  'Új címzett meghívása': { en: 'Invite new recipient', de: 'Neuen Empfänger einladen' },
  'Meghívó újraküldése': { en: 'Resend invitation', de: 'Einladung erneut senden' },
  'Meghívás folytatása': { en: 'Continue invitation', de: 'Einladung fortsetzen' },
  'Üres': { en: 'Empty', de: 'Leer' },
  'Meghívva': { en: 'Invited', de: 'Eingeladen' },
  'Szerkesztés alatt': { en: 'Being edited', de: 'In Bearbeitung' },
  'Beküldve': { en: 'Submitted', de: 'Eingereicht' },
  'Archiválva': { en: 'Archived', de: 'Archiviert' },
  'Meghívó lejárt': { en: 'Invitation expired', de: 'Einladung abgelaufen' },
  'Meghívó kiküldve': { en: 'Invitation sent', de: 'Einladung gesendet' },

  'Megosztásnál add meg a címzett nevét, hogy az emlék később is azonosítható legyen.': { en: 'For sharing, enter the recipient name so the memory can be identified later.', de: 'Gib beim Teilen den Namen des Empfängers an, damit die Erinnerung später zugeordnet werden kann.' },
  'E-mail küldésnél add meg a címzett e-mail címét.': { en: "Enter the recipient's email address for email delivery.", de: 'Gib für den E-Mail-Versand die E-Mail-Adresse des Empfängers an.' },
  'Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.': { en: 'Could not record the invitation as sent. Try again.', de: 'Der Versand der Einladung konnte nicht gespeichert werden. Versuche es erneut.' },
  'Ezen az eszközön a rendszer megosztás nem érhető el. Válaszd az E-mail lehetőséget.': { en: 'System sharing is not available on this device. Choose Email.', de: 'Die Systemfreigabe ist auf diesem Gerät nicht verfügbar. Wähle E-Mail.' },
  'Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.': { en: 'Could not open sharing. Try again or choose Email.', de: 'Die Freigabe konnte nicht geöffnet werden. Versuche es erneut oder wähle E-Mail.' },
  'Oldal {page}': { en: 'Page {page}', de: 'Seite {page}' },
  'Meghívás küldése': { en: 'Send invitation', de: 'Einladung senden' },
  'Bezárás': { en: 'Close', de: 'Schließen' },
  'Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.': { en: 'You already sent this invitation. Resending is intended for the same person.', de: 'Diese Einladung wurde bereits gesendet. Das erneute Senden ist für dieselbe Person gedacht.' },
  'A meghívó 14 napig használható{expiry}.': { en: 'The invitation is valid for 14 days{expiry}.', de: 'Die Einladung ist 14 Tage gültig{expiry}.' },
  ', lejár: {date}': { en: ', expires: {date}', de: ', Ablauf: {date}' },
  '1. Küldési mód': { en: '1. Delivery method', de: '1. Versandart' },
  'Megosztás…': { en: 'Share…', de: 'Teilen…' },
  'Messenger, WhatsApp, SMS, e-mail és más telepített app': { en: 'Messenger, WhatsApp, SMS, email and other installed apps', de: 'Messenger, WhatsApp, SMS, E-Mail und andere installierte Apps' },
  'Közvetlenül a levelező alkalmazásban': { en: 'Directly in your email app', de: 'Direkt in der E-Mail-App' },
  '2. Meghívó nyelve': { en: '2. Invitation language', de: '2. Sprache der Einladung' },
  'Nyelv': { en: 'Language', de: 'Sprache' },
  'Meghívó nyelve': { en: 'Invitation language', de: 'Sprache der Einladung' },
  'Könyv nyelve ({language})': { en: 'Book language ({language})', de: 'Buchsprache ({language})' },
  '3. Személyre szabás': { en: '3. Personalization', de: '3. Personalisierung' },
  'Címzett neve': { en: 'Recipient name', de: 'Name des Empfängers' },
  '(kötelező)': { en: '(required)', de: '(erforderlich)' },
  '(opcionális)': { en: '(optional)', de: '(optional)' },
  'pl. Rubinszky Gertrúd': { en: 'e.g. Gertrud Rubinszky', de: 'z. B. Gertrud Rubinszky' },
  'E-mail cím (kötelező)': { en: 'Email address (required)', de: 'E-Mail-Adresse (erforderlich)' },
  'Meghívó üzenet': { en: 'Invitation message', de: 'Einladungstext' },
  'A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.': { en: 'During the active 14-day window, this page is assigned to this recipient. After expiry, the page can be assigned to someone new.', de: 'Während des aktiven 14-Tage-Zeitraums ist diese Seite diesem Empfänger zugeordnet. Nach Ablauf kann die Seite einem neuen Empfänger zugewiesen werden.' },
  'A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.': { en: 'The “Create your own MemoryBook” section remains in the invitation so the recipient can start their own MemoryBook.', de: 'Der Abschnitt „Eigenes MemoryBook erstellen“ bleibt in der Einladung, damit der Empfänger ein eigenes MemoryBook starten kann.' },
  'Mégse': { en: 'Cancel', de: 'Abbrechen' },
  'E-mail megnyitása': { en: 'Open email', de: 'E-Mail öffnen' },
  'Címzett és app kiválasztása': { en: 'Choose recipient and app', de: 'Empfänger und App auswählen' },
};

export function ownerText(language: AppLanguage, key: string): string {
  if (language === 'hu') return key;
  return translations[key]?.[language] ?? key;
}

export function ownerFormat(
  language: AppLanguage,
  key: string,
  values: Record<string, string | number> = {}
): string {
  let value = ownerText(language, key);
  for (const [name, replacement] of Object.entries(values)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

export function ownerLocale(language: AppLanguage): string {
  if (language === 'de') return 'de-DE';
  if (language === 'en') return 'en-US';
  return 'hu-HU';
}

export function useOwnerUiLanguage(): AppLanguage {
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  useEffect(() => subscribeAppLanguage(setLanguage), []);
  return language;
}
'''
Path('src/ownerUiI18n.ts').write_text(helper, encoding='utf-8')

# MyBooksPage
p = 'src/MyBooksPage.tsx'
text = read(p)
text = rep(text, "import { getAppLanguage, type AppLanguage } from './i18n';", "import { getAppLanguage, type AppLanguage } from './i18n';\nimport { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'mybooks import')
text = rep(text, "export function MyBooksPage() {\n", "export function MyBooksPage() {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);\n", 'mybooks hook')
for old in [
    'Nem sikerült betölteni a könyveidet.',
    'Adj nevet az emlékkönyvnek.',
    'A könyv létrehozásához felhasználható vásárlási jogosultság kell.',
    'A könyv létrehozásához vásárlási jogosultság szükséges.',
    'Nem sikerült létrehozni az emlékkönyvet.',
]:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, '<h1 style={styles.title}>Saját könyveim</h1>', "<h1 style={styles.title}>{t('Saját könyveim')}</h1>", 'mybooks title')
text = rep(text, "user.name || user.email || 'Bejelentkezett felhasználó'", "user.name || user.email || t('Bejelentkezett felhasználó')", 'mybooks user fallback')
text = rep(text, '>Kijelentkezés</button>', ">{t('Kijelentkezés')}</button>", 'mybooks signout')
text = rep(text, '<h2 style={styles.createTitle}>Új emlékkönyv létrehozása</h2>', "<h2 style={styles.createTitle}>{t('Új emlékkönyv létrehozása')}</h2>", 'mybooks create title')
text = rep(text, '{availableEntitlements.length} felhasználható könyvjogosultságod van. Egy jogosultság egy könyv létrehozására használható fel.', "{f('{count} felhasználható könyvjogosultságod van. Egy jogosultság egy könyv létrehozására használható fel.', { count: availableEntitlements.length })}", 'mybooks entitlement count')
text = rep(text, 'aria-label="Vásárlási jogosultság"', "aria-label={t('Vásárlási jogosultság')}", 'mybooks entitlement aria')
text = rep(text, "? 'Rendezvény-vendégkönyv'\n                          : `Normál emlékkönyv – ${item.includedPages} oldal`}", "? t('Rendezvény-vendégkönyv')\n                          : f('Normál emlékkönyv – {count} oldal', { count: item.includedPages })}", 'mybooks entitlement option')
text = rep(text, "{item.wasGift ? ' · ajándék' : ''}", "{item.wasGift ? ` ${t('· ajándék')}` : ''}", 'mybooks gift')
text = rep(text, 'placeholder="Például: Anna 40. születésnapja"', "placeholder={t('Például: Anna 40. születésnapja')}", 'mybooks placeholder')
text = rep(text, "{creating ? 'Létrehozás...' : 'Emlékkönyv létrehozása'}", "{creating ? t('Létrehozás...') : t('Emlékkönyv létrehozása')}", 'mybooks create button')
text = rep(text, '<h2 style={styles.createTitle}>Új emlékkönyv</h2>', "<h2 style={styles.createTitle}>{t('Új emlékkönyv')}</h2>", 'mybooks new title')
text = rep(text, 'Új könyvet vásárlási jogosultsággal lehet létrehozni. A normál könyv 30 oldallal indul, később bővíthető.', "{t('Új könyvet vásárlási jogosultsággal lehet létrehozni. A normál könyv 30 oldallal indul, később bővíthető.')}", 'mybooks purchase text')
text = rep(text, '>Új könyv vásárlása</a>', ">{t('Új könyv vásárlása')}</a>", 'mybooks purchase')
text = rep(text, '>További könyv vásárlása vagy ajándékba vétele</a>', ">{t('További könyv vásárlása vagy ajándékba vétele')}</a>", 'mybooks purchase more')
text = rep(text, '<div style={styles.panel}>Betöltés...</div>', "<div style={styles.panel}>{t('Betöltés...')}</div>", 'mybooks loading')
text = rep(text, '<h2 style={styles.emptyTitle}>Még nincs emlékkönyved</h2>', "<h2 style={styles.emptyTitle}>{t('Még nincs emlékkönyved')}</h2>", 'mybooks empty title')
text = rep(text, 'Vásárolj könyvjogosultságot, vagy válts be egy ajándékba kapott jogosultságot. A könyv csak ezután hozható létre.', "{t('Vásárolj könyvjogosultságot, vagy válts be egy ajándékba kapott jogosultságot. A könyv csak ezután hozható létre.')}", 'mybooks empty text')
text = rep(text, "{book.bookType === 'event' ? 'Rendezvény-vendégkönyv' : 'Normál emlékkönyv'}", "{book.bookType === 'event' ? t('Rendezvény-vendégkönyv') : t('Normál emlékkönyv')}", 'mybooks badge')
# Normal badge key is intentionally handled separately because only the short label exists here.
text = text.replace("t('Normál emlékkönyv')", "language === 'de' ? 'Normales Erinnerungsbuch' : language === 'en' ? 'Standard memory book' : 'Normál emlékkönyv'", 1)
text = rep(text, "{book.bookType === 'event' ? `${book.contributionCount} bejegyzés` : `${book.pageCount} oldal`}", "{book.bookType === 'event' ? f('{count} bejegyzés', { count: book.contributionCount }) : f('{count} oldal', { count: book.pageCount })}", 'mybooks meta')
text = rep(text, "{book.bookType === 'event' ? 'Rendezvény kezelése' : 'Oldalak és meghívók'}", "{book.bookType === 'event' ? t('Rendezvény kezelése') : t('Oldalak és meghívók')}", 'mybooks primary link')
text = rep(text, '>Könyv megnyitása</a>', ">{t('Könyv megnyitása')}</a>", 'mybooks open')
text = rep(text, '>Beérkezett bejegyzések</a>', ">{t('Beérkezett bejegyzések')}</a>", 'mybooks entries')
write(p, text)

# NotificationMenu
p = 'src/NotificationMenu.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState } from 'react';", "import { useEffect, useState } from 'react';\nimport { ownerFormat, ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'notification import')
text = rep(text, "export function NotificationMenu() {\n", "export function NotificationMenu() {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);\n", 'notification hook')
text = text.replace("setError('Nem sikerült betölteni az értesítéseket.');", "setError(t('Nem sikerült betölteni az értesítéseket.'));")
text = rep(text, "aria-label={`Értesítések${unreadCount > 0 ? `, ${unreadCount} olvasatlan` : ''}`}", "aria-label={`${t('Értesítések')}${unreadCount > 0 ? `, ${f('{count} olvasatlan', { count: unreadCount })}` : ''}`}", 'notification aria')
text = rep(text, 'aria-label="Értesítések"', "aria-label={t('Értesítések')}", 'notification region aria')
text = rep(text, '<strong>Értesítések</strong>', "<strong>{t('Értesítések')}</strong>", 'notification title')
text = rep(text, '{unreadCount} új', "{f('{count} új', { count: unreadCount })}", 'notification new')
text = rep(text, '<div style={styles.state}>Betöltés...</div>', "<div style={styles.state}>{t('Betöltés...')}</div>", 'notification loading')
text = rep(text, '<div style={styles.state}>Nincs értesítés.</div>', "<div style={styles.state}>{t('Nincs értesítés.')}</div>", 'notification empty')
text = rep(text, "? `${notification.actorName} visszaküldte a ${notification.pageNumber}. oldalt.`\n                  : `Visszaérkezett a ${notification.pageNumber}. oldal.`;", "? f('{name} visszaküldte a {page}. oldalt.', { name: notification.actorName, page: notification.pageNumber })\n                  : f('Visszaérkezett a {page}. oldal.', { page: notification.pageNumber });", 'notification message')
write(p, text)

# EventBookSettings
p = 'src/EventBookSettings.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState, type FormEvent } from 'react';", "import { useEffect, useState, type FormEvent } from 'react';\nimport { ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'event settings import')
text = rep(text, "export function EventBookSettings({ bookId }: Props) {\n", "export function EventBookSettings({ bookId }: Props) {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n", 'event settings hook')
for old in ['A rendezvény beállításait nem sikerült betölteni.', 'Beállítás mentve.', 'A beállítást nem sikerült menteni.']:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, 'if (loading) return <section style={styles.panel}>Rendezvény beállítások betöltése...</section>;', "if (loading) return <section style={styles.panel}>{t('Rendezvény beállítások betöltése...')}</section>;", 'event settings loading')
text = rep(text, '<div style={styles.eyebrow}>Beküldési szabályok</div>', "<div style={styles.eyebrow}>{t('Beküldési szabályok')}</div>", 'event settings eyebrow')
text = rep(text, '<h2 style={styles.title}>Hány bejegyzés jöhet egy telefonról?</h2>', "<h2 style={styles.title}>{t('Hány bejegyzés jöhet egy telefonról?')}</h2>", 'event settings title')
text = rep(text, 'Ezt minden rendezvénykönyvnél külön állítod be. Nagy koncertnél vagy fesztiválnál tipikusan 1, családi rendezvénynél 5 vagy 10 lehet.', "{t('Ezt minden rendezvénykönyvnél külön állítod be. Nagy koncertnél vagy fesztiválnál tipikusan 1, családi rendezvénynél 5 vagy 10 lehet.')}", 'event settings text')
text = rep(text, 'Bejegyzések száma egy eszközről\n          <input', "{t('Bejegyzések száma egy eszközről')}\n          <input", 'event settings label')
text = rep(text, 'aria-label="Bejegyzések száma egy eszközről"', "aria-label={t('Bejegyzések száma egy eszközről')}", 'event settings aria')
text = rep(text, "{saving ? 'Mentés...' : 'Beállítás mentése'}", "{saving ? t('Mentés...') : t('Beállítás mentése')}", 'event settings save')
text = rep(text, '<strong>Azonosítás</strong>', "<strong>{t('Azonosítás')}</strong>", 'event settings identity')
text = rep(text, "{identityMode === 'none' ? 'Azonosítás nélkül' : identityMode}", "{identityMode === 'none' ? t('Azonosítás nélkül') : identityMode}", 'event settings identity value')
text = rep(text, 'Google-, e-mail- és rendezvényalkalmazás-azonosítás külön következő lépésben kapcsolható be. A mostani eszközlimit már működik.', "{t('Google-, e-mail- és rendezvényalkalmazás-azonosítás külön következő lépésben kapcsolható be. A mostani eszközlimit már működik.')}", 'event settings note')
write(p, text)

# EventGuestbookQrPage
p = 'src/EventGuestbookQrPage.tsx'
text = read(p)
text = rep(text, "import QRCode from 'qrcode';", "import QRCode from 'qrcode';\nimport { ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'qr import')
text = rep(text, "export function EventGuestbookQrPage({ bookId }: EventGuestbookQrPageProps) {\n", "export function EventGuestbookQrPage({ bookId }: EventGuestbookQrPageProps) {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n", 'qr hook')
text = rep(text, "const [title, setTitle] = useState('MemoryBook vendégkönyv');", "const [title, setTitle] = useState('MemoryBook');", 'qr title state')
text = rep(text, "setTitle(data.book?.title || 'MemoryBook vendégkönyv');", "setTitle(data.book?.title || 'MemoryBook');", 'qr fallback')
text = text.replace("setError('Nem sikerült betölteni a rendezvény QR-kódját.');", "setError(t('Nem sikerült betölteni a rendezvény QR-kódját.'));")
text = text.replace("setError('Nem sikerült elkészíteni a QR-kódot.');", "setError(t('Nem sikerült elkészíteni a QR-kódot.'));")
text = rep(text, '<main style={styles.center}>QR-kód készítése...</main>', "<main style={styles.center}>{t('QR-kód készítése...')}</main>", 'qr loading')
text = rep(text, '>← Vissza a könyvhöz</a>', ">{t('← Vissza a könyvhöz')}</a>", 'qr back')
text = rep(text, '<div style={styles.brand}>MemoryBook vendégkönyv</div>', "<div style={styles.brand}>{t('MemoryBook vendégkönyv')}</div>", 'qr brand')
text = rep(text, '<p style={styles.lead}>Olvasd be a QR-kódot, és írj a vendégkönyvbe!</p>', "<p style={styles.lead}>{t('Olvasd be a QR-kódot, és írj a vendégkönyvbe!')}</p>", 'qr lead')
text = rep(text, 'alt="Rendezvény vendégkönyv QR-kód"', "alt={t('Rendezvény vendégkönyv QR-kód')}", 'qr alt')
text = rep(text, '<p style={styles.hint}>A QR-kód ugyanarra a közös vendégkönyvre visz minden vendéget.</p>', "<p style={styles.hint}>{t('A QR-kód ugyanarra a közös vendégkönyvre visz minden vendéget.')}</p>", 'qr hint')
write(p, text)

# OrganizerContributionsPage
p = 'src/OrganizerContributionsPage.tsx'
text = read(p)
text = rep(text, "import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useMemo, useState } from 'react';\nimport { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'organizer import')
text = rep(text, "export function OrganizerContributionsPage({ bookId }: Props) {\n", "export function OrganizerContributionsPage({ bookId }: Props) {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);\n", 'organizer hook')
for old in ['A beérkezett bejegyzéseket nem sikerült betölteni.', 'A bejegyzés állapotát nem sikerült módosítani.', 'A csoport/tematika mentése nem sikerült.', 'A sorrend mentése nem sikerült.']:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, '<div style={styles.message}>Bejegyzések betöltése...</div>', "<div style={styles.message}>{t('Bejegyzések betöltése...')}</div>", 'organizer loading')
text = rep(text, '<div style={styles.message}>A könyv nem található.</div>', "<div style={styles.message}>{t('A könyv nem található.')}</div>", 'organizer not found')
text = rep(text, '← Vissza a könyvhöz\n        </a>', "{t('← Vissza a könyvhöz')}\n        </a>", 'organizer back')
text = rep(text, '<div style={styles.eyebrow}>MemoryBook · rendezvény</div>', "<div style={styles.eyebrow}>{t('MemoryBook · rendezvény')}</div>", 'organizer eyebrow')
text = rep(text, 'Itt te döntöd el, mely vendégbejegyzéseket tartod meg. A megtartott\n          anyagokat kézzel rendezheted; később az AI javasolhat csoportokat és\n          sorrendet, de nem dönt helyetted.', "{t('Itt te döntöd el, mely vendégbejegyzéseket tartod meg. A megtartott anyagokat kézzel rendezheted; később az AI javasolhat csoportokat és sorrendet, de nem dönt helyetted.')}", 'organizer intro')
text = rep(text, 'Új ({counts.pending})', "{t('Új')} ({counts.pending})", 'organizer pending')
text = rep(text, 'Megtartott ({counts.kept})', "{t('Megtartott')} ({counts.kept})", 'organizer kept')
text = rep(text, 'Elutasított ({counts.rejected})', "{t('Elutasított')} ({counts.rejected})", 'organizer rejected')
text = rep(text, 'Összes ({counts.all})', "{t('Összes')} ({counts.all})", 'organizer all')
text = rep(text, '<strong style={styles.organizationTitle}>Megtartott bejegyzések rendezése</strong>', "<strong style={styles.organizationTitle}>{t('Megtartott bejegyzések rendezése')}</strong>", 'organizer arrange')
text = rep(text, 'A ↑ / ↓ gombokkal állítsd be a sorrendet. A „Csoport / tematika”\n                mezővel például Család, Barátok, Kollégák vagy Esti pillanatok\n                csoportot adhatsz meg.', "{t('A ↑ / ↓ gombokkal állítsd be a sorrendet. A „Csoport / tematika” mezővel például Család, Barátok, Kollégák vagy Esti pillanatok csoportot adhatsz meg.')}", 'organizer arrange text')
text = rep(text, '<strong>AI-rendszerezési javaslat – később</strong>', "<strong>{t('AI-rendszerezési javaslat – később')}</strong>", 'organizer ai title')
text = rep(text, 'Az AI csak javasolhat csoportokat és sorrendet. Minden változtatást\n                a tulajdonos hagy jóvá.', "{t('Az AI csak javasolhat csoportokat és sorrendet. Minden változtatást a tulajdonos hagy jóvá.')}", 'organizer ai text')
text = rep(text, '<div style={styles.empty}>Ebben a csoportban nincs bejegyzés.</div>', "<div style={styles.empty}>{t('Ebben a csoportban nincs bejegyzés.')}</div>", 'organizer empty')
text = rep(text, '{statusLabel(status)}', '{statusLabel(status, language)}', 'organizer status')
text = rep(text, "toLocaleString('hu-HU')", 'toLocaleString(ownerLocale(language))', 'organizer locale')
text = rep(text, "alt={`${contribution.contributorName} fotója`}", "alt={f('{name} fotója', { name: contribution.contributorName })}", 'organizer alt')
text = rep(text, 'Csoport / tematika\n                        <input', "{t('Csoport / tematika')}\n                        <input", 'organizer group label')
text = rep(text, 'placeholder="Például: Család"', "placeholder={t('Például: Család')}", 'organizer placeholder')
text = rep(text, '>Tematika mentése\n                      </button>', ">{t('Tematika mentése')}\n                      </button>", 'organizer save theme')
text = rep(text, 'aria-label="Bejegyzés feljebb"', "aria-label={t('Bejegyzés feljebb')}", 'organizer up aria')
text = rep(text, '>\n                          ↑ Feljebb\n                        </button>', ">\n                          {t('↑ Feljebb')}\n                        </button>", 'organizer up')
text = rep(text, 'aria-label="Bejegyzés lejjebb"', "aria-label={t('Bejegyzés lejjebb')}", 'organizer down aria')
text = rep(text, '>\n                          ↓ Lejjebb\n                        </button>', ">\n                          {t('↓ Lejjebb')}\n                        </button>", 'organizer down')
text = rep(text, "{working ? 'Folyamatban...' : 'Megtartom'}", "{working ? t('Folyamatban...') : t('Megtartom')}", 'organizer keep')
text = rep(text, '>\n                      Elutasítom\n                    </button>', ">\n                      {t('Elutasítom')}\n                    </button>", 'organizer reject')
text = rep(text, '>\n                        Vissza az új bejegyzésekhez\n                      </button>', ">\n                        {t('Vissza az új bejegyzésekhez')}\n                      </button>", 'organizer reset')
text = rep(text, 'function statusLabel(status: OwnerStatus) {\n  if (status === \'kept\') return \'Megtartva\';\n  if (status === \'rejected\') return \'Elutasítva\';\n  return \'Új\';\n}', "function statusLabel(status: OwnerStatus, language: import('./i18n').AppLanguage) {\n  if (status === 'kept') return ownerText(language, 'Megtartva');\n  if (status === 'rejected') return ownerText(language, 'Elutasítva');\n  return ownerText(language, 'Új');\n}", 'organizer status function')
write(p, text)

# BookViewerPage
p = 'src/BookViewerPage.tsx'
text = read(p)
text = rep(text, "import { useEffect, useState } from 'react';", "import { useEffect, useState } from 'react';\nimport { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';\nimport type { AppLanguage } from './i18n';", 'viewer import')
text = rep(text, "export function BookViewerPage({ bookId }: BookViewerPageProps) {\n", "export function BookViewerPage({ bookId }: BookViewerPageProps) {\n  const language = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(language, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(language, key, values);\n", 'viewer hook')
for old in ['A könyvet nem sikerült betölteni.', 'Az oldalt nem sikerült betölteni.', 'A saját megjegyzést nem sikerült elmenteni.']:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, '← Saját könyveim\n        </a>', "{t('← Saját könyveim')}\n        </a>", 'viewer back')
text = rep(text, '<div style={styles.meta}>Csak olvasható könyvnézet</div>', "<div style={styles.meta}>{t('Csak olvasható könyvnézet')}</div>", 'viewer meta')
text = rep(text, 'aria-label="Előző oldal"', "aria-label={t('Előző oldal')}", 'viewer prev aria')
text = rep(text, '>\n            ← Előző\n          </button>', ">\n            {t('← Előző')}\n          </button>", 'viewer prev')
text = rep(text, "? `${currentIndex + 1} / ${pageIds.length} oldal`\n              : 'Nincs oldal'", "? f('{current} / {total} oldal', { current: currentIndex + 1, total: pageIds.length })\n              : t('Nincs oldal')", 'viewer page count')
text = rep(text, 'aria-label="Következő oldal"', "aria-label={t('Következő oldal')}", 'viewer next aria')
text = rep(text, '>\n            Következő →\n          </button>', ">\n            {t('Következő →')}\n          </button>", 'viewer next')
text = rep(text, '<div style={styles.message}>Oldal betöltése...</div>', "<div style={styles.message}>{t('Oldal betöltése...')}</div>", 'viewer loading')
text = rep(text, '<div>Még nincs beküldött oldal ebben a könyvben.</div>', "<div>{t('Még nincs beküldött oldal ebben a könyvben.')}</div>", 'viewer empty')
text = rep(text, "alt={`${page.pageNumber}. oldal`}", "alt={f('{page}. oldal', { page: page.pageNumber })}", 'viewer img alt')
text = rep(text, '<div>{currentIndex + 1}. oldal</div>', "<div>{f('{page}. oldal', { page: currentIndex + 1 })}</div>", 'viewer page fallback')
text = rep(text, '<div style={styles.emptyText}>Ehhez az oldalhoz nincs előnézeti kép.</div>', "<div style={styles.emptyText}>{t('Ehhez az oldalhoz nincs előnézeti kép.')}</div>", 'viewer no preview')
text = rep(text, '<div style={styles.identityEyebrow}>Az emlék adatai</div>', "<div style={styles.identityEyebrow}>{t('Az emlék adatai')}</div>", 'viewer details')
text = rep(text, "page.inviteRecipientEmail || 'Nincs azonosítva'", "page.inviteRecipientEmail || t('Nincs azonosítva')", 'viewer unidentified')
text = rep(text, '<span style={styles.identityLabel}>Küldési mód</span>', "<span style={styles.identityLabel}>{t('Küldési mód')}</span>", 'viewer delivery label')
text = rep(text, "? 'E-mail'\n                  : page.inviteDeliveryMethod === 'share'\n                    ? 'Megosztás'\n                    : 'Nincs rögzítve'", "? 'E-mail'\n                  : page.inviteDeliveryMethod === 'share'\n                    ? t('Megosztás')\n                    : t('Nincs rögzítve')", 'viewer delivery')
text = rep(text, '<span style={styles.identityLabel}>Meghívás dátuma</span>', "<span style={styles.identityLabel}>{t('Meghívás dátuma')}</span>", 'viewer invite date')
text = rep(text, '{formatDate(page.inviteSentAt)}', '{formatDate(page.inviteSentAt, language)}', 'viewer invite format')
text = rep(text, '<span style={styles.identityLabel}>Beküldés dátuma</span>', "<span style={styles.identityLabel}>{t('Beküldés dátuma')}</span>", 'viewer submit date')
text = rep(text, '{formatDate(page.submittedAt)}', '{formatDate(page.submittedAt, language)}', 'viewer submit format')
text = rep(text, 'Saját megjegyzés\n              <textarea', "{t('Saját megjegyzés')}\n              <textarea", 'viewer note label')
text = rep(text, 'placeholder="Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…"', "placeholder={t('Pl. hol találkoztunk, milyen eseményhez kapcsolódik az emlék…')}", 'viewer note placeholder')
text = rep(text, "{noteSaving ? 'Mentés…' : noteSaved ? 'Megjegyzés elmentve' : 'Megjegyzés mentése'}", "{noteSaving ? t('Mentés…') : noteSaved ? t('Megjegyzés elmentve') : t('Megjegyzés mentése')}", 'viewer note button')
text = rep(text, 'Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.', "{t('Ez az adatblokk az online könyvhöz tartozik. Későbbi nyomtatásnál csak a fenti emlékoldal kerül a könyvbe.')}", 'viewer print hint')
text = rep(text, "function formatDate(value?: string | null) {\n  if (!value) return 'Nincs rögzítve';\n  const date = new Date(value);\n  return Number.isNaN(date.getTime())\n    ? value\n    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });\n}", "function formatDate(value: string | null | undefined, language: AppLanguage) {\n  if (!value) return ownerText(language, 'Nincs rögzítve');\n  const date = new Date(value);\n  return Number.isNaN(date.getTime())\n    ? value\n    : date.toLocaleDateString(ownerLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit' });\n}", 'viewer format date function')
write(p, text)

# OwnerBookPage
p = 'src/OwnerBookPage.tsx'
text = read(p)
text = rep(text, "import { normalizeAppLanguage, SUPPORTED_APP_LANGUAGES, type AppLanguage } from './i18n';", "import { normalizeAppLanguage, SUPPORTED_APP_LANGUAGES, type AppLanguage } from './i18n';\nimport { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'owner import')
text = rep(text, "export function OwnerBookPage({ bookId }: OwnerBookPageProps) {\n", "export function OwnerBookPage({ bookId }: OwnerBookPageProps) {\n  const uiLanguage = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(uiLanguage, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(uiLanguage, key, values);\n", 'owner hook')
for old in [
    'Nem sikerült betölteni a könyv oldalait.',
    'Nem sikerült létrehozni a meghívót.',
    'Nem sikerült új címzettnek megnyitni az oldalt.',
    'Nem sikerült módosítani az oldal állapotát.',
    'A szerző nem járult hozzá a nyilvános megosztáshoz.',
    'Nem sikerült módosítani a nyilvános megosztást.',
    'Nem sikerült törölni a beküldött oldalt.',
    'A könyv nyelvét nem sikerült módosítani.',
]:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, "window.prompt('Másold ki a nyilvános linket:', url);", "window.prompt(t('Másold ki a nyilvános linket:'), url);", 'owner prompt')
text = rep(text, "`Biztosan végleg törlöd a(z) ${page.pageNumber}. oldal beküldött tartalmát?\\n\\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.`", "f('Biztosan végleg törlöd a(z) {page}. oldal beküldött tartalmát?\\n\\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.', { page: page.pageNumber })", 'owner delete confirm')
text = rep(text, '<a href="/my-books" style={styles.backLink}>← Saját könyveim</a>', "<a href=\"/my-books\" style={styles.backLink}>{t('← Saját könyveim')}</a>", 'owner back')
text = rep(text, 'Könyv nyelve\n              <select', "{t('Könyv nyelve')}\n              <select", 'owner language label')
text = rep(text, 'aria-label="Könyv nyelve"', "aria-label={t('Könyv nyelve')}", 'owner language aria')
text = rep(text, "? 'A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.'\n                : 'Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött oldalakat megtarthatod, archiválhatod vagy végleg törölheted.'", "? t('A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.')\n                : t('Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött oldalakat megtarthatod, archiválhatod vagy végleg törölheted.')", 'owner subtitle')
text = rep(text, '<strong style={styles.eventPanelTitle}>Rendezvény vendégkönyv</strong>', "<strong style={styles.eventPanelTitle}>{t('Rendezvény vendégkönyv')}</strong>", 'owner event title')
text = rep(text, '<div style={styles.eventPanelText}>Egy közös QR-kódot tehetsz ki a helyszínen. Minden vendég ugyanabba a vendégkönyvbe írhat.</div>', "<div style={styles.eventPanelText}>{t('Egy közös QR-kódot tehetsz ki a helyszínen. Minden vendég ugyanabba a vendégkönyvbe írhat.')}</div>", 'owner event text')
text = rep(text, '>QR-kód megnyitása</a>', ">{t('QR-kód megnyitása')}</a>", 'owner qr')
text = rep(text, '>Beérkezett bejegyzések</a>', ">{t('Beérkezett bejegyzések')}</a>", 'owner contributions')
text = rep(text, '<div style={styles.panel}>Betöltés...</div>', "<div style={styles.panel}>{t('Betöltés...')}</div>", 'owner loading')
text = rep(text, '<strong style={styles.pageNumber}>Oldal {page.pageNumber}</strong>', "<strong style={styles.pageNumber}>{f('Oldal {page}', { page: page.pageNumber })}</strong>", 'owner page number')
text = rep(text, '{displayStatusLabel(page)}', '{displayStatusLabel(page, uiLanguage)}', 'owner display status')
text = rep(text, "? 'Elrejtve a könyvből, a tartalom megőrizve.'\n                          : 'Könyvben marad.'", "? t('Elrejtve a könyvből, a tartalom megőrizve.')\n                          : t('Könyvben marad.')", 'owner state')
text = rep(text, '<strong>Emlék:</strong>', "<strong>{t('Emlék:')}</strong>", 'owner memory')
text = rep(text, "page.inviteRecipientEmail || 'Nincs azonosítva'", "page.inviteRecipientEmail || t('Nincs azonosítva')", 'owner unidentified')
text = rep(text, 'formatInviteExpiry(page.submittedAt)', 'formatInviteExpiry(page.submittedAt, uiLanguage)', 'owner submitted date')
text = rep(text, "Szerző jóváhagyása: <strong>{page.authorShareApproved ? 'igen' : 'nem'}</strong>", "{t('Szerző jóváhagyása:')} <strong>{page.authorShareApproved ? t('igen') : t('nem')}</strong>", 'owner author approval')
text = rep(text, "Tulajdonosi jóváhagyás: <strong>{page.ownerShareApproved ? 'igen' : 'nem'}</strong>", "{t('Tulajdonosi jóváhagyás:')} <strong>{page.ownerShareApproved ? t('igen') : t('nem')}</strong>", 'owner owner approval')
text = rep(text, "? 'Nyilvános megosztás visszavonása'\n                              : 'Nyilvános megosztás jóváhagyása'", "? t('Nyilvános megosztás visszavonása')\n                              : t('Nyilvános megosztás jóváhagyása')", 'owner sharing')
text = rep(text, "? 'Nyilvános link kimásolva'\n                                : 'Nyilvános link másolása'", "? t('Nyilvános link kimásolva')\n                                : t('Nyilvános link másolása')", 'owner public link')
text = rep(text, "? 'Folyamatban...'\n                            : isArchived\n                              ? 'Vissza a könyvbe'\n                              : 'Elrejtés / archiválás'", "? t('Folyamatban...')\n                            : isArchived\n                              ? t('Vissza a könyvbe')\n                              : t('Elrejtés / archiválás')", 'owner visibility button')
text = rep(text, '>\n                          Végleges törlés\n                        </button>', ">\n                          {t('Végleges törlés')}\n                        </button>", 'owner delete button')
text = rep(text, "? 'A meghívó lejárt. Az oldal új címzettnek kiadható.'\n                            : <>A meghívó 14 napig használható. Lejár: {formatInviteExpiry(page.inviteExpiresAt)}</>", "? t('A meghívó lejárt. Az oldal új címzettnek kiadható.')\n                            : f('A meghívó 14 napig használható. Lejár: {date}', { date: formatInviteExpiry(page.inviteExpiresAt, uiLanguage) })", 'owner invite meta')
text = rep(text, "? 'Készül...'\n                          : !hasInvite\n                            ? 'Meghívás'\n                            : isInviteExpired(page)\n                              ? 'Új címzett meghívása'\n                              : page.inviteSentAt\n                                ? 'Meghívó újraküldése'\n                                : 'Meghívás folytatása'", "? t('Készül...')\n                          : !hasInvite\n                            ? t('Meghívás')\n                            : isInviteExpired(page)\n                              ? t('Új címzett meghívása')\n                              : page.inviteSentAt\n                                ? t('Meghívó újraküldése')\n                                : t('Meghívás folytatása')", 'owner invite button')
text = rep(text, "function statusLabel(status: string) {\n  switch (status) {\n    case 'empty':\n      return 'Üres';\n    case 'invited':\n      return 'Meghívva';\n    case 'draft':\n      return 'Szerkesztés alatt';\n    case 'submitted':\n      return 'Beküldve';\n    default:\n      return status;\n  }\n}\n\nfunction displayStatusLabel(page: OwnerPage) {\n  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {\n    return 'Archiválva';\n  }\n  if (isInviteExpired(page)) {\n    return 'Meghívó lejárt';\n  }\n  if (page.inviteStatus === 'invited' && page.inviteSentAt) {\n    return 'Meghívó kiküldve';\n  }\n\n  return statusLabel(page.inviteStatus);\n}", "function statusLabel(status: string, language: AppLanguage) {\n  switch (status) {\n    case 'empty':\n      return ownerText(language, 'Üres');\n    case 'invited':\n      return ownerText(language, 'Meghívva');\n    case 'draft':\n      return ownerText(language, 'Szerkesztés alatt');\n    case 'submitted':\n      return ownerText(language, 'Beküldve');\n    default:\n      return status;\n  }\n}\n\nfunction displayStatusLabel(page: OwnerPage, language: AppLanguage) {\n  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {\n    return ownerText(language, 'Archiválva');\n  }\n  if (isInviteExpired(page)) {\n    return ownerText(language, 'Meghívó lejárt');\n  }\n  if (page.inviteStatus === 'invited' && page.inviteSentAt) {\n    return ownerText(language, 'Meghívó kiküldve');\n  }\n\n  return statusLabel(page.inviteStatus, language);\n}", 'owner status functions')
text = rep(text, "function formatInviteExpiry(value: string) {\n  const date = new Date(value);\n  return Number.isNaN(date.getTime())\n    ? value\n    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });\n}", "function formatInviteExpiry(value: string, language: AppLanguage) {\n  const date = new Date(value);\n  return Number.isNaN(date.getTime())\n    ? value\n    : date.toLocaleDateString(ownerLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit' });\n}", 'owner date function')
write(p, text)

# InviteSendDialog
p = 'src/InviteSendDialog.tsx'
text = read(p)
text = rep(text, "import type { AppLanguage } from './i18n';", "import type { AppLanguage } from './i18n';\nimport { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';", 'invite dialog import')
text = rep(text, "}: InviteSendDialogProps) {\n", "}: InviteSendDialogProps) {\n  const uiLanguage = useOwnerUiLanguage();\n  const t = (key: string) => ownerText(uiLanguage, key);\n  const f = (key: string, values: Record<string, string | number>) => ownerFormat(uiLanguage, key, values);\n", 'invite dialog hook')
for old in [
    'Megosztásnál add meg a címzett nevét, hogy az emlék később is azonosítható legyen.',
    'E-mail küldésnél add meg a címzett e-mail címét.',
    'Nem sikerült rögzíteni a meghívás küldését. Próbáld újra.',
    'Nem sikerült megnyitni a megosztást. Próbáld újra vagy válaszd az E-mailt.',
]:
    text = text.replace(f"'{old}'", f"t({old!r})")
text = rep(text, "setSendError(\n        'Ezen az eszközön a rendszer megosztás nem érhető el. Válaszd az E-mail lehetőséget.'\n      );", "setSendError(t('Ezen az eszközön a rendszer megosztás nem érhető el. Válaszd az E-mail lehetőséget.'));", 'invite no share')
text = rep(text, '<div style={styles.eyebrow}>Oldal {pageNumber}</div>', "<div style={styles.eyebrow}>{f('Oldal {page}', { page: pageNumber })}</div>", 'invite page')
text = rep(text, "{isResend ? 'Meghívó újraküldése' : 'Meghívás küldése'}", "{isResend ? t('Meghívó újraküldése') : t('Meghívás küldése')}", 'invite title')
text = rep(text, 'aria-label="Bezárás"', "aria-label={t('Bezárás')}", 'invite close')
text = rep(text, 'Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.', "{t('Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.')}", 'invite resend note')
text = rep(text, "A meghívó 14 napig használható{expiresAt ? `, lejár: ${new Date(expiresAt).toLocaleDateString('hu-HU')}` : ''}.", "{f('A meghívó 14 napig használható{expiry}.', { expiry: expiresAt ? f(', lejár: {date}', { date: new Date(expiresAt).toLocaleDateString(ownerLocale(uiLanguage)) }) : '' })}", 'invite expiry')
text = rep(text, '<div style={styles.stepLabel}>1. Küldési mód</div>', "<div style={styles.stepLabel}>{t('1. Küldési mód')}</div>", 'invite step1')
text = rep(text, '            Megosztás…\n            <span style={styles.platformHint}>Messenger, WhatsApp, SMS, e-mail és más telepített app</span>', "            {t('Megosztás…')}\n            <span style={styles.platformHint}>{t('Messenger, WhatsApp, SMS, e-mail és más telepített app')}</span>", 'invite share option')
text = rep(text, '            E-mail\n            <span style={styles.platformHint}>Közvetlenül a levelező alkalmazásban</span>', "            E-mail\n            <span style={styles.platformHint}>{t('Közvetlenül a levelező alkalmazásban')}</span>", 'invite email option')
text = rep(text, '<div style={styles.stepLabel}>2. Meghívó nyelve</div>', "<div style={styles.stepLabel}>{t('2. Meghívó nyelve')}</div>", 'invite step2')
text = rep(text, '          Nyelv\n          <select', "          {t('Nyelv')}\n          <select", 'invite lang label')
text = rep(text, 'aria-label="Meghívó nyelve"', "aria-label={t('Meghívó nyelve')}", 'invite lang aria')
text = rep(text, '<option value="inherit">Könyv nyelve ({languageLabel(bookLanguage)})</option>', "<option value=\"inherit\">{f('Könyv nyelve ({language})', { language: languageLabel(bookLanguage) })}</option>", 'invite inherit option')
text = rep(text, '<div style={styles.stepLabel}>3. Személyre szabás</div>', "<div style={styles.stepLabel}>{t('3. Személyre szabás')}</div>", 'invite step3')
text = rep(text, "Címzett neve {platform === 'share' ? '(kötelező)' : '(opcionális)'}", "{t('Címzett neve')} {platform === 'share' ? t('(kötelező)') : t('(opcionális)')}", 'invite recipient label')
text = rep(text, 'placeholder="pl. Rubinszky Gertrúd"', "placeholder={t('pl. Rubinszky Gertrúd')}", 'invite recipient placeholder')
text = rep(text, '            E-mail cím (kötelező)\n            <input', "            {t('E-mail cím (kötelező)')}\n            <input", 'invite email label')
text = rep(text, '          Meghívó üzenet\n          <textarea', "          {t('Meghívó üzenet')}\n          <textarea", 'invite message label')
text = rep(text, 'A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.', "{t('A címzett az aktív 14 napos időablak alatt ehhez az oldalhoz rögzült. Lejárat után az oldal új címzettnek adható.')}", 'invite identity note')
text = rep(text, 'A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.', "{t('A „Nekem is kell emlékkönyv” rész a meghívóban marad, így a címzett saját MemoryBookot is indíthat.')}", 'invite cta note')
text = rep(text, '>Mégse</button>', ">{t('Mégse')}</button>", 'invite cancel')
text = rep(text, "{platform === 'email' ? 'E-mail megnyitása' : 'Címzett és app kiválasztása'}", "{platform === 'email' ? t('E-mail megnyitása') : t('Címzett és app kiválasztása')}", 'invite primary')
write(p, text)

print('OWNER_UI_I18N_PATCH_APPLIED')
