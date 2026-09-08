from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Marker not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# src/i18n.ts
p = Path('src/i18n.ts')
text = p.read_text(encoding='utf-8')
text = text.replace("export type AppLanguage = 'hu' | 'en';", "export type AppLanguage = 'hu' | 'en' | 'de';")
text = text.replace(
    "  { code: 'en', label: 'English' },\n];",
    "  { code: 'en', label: 'English' },\n  { code: 'de', label: 'Deutsch' },\n];",
)
text = text.replace(
    "  return normalized === 'hu' || normalized === 'en' ? normalized : null;",
    "  return normalized === 'hu' || normalized === 'en' || normalized === 'de'\n    ? normalized\n    : null;",
)
p.write_text(text, encoding='utf-8')

# src/LanguageSwitcher.tsx
replace_once(
    'src/LanguageSwitcher.tsx',
    "      aria-label={language === 'hu' ? 'Alkalmazás nyelve' : 'Application language'}",
    "      aria-label={\n        language === 'hu'\n          ? 'Alkalmazás nyelve'\n          : language === 'de'\n            ? 'Anwendungssprache'\n            : 'Application language'\n      }",
)

# src/PageInviteEditorPage.tsx
replace_once(
    'src/PageInviteEditorPage.tsx',
    "import { detectBrowserAppLanguage, type AppLanguage } from './i18n';",
    "import { detectBrowserAppLanguage, normalizeAppLanguage, type AppLanguage } from './i18n';",
)
replace_once(
    'src/PageInviteEditorPage.tsx',
    "  const language: AppLanguage =\n    page?.language === 'en' ? 'en' : page?.language === 'hu' ? 'hu' : fallbackLanguage;",
    "  const language: AppLanguage = normalizeAppLanguage(page?.language) ?? fallbackLanguage;",
)
replace_once(
    'src/PageInviteEditorPage.tsx',
    "          language: data?.language === 'hu' ? 'hu' : 'en',",
    "          language: normalizeAppLanguage(data?.language) ?? fallbackLanguage,",
)

# src/inviteEditorI18n.ts
p = Path('src/inviteEditorI18n.ts')
text = p.read_text(encoding='utf-8')
marker = "\n  },\n} as const;\n"
idx = text.rfind(marker)
if idx < 0:
    raise SystemExit('inviteEditorI18n closing marker not found')
de_section = """
  },
  de: {
    page: {
      loading: 'Einladung wird geladen...',
      alreadySubmitted: 'Diese Seite wurde bereits eingereicht und kann nicht mehr bearbeitet werden.',
      unavailable: 'Diese Einladung ist nicht verfügbar.',
      notFound: 'Einladung nicht gefunden.',
      confirmSubmit: 'Nach dem Einreichen kannst du diese Seite nicht mehr bearbeiten. Möchtest du sie wirklich einreichen?',
      conflict: 'Diese Seite wurde zwischenzeitlich geändert. Lade die Seite neu und versuche es erneut.',
      submitFailed: 'Das Einreichen ist fehlgeschlagen. Deine Bearbeitung wurde noch nicht geschlossen.',
      success: 'Deine Seite wurde eingereicht. Vielen Dank!',
      submittedLocked: 'Die eingereichte Seite kann über diese Einladung nicht mehr bearbeitet werden.',
      shareApproved: 'Du hast der öffentlichen Freigabe zugestimmt. Die Seite wird nur öffentlich, wenn auch der Eigentümer des Buches zustimmt.',
      shareDenied: 'Du hast der öffentlichen Freigabe nicht zugestimmt.',
      pageLabel: (pageNumber: number) => `Deine Seite: Seite ${pageNumber}`,
      instructions: 'Mit dieser Einladung kannst du nur diese eine Seite bearbeiten. Deine Änderungen werden automatisch gespeichert.',
      shareConsentAria: 'Öffentliche Freigabe erlauben',
      shareConsent: 'Ich stimme zu, dass diese Seite öffentlich geteilt werden darf. Für die öffentliche Freigabe ist zusätzlich die Zustimmung des Buch-Eigentümers erforderlich.',
      submitting: 'Wird eingereicht...',
      submit: 'Seite einreichen',
      submitWarning: 'Nach dem Einreichen wird diese Seite für dich endgültig gesperrt.',
    },
    editor: {
      textPlaceholder: 'Schreibe hier deine Gedanken...',
      addText: '+ Text',
      addPhoto: '+ Foto',
      startDrawing: 'Freihand zeichnen',
      stopDrawing: 'Zeichnen beenden',
      eraser: 'Radierer',
      stopEraser: 'Radierer beenden',
      brushColor: 'Pinselfarbe',
      brushWidth: 'Pinselbreite',
      bringForward: '↑ Nach vorne',
      sendBackward: '↓ Nach hinten',
      delete: 'Löschen',
      undo: 'Rückgängig',
      redo: 'Wiederholen',
      saved: '✓ Gespeichert',
      saving: 'Speichern...',
      conflict: '⚠ Konflikt',
      unsaved: 'Nicht gespeichert',
      saveNow: 'Jetzt speichern',
    },
  },
} as const;
"""
text = text[:idx] + "\n" + de_section.lstrip('\n') + text[idx + len(marker):]
p.write_text(text, encoding='utf-8')

