from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Marker not found: {label}")
    return text.replace(old, new, 1)


# ---------------- Frontend ----------------
p = Path("src/PurchasePage.tsx")
text = p.read_text(encoding="utf-8")

text = replace_once(
    text,
    "  billingTaxNumber?: string | null;\n};",
    "  billingTaxNumber?: string | null;\n  billingCompanyName?: string | null;\n};",
    "BillingProfile company name",
)

text = replace_once(
    text,
    "  const [billingTaxNumber, setBillingTaxNumber] = useState('');",
    "  const [billingTaxNumber, setBillingTaxNumber] = useState('');\n  const [billingCompanyName, setBillingCompanyName] = useState('');",
    "company state",
)

text = replace_once(
    text,
    "        setBillingTaxNumber(profile.billingTaxNumber || '');",
    "        setBillingTaxNumber(profile.billingTaxNumber || '');\n        setBillingCompanyName(profile.billingCompanyName || '');",
    "company profile load",
)

text = replace_once(
    text,
    """    if (mode !== 'gift' && !user) {
      const returnTo = `/purchase?mode=${mode}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }""",
    """    if (!user) {
      const returnTo = `/purchase?mode=${mode}`;
      window.location.href = `/login?returnTo=${encodeURIComponent(returnTo)}`;
      return;
    }""",
    "all modes require account",
)

text = replace_once(
    text,
    "          purchaserName: mode === 'gift' ? billingName : purchaserName,\n          purchaserEmail: mode === 'gift' ? billingEmail : purchaserEmail,",
    "          purchaserName,\n          purchaserEmail,",
    "buyer identity from account",
)

text = replace_once(
    text,
    "          billingTaxNumber,",
    "          billingTaxNumber,\n          billingCompanyName,",
    "submit company name",
)

text = replace_once(
    text,
    """        {mode !== 'gift' && !user && (
          <div style={styles.notice}>
            {t('A vásárláshoz előbb be kell lépned vagy regisztrálnod.')}
            <a href={`/login?returnTo=${encodeURIComponent(`/purchase?mode=${mode}`)}`} style={styles.inlineLink}> {t('Belépés / regisztráció')}</a>
          </div>
        )}""",
    """        {!user && (
          <div style={styles.notice}>
            {t('A vásárláshoz jelentkezz be Google-fiókkal.')}
            <a href={`/login?returnTo=${encodeURIComponent(`/purchase?mode=${mode}`)}`} style={styles.inlineLink}> {t('Belépés Google-fiókkal')}</a>
          </div>
        )}

        {user && (
          <div style={styles.accountInfo}>
            <strong>{t(mode === 'organization' ? 'Kapcsolattartó' : 'Vásárló')}</strong>
            <span>{user.name || purchaserName}</span>
            <span>{user.email || purchaserEmail}</span>
          </div>
        )}""",
    "account info block",
)

old_billing = """          <div style={styles.sectionTitle}>{t('Számlázási adatok')}</div>
          <label style={styles.label}>{t('Ország')}
            <input value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input} />
          </label>
          <div style={styles.twoCols}>
            <label style={styles.label}>{t('Irányítószám')}
              <input
                value={billingPostalCode}
                inputMode={billingCountry.trim().toLocaleLowerCase('hu-HU') === 'magyarország' ? 'numeric' : undefined}
                onChange={(event) => setBillingPostalCode(event.target.value)}
                style={styles.input}
              />
            </label>
            <label style={styles.label}>{t('Település')}
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} />
            </label>
          </div>
          <label style={styles.label}>{t('Cím')}
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('Adószám (ha szükséges)')}
            <input value={billingTaxNumber} onChange={(event) => setBillingTaxNumber(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('Név')}
            <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>{t('E-mail')}
            <input type=\"email\" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} />
          </label>"""

