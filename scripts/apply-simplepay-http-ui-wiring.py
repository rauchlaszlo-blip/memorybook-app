from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'server/index.ts',
    """import {
  capturePayPalPaymentForPurchase,
  createPayPalOrderForPurchase,
  PayPalPurchaseError,
} from './payments/paypal-purchase';

dotenv.config();""",
    """import {
  capturePayPalPaymentForPurchase,
  createPayPalOrderForPurchase,
  PayPalPurchaseError,
} from './payments/paypal-purchase';
import {
  buildSimplePayIpnAcknowledgement,
  getSimplePayCapabilities,
  SimplePayAdapterError,
} from './payments/simplepay';
import {
  createSimplePayTransactionForPurchase,
  finalizeSimplePayPurchaseFromIpn,
  SimplePayPurchaseError,
} from './payments/simplepay-purchase';

dotenv.config();""",
)

replace_once(
    'server/index.ts',
    "app.use(express.json({ limit: '5mb' }));",
    """app.use(express.json({
  limit: '5mb',
  verify: (req: any, _res: any, buf: Buffer) => {
    const pathname = String(req.originalUrl || req.url || '').split('?')[0];
    if (pathname === '/api/payments/simplepay/ipn') {
      req.rawBody = buf.toString('utf8');
    }
  },
}));""",
)

replace_once(
    'server/index.ts',
    """  res.status(status).json({ error: code });
}

function isPageInviteExpired""",
    """  res.status(status).json({ error: code });
}

function sendSimplePayRouteError(res: any, err: any, fallbackCode: string): void {
  let status = 500;
  let code = fallbackCode;

  if (err instanceof SimplePayPurchaseError || err instanceof PayPalPurchaseError) {
    status = err.status;
    code = err.message || fallbackCode;
  } else if (err instanceof SimplePayAdapterError) {
    const configError =
      err.message.startsWith('MISSING_SIMPLEPAY_') ||
      err.message === 'SIMPLEPAY_LIVE_NOT_ENABLED';
    const ipnInputError = err.message.startsWith('SIMPLEPAY_IPN_');
    status = configError ? 503 : ipnInputError ? 400 : 502;
    code = err.message || fallbackCode;
  }

  console.error(fallbackCode, {
    code,
    status,
    providerStatus: err instanceof SimplePayAdapterError ? err.status : undefined,
    providerErrorCodes: err instanceof SimplePayAdapterError ? err.providerErrorCodes : undefined,
  });
  res.status(status).json({ error: code });
}

function isPageInviteExpired""",
)

replace_once(
    'server/index.ts',
    """    paypal: getPayPalCapabilities(),
    simplepay: {
      enabled: false,
      integrationReady: false,
    },""",
    """    paypal: getPayPalCapabilities(),
    simplepay: {
      ...getSimplePayCapabilities(),
      integrationReady: true,
    },""",
)

simplepay_routes = r'''
app.post('/api/purchases/:purchaseId/simplepay/start', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  if (!purchaseId) {
    res.status(400).json({ error: 'PURCHASE_ID_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const publicBaseUrl = getPublicAppBaseUrl(req);
    const encodedPurchaseId = encodeURIComponent(purchaseId);
    const result = await createSimplePayTransactionForPurchase(
      purchaseId,
      `${publicBaseUrl}/purchase?simplepay=return&purchaseId=${encodedPurchaseId}`
    );

    res.status(201).json({
      success: true,
      purchaseId: result.purchaseId,
      paymentStatus: result.paymentStatus,
      transaction: {
        transactionId: result.transaction.transactionId,
        paymentUrl: result.transaction.paymentUrl,
      },
    });
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_START_FAILED');
  }
});

app.get('/api/purchases/:purchaseId/simplepay/status', async (req, res) => {
  const purchaseId = String(req.params.purchaseId || '').trim();
  if (!purchaseId) {
    res.status(400).json({ error: 'PURCHASE_ID_REQUIRED' });
    return;
  }

  try {
    await ensurePurchasePaymentAccess(req, purchaseId);
    const result = await pool.query(
      `SELECT
         p.payment_status AS "paymentStatus",
         p.provider_reference AS "providerReference",
         e.id AS "entitlementId",
         e.gift_token AS "giftToken",
         e.book_type AS "bookType",
         e.included_pages AS "includedPages",
         e.status AS "entitlementStatus"
       FROM purchases p
       LEFT JOIN book_entitlements e ON e.purchase_id = p.id
       WHERE p.id = $1
         AND p.payment_provider = 'simplepay'`,
      [purchaseId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'PURCHASE_NOT_FOUND' });
      return;
    }

    const row = result.rows[0];
    if (row.paymentStatus === 'paid' && !row.entitlementId) {
      res.status(500).json({ error: 'PAID_PURCHASE_ENTITLEMENT_MISSING' });
      return;
    }

    res.status(200).json({
      success: true,
      purchaseId,
      paymentStatus: row.paymentStatus,
      providerReference: row.providerReference,
      entitlement: row.entitlementId
        ? {
            id: row.entitlementId,
            bookType: row.bookType,
            includedPages: row.includedPages,
            status: row.entitlementStatus,
            giftToken: row.giftToken,
          }
        : null,
      giftRedeemPath: row.giftToken ? `/gift/${encodeURIComponent(row.giftToken)}` : null,
    });
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_STATUS_FAILED');
  }
});

app.post('/api/payments/simplepay/ipn', async (req: any, res) => {
  const rawBody = typeof req.rawBody === 'string' ? req.rawBody : '';
  const incomingSignature = String(req.get('Signature') || '').trim();

  if (!rawBody || !incomingSignature) {
    res.status(400).json({ error: 'SIMPLEPAY_IPN_INPUT_REQUIRED' });
    return;
  }

  try {
    const acknowledgement = buildSimplePayIpnAcknowledgement(rawBody, incomingSignature);
    await finalizeSimplePayPurchaseFromIpn(acknowledgement.message);

    res
      .status(200)
      .set('Signature', acknowledgement.responseSignature)
      .type('application/json')
      .send(acknowledgement.responseBody);
  } catch (err) {
    sendSimplePayRouteError(res, err, 'SIMPLEPAY_IPN_FAILED');
  }
});
'''

