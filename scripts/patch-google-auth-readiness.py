from pathlib import Path

server = Path('server/index.ts')
s = server.read_text(encoding='utf-8')
anchor = "app.get('/api/me', async (req, res) => {"
if "app.get('/api/auth-capabilities'" not in s:
    block = """app.get('/api/auth-capabilities', (_req, res) => {\n  res.status(200).json({\n    google: Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET),\n  });\n});\n\n"""
    if anchor not in s:
        raise SystemExit('server anchor not found')
    s = s.replace(anchor, block + anchor, 1)
    server.write_text(s, encoding='utf-8')

page = Path('src/AuthPage.tsx')
p = page.read_text(encoding='utf-8')
p = p.replace("import { useState } from 'react';", "import { useEffect, useState } from 'react';", 1)
if "const [googleReady" not in p:
    marker = "  const [loading, setLoading] = useState(false);\n"
    replacement = marker + "  const [googleReady, setGoogleReady] = useState<boolean | null>(null);\n"
    if marker not in p:
        raise SystemExit('state marker not found')
    p = p.replace(marker, replacement, 1)

if "fetch(`${API_BASE}/api/auth-capabilities`" not in p:
    marker = "  const [error, setError] = useState<string | null>(\n    oauthError === 'google' ? 'A Google-belépés nem sikerült. Próbáld újra.' : null\n  );\n\n"
    block = marker + "  useEffect(() => {\n    fetch(`${API_BASE}/api/auth-capabilities`)\n      .then((response) => (response.ok ? response.json() : Promise.reject()))\n      .then((data) => setGoogleReady(Boolean(data?.google)))\n      .catch(() => setGoogleReady(false));\n  }, []);\n\n"
    if marker not in p:
        raise SystemExit('error state marker not found')
    p = p.replace(marker, block, 1)

p = p.replace("  const signInWithGoogle = async () => {\n    setError(null);\n    setLoading(true);", "  const signInWithGoogle = async () => {\n    setError(null);\n    if (!googleReady) {\n      setError('A Google-belépés technikailag elő van készítve, de az OAuth kliens még nincs aktiválva.');\n      return;\n    }\n    setLoading(true);", 1)

p = p.replace("          disabled={loading}\n          aria-label=\"Folytatás Google-fiókkal\"", "          disabled={loading || googleReady !== true}\n          aria-label=\"Folytatás Google-fiókkal\"", 1)
p = p.replace("          {loading ? 'Kapcsolódás...' : 'Folytatás Google-fiókkal'}", "          {loading\n            ? 'Kapcsolódás...'\n            : googleReady === false\n              ? 'Google-belépés beállítás alatt'\n              : googleReady === null\n                ? 'Google-belépés ellenőrzése...'\n                : 'Folytatás Google-fiókkal'}", 1)

if "googleReady === false &&" not in p:
    marker = "        </button>\n\n        {error && <div style={styles.error}>{error}</div>}"
    replacement = "        </button>\n\n        {googleReady === false && (\n          <div style={styles.setupNotice}>\n            A Google OAuth kliens létrehozása után ez a gomb automatikusan aktiválódik.\n          </div>\n        )}\n\n        {error && <div style={styles.error}>{error}</div>}"
    if marker not in p:
        raise SystemExit('button marker not found')
    p = p.replace(marker, replacement, 1)

if "  setupNotice:" not in p:
    marker = "  error: {\n"
    style = "  setupNotice: {\n    marginTop: 12,\n    padding: 10,\n    borderRadius: 8,\n    background: '#f8fafc',\n    color: '#64748b',\n    fontSize: 13,\n    lineHeight: 1.45,\n  },\n"
    if marker not in p:
        raise SystemExit('style marker not found')
    p = p.replace(marker, style + marker, 1)

page.write_text(p, encoding='utf-8')