new_billing = """          <div style={styles.sectionTitle}>{t('Számlázási adatok')}</div>
          <label style={styles.label}>{t('Ország')}
            <input
              value={billingCountry}
              onChange={(event) => setBillingCountry(event.target.value)}
              placeholder={t('pl. Magyarország, DE, US')}
              style={styles.input}
            />
          </label>

          {mode === 'organization' && (
            <>
              <label style={styles.label}>{t(companyTaxLabel(billingCountry))}
                <input
                  value={billingTaxNumber}
                  onChange={(event) => setBillingTaxNumber(event.target.value.toUpperCase())}
                  placeholder={companyTaxPlaceholder(billingCountry)}
                  pattern={isHungarianCountry(billingCountry) ? '[0-9]{8}-[0-9]-[0-9]{2}' : undefined}
                  title={isHungarianCountry(billingCountry) ? t('A magyar adószám formátuma: 12345678-2-42.') : undefined}
                  style={styles.input}
                  required
                />
              </label>
              <label style={styles.label}>{t('Cégnév')}
                <input value={billingCompanyName} onChange={(event) => setBillingCompanyName(event.target.value)} style={styles.input} required />
              </label>
            </>
          )}

          <div style={styles.twoCols}>
            <label style={styles.label}>{t('Irányítószám')}
              <input
                value={billingPostalCode}
                inputMode={isHungarianCountry(billingCountry) ? 'numeric' : undefined}
                onChange={(event) => setBillingPostalCode(event.target.value)}
                style={styles.input}
                required
              />
            </label>
            <label style={styles.label}>{t('Település')}
              <input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} style={styles.input} required />
            </label>
          </div>
          <label style={styles.label}>{t('Cím')}
            <input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} style={styles.input} required />
          </label>

          {mode !== 'organization' && (
            <>
              <label style={styles.label}>{t('Számlázási név')}
                <input value={billingName} onChange={(event) => setBillingName(event.target.value)} style={styles.input} required />
              </label>
              <label style={styles.label}>{t('Számlázási e-mail')}
                <input type=\"email\" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} style={styles.input} required />
              </label>
            </>
          )}"""
text = replace_once(text, old_billing, new_billing, "mode-specific billing fields")

text = replace_once(
    text,
    "          <button type=\"submit\" disabled={loading || (mode !== 'gift' && !user)} style={styles.primaryButton}>",
    "          <button type=\"submit\" disabled={loading || !user} style={styles.primaryButton}>",
    "submit disabled for all anonymous",
)

text = replace_once(
    text,
    "  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },",
    "  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },\n  accountInfo: { display: 'flex', flexWrap: 'wrap', gap: '2px 8px', marginBottom: 6, padding: '6px 8px', borderRadius: 8, background: '#f8fafc', color: '#475569', fontSize: 12, overflowWrap: 'anywhere' },",
    "account info style",
)

# Add country/tax helpers before the component.
helper_marker = "export function PurchasePage() {"
helpers = """const EU_COUNTRY_ALIASES = new Set([
  'AT','AUSTRIA','AUSZTRIA','ÖSTERREICH','BE','BELGIUM','BELGIEN','BELGIQUE','BELGIUM','BG','BULGARIA','BULGÁRIA','CY','CYPRUS','CIPRUS','CZ','CZECHIA','CZECH REPUBLIC','CSEHORSZÁG','TSCHECHIEN','DE','GERMANY','NÉMETORSZÁG','DEUTSCHLAND','DK','DENMARK','DÁNIA','DÄNEMARK','EE','ESTONIA','ÉSZTORSZÁG','ESTLAND','EL','GR','GREECE','GÖRÖGORSZÁG','GRIECHENLAND','ES','SPAIN','SPANYOLORSZÁG','SPANIEN','FI','FINLAND','FINNORSZÁG','FR','FRANCE','FRANCIAORSZÁG','FRANKREICH','HR','CROATIA','HORVÁTORSZÁG','KROATIEN','HU','HUNGARY','MAGYARORSZÁG','UNGARN','IE','IRELAND','ÍRORSZÁG','IRLAND','IT','ITALY','OLASZORSZÁG','ITALIEN','LT','LITHUANIA','LITVÁNIA','LITAUEN','LU','LUXEMBOURG','LUXEMBURG','LV','LATVIA','LETTORSZÁG','LETTLAND','MT','MALTA','NL','NETHERLANDS','HOLLANDIA','NIEDERLANDE','PL','POLAND','LENGYELORSZÁG','POLEN','PT','PORTUGAL','PORTUGÁLIA','RO','ROMANIA','ROMÁNIA','RUMÄNIEN','SE','SWEDEN','SVÉDORSZÁG','SCHWEDEN','SI','SLOVENIA','SZLOVÉNIA','SLOWENIEN','SK','SLOVAKIA','SZLOVÁKIA','SLOWAKEI'
]);

function normalizedCountry(value: string): string {
  return value.trim().toLocaleUpperCase('hu-HU');
}

function isHungarianCountry(value: string): boolean {
  return ['HU', 'HUNGARY', 'MAGYARORSZÁG', 'UNGARN'].includes(normalizedCountry(value));
}

function isEuCountry(value: string): boolean {
  return EU_COUNTRY_ALIASES.has(normalizedCountry(value));
}

function companyTaxLabel(country: string): string {
  if (isHungarianCountry(country)) return 'Adószám';
  if (isEuCountry(country)) return 'Közösségi adószám / VAT ID';
  return 'Adóazonosító / Tax ID';
}

function companyTaxPlaceholder(country: string): string {
  if (isHungarianCountry(country)) return '12345678-2-42';
  if (isEuCountry(country)) return 'DE123456789';
  return '';
}

"""
text = replace_once(text, helper_marker, helpers + helper_marker, "country tax helpers")

