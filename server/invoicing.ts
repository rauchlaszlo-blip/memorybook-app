import crypto from 'crypto';
import { pool } from './db';
import { billingoAdapter } from './invoice-providers/billingo';

export type InvoiceProvider = 'billingo' | 'szamlazzhu';

type DbClient = {
  query: (text: string, params?: any[]) => Promise<any>;
};

export type NormalizedInvoicePayload = {
  version: 1;
  purchaseId: string;
  purchaseMode: 'self' | 'gift';
  bookType: 'standard' | 'event' | 'dedication';
  language: 'hu' | 'en' | 'de';
  buyer: {
    name: string;
    email: string;
    country: string;
    countryCode: string | null;
    postalCode: string;
    city: string;
    address: string;
    taxNumber: string | null;
  };
  payment: {
    provider: 'paypal' | 'simplepay';
    providerReference: string | null;
    paidAt: string;
  };
  currency: string;
  totalGrossMinor: number;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit: string;
    grossAmountMinor: number;
    taxCode: string | null;
  }>;
};

export type InvoiceIssueResult = {
  externalInvoiceId: string;
  invoiceNumber: string;
  invoicePdfUrl?: string | null;
  providerResponse?: Record<string, unknown> | null;
};

export interface InvoiceProviderAdapter {
  provider: InvoiceProvider;
  issueInvoice(payload: NormalizedInvoicePayload): Promise<InvoiceIssueResult>;
}

const adapters = new Map<InvoiceProvider, InvoiceProviderAdapter>();

export function registerInvoiceProviderAdapter(adapter: InvoiceProviderAdapter): void {
  adapters.set(adapter.provider, adapter);
}

registerInvoiceProviderAdapter(billingoAdapter);

export function getInvoiceProviderAdapter(provider: InvoiceProvider): InvoiceProviderAdapter | null {
  return adapters.get(provider) || null;
}

function configuredProvider(): InvoiceProvider | null {
  const value = String(process.env.INVOICE_PROVIDER || '').trim().toLowerCase();
  return value === 'billingo' || value === 'szamlazzhu' ? value : null;
}

export function getInvoicingCapabilities() {
  const provider = configuredProvider();
  const missingConfiguration: string[] = [];

  if (!provider) {
    missingConfiguration.push('INVOICE_PROVIDER');
  } else if (provider === 'billingo') {
    if (!String(process.env.BILLINGO_API_KEY || '').trim()) {
      missingConfiguration.push('BILLINGO_API_KEY');
    }
    if (!String(process.env.BILLINGO_BLOCK_ID || '').trim()) {
      missingConfiguration.push('BILLINGO_BLOCK_ID');
    }
  } else if (provider === 'szamlazzhu') {
    if (!String(process.env.SZAMLAZZHU_AGENT_KEY || '').trim()) {
      missingConfiguration.push('SZAMLAZZHU_AGENT_KEY');
    }
  }

  const adapterConnected = provider ? adapters.has(provider) : false;
  const credentialsConfigured = provider !== null && missingConfiguration.length === 0;
  const liveIssuingRequested = process.env.INVOICE_LIVE_ISSUING === 'true';

  return {
    supportedProviders: ['billingo', 'szamlazzhu'] as InvoiceProvider[],
    provider,
    credentialsConfigured,
    adapterConnected,
    liveIssuingRequested,
    liveIssuingEnabled: credentialsConfigured && adapterConnected && liveIssuingRequested,
    missingConfiguration,
  };
}

function productData(bookType: 'standard' | 'event' | 'dedication', includedPages: number) {
  if (bookType === 'event') {
    return {
      sku: 'MEMORYBOOK_EVENT',
      name: 'MemoryBook – rendezvény-vendégkönyv',
    };
  }

  if (bookType === 'dedication') {
    return {
      sku: `MEMORYBOOK_DEDICATION_${includedPages || 30}`,
      name: `MemoryBook – Dedikálás (${includedPages || 30} oldal)`,
    };
  }

  return {
    sku: `MEMORYBOOK_STANDARD_${includedPages || 30}`,
    name: `MemoryBook – normál emlékkönyv (${includedPages || 30} oldal)`,
  };
}