replace_once(
    'server/index.ts',
    "\n\napp.post('/api/purchases/:purchaseId/paypal/order', async (req, res) => {",
    "\n" + simplepay_routes + "\napp.post('/api/purchases/:purchaseId/paypal/order', async (req, res) => {",
)

replace_once(
    'src/PurchasePage.tsx',
    """  simplepay?: { enabled?: boolean; integrationReady?: boolean };
};
type PaymentSuccess = {
  purchaseId: string;
  giftRedeemPath?: string | null;
};""",
    """  simplepay?: {
    environment?: 'sandbox' | 'live';
    credentialsConfigured?: boolean;
    liveRequested?: boolean;
    liveEnabled?: boolean;
    enabled?: boolean;
    integrationReady?: boolean;
    missingConfiguration?: string[];
  };
};
type PaymentSuccess = {
  purchaseId: string;
  provider: Provider;
  giftRedeemPath?: string | null;
};""",
)

replace_once(
    'src/PurchasePage.tsx',
    """    const paypalState = query.get('paypal');
    const returnedPurchaseId = query.get('purchaseId');

    if (paypalState === 'cancel') {""",
    """    const paypalState = query.get('paypal');
    const simplePayState = query.get('simplepay');
    const returnedPurchaseId = query.get('purchaseId');

    if (simplePayState === 'return') {
      if (!returnedPurchaseId) {
        setError(t('A SimplePay visszatérési adatai hiányosak.'));
        return;
      }

      let active = true;
      let timer: number | undefined;
      setPurchaseId(returnedPurchaseId);
      setLoading(true);
      setError(null);
      setNotice(t('SimplePay fizetés ellenőrzése...'));

      const checkStatus = async (attempt: number) => {
        try {
          const response = await fetch(
            `${API_BASE}/api/purchases/${encodeURIComponent(returnedPurchaseId)}/simplepay/status`,
            { credentials: 'include' }
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data?.error || 'SIMPLEPAY_STATUS_FAILED');
          if (!active) return;

          if (data?.paymentStatus === 'paid') {
            setPaymentSuccess({
              purchaseId: returnedPurchaseId,
              provider: 'simplepay',
              giftRedeemPath: data?.giftRedeemPath || null,
            });
            setNotice(null);
            setLoading(false);
            window.history.replaceState({}, '', '/purchase');
            return;
          }

          if (attempt < 7) {
            timer = window.setTimeout(() => { void checkStatus(attempt + 1); }, 1000);
            return;
          }

          setNotice(t('A SimplePay fizetés még feldolgozás alatt van. A könyvjogosultság csak a hiteles SimplePay értesítés után jön létre.'));
          setLoading(false);
          window.history.replaceState({}, '', '/purchase');
        } catch (err) {
          if (!active) return;
          console.error(err);
          setNotice(null);
          setLoading(false);
          setError(t('A SimplePay fizetés állapotának ellenőrzése nem sikerült. A vásárlást nem jelöltük kifizetettnek.'));
        }
      };

      void checkStatus(0);
      return () => {
        active = false;
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    if (paypalState === 'cancel') {""",
)

replace_once(
    'src/PurchasePage.tsx',
    """        setPaymentSuccess({
          purchaseId: returnedPurchaseId,
          giftRedeemPath: data?.giftRedeemPath || null,
        });""",
    """        setPaymentSuccess({
          purchaseId: returnedPurchaseId,
          provider: 'paypal',
          giftRedeemPath: data?.giftRedeemPath || null,
        });""",
)

