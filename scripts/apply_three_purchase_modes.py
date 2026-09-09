from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Marker not found: {label}")
    return text.replace(old, new, 1)


p = Path("src/PurchasePage.tsx")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "type Mode = 'self' | 'gift';", "type Mode = 'self' | 'gift' | 'organization';", "Mode type")
text = replace_once(
    text,
    "  const [mode, setMode] = useState<Mode>(initialQuery.get('mode') === 'gift' ? 'gift' : 'self');",
    """  const [mode, setMode] = useState<Mode>(
    initialQuery.get('mode') === 'gift'
      ? 'gift'
      : initialQuery.get('mode') === 'organization'
        ? 'organization'
        : 'self'
  );""",
    "initial mode",
)
text = replace_once(
    text,
    """    if (mode === 'self' && !user) {
      window.location.href = `/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`;
      return;
    }""",
    """    if (mode !== 'gift' && !user) {
      const returnTo = `/purchase?mode=${mode}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }""",
    "submit auth",
)
text = replace_once(
    text,
    """        <div style={styles.switcher}>
          <button type=\"button\" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>{t('Magamnak')}</button>
          <button type=\"button\" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>{t('Ajándékba')}</button>
        </div>""",
    """        <div style={styles.switcher}>
          <button type=\"button\" onClick={() => setMode('self')} style={{ ...styles.switchButton, ...(mode === 'self' ? styles.active : {}) }}>{t('Magamnak')}</button>
          <button type=\"button\" onClick={() => setMode('gift')} style={{ ...styles.switchButton, ...(mode === 'gift' ? styles.active : {}) }}>{t('Ajándékba')}</button>
          <button type=\"button\" onClick={() => setMode('organization')} style={{ ...styles.switchButton, ...(mode === 'organization' ? styles.active : {}) }}>{t('Cég / szervezet')}</button>
        </div>""",
    "three mode switcher",
)
text = replace_once(
    text,
    """        {mode === 'self' && !user && (
          <div style={styles.notice}>
            {t('Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.')}
            <a href={`/login?returnTo=${encodeURIComponent('/purchase?mode=self')}`} style={styles.inlineLink}> {t('Belépés / regisztráció')}</a>
          </div>
        )}""",
    """        {mode !== 'gift' && !user && (
          <div style={styles.notice}>
            {t('A vásárláshoz előbb be kell lépned vagy regisztrálnod.')}
            <a href={`/login?returnTo=${encodeURIComponent(`/purchase?mode=${mode}`)}`} style={styles.inlineLink}> {t('Belépés / regisztráció')}</a>
          </div>
        )}""",
    "auth notice",
)
text = replace_once(text, "          <button type=\"submit\" disabled={loading || (mode === 'self' && !user)} style={styles.primaryButton}>", "          <button type=\"submit\" disabled={loading || (mode !== 'gift' && !user)} style={styles.primaryButton}>", "submit disabled")
text = replace_once(text, "  switcher: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8, padding: 2, background: '#e2e8f0', borderRadius: 9 },", "  switcher: { display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 4, marginBottom: 8, padding: 2, background: '#e2e8f0', borderRadius: 9 },", "switcher style")
text = replace_once(text, "  switchButton: { minHeight: 38, border: 0, borderRadius: 7, background: 'transparent', fontWeight: 800, color: '#475569' },", "  switchButton: { minHeight: 38, padding: '0 2px', border: 0, borderRadius: 7, background: 'transparent', fontWeight: 800, color: '#475569', fontSize: 11.5, lineHeight: 1.15, whiteSpace: 'nowrap' },", "switch button style")
p.write_text(text, encoding="utf-8")

p = Path("src/publicUiI18n.ts")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "  'Ajándékba': { en: 'As a gift', de: 'Als Geschenk' },", "  'Ajándékba': { en: 'As a gift', de: 'Als Geschenk' },\n  'Cég / szervezet': { en: 'Company / organization', de: 'Firma / Organisation' },", "organization translation")
text = replace_once(text, "  'Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.': { en: 'To buy a book for yourself, sign in or register first.', de: 'Um ein Buch für dich selbst zu kaufen, musst du dich zuerst anmelden oder registrieren.' },", "  'Saját könyv vásárlásához előbb be kell lépned vagy regisztrálnod.': { en: 'To buy a book for yourself, sign in or register first.', de: 'Um ein Buch für dich selbst zu kaufen, musst du dich zuerst anmelden oder registrieren.' },\n  'A vásárláshoz előbb be kell lépned vagy regisztrálnod.': { en: 'Sign in or register before purchasing.', de: 'Melde dich vor dem Kauf an oder registriere dich.' },", "generic auth translation")
p.write_text(text, encoding="utf-8")

p = Path("server/index.ts")
text = p.read_text(encoding="utf-8")
text = replace_once(text, "  if (purchase.purchaseMode !== 'self') return;", "  if (purchase.purchaseMode === 'gift') return;", "payment access")
text = replace_once(text, "      purchase_mode TEXT NOT NULL CHECK (purchase_mode IN ('self', 'gift')),", "      purchase_mode TEXT NOT NULL CHECK (purchase_mode IN ('self', 'gift', 'organization')),", "purchase check")
text = replace_once(text, "  const purchaseMode = req.body?.purchaseMode === 'gift' ? 'gift' : 'self';", """  const purchaseMode =
    req.body?.purchaseMode === 'gift'
      ? 'gift'
      : req.body?.purchaseMode === 'organization'
        ? 'organization'
        : 'self';""", "purchase mode parse")
text = replace_once(text, "  if (purchaseMode === 'self' && !session) {", "  if (purchaseMode !== 'gift' && !session) {", "purchase auth")
text = replace_once(text, """    purchaseMode === 'self'
      ? String(session?.user?.name || req.body?.purchaserName || '').trim()""", """    purchaseMode !== 'gift'
      ? String(session?.user?.name || req.body?.purchaserName || '').trim()""", "purchaser name")
text = replace_once(text, """    purchaseMode === 'self'
      ? String(session?.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase()""", """    purchaseMode !== 'gift'
      ? String(session?.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase()""", "purchaser email")
marker = """  const billingProfilesMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_billing_profiles.sql'),
    'utf8'
  );
  await pool.query(billingProfilesMigration);

  const invoicingMigration = await fs.readFile("""
replacement = """  const billingProfilesMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_billing_profiles.sql'),
    'utf8'
  );
  await pool.query(billingProfilesMigration);

  const organizationPurchaseModeMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_organization_purchase_mode.sql'),
    'utf8'
  );
  await pool.query(organizationPurchaseModeMigration);

  const invoicingMigration = await fs.readFile("""
text = replace_once(text, marker, replacement, "organization migration load")
p.write_text(text, encoding="utf-8")

Path("server/migrations/20260909_organization_purchase_mode.sql").write_text("""ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_purchase_mode_check;

ALTER TABLE purchases
  ADD CONSTRAINT purchases_purchase_mode_check
  CHECK (purchase_mode IN ('self', 'gift', 'organization'));
""", encoding="utf-8")