p.write_text(text, encoding="utf-8")


# ---------------- Translations ----------------
p = Path("src/publicUiI18n.ts")
text = p.read_text(encoding="utf-8")
insert_after = "  'Cég / szervezet': { en: 'Company / organization', de: 'Firma / Organisation' },"
translations = """
  'A vásárláshoz jelentkezz be Google-fiókkal.': { en: 'Sign in with your Google account to purchase.', de: 'Melde dich zum Kauf mit deinem Google-Konto an.' },
  'Belépés Google-fiókkal': { en: 'Sign in with Google', de: 'Mit Google anmelden' },
  'Vásárló': { en: 'Buyer', de: 'Käufer' },
  'Kapcsolattartó': { en: 'Contact person', de: 'Kontaktperson' },
  'Cégnév': { en: 'Company name', de: 'Firmenname' },
  'Adószám': { en: 'Tax number', de: 'Steuernummer' },
  'Közösségi adószám / VAT ID': { en: 'EU VAT ID', de: 'USt-IdNr.' },
  'Adóazonosító / Tax ID': { en: 'Tax ID', de: 'Steuer-ID' },
  'Számlázási név': { en: 'Billing name', de: 'Rechnungsname' },
  'Számlázási e-mail': { en: 'Billing email', de: 'Rechnungs-E-Mail' },
  'pl. Magyarország, DE, US': { en: 'e.g. Hungary, DE, US', de: 'z. B. Ungarn, DE, US' },
  'A magyar adószám formátuma: 12345678-2-42.': { en: 'Hungarian tax number format: 12345678-2-42.', de: 'Format der ungarischen Steuernummer: 12345678-2-42.' },"""
text = replace_once(text, insert_after, insert_after + translations, "purchase translations")
p.write_text(text, encoding="utf-8")


# ---------------- Backend ----------------
p = Path("server/index.ts")
text = p.read_text(encoding="utf-8")

text = replace_once(
    text,
    "  if (purchase.purchaseMode === 'gift') return;\n\n  const session = await getSession(req).catch(() => null);",
    "  const session = await getSession(req).catch(() => null);",
    "payment access for gift buyer",
)

text = replace_once(
    text,
    "         billing_tax_number AS \"billingTaxNumber\",\n         updated_at AS \"updatedAt\"",
    "         billing_tax_number AS \"billingTaxNumber\",\n         billing_company_name AS \"billingCompanyName\",\n         updated_at AS \"updatedAt\"",
    "billing profile company select",
)

old_identity = """  const session = await getSession(req).catch(() => null);
  if (purchaseMode !== 'gift' && !session) {
    res.status(401).json({ error: 'ACCOUNT_REQUIRED_FOR_SELF_PURCHASE' });
    return;
  }

  const purchaserName =
    purchaseMode !== 'gift'
      ? String(session?.user?.name || req.body?.purchaserName || '').trim()
      : String(req.body?.purchaserName || '').trim();
  const purchaserEmail =
    purchaseMode !== 'gift'
      ? String(session?.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase()
      : String(req.body?.purchaserEmail || '').trim().toLowerCase();
  const billingName = String(req.body?.billingName || '').trim();"""
new_identity = """  const session = await getSession(req).catch(() => null);
  if (!session) {
    res.status(401).json({ error: 'ACCOUNT_REQUIRED_FOR_PURCHASE' });
    return;
  }

  const purchaserName = String(session.user?.name || req.body?.purchaserName || '').trim();
  const purchaserEmail = String(session.user?.email || req.body?.purchaserEmail || '').trim().toLowerCase();
  const billingName = String(req.body?.billingName || session.user?.name || '').trim();"""
text = replace_once(text, old_identity, new_identity, "purchase account identity")

text = replace_once(
    text,
    "  const billingTaxNumber = String(req.body?.billingTaxNumber || '').trim();",
    "  const billingTaxNumber = String(req.body?.billingTaxNumber || '').trim().toUpperCase();\n  const billingCompanyName = String(req.body?.billingCompanyName || '').trim();\n  const purchaseBillingName = purchaseMode === 'organization' ? billingCompanyName : billingName;",
    "company name parse",
)

old_required = """  const requiredValues = [
    purchaserName,
    purchaserEmail,
    billingName,
    billingEmail,
    billingCountry,
    billingPostalCode,
    billingCity,
    billingAddress,
  ];
  if (requiredValues.some((value) => !value)) {
    res.status(400).json({ error: 'INCOMPLETE_PURCHASE_IDENTITY' });
    return;
  }"""
