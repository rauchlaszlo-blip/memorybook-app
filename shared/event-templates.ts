// Immutable IDs/versions are stored on each book. New copy/layout => new version.
// A common event may describe a person, couple or group and an optional date range.
export interface EventProfile {
  eventType: string;
  title: string;
  subjects: { displayName: string; kind: 'person' | 'group' }[];
  startsOn: string | null;
  endsOn: string | null;
  templateId: string;
  templateVersion: number;
}
export const weddingTemplate = {
  id: 'wedding-classic', version: 1, eventType: 'wedding',
  appearance: { background: '#faf6f1', ink: '#352b31', accent: '#785064' },
  copy: {
    hu: {
      heading: 'Esküvői vendégkönyv', intro: 'Őrizzétek meg a nektek szóló jókívánságokat.',
      names: 'Megjelenített nevek', date: 'Az esküvő dátuma', create: 'Vendégkönyv létrehozása',
      yourBooks: 'Vendégkönyveim', open: 'Megnyitás', qr: 'QR-kód a vendégeknek',
      link: 'Beküldési link', copy: 'Link másolása', copied: 'A linket kimásoltuk.',
      copyFailed: 'A másolás nem sikerült. Jelöld ki és másold a linket.',
      messages: 'Beérkezett jókívánságok', empty: 'Még nem érkezett jókívánság.', refresh: 'Frissítés',
      close: 'Beküldés lezárása', closeQuestion: 'Lezárod a beküldést? Ezután új üzenet már nem küldhető.',
      closed: 'A beküldés lezárult.', guestIntro: 'Írj egy személyes jókívánságot! Csak a könyv tulajdonosa olvashatja.',
      name: 'Neved', message: 'Jókívánságod', prompt: 'Mit kívánsz az ifjú párnak?', send: 'Beküldés',
      sending: 'Küldés…', success: 'Köszönjük! A jókívánságod megérkezett.',
      network: 'Nem kaptunk biztos választ. Az üzeneted itt megmaradt. Próbáld újra ugyanazt a beküldést.',
      retry: 'Beküldés újrapróbálása', loading: 'Betöltés…', unavailable: 'Ez a vendégkönyv most nem érhető el.',
      login: 'Bejelentkezés', loginHint: 'A saját vendégkönyveidhez jelentkezz be.',
      pilot: 'Új könyvet jelenleg a helyi próba engedélyezett résztvevői hozhatnak létre.',
      invalid: 'Ellenőrizd a mezőket és a szövegek hosszát.', limited: 'Most túl sok kérés érkezett. Várj egy percet, majd próbáld újra.',
      conflict: 'Ehhez a beküldéshez már más tartalom tartozik. A korábbi üzenetet nem módosítottuk.',
      back: 'Vissza a vendégkönyvekhez', qrFailed: 'A QR-kód nem készült el. A beküldési link továbbra is használható.',
      step: 'Név és jókívánság · egy lépésben', owner: 'Csak neked látható',
    },
    en: {
      heading: 'Wedding guestbook', intro: 'Keep the wishes written for you.', names: 'Display names', date: 'Wedding date',
      create: 'Create guestbook', yourBooks: 'My guestbooks', open: 'Open', qr: 'Guest QR code', link: 'Submission link',
      copy: 'Copy link', copied: 'Link copied.', copyFailed: 'Copy failed. Select and copy the link.',
      messages: 'Received wishes', empty: 'No wishes yet.', refresh: 'Refresh', close: 'Close submissions',
      closeQuestion: 'Close submissions? No new wishes can be sent afterwards.', closed: 'Submissions are closed.',
      guestIntro: 'Write a personal wish! Only the book owner can read it.', name: 'Your name', message: 'Your wish',
      prompt: 'What would you wish the newlyweds?', send: 'Send wish', sending: 'Sending…', success: 'Thank you! Your wish has arrived.',
      network: 'We could not confirm delivery. Your message is still here. Retry the same submission.', retry: 'Retry submission',
      loading: 'Loading…', unavailable: 'This guestbook is currently unavailable.', login: 'Sign in',
      loginHint: 'Sign in to see your guestbooks.', pilot: 'Only approved local pilot participants can create a book at present.',
      invalid: 'Check the fields and text lengths.', limited: 'Too many requests. Wait a minute and try again.',
      conflict: 'This submission key already belongs to different content. The earlier message was not changed.',
      back: 'Back to guestbooks', qrFailed: 'Could not generate the QR code. The submission link still works.',
      step: 'Name and wish · one step', owner: 'Visible only to you',
    },
    de: {
      heading: 'Hochzeitsgästebuch', intro: 'Bewahrt eure persönlichen Glückwünsche auf.', names: 'Angezeigte Namen', date: 'Hochzeitsdatum',
      create: 'Gästebuch erstellen', yourBooks: 'Meine Gästebücher', open: 'Öffnen', qr: 'QR-Code für Gäste', link: 'Link zum Eintragen',
      copy: 'Link kopieren', copied: 'Link kopiert.', copyFailed: 'Kopieren fehlgeschlagen. Markiere und kopiere den Link.',
      messages: 'Erhaltene Glückwünsche', empty: 'Noch keine Glückwünsche.', refresh: 'Aktualisieren', close: 'Einträge schließen',
      closeQuestion: 'Einträge schließen? Danach sind keine neuen Wünsche möglich.', closed: 'Einträge sind geschlossen.',
      guestIntro: 'Schreibe einen persönlichen Wunsch! Nur der Buchbesitzer kann ihn lesen.', name: 'Dein Name', message: 'Dein Wunsch',
      prompt: 'Was wünschst du dem Brautpaar?', send: 'Absenden', sending: 'Wird gesendet…', success: 'Danke! Dein Wunsch ist angekommen.',
      network: 'Der Empfang konnte nicht bestätigt werden. Deine Nachricht bleibt hier. Sende denselben Eintrag erneut.', retry: 'Erneut senden',
      loading: 'Wird geladen…', unavailable: 'Dieses Gästebuch ist derzeit nicht verfügbar.', login: 'Anmelden',
      loginHint: 'Melde dich für deine Gästebücher an.', pilot: 'Nur freigeschaltete lokale Testteilnehmer können derzeit Bücher erstellen.',
      invalid: 'Prüfe die Felder und Textlängen.', limited: 'Zu viele Anfragen. Warte eine Minute und versuche es erneut.',
      conflict: 'Dieser Eintragsschlüssel gehört bereits zu anderem Inhalt. Die frühere Nachricht wurde nicht geändert.',
      back: 'Zurück zu den Gästebüchern', qrFailed: 'Der QR-Code konnte nicht erstellt werden. Der Link funktioniert weiterhin.',
      step: 'Name und Wunsch · ein Schritt', owner: 'Nur für dich sichtbar',
    },
  },
} as const;