replace_once(
    'src/PurchasePage.tsx',
    """      if (provider !== 'paypal') {
        setNotice(t('A SimplePay bekötése még nincs aktiválva. A vásárlási adatok elmentve.'));
        return;
      }

      if (!paymentCapabilities?.paypal?.enabled) {""",
    """      if (provider === 'simplepay') {
        if (!paymentCapabilities?.simplepay?.enabled) {
          setNotice(t('A SimplePay technikailag be van kötve, de a sandbox hitelesítő adatok még nincsenek beállítva.'));
          return;
        }

        const startResponse = await fetch(
          `${API_BASE}/api/purchases/${encodeURIComponent(nextPurchaseId)}/simplepay/start`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          }
        );
        const startData = await startResponse.json().catch(() => ({}));
        if (!startResponse.ok) {
          if (startData?.error === 'PURCHASE_AMOUNT_NOT_READY') {
            setNotice(t('A SimplePay útvonal működik, de a MemoryBook ára és pénzneme még nincs beállítva.'));
            return;
          }
          throw new Error(startData?.error || 'SIMPLEPAY_START_FAILED');
        }

        const paymentUrl = String(startData?.transaction?.paymentUrl || '');
        if (!paymentUrl) throw new Error('SIMPLEPAY_PAYMENT_URL_MISSING');
        window.location.assign(paymentUrl);
        return;
      }

      if (!paymentCapabilities?.paypal?.enabled) {""",
)

replace_once(
    'src/PurchasePage.tsx',
    """  const paypalReady = Boolean(paymentCapabilities?.paypal?.enabled);

  return (""",
    """  const paypalReady = Boolean(paymentCapabilities?.paypal?.enabled);
  const simplePayReady = Boolean(paymentCapabilities?.simplepay?.enabled);

  return (""",
)

replace_once(
    'src/PurchasePage.tsx',
    """        <p style={styles.lead}>{t('A PayPal fizetési folyamat technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.')}</p>""",
    """        <p style={styles.lead}>{t('A PayPal és a SimplePay fizetési folyamata technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.')}</p>""",
)

replace_once(
    'src/PurchasePage.tsx',
    """          {provider === 'paypal' && paymentCapabilities && !paypalReady && (
            <div style={styles.notice}>{t('A PayPal sandbox még nincs aktiválva. A fizetés nem indul el, amíg nincs beállítva teszt hitelesítés.')}</div>
          )}

          <div style={styles.sectionTitle}>{t('Vásárló azonosítása')}</div>""",
    """          {provider === 'paypal' && paymentCapabilities && !paypalReady && (
            <div style={styles.notice}>{t('A PayPal sandbox még nincs aktiválva. A fizetés nem indul el, amíg nincs beállítva teszt hitelesítés.')}</div>
          )}
          {provider === 'simplepay' && paymentCapabilities && !simplePayReady && (
            <div style={styles.notice}>{t('A SimplePay sandbox még nincs aktiválva. A fizetés nem indul el, amíg nincs beállítva teszt hitelesítés.')}</div>
          )}

          <div style={styles.sectionTitle}>{t('Vásárló azonosítása')}</div>""",
)

replace_once(
    'src/PurchasePage.tsx',
    """            {loading ? t('Folyamatban...') : provider === 'paypal' && paypalReady ? t('Tovább a PayPal fizetéshez') : t('Vásárlási adatok mentése')}""",
    """            {loading
              ? t('Folyamatban...')
              : provider === 'simplepay' && simplePayReady
                ? t('Tovább a SimplePay fizetéshez')
                : provider === 'paypal' && paypalReady
                  ? t('Tovább a PayPal fizetéshez')
                  : t('Vásárlási adatok mentése')}""",
)

replace_once(
    'src/PurchasePage.tsx',
    """            <strong>{t('A PayPal fizetés sikeres. A könyvjogosultság létrejött.')}</strong><br />""",
    """            <strong>{t(paymentSuccess.provider === 'simplepay' ? 'A SimplePay fizetés sikeres. A könyvjogosultság létrejött.' : 'A PayPal fizetés sikeres. A könyvjogosultság létrejött.')}</strong><br />""",
)