function normalizeCurrency(value: unknown): string | null {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

export async function prepareInvoiceForPaidPurchase(
  purchaseId: string,
  db: DbClient = pool
) {
  const purchaseResult = await db.query(
    `SELECT
       id,
       purchase_mode AS "purchaseMode",
       book_type AS "bookType",
       included_pages AS "includedPages",
       billing_name AS "billingName",
       billing_email AS "billingEmail",
       billing_country AS "billingCountry",
       billing_country_code AS "billingCountryCode",
       billing_postal_code AS "billingPostalCode",
       billing_city AS "billingCity",
       billing_address AS "billingAddress",
       billing_tax_number AS "billingTaxNumber",
       payment_provider AS "paymentProvider",
       payment_status AS "paymentStatus",
       provider_reference AS "providerReference",
       amount_minor AS "amountMinor",
       currency,
       paid_at AS "paidAt",
       invoice_language AS "invoiceLanguage",
       invoice_tax_code AS "invoiceTaxCode"
     FROM purchases
     WHERE id = $1`,
    [purchaseId]
  );

  if (purchaseResult.rowCount === 0) {
    const error: any = new Error('PURCHASE_NOT_FOUND');
    error.status = 404;
    throw error;
  }

  const purchase = purchaseResult.rows[0];
  if (purchase.paymentStatus !== 'paid' || !purchase.paidAt) {
    const error: any = new Error('INVOICE_REQUIRES_PAID_PURCHASE');
    error.status = 409;
    throw error;
  }

  const amountMinor = Number(purchase.amountMinor);
  const currency = normalizeCurrency(purchase.currency);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0 || !currency) {
    const error: any = new Error('INVOICE_AMOUNT_NOT_READY');
    error.status = 409;
    throw error;
  }

  const requiredBillingValues = [
    purchase.billingName,
    purchase.billingEmail,
    purchase.billingCountry,
    purchase.billingPostalCode,
    purchase.billingCity,
    purchase.billingAddress,
  ];
  if (requiredBillingValues.some((value) => !String(value || '').trim())) {
    const error: any = new Error('INVOICE_BILLING_DATA_INCOMPLETE');
    error.status = 409;
    throw error;
  }

  const language =
    purchase.invoiceLanguage === 'en' || purchase.invoiceLanguage === 'de'
      ? purchase.invoiceLanguage
      : 'hu';
  const bookType = purchase.bookType === 'event'
    ? 'event'
    : purchase.bookType === 'dedication'
      ? 'dedication'
      : 'standard';
  const product = productData(bookType, Number(purchase.includedPages) || 0);
  const capabilities = getInvoicingCapabilities();

  const payload: NormalizedInvoicePayload = {
    version: 1,
    purchaseId: purchase.id,
    purchaseMode: purchase.purchaseMode === 'gift' ? 'gift' : 'self',
    bookType,
    language,
    buyer: {
      name: String(purchase.billingName).trim(),
      email: String(purchase.billingEmail).trim().toLowerCase(),
      country: String(purchase.billingCountry).trim(),
      countryCode: purchase.billingCountryCode
        ? String(purchase.billingCountryCode).trim().toUpperCase()
        : null,
      postalCode: String(purchase.billingPostalCode).trim(),
      city: String(purchase.billingCity).trim(),
      address: String(purchase.billingAddress).trim(),
      taxNumber: purchase.billingTaxNumber
        ? String(purchase.billingTaxNumber).trim()
        : null,
    },
    payment: {
      provider: purchase.paymentProvider === 'paypal' ? 'paypal' : 'simplepay',
      providerReference: purchase.providerReference
        ? String(purchase.providerReference)
        : null,
      paidAt: new Date(purchase.paidAt).toISOString(),
    },
    currency,
    totalGrossMinor: amountMinor,
    items: [
      {
        sku: product.sku,
        name: product.name,
        quantity: 1,
        unit: 'db',
        grossAmountMinor: amountMinor,
        taxCode: purchase.invoiceTaxCode
          ? String(purchase.invoiceTaxCode).trim()
          : null,
      },
    ],
  };

  const invoiceId = `invoice-${crypto.randomUUID()}`;
  const result = await db.query(
    `INSERT INTO purchase_invoices (
       id,
       purchase_id,
       provider,
       status,
       payload_json
     )
     VALUES ($1, $2, $3, 'prepared', $4::jsonb)
     ON CONFLICT (purchase_id) DO UPDATE
     SET
       provider = CASE
         WHEN purchase_invoices.status IN ('issuing', 'issued') THEN purchase_invoices.provider
         ELSE EXCLUDED.provider
       END,
       payload_json = CASE
         WHEN purchase_invoices.status IN ('issuing', 'issued') THEN purchase_invoices.payload_json
         ELSE EXCLUDED.payload_json
       END,
       status = CASE
         WHEN purchase_invoices.status IN ('issuing', 'issued') THEN purchase_invoices.status
         ELSE 'prepared'
       END,
       last_error_code = CASE
         WHEN purchase_invoices.status IN ('issuing', 'issued') THEN purchase_invoices.last_error_code
         ELSE NULL
       END,
       last_error_message = CASE
         WHEN purchase_invoices.status IN ('issuing', 'issued') THEN purchase_invoices.last_error_message
         ELSE NULL
       END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING
       id,
       purchase_id AS "purchaseId",
       provider,
       status,
       payload_json AS payload,
       external_invoice_id AS "externalInvoiceId",
       invoice_number AS "invoiceNumber",
       invoice_pdf_url AS "invoicePdfUrl",
       attempt_count AS "attemptCount",
       last_error_code AS "lastErrorCode",
       issued_at AS "issuedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [invoiceId, purchase.id, capabilities.provider, JSON.stringify(payload)]
  );

  return {
    invoice: result.rows[0],
    capabilities,
    liveReady:
      capabilities.liveIssuingEnabled &&
      Boolean(payload.items[0].taxCode) &&
      Boolean(payload.buyer.countryCode),
    missingInvoiceData: [
      ...(payload.items[0].taxCode ? [] : ['invoiceTaxCode']),
      ...(payload.buyer.countryCode ? [] : ['billingCountryCode']),
    ],
  };
}