new_required = """  const requiredValues = [
    purchaserName,
    purchaserEmail,
    billingEmail,
    billingCountry,
    billingPostalCode,
    billingCity,
    billingAddress,
    purchaseMode === 'organization' ? billingCompanyName : billingName,
    purchaseMode === 'organization' ? billingTaxNumber : 'not-required',
  ];
  if (requiredValues.some((value) => !value)) {
    res.status(400).json({ error: 'INCOMPLETE_PURCHASE_IDENTITY' });
    return;
  }
  const normalizedBillingCountry = billingCountry.trim().toLocaleLowerCase('hu-HU');
  const isHungarianBilling = ['hu', 'hungary', 'magyarország', 'ungarn'].includes(normalizedBillingCountry);
  if (purchaseMode === 'organization' && isHungarianBilling && !/^\\d{8}-\\d-\\d{2}$/.test(billingTaxNumber)) {
    res.status(400).json({ error: 'INVALID_HUNGARIAN_TAX_NUMBER' });
    return;
  }"""
text = replace_once(text, old_required, new_required, "mode-specific validation")

# Billing profile upsert: add company column and value.
text = replace_once(
    text,
    "           billing_tax_number,\n           updated_at\n         )\n         VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), CURRENT_TIMESTAMP)",
    "           billing_tax_number,\n           billing_company_name,\n           updated_at\n         )\n         VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), CURRENT_TIMESTAMP)",
    "profile insert company",
)
text = replace_once(
    text,
    "           billing_tax_number = EXCLUDED.billing_tax_number,\n           updated_at = CURRENT_TIMESTAMP`,",
    "           billing_tax_number = EXCLUDED.billing_tax_number,\n           billing_company_name = EXCLUDED.billing_company_name,\n           updated_at = CURRENT_TIMESTAMP`,",
    "profile update company",
)
text = replace_once(
    text,
    "          billingAddress,\n          billingTaxNumber,\n        ]",
    "          billingAddress,\n          billingTaxNumber,\n          billingCompanyName,\n        ]",
    "profile company param",
)

# Purchase insert: add explicit company field; billing_name remains invoice name.
text = replace_once(
    text,
    "         billing_tax_number,\n         payment_provider,",
    "         billing_tax_number,\n         billing_company_name,\n         payment_provider,",
    "purchase company column",
)
text = replace_once(
    text,
    "       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), $15, 'draft')",
    "       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), NULLIF($15, ''), $16, 'draft')",
    "purchase company values",
)
text = replace_once(
    text,
    "        billingName,\n        billingEmail,",
    "        purchaseBillingName,\n        billingEmail,",
    "invoice company billing name",
)
text = replace_once(
    text,
    "        billingAddress,\n        billingTaxNumber,\n        paymentProvider,",
    "        billingAddress,\n        billingTaxNumber,\n        billingCompanyName,\n        paymentProvider,",
    "purchase company param",
)

# Permanent company billing migration + temporary test-book grant migration.
loader_marker = """  const organizationPurchaseModeMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_organization_purchase_mode.sql'),
    'utf8'
  );
  await pool.query(organizationPurchaseModeMigration);

  const invoicingMigration = await fs.readFile("""
loader_replacement = """  const organizationPurchaseModeMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_organization_purchase_mode.sql'),
    'utf8'
  );
  await pool.query(organizationPurchaseModeMigration);

  const companyBillingMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_company_billing.sql'),
    'utf8'
  );
  await pool.query(companyBillingMigration);

  const testBookGrantMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_grant_test_book_rauch.sql'),
    'utf8'
  );
  await pool.query(testBookGrantMigration);

  const invoicingMigration = await fs.readFile("""
text = replace_once(text, loader_marker, loader_replacement, "migration loaders")
p.write_text(text, encoding="utf-8")

Path("server/migrations/20260909_company_billing.sql").write_text(
    """ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS billing_company_name TEXT;

ALTER TABLE billing_profiles
  ADD COLUMN IF NOT EXISTS billing_company_name TEXT;
""",
    encoding="utf-8",
)

Path("server/migrations/20260909_grant_test_book_rauch.sql").write_text(
    """DO $$
DECLARE
  target_user_id TEXT;
BEGIN
  SELECT id INTO target_user_id
  FROM users
  WHERE lower(email) = lower('rauchlaszlo@gmail.com')
  LIMIT 1;

  IF target_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM books WHERE id = 'test-book-rauchlaszlo-20260909') THEN
    INSERT INTO books (
      id, owner_user_id, title, invite_token, book_type, page_capacity, language
    ) VALUES (
      'test-book-rauchlaszlo-20260909',
      target_user_id,
      'TESZT – Saját emlékkönyv',
      NULL,
      'standard',
      30,
      'hu'
    );

    INSERT INTO pages (id, book_id, page_number)
    SELECT
      'test-book-rauchlaszlo-20260909-page-' || page_number,
      'test-book-rauchlaszlo-20260909',
      page_number
    FROM generate_series(1, 30) AS page_number;
  END IF;
END $$;
""",
    encoding="utf-8",
)
