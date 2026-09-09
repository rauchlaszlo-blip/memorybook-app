from pathlib import Path


def rep(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Marker not found: {label}')
    return text.replace(old, new, 1)

# --- Purchase page ---
p = Path('src/PurchasePage.tsx')
text = p.read_text(encoding='utf-8')
text = rep(text, """type PaymentSuccess = {
  purchaseId: string;
  provider: Provider;
  giftRedeemPath?: string | null;
};

const EU_COUNTRY_ALIASES = new Set([""", """type PaymentSuccess = {
  purchaseId: string;
  provider: Provider;
  giftRedeemPath?: string | null;
};

type CompanyLookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'invalid' | 'error';

const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(' ');

const EU_COUNTRY_ALIASES = new Set([""", 'country codes')
text = rep(text, """function companyTaxPlaceholder(country: string): string {
  if (isHungarianCountry(country)) return '12345678-2-42';
  if (isEuCountry(country)) return 'DE123456789';
  return '';
}

export function PurchasePage() {""", """function companyTaxPlaceholder(country: string): string {
  if (isHungarianCountry(country)) return '12345678-2-42';
  if (isEuCountry(country)) return 'DE123456789';
  return '';
}

function normalizeCountryCode(value: string): string {
  const normalized = normalizedCountry(value);
  const legacy: Record<string, string> = {
    'MAGYARORSZÁG': 'HU', HUNGARY: 'HU', UNGARN: 'HU',
    GERMANY: 'DE', 'NÉMETORSZÁG': 'DE', DEUTSCHLAND: 'DE',
    AUSTRIA: 'AT', AUSZTRIA: 'AT', 'ÖSTERREICH': 'AT',
  };
  const mapped = legacy[normalized] || normalized;
  return COUNTRY_CODES.includes(mapped) ? mapped : 'HU';
}

function countryLabel(code: string, language: string): string {
  try {
    const displayNames = new (Intl as any).DisplayNames([language], { type: 'region' });
    return String(displayNames.of(code) || code);
  } catch {
    return code;
  }
}

export function PurchasePage() {""", 'country helpers')
text = rep(text, """  const [billingTaxNumber, setBillingTaxNumber] = useState('');
  const [billingCompanyName, setBillingCompanyName] = useState('');
  const [loading, setLoading] = useState(false);""", """  const [billingTaxNumber, setBillingTaxNumber] = useState('');
  const [billingCompanyName, setBillingCompanyName] = useState('');
  const [giftRecipientName, setGiftRecipientName] = useState('');
  const [giftRecipientEmail, setGiftRecipientEmail] = useState('');
  const [companyLookupStatus, setCompanyLookupStatus] = useState<CompanyLookupStatus>('idle');
  const [loading, setLoading] = useState(false);""", 'new states')
text = rep(text, """        setBillingCountry(profile.billingCountry || 'Magyarország');""", """        setBillingCountry(normalizeCountryCode(profile.billingCountry || 'HU'));""", 'legacy country normalization')
text = rep(text, """  useEffect(() => {
    const normalizedCountry = billingCountry.trim().toLocaleLowerCase('hu-HU');
    const isHungary = normalizedCountry === 'magyarország' || normalizedCountry === 'hungary' || normalizedCountry === 'hu';
    const postalCode = billingPostalCode.trim();
    if (!isHungary || !/^\\d{4}$/.test(postalCode)) return;""", """  useEffect(() => {
    const postalCode = billingPostalCode.trim();
    if (billingCountry !== 'HU' || !/^\\d{4}$/.test(postalCode)) return;""", 'postal country select')
marker = """  useEffect(() => {
    const query = new URLSearchParams(window.location.search);"""
lookup_effect = """  useEffect(() => {
    if (mode !== 'organization' || !isEuCountry(billingCountry)) {
      setCompanyLookupStatus('idle');
      return;
    }
    const rawTaxNumber = billingTaxNumber.trim();
    const compact = rawTaxNumber.replace(/[^A-Za-z0-9]/g, '');
    const enough = billingCountry === 'HU' ? compact.replace(/^HU/i, '').length >= 8 : compact.length >= 4;
    if (!enough) {
      setCompanyLookupStatus('idle');
      return;
    }
    let active = true;
    setCompanyLookupStatus('loading');
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE}/api/company-lookup/${encodeURIComponent(billingCountry)}/${encodeURIComponent(rawTaxNumber)}`)
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!active) return;
          if (response.status === 404 || data?.valid === false) {
            setCompanyLookupStatus('invalid');
            return;
          }
          if (!response.ok) {
            setCompanyLookupStatus('error');
            return;
          }
          const companyName = String(data?.companyName || '').trim();
          if (companyName) {
            setBillingCompanyName(companyName);
            setCompanyLookupStatus('found');
          } else {
            setCompanyLookupStatus('not-found');
          }
        })
        .catch(() => { if (active) setCompanyLookupStatus('error'); });
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [mode, billingCountry, billingTaxNumber]);

"""
text = rep(text, marker, lookup_effect + marker, 'company lookup effect')
text = rep(text, """          billingTaxNumber,
          billingCompanyName,
        }),""", """          billingTaxNumber,
          billingCompanyName,
          giftRecipientName,
          giftRecipientEmail,
        }),""", 'submit gift recipient')
text = rep(text, """        {user && (
          <div style={styles.accountInfo}>
            <strong>{t(mode === 'organization' ? 'Kapcsolattartó' : 'Vásárló')}</strong>
            <span>{user.name || purchaserName}</span>
            <span>{user.email || purchaserEmail}</span>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>""", """        {user && (
          <div style={styles.accountInfo}>
            <strong>{t(mode === 'organization' ? 'Kapcsolattartó' : 'Vásárló')}</strong>
            <span>{user.name || purchaserName}</span>
            <span>{user.email || purchaserEmail}</span>
          </div>
        )}

        <form onSubmit={submit} style={styles.form}>
          {mode === 'gift' && (
            <div style={styles.giftRecipientBox}>
              <div style={styles.sectionTitle}>{t('Ajándékozott – a könyv jövőbeli tulajdonosa')}</div>
              <label style={styles.label}>{t('Ajándékozott neve')}
                <input value={giftRecipientName} onChange={(event) => setGiftRecipientName(event.target.value)} style={styles.input} required />
              </label>
              <label style={styles.label}>{t('Ajándékozott Google e-mail címe')}
                <input type=\"email\" value={giftRecipientEmail} onChange={(event) => setGiftRecipientEmail(event.target.value)} style={styles.input} required />
              </label>
              <div style={styles.fieldHint}>{t('Sikeres fizetés után beváltó link készül. A könyvet csak a fenti e-mail címhez tartozó Google-fiók válthatja be.')}</div>
            </div>
          )}""", 'gift recipient fields')
old_country = """          <label style={styles.label}>{t('Ország')}
            <input
              value={billingCountry}
              onChange={(event) => setBillingCountry(event.target.value)}
              placeholder={t('pl. Magyarország, DE, US')}
              style={styles.input}
            />
          </label>"""
new_country = """          <label style={styles.label}>{t('Ország')}
            <select value={billingCountry} onChange={(event) => setBillingCountry(event.target.value)} style={styles.input}>
              {COUNTRY_CODES
                .map((code) => ({ code, label: countryLabel(code, language) }))
                .sort((a, b) => a.label.localeCompare(b.label, language))
                .map((item) => <option key={item.code} value={item.code}>{item.label} ({item.code})</option>)}
            </select>
          </label>"""
text = rep(text, old_country, new_country, 'country select')
text = rep(text, """              <label style={styles.label}>{t('Cégnév')}
                <input value={billingCompanyName} onChange={(event) => setBillingCompanyName(event.target.value)} style={styles.input} required />
              </label>""", """              <label style={styles.label}>{t('Cégnév')}
                <input value={billingCompanyName} onChange={(event) => setBillingCompanyName(event.target.value)} style={styles.input} required />
                {companyLookupStatus === 'loading' && <span style={styles.fieldHint}>{t('Cégadat ellenőrzése...')}</span>}
                {companyLookupStatus === 'found' && <span style={styles.fieldHint}>{t('A cégnév automatikusan kitöltve a VIES adatai alapján.')}</span>}
                {companyLookupStatus === 'not-found' && <span style={styles.fieldHint}>{t('Az adószám érvényes, de a VIES nem adott vissza cégnevet. Add meg kézzel.')}</span>}
                {companyLookupStatus === 'invalid' && <span style={styles.fieldError}>{t('Ez az adószám nem érvényes a VIES rendszerben, vagy nem közösségi adószám.')}</span>}
                {companyLookupStatus === 'error' && <span style={styles.fieldHint}>{t('A cégadat most nem kérdezhető le. A cégnév kézzel is megadható.')}</span>}
              </label>""", 'company lookup status')
text = rep(text, """          {mode === 'gift' && <div style={styles.giftInfo}>{t('Ajándék vásárlásnál a könyv nem a fizető fiókjában jön létre. Sikeres fizetés után továbbküldhető beváltó link készül.')}</div>}""", """          {mode === 'gift' && <div style={styles.giftInfo}>{t('Az ajándék nem a vásárló fiókjába kerül. Fizetés után küldd el a beváltó linket az ajándékozottnak; a megadott Google-fiókkal tudja átvenni.')}</div>}""", 'gift explanation')
text = rep(text, """  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },
  accountInfo:""", """  notice: { marginBottom: 8, padding: 9, borderRadius: 8, background: '#fff7ed', color: '#9a3412', lineHeight: 1.35, fontSize: 13 },
  giftRecipientBox: { display: 'grid', gap: 6, padding: 9, borderRadius: 9, background: '#f8fafc', border: '1px solid #e2e8f0' },
  fieldHint: { display: 'block', marginTop: 2, color: '#64748b', fontSize: 11.5, lineHeight: 1.3, fontWeight: 500 },
  fieldError: { display: 'block', marginTop: 2, color: '#b91c1c', fontSize: 11.5, lineHeight: 1.3, fontWeight: 600 },
  accountInfo:""", 'purchase styles')
p.write_text(text, encoding='utf-8')

# --- Public translations ---
p = Path('src/publicUiI18n.ts')
text = p.read_text(encoding='utf-8')
anchor = "  'Kapcsolattartó': { en: 'Contact person', de: 'Kontaktperson' },"
translations = """
  'Ajándékozott – a könyv jövőbeli tulajdonosa': { en: 'Gift recipient – future book owner', de: 'Beschenkte Person – zukünftiger Bucheigentümer' },
  'Ajándékozott neve': { en: 'Recipient name', de: 'Name der beschenkten Person' },
  'Ajándékozott Google e-mail címe': { en: 'Recipient Google email address', de: 'Google-E-Mail-Adresse der beschenkten Person' },
  'Sikeres fizetés után beváltó link készül. A könyvet csak a fenti e-mail címhez tartozó Google-fiók válthatja be.': { en: 'After successful payment, a redemption link is created. Only the Google account for the email address above can redeem the book.', de: 'Nach erfolgreicher Zahlung wird ein Einlösungslink erstellt. Nur das Google-Konto der oben angegebenen E-Mail-Adresse kann das Buch einlösen.' },
  'Az ajándék nem a vásárló fiókjába kerül. Fizetés után küldd el a beváltó linket az ajándékozottnak; a megadott Google-fiókkal tudja átvenni.': { en: 'The gift is not added to the buyer’s account. After payment, send the redemption link to the recipient; they can claim it with the specified Google account.', de: 'Das Geschenk wird nicht dem Konto des Käufers hinzugefügt. Sende nach der Zahlung den Einlösungslink an die beschenkte Person; sie kann es mit dem angegebenen Google-Konto übernehmen.' },
  'Cégadat ellenőrzése...': { en: 'Checking company details...', de: 'Firmendaten werden geprüft...' },
  'A cégnév automatikusan kitöltve a VIES adatai alapján.': { en: 'Company name filled automatically from VIES data.', de: 'Firmenname wurde automatisch aus VIES-Daten ausgefüllt.' },
  'Az adószám érvényes, de a VIES nem adott vissza cégnevet. Add meg kézzel.': { en: 'The VAT number is valid, but VIES did not return a company name. Enter it manually.', de: 'Die USt-IdNr. ist gültig, aber VIES hat keinen Firmennamen zurückgegeben. Bitte manuell eingeben.' },
  'Ez az adószám nem érvényes a VIES rendszerben, vagy nem közösségi adószám.': { en: 'This VAT number is not valid in VIES or is not an EU VAT number.', de: 'Diese USt-IdNr. ist in VIES nicht gültig oder keine EU-USt-IdNr.' },
  'A cégadat most nem kérdezhető le. A cégnév kézzel is megadható.': { en: 'Company data cannot be checked right now. You can enter the company name manually.', de: 'Firmendaten können derzeit nicht geprüft werden. Der Firmenname kann manuell eingegeben werden.' },
  'Ezt az ajándékot másik e-mail címhez rendelték. A megadott Google-fiókkal lépj be.': { en: 'This gift is assigned to another email address. Sign in with the specified Google account.', de: 'Dieses Geschenk ist einer anderen E-Mail-Adresse zugeordnet. Melde dich mit dem angegebenen Google-Konto an.' },
  'Ajándékozott: {name}': { en: 'Recipient: {name}', de: 'Beschenkte Person: {name}' },
  'A megadott Google-fiókkal váltható be: {email}': { en: 'Redeem with the specified Google account: {email}', de: 'Mit dem angegebenen Google-Konto einlösen: {email}' },"""
text = rep(text, anchor, anchor + translations, 'public translations')
p.write_text(text, encoding='utf-8')

# --- Gift redeem page ---
p = Path('src/GiftRedeemPage.tsx')
text = p.read_text(encoding='utf-8')
text = rep(text, """type GiftInfo = { bookType: 'standard' | 'event' | string; includedPages: number; claimStatus: 'available' | 'claimed' | 'redeemed' | string };""", """type GiftInfo = {
  bookType: 'standard' | 'event' | string;
  includedPages: number;
  claimStatus: 'available' | 'claimed' | 'redeemed' | string;
  recipientName?: string | null;
  recipientEmailMasked?: string | null;
};""", 'gift info type')
text = rep(text, """      setError(err?.message === 'GIFT_ENTITLEMENT_ALREADY_CLAIMED' ? t('Ezt az ajándékot már másik fiók beváltotta.') : t('Az ajándék beváltása nem sikerült.'));""", """      setError(
        err?.message === 'GIFT_RECIPIENT_ACCOUNT_MISMATCH'
          ? t('Ezt az ajándékot másik e-mail címhez rendelték. A megadott Google-fiókkal lépj be.')
          : err?.message === 'GIFT_ENTITLEMENT_ALREADY_CLAIMED'
            ? t('Ezt az ajándékot már másik fiók beváltotta.')
            : t('Az ajándék beváltása nem sikerült.')
      );""", 'gift mismatch error')
text = rep(text, """            <p style={styles.text}>
              {info.bookType === 'event' ? t('Rendezvény-vendégkönyv') : f('Normál emlékkönyv – {count} oldal', { count: info.includedPages })}
            </p>""", """            <p style={styles.text}>
              {info.bookType === 'event' ? t('Rendezvény-vendégkönyv') : f('Normál emlékkönyv – {count} oldal', { count: info.includedPages })}
            </p>
            {info.recipientName && <p style={styles.text}><strong>{f('Ajándékozott: {name}', { name: info.recipientName })}</strong></p>}
            {info.recipientEmailMasked && <p style={styles.text}>{f('A megadott Google-fiókkal váltható be: {email}', { email: info.recipientEmailMasked })}</p>}""", 'gift recipient display')
p.write_text(text, encoding='utf-8')

# --- Backend ---
p = Path('server/index.ts')
text = p.read_text(encoding='utf-8')
anchor = """app.get('/api/invoicing-capabilities', (_req, res) => {"""
route = r"""const VIES_COUNTRIES = new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);

app.get('/api/company-lookup/:country/:taxNumber', async (req, res) => {
  const inputCountry = String(req.params.country || '').trim().toUpperCase();
  const countryCode = inputCountry === 'GR' ? 'EL' : inputCountry;
  if (!VIES_COUNTRIES.has(inputCountry) && !VIES_COUNTRIES.has(countryCode)) {
    res.status(400).json({ error: 'COMPANY_LOOKUP_NOT_SUPPORTED' });
    return;
  }
  let vatNumber = String(req.params.taxNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  if (vatNumber.startsWith(inputCountry)) vatNumber = vatNumber.slice(inputCountry.length);
  if (vatNumber.startsWith(countryCode)) vatNumber = vatNumber.slice(countryCode.length);
  if (countryCode === 'HU') {
    const digits = vatNumber.replace(/\D/g, '');
    vatNumber = digits.slice(0, 8);
  } else {
    vatNumber = vatNumber.replace(/[^A-Z0-9]/g, '');
  }
  if (!vatNumber) {
    res.status(400).json({ error: 'INVALID_TAX_NUMBER' });
    return;
  }
  try {
    const response = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: AbortSignal.timeout(8000),
    });
    const data: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(502).json({ error: 'COMPANY_LOOKUP_FAILED' });
      return;
    }
    const valid = Boolean(data?.isValid ?? data?.valid);
    const rawName = String(data?.name || '').trim();
    const rawAddress = String(data?.address || '').trim();
    const companyName = rawName && rawName !== '---' ? rawName : null;
    const address = rawAddress && rawAddress !== '---' ? rawAddress : null;
    if (!valid) {
      res.status(404).json({ valid: false, companyName: null, address: null, source: 'VIES' });
      return;
    }
    res.status(200).json({ valid: true, companyName, address, source: 'VIES' });
  } catch (err) {
    console.error('Company lookup error:', err);
    res.status(502).json({ error: 'COMPANY_LOOKUP_FAILED' });
  }
});

"""
text = rep(text, anchor, route + anchor, 'company lookup route')
text = rep(text, """  const billingCompanyName = String(req.body?.billingCompanyName || '').trim();
  const purchaseBillingName = purchaseMode === 'organization' ? billingCompanyName : billingName;""", """  const billingCompanyName = String(req.body?.billingCompanyName || '').trim();
  const giftRecipientName = purchaseMode === 'gift' ? String(req.body?.giftRecipientName || '').trim() : '';
  const giftRecipientEmail = purchaseMode === 'gift' ? String(req.body?.giftRecipientEmail || '').trim().toLowerCase() : '';
  const purchaseBillingName = purchaseMode === 'organization' ? billingCompanyName : billingName;""", 'gift recipient backend vars')
text = rep(text, """    purchaseMode === 'organization' ? billingTaxNumber : 'not-required',
  ];""", """    purchaseMode === 'organization' ? billingTaxNumber : 'not-required',
    purchaseMode === 'gift' ? giftRecipientName : 'not-required',
    purchaseMode === 'gift' ? giftRecipientEmail : 'not-required',
  ];""", 'gift recipient required')
text = rep(text, """  if (!purchaserEmail.includes('@') || !billingEmail.includes('@')) {""", """  if (!purchaserEmail.includes('@') || !billingEmail.includes('@') || (purchaseMode === 'gift' && !giftRecipientEmail.includes('@'))) {""", 'gift email validation')
text = rep(text, """    billingTaxNumber.length > 80
  ) {""", """    billingTaxNumber.length > 80 ||
    billingCompanyName.length > 200 ||
    giftRecipientName.length > 160 ||
    giftRecipientEmail.length > 240
  ) {""", 'gift/company length')
text = rep(text, """         billing_company_name,
         payment_provider,
         payment_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), NULLIF($15, ''), $16, 'draft')""", """         billing_company_name,
         gift_recipient_name,
         gift_recipient_email,
         payment_provider,
         payment_status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''), NULLIF($17, ''), $18, 'draft')""", 'purchase insert columns')
text = rep(text, """        billingCompanyName,
        paymentProvider,
      ]""", """        billingCompanyName,
        giftRecipientName,
        giftRecipientEmail,
        paymentProvider,
      ]""", 'purchase insert values')
text = rep(text, """         e.status,
         e.assigned_user_id IS NOT NULL AS \"claimed\"
       FROM book_entitlements e""", """         e.status,
         e.assigned_user_id IS NOT NULL AS \"claimed\",
         p.gift_recipient_name AS \"recipientName\",
         p.gift_recipient_email AS \"recipientEmail\"
       FROM book_entitlements e""", 'gift get recipient select')
text = rep(text, """    res.status(200).json({
      bookType: row.bookType,
      includedPages: row.includedPages,
      claimStatus:""", """    const recipientEmail = String(row.recipientEmail || '');
    const recipientEmailMasked = recipientEmail
      ? recipientEmail.replace(/^(.{1,2}).*(@.*)$/, '$1***$2')
      : null;
    res.status(200).json({
      bookType: row.bookType,
      includedPages: row.includedPages,
      recipientName: row.recipientName || null,
      recipientEmailMasked,
      claimStatus:""", 'gift get response')
text = rep(text, """         e.status,
         e.book_type AS \"bookType\",
         e.included_pages AS \"includedPages\"
       FROM book_entitlements e""", """         e.status,
         e.book_type AS \"bookType\",
         e.included_pages AS \"includedPages\",
         p.gift_recipient_email AS \"recipientEmail\"
       FROM book_entitlements e""", 'gift redeem recipient select')
text = rep(text, """    const entitlement = result.rows[0];
    if (entitlement.status !== 'available') {""", """    const entitlement = result.rows[0];
    const designatedRecipientEmail = String(entitlement.recipientEmail || '').trim().toLowerCase();
    const signedInEmail = String(session.user?.email || '').trim().toLowerCase();
    if (designatedRecipientEmail && designatedRecipientEmail !== signedInEmail) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'GIFT_RECIPIENT_ACCOUNT_MISMATCH' });
      return;
    }
    if (entitlement.status !== 'available') {""", 'gift redeem email lock')
text = rep(text, """  const invoicingMigration = await fs.readFile(""", """  const giftRecipientMigration = await fs.readFile(
    path.join(process.cwd(), 'server', 'migrations', '20260909_gift_recipient.sql'),
    'utf8'
  );
  await pool.query(giftRecipientMigration);

  const invoicingMigration = await fs.readFile(""", 'gift migration loader')
p.write_text(text, encoding='utf-8')
Path('server/migrations/20260909_gift_recipient.sql').write_text("""ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gift_recipient_name TEXT;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS gift_recipient_email TEXT;
CREATE INDEX IF NOT EXISTS purchases_gift_recipient_email_idx
  ON purchases (gift_recipient_email)
  WHERE purchase_mode = 'gift' AND gift_recipient_email IS NOT NULL;
""", encoding='utf-8')