# src/InviteSendDialog.tsx
replace_once(
    'src/InviteSendDialog.tsx',
    "function languageLabel(language: AppLanguage) {\n  return language === 'en' ? 'English' : 'Magyar';\n}",
    "function languageLabel(language: AppLanguage) {\n  if (language === 'de') return 'Deutsch';\n  return language === 'en' ? 'English' : 'Magyar';\n}",
)
replace_once(
    'src/InviteSendDialog.tsx',
    "function buildGreeting(language: AppLanguage, recipientName: string) {\n  const name = recipientName.trim();\n  if (language === 'en') return name ? `Hi, ${name}!` : 'Hi!';\n  return name ? `Szia, ${name}!` : 'Szia!';\n}",
    "function buildGreeting(language: AppLanguage, recipientName: string) {\n  const name = recipientName.trim();\n  if (language === 'de') return name ? `Hallo, ${name}!` : 'Hallo!';\n  if (language === 'en') return name ? `Hi, ${name}!` : 'Hi!';\n  return name ? `Szia, ${name}!` : 'Szia!';\n}\n\nfunction buildInviteTitle(language: AppLanguage, bookTitle: string) {\n  if (language === 'de') return `MemoryBook-Einladung – ${bookTitle}`;\n  if (language === 'en') return `MemoryBook invitation – ${bookTitle}`;\n  return `MemoryBook meghívás – ${bookTitle}`;\n}",
)
replace_once(
    'src/InviteSendDialog.tsx',
    "  if (language === 'en') {\n    return [",
    "  if (language === 'de') {\n    return [\n      buildGreeting(language, recipientName),\n      '',\n      `Ich habe ein MemoryBook mit dem Titel „${bookTitle}“ erstellt. Ich würde mich freuen, wenn du eine eigene Seite dafür gestaltest.`,\n      '',\n      'Deine Seite findest du hier:',\n      pageUrl,\n      '',\n      'Dieser Link gehört nur zu deiner Seite. Wenn du fertig bist, reiche sie unten auf der Seite ein.',\n      'Die Einladung ist 14 Tage gültig.',\n      '',\n      `👉 Eigenes MemoryBook erstellen: ${ctaUrl}`,\n    ].join('\\n');\n  }\n\n  if (language === 'en') {\n    return [",
)
p = Path('src/InviteSendDialog.tsx')
text = p.read_text(encoding='utf-8')
old_subject = """        const subject =
          effectiveInviteLanguage === 'en'
            ? `MemoryBook invitation – ${bookTitle}`
            : `MemoryBook meghívás – ${bookTitle}`;"""
if old_subject not in text:
    raise SystemExit('Invite email subject marker missing')
text = text.replace(old_subject, "        const subject = buildInviteTitle(effectiveInviteLanguage, bookTitle);", 1)
old_share = """        title:
          effectiveInviteLanguage === 'en'
            ? `MemoryBook invitation – ${bookTitle}`
            : `MemoryBook meghívás – ${bookTitle}`,"""
if old_share not in text:
    raise SystemExit('Invite share title marker missing')
text = text.replace(old_share, "        title: buildInviteTitle(effectiveInviteLanguage, bookTitle),", 1)
if '<option value="de">Deutsch</option>' not in text:
    text = text.replace(
        '            <option value="en">English</option>\n',
        '            <option value="en">English</option>\n            <option value="de">Deutsch</option>\n',
        1,
    )
p.write_text(text, encoding='utf-8')

# src/OwnerBookPage.tsx
replace_once(
    'src/OwnerBookPage.tsx',
    "import { SUPPORTED_APP_LANGUAGES, type AppLanguage } from './i18n';",
    "import { normalizeAppLanguage, SUPPORTED_APP_LANGUAGES, type AppLanguage } from './i18n';",
)
replace_once(
    'src/OwnerBookPage.tsx',
    "        setBookLanguage(data.book?.language === 'en' ? 'en' : 'hu');",
    "        setBookLanguage(normalizeAppLanguage(data.book?.language) ?? 'hu');",
)
replace_once(
    'src/OwnerBookPage.tsx',
    "      inviteLanguage:\n        data.inviteLanguage === 'en'\n          ? 'en'\n          : data.inviteLanguage === 'hu'\n            ? 'hu'\n            : null,",
    "      inviteLanguage: normalizeAppLanguage(data.inviteLanguage),",
)
replace_once(
    'src/OwnerBookPage.tsx',
    "      setBookLanguage(data.book.language === 'en' ? 'en' : 'hu');",
    "      setBookLanguage(normalizeAppLanguage(data.book.language) ?? 'hu');",
)

# server/index.ts
p = Path('server/index.ts')
text = p.read_text(encoding='utf-8')
old = """    requestedLanguage !== 'hu' &&
    requestedLanguage !== 'en'"""
new = """    requestedLanguage !== 'hu' &&
    requestedLanguage !== 'en' &&
    requestedLanguage !== 'de'"""
if old not in text:
    raise SystemExit('requestedLanguage validation marker missing')
text = text.replace(old, new)
old = "const language = requestedLanguage === 'en' ? 'en' : 'hu';"
if old not in text:
    raise SystemExit('requestedLanguage normalization marker missing')
text = text.replace(old, "const language = requestedLanguage === 'de' ? 'de' : requestedLanguage === 'en' ? 'en' : 'hu';")
old = "if (language !== 'hu' && language !== 'en') {"
if old not in text:
    raise SystemExit('book language PATCH validation marker missing')
text = text.replace(old, "if (language !== 'hu' && language !== 'en' && language !== 'de') {")
old = "rawInviteLanguage === 'hu' || rawInviteLanguage === 'en'"
if old not in text:
    raise SystemExit('invite language validation marker missing')
text = text.replace(old, "rawInviteLanguage === 'hu' || rawInviteLanguage === 'en' || rawInviteLanguage === 'de'")
text = text.replace("language NOT IN ('hu', 'en')", "language NOT IN ('hu', 'en', 'de')")
text = text.replace("invite_language NOT IN ('hu', 'en')", "invite_language NOT IN ('hu', 'en', 'de')")
p.write_text(text, encoding='utf-8')

print('GERMAN_LANGUAGE_PATCH_APPLIED')