replace_once(
    'src/publicUiI18n.ts',
    """  'A PayPal fizetési folyamat technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.': { en: 'The PayPal payment flow is technically connected. Live payments can start only after separate activation.', de: 'Der PayPal-Zahlungsablauf ist technisch angebunden. Live-Zahlungen können erst nach einer separaten Aktivierung gestartet werden.' },""",
    """  'A PayPal fizetési folyamat technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.': { en: 'The PayPal payment flow is technically connected. Live payments can start only after separate activation.', de: 'Der PayPal-Zahlungsablauf ist technisch angebunden. Live-Zahlungen können erst nach einer separaten Aktivierung gestartet werden.' },
  'A PayPal és a SimplePay fizetési folyamata technikailag be van kötve. Éles fizetés csak külön aktiválás után indulhat.': { en: 'The PayPal and SimplePay payment flows are technically connected. Live payments can start only after separate activation.', de: 'Die PayPal- und SimplePay-Zahlungsabläufe sind technisch angebunden. Live-Zahlungen können erst nach einer separaten Aktivierung gestartet werden.' },""",
)

replace_once(
    'src/publicUiI18n.ts',
    """  'A SimplePay bekötése még nincs aktiválva. A vásárlási adatok elmentve.': { en: 'SimplePay has not been activated yet. The purchase details were saved.', de: 'SimplePay ist noch nicht aktiviert. Die Kaufdaten wurden gespeichert.' },""",
    """  'A SimplePay bekötése még nincs aktiválva. A vásárlási adatok elmentve.': { en: 'SimplePay has not been activated yet. The purchase details were saved.', de: 'SimplePay ist noch nicht aktiviert. Die Kaufdaten wurden gespeichert.' },
  'A SimplePay sandbox még nincs aktiválva. A fizetés nem indul el, amíg nincs beállítva teszt hitelesítés.': { en: 'The SimplePay sandbox is not activated yet. Payment will not start until test credentials are configured.', de: 'Die SimplePay-Sandbox ist noch nicht aktiviert. Die Zahlung startet erst, wenn Test-Zugangsdaten eingerichtet sind.' },
  'A SimplePay technikailag be van kötve, de a sandbox hitelesítő adatok még nincsenek beállítva.': { en: 'SimplePay is technically connected, but the sandbox credentials have not been configured yet.', de: 'SimplePay ist technisch angebunden, aber die Sandbox-Zugangsdaten sind noch nicht eingerichtet.' },
  'A SimplePay útvonal működik, de a MemoryBook ára és pénzneme még nincs beállítva.': { en: 'The SimplePay route is working, but the MemoryBook price and currency have not been configured yet.', de: 'Die SimplePay-Anbindung funktioniert, aber Preis und Währung für MemoryBook sind noch nicht eingerichtet.' },
  'A SimplePay visszatérési adatai hiányosak.': { en: 'The SimplePay return data is incomplete.', de: 'Die SimplePay-Rückgabedaten sind unvollständig.' },
  'SimplePay fizetés ellenőrzése...': { en: 'Checking SimplePay payment...', de: 'SimplePay-Zahlung wird geprüft...' },
  'A SimplePay fizetés még feldolgozás alatt van. A könyvjogosultság csak a hiteles SimplePay értesítés után jön létre.': { en: 'The SimplePay payment is still being processed. The book entitlement is created only after the verified SimplePay notification arrives.', de: 'Die SimplePay-Zahlung wird noch verarbeitet. Die Buchberechtigung wird erst nach der verifizierten SimplePay-Benachrichtigung erstellt.' },
  'A SimplePay fizetés állapotának ellenőrzése nem sikerült. A vásárlást nem jelöltük kifizetettnek.': { en: 'The SimplePay payment status could not be checked. The purchase was not marked as paid.', de: 'Der Status der SimplePay-Zahlung konnte nicht geprüft werden. Der Kauf wurde nicht als bezahlt markiert.' },
  'Tovább a SimplePay fizetéshez': { en: 'Continue to SimplePay payment', de: 'Weiter zur SimplePay-Zahlung' },
  'A SimplePay fizetés sikeres. A könyvjogosultság létrejött.': { en: 'The SimplePay payment was successful. The book entitlement has been created.', de: 'Die SimplePay-Zahlung war erfolgreich. Die Buchberechtigung wurde erstellt.' },""",
)

replace_once(
    'server/payments/README.md',
    """HTTP route/UI wiring and real provider credentials are separate integration steps. Purchase pricing must exist before either provider may start a payment.""",
    """SimplePay HTTP integration routes:
- `POST /api/purchases/:purchaseId/simplepay/start` creates the signed provider transaction and returns its payment URL;
- `POST /api/payments/simplepay/ipn` verifies the exact raw request body and returns the exact signed acknowledgement body;
- `GET /api/purchases/:purchaseId/simplepay/status` exposes only the locally verified purchase state for the browser return flow.

The browser redirect never marks a purchase paid. Only a verified `FINISHED` IPN may finalize the purchase and create the entitlement. The SimplePay merchant/sandbox IPN configuration must point to `/api/payments/simplepay/ipn` when provider credentials are configured.

Real provider credentials and purchase pricing remain separate configuration steps. Purchase pricing must exist before either provider may start a payment.""",
)

print('SimplePay HTTP/UI wiring patch applied')
