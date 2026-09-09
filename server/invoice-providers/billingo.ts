import crypto from 'crypto';
import type {
  InvoiceIssueResult,
  InvoiceProviderAdapter,
  NormalizedInvoicePayload,
} from '../invoicing';

const DEFAULT_BILLINGO_API_BASE_URL = 'https://api.billingo.hu/v3';

type BillingoDocument = {
  id?: number | string;
  invoice_number?: string;
  payment_status?: string;
};

type BillingoPublicUrl = {
  public_url?: string;
};

type BillingoPartner = {
  id?: number | string;
};

export class BillingoAdapterError extends Error {
  status?: number;
  providerCode?: string;
  providerBody?: unknown;

  constructor(
    message: string,
    options: { status?: number; providerCode?: string; providerBody?: unknown } = {}
  ) {
    super(message);
    this.name = 'BillingoAdapterError';
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.providerBody = options.providerBody;
  }
}

function requiredEnv(name: 'BILLINGO_API_KEY' | 'BILLINGO_BLOCK_ID'): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new BillingoAdapterError(`MISSING_${name}`);
  }
  return value;
}

function billingoBaseUrl(): string {
  return String(process.env.BILLINGO_API_BASE_URL || DEFAULT_BILLINGO_API_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
}

function vendorIdForPurchase(purchaseId: string): string {
  const digest = crypto.createHash('sha256').update(purchaseId).digest('hex').slice(0, 32);
  return `memorybook-${digest}`;
}

function currencyFractionDigits(currency: string): number {
  return ['HUF', 'JPY', 'KRW'].includes(currency.toUpperCase()) ? 0 : 2;
}

function minorToMajor(amountMinor: number, currency: string): number {
  const fractionDigits = currencyFractionDigits(currency);
  return amountMinor / 10 ** fractionDigits;
}

function paidDate(payload: NormalizedInvoicePayload): string {
  const date = new Date(payload.payment.paidAt);
  if (!Number.isFinite(date.getTime())) {
    throw new BillingoAdapterError('INVALID_PAID_AT');
  }
  return date.toISOString().slice(0, 10);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function billingoRequest<T>(
  path: string,
  init: RequestInit,
  options: { allowNotFound?: boolean } = {}
): Promise<T | null> {
  const apiKey = requiredEnv('BILLINGO_API_KEY');
  const response = await fetch(`${billingoBaseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      ...(init.headers || {}),
    },
  });

  const body = await parseResponseBody(response);

  if (options.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const providerCode =
      body && typeof body === 'object' && 'error' in body
        ? String((body as any).error?.code || (body as any).error?.message || '') || undefined
        : undefined;

    throw new BillingoAdapterError('BILLINGO_API_REQUEST_FAILED', {
      status: response.status,
      providerCode,
      providerBody: body,
    });
  }

  return body as T;
}

async function existingDocument(vendorId: string): Promise<BillingoDocument | null> {
  return billingoRequest<BillingoDocument>(
    `/documents/vendor/${encodeURIComponent(vendorId)}`,
    { method: 'GET' },
    { allowNotFound: true }
  );
}

async function createPartner(payload: NormalizedInvoicePayload): Promise<string> {
  if (!payload.buyer.countryCode) {
    throw new BillingoAdapterError('BILLINGO_COUNTRY_CODE_REQUIRED');
  }

  const partner = await billingoRequest<BillingoPartner>('/partners', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.buyer.name,
      address: {
        country_code: payload.buyer.countryCode,
        post_code: payload.buyer.postalCode,
        city: payload.buyer.city,
        address: payload.buyer.address,
      },
      emails: [payload.buyer.email],
      ...(payload.buyer.taxNumber ? { taxcode: payload.buyer.taxNumber } : {}),
    }),
  });

  if (!partner?.id) {
    throw new BillingoAdapterError('BILLINGO_PARTNER_ID_MISSING');
  }

  return String(partner.id);
}

async function createDocument(
  payload: NormalizedInvoicePayload,
  vendorId: string,
  partnerId: string
): Promise<BillingoDocument> {
  const blockId = Number(requiredEnv('BILLINGO_BLOCK_ID'));
  if (!Number.isInteger(blockId) || blockId <= 0) {
    throw new BillingoAdapterError('INVALID_BILLINGO_BLOCK_ID');
  }

  const items = payload.items.map((item) => {
    if (!item.taxCode) {
      throw new BillingoAdapterError('BILLINGO_TAX_CODE_REQUIRED');
    }

    return {
      name: item.name,
      unit_price: minorToMajor(item.grossAmountMinor, payload.currency),
      unit_price_type: 'gross',
      quantity: item.quantity,
      unit: item.unit,
      vat: item.taxCode,
      comment: item.sku,
    };
  });

  const optionalBankAccountId = Number(String(process.env.BILLINGO_BANK_ACCOUNT_ID || '').trim());
  const document = await billingoRequest<BillingoDocument>('/documents', {
    method: 'POST',
    body: JSON.stringify({
      vendor_id: vendorId,
      partner_id: Number(partnerId),
      block_id: blockId,
      ...(Number.isInteger(optionalBankAccountId) && optionalBankAccountId > 0
        ? { bank_account_id: optionalBankAccountId }
        : {}),
      type: 'invoice',
      fulfillment_date: paidDate(payload),
      due_date: paidDate(payload),
      payment_method: payload.payment.provider === 'paypal' ? 'paypal' : 'online_bankcard',
      language: payload.language,
      currency: payload.currency,
      electronic: false,
      paid: true,
      items,
      comment: `MemoryBook purchase ${payload.purchaseId}`,
    }),
  });

  if (!document?.id || !document.invoice_number) {
    throw new BillingoAdapterError('BILLINGO_DOCUMENT_RESPONSE_INCOMPLETE', {
      providerBody: document,
    });
  }

  return document;
}

async function publicUrlForDocument(documentId: string): Promise<string | null> {
  const result = await billingoRequest<BillingoPublicUrl>(
    `/documents/${encodeURIComponent(documentId)}/public-url`,
    { method: 'GET' }
  );

  return result?.public_url || null;
}

async function resultForDocument(
  document: BillingoDocument,
  vendorId: string
): Promise<InvoiceIssueResult> {
  if (!document.id || !document.invoice_number) {
    throw new BillingoAdapterError('BILLINGO_DOCUMENT_RESPONSE_INCOMPLETE', {
      providerBody: document,
    });
  }

  const externalInvoiceId = String(document.id);
  const invoicePdfUrl = await publicUrlForDocument(externalInvoiceId);

  return {
    externalInvoiceId,
    invoiceNumber: document.invoice_number,
    invoicePdfUrl,
    providerResponse: {
      vendorId,
      documentId: externalInvoiceId,
      paymentStatus: document.payment_status || null,
    },
  };
}

export const billingoAdapter: InvoiceProviderAdapter = {
  provider: 'billingo',
  async issueInvoice(payload) {
    const vendorId = vendorIdForPurchase(payload.purchaseId);
    const alreadyIssued = await existingDocument(vendorId);

    if (alreadyIssued) {
      return resultForDocument(alreadyIssued, vendorId);
    }

    const partnerId = await createPartner(payload);
    const document = await createDocument(payload, vendorId, partnerId);
    return resultForDocument(document, vendorId);
  },
};
