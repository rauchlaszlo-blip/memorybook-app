import crypto from 'crypto';

export type SimplePayEnvironment = 'sandbox' | 'live';
export type SimplePayCurrency = 'HUF' | 'EUR' | 'USD';
export type SimplePayLanguage = 'HU' | 'EN' | 'DE';

export type StartSimplePayTransactionInput = {
  purchaseId: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  language?: SimplePayLanguage;
  redirectUrl: string;
  timeoutMinutes?: number;
};

export type SimplePayStartResult = {
  transactionId: string;
  orderRef: string;
  paymentUrl: string;
  currency: SimplePayCurrency;
  amountMinor: number;
  providerResponse: Record<string, unknown>;
};

export type SimplePayIpnMessage = {
  salt?: string;
  orderRef?: string;
  method?: string;
  merchant?: string;
  finishDate?: string;
  paymentDate?: string;
  transactionId?: number | string;
  status?: string;
  [key: string]: unknown;
};

export type SimplePayIpnAcknowledgement = {
  message: SimplePayIpnMessage;
  responseBody: string;
  responseSignature: string;
};

export class SimplePayAdapterError extends Error {
  status?: number;
  providerErrorCodes?: unknown;
  providerBody?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      providerErrorCodes?: unknown;
      providerBody?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'SimplePayAdapterError';
    this.status = options.status;
    this.providerErrorCodes = options.providerErrorCodes;
    this.providerBody = options.providerBody;
  }
}

const SIMPLEPAY_SANDBOX_BASE_URL = 'https://sandbox.simplepay.hu/payment';
const SIMPLEPAY_LIVE_BASE_URL = 'https://secure.simplepay.hu/payment';
const SIMPLEPAY_SDK_VERSION = 'MemoryBook-SimplePayV2.1';
const SUPPORTED_CURRENCIES = new Set<SimplePayCurrency>(['HUF', 'EUR', 'USD']);

function configuredEnvironment(): SimplePayEnvironment {
  return String(process.env.SIMPLEPAY_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'live'
    ? 'live'
    : 'sandbox';
}

function configuredMerchantId(): string {
  const value = String(process.env.SIMPLEPAY_MERCHANT_ID || '').trim();
  if (!value) throw new SimplePayAdapterError('MISSING_SIMPLEPAY_MERCHANT_ID');
  return value;
}

function configuredSecretKey(): string {
  const value = String(process.env.SIMPLEPAY_SECRET_KEY || '').trim();
  if (!value) throw new SimplePayAdapterError('MISSING_SIMPLEPAY_SECRET_KEY');
  return value;
}

function ensureEnvironmentAllowed(environment: SimplePayEnvironment): void {
  if (environment === 'live' && process.env.SIMPLEPAY_LIVE_ENABLED !== 'true') {
    throw new SimplePayAdapterError('SIMPLEPAY_LIVE_NOT_ENABLED');
  }
}

function apiBaseUrl(environment: SimplePayEnvironment): string {
  const override = String(process.env.SIMPLEPAY_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;
  return environment === 'live' ? SIMPLEPAY_LIVE_BASE_URL : SIMPLEPAY_SANDBOX_BASE_URL;
}

function normalizeCurrency(value: string): SimplePayCurrency {
  const currency = String(value || '').trim().toUpperCase() as SimplePayCurrency;
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw new SimplePayAdapterError('UNSUPPORTED_SIMPLEPAY_CURRENCY');
  }
  return currency;
}

function normalizeLanguage(value: SimplePayLanguage | undefined): SimplePayLanguage {
  return value === 'EN' || value === 'DE' ? value : 'HU';
}

function minorToSimplePayTotal(amountMinor: number, currency: SimplePayCurrency): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new SimplePayAdapterError('INVALID_SIMPLEPAY_AMOUNT');
  }
  if (currency === 'HUF') return amountMinor;
  return amountMinor / 100;
}

function simplePayTotalToMinor(total: unknown, currency: SimplePayCurrency): number {
  const amount = Number(total);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SimplePayAdapterError('INVALID_SIMPLEPAY_RESPONSE_AMOUNT');
  }
  const minor = currency === 'HUF' ? amount : Math.round(amount * 100);
  if (!Number.isSafeInteger(minor)) {
    throw new SimplePayAdapterError('INVALID_SIMPLEPAY_RESPONSE_AMOUNT');
  }
  return minor;
}

function randomSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function timeoutIso(minutes = 15): string {
  const boundedMinutes = Math.min(60, Math.max(5, Math.trunc(minutes) || 15));
  return new Date(Date.now() + boundedMinutes * 60_000).toISOString();
}

export function signSimplePayBody(rawBody: string, secretKey = configuredSecretKey()): string {
  return crypto.createHmac('sha384', secretKey).update(rawBody, 'utf8').digest('base64');
}

export function verifySimplePaySignature(
  rawBody: string,
  signature: string,
  secretKey = configuredSecretKey()
): boolean {
  const incoming = String(signature || '').trim();
  if (!incoming) return false;

  const expected = signSimplePayBody(rawBody, secretKey);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const incomingBuffer = Buffer.from(incoming, 'utf8');
  if (expectedBuffer.length !== incomingBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
}

function parseJsonObject(rawBody: string, errorCode: string): Record<string, any> {
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-object');
    }
    return parsed;
  } catch {
    throw new SimplePayAdapterError(errorCode);
  }
}

async function simplePayPost<T extends Record<string, any>>(
  path: string,
  payload: Record<string, unknown>
): Promise<{ body: T; rawBody: string; signature: string }> {
  const environment = configuredEnvironment();
  ensureEnvironmentAllowed(environment);
  const secretKey = configuredSecretKey();
  const rawRequestBody = JSON.stringify(payload);
  const requestSignature = signSimplePayBody(rawRequestBody, secretKey);

  const response = await fetch(`${apiBaseUrl(environment)}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Signature: requestSignature,
    },
    body: rawRequestBody,
  });

  const rawResponseBody = await response.text();
  const responseSignature = String(response.headers.get('signature') || '').trim();

  if (!responseSignature || !verifySimplePaySignature(rawResponseBody, responseSignature, secretKey)) {
    throw new SimplePayAdapterError('SIMPLEPAY_RESPONSE_SIGNATURE_INVALID', {
      status: response.status,
      providerBody: rawResponseBody,
    });
  }

  const body = parseJsonObject(rawResponseBody, 'SIMPLEPAY_RESPONSE_JSON_INVALID') as T;
  const providerErrorCodes = body.errorCodes;
  if (!response.ok || (Array.isArray(providerErrorCodes) && providerErrorCodes.length > 0)) {
    throw new SimplePayAdapterError('SIMPLEPAY_API_REQUEST_FAILED', {
      status: response.status,
      providerErrorCodes,
      providerBody: body,
    });
  }

  return { body, rawBody: rawResponseBody, signature: responseSignature };
}

export function getSimplePayCapabilities() {
  const environment = configuredEnvironment();
  const missingConfiguration: string[] = [];
  if (!String(process.env.SIMPLEPAY_MERCHANT_ID || '').trim()) {
    missingConfiguration.push('SIMPLEPAY_MERCHANT_ID');
  }
  if (!String(process.env.SIMPLEPAY_SECRET_KEY || '').trim()) {
    missingConfiguration.push('SIMPLEPAY_SECRET_KEY');
  }
  if (environment === 'live' && process.env.SIMPLEPAY_LIVE_ENABLED !== 'true') {
    missingConfiguration.push('SIMPLEPAY_LIVE_ENABLED');
  }

  return {
    environment,
    credentialsConfigured:
      Boolean(String(process.env.SIMPLEPAY_MERCHANT_ID || '').trim()) &&
      Boolean(String(process.env.SIMPLEPAY_SECRET_KEY || '').trim()),
    liveRequested: environment === 'live',
    liveEnabled: environment === 'live' && process.env.SIMPLEPAY_LIVE_ENABLED === 'true',
    enabled: missingConfiguration.length === 0,
    missingConfiguration,
  };
}

export async function startSimplePayTransaction(
  input: StartSimplePayTransactionInput
): Promise<SimplePayStartResult> {
  const merchant = configuredMerchantId();
  const currency = normalizeCurrency(input.currency);
  const amountMinor = input.amountMinor;
  const total = minorToSimplePayTotal(amountMinor, currency);
  const orderRef = String(input.purchaseId || '').trim();
  const customerEmail = String(input.customerEmail || '').trim();
  const redirectUrl = String(input.redirectUrl || '').trim();

  if (!orderRef) throw new SimplePayAdapterError('SIMPLEPAY_ORDER_REF_REQUIRED');
  if (!customerEmail || !customerEmail.includes('@')) {
    throw new SimplePayAdapterError('SIMPLEPAY_CUSTOMER_EMAIL_REQUIRED');
  }
  try {
    const parsed = new URL(redirectUrl);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      throw new Error('insecure');
    }
  } catch {
    throw new SimplePayAdapterError('SIMPLEPAY_REDIRECT_URL_INVALID');
  }

  const { body } = await simplePayPost<any>('/v2/start', {
    salt: randomSalt(),
    merchant,
    orderRef,
    currency,
    customerEmail,
    language: normalizeLanguage(input.language),
    sdkVersion: SIMPLEPAY_SDK_VERSION,
    methods: ['CARD'],
    total,
    timeout: timeoutIso(input.timeoutMinutes),
    url: redirectUrl,
  });

  const responseCurrency = normalizeCurrency(String(body.currency || currency));
  const responseAmountMinor = simplePayTotalToMinor(body.total ?? total, responseCurrency);
  const transactionId = String(body.transactionId ?? '').trim();
  const paymentUrl = String(body.paymentUrl || '').trim();
  const responseOrderRef = String(body.orderRef || orderRef).trim();
  const responseMerchant = String(body.merchant || merchant).trim();

  if (!transactionId || !paymentUrl) {
    throw new SimplePayAdapterError('SIMPLEPAY_START_RESPONSE_INCOMPLETE', { providerBody: body });
  }
  if (responseOrderRef !== orderRef || responseMerchant !== merchant) {
    throw new SimplePayAdapterError('SIMPLEPAY_START_REFERENCE_MISMATCH', { providerBody: body });
  }
  if (responseCurrency !== currency || responseAmountMinor !== amountMinor) {
    throw new SimplePayAdapterError('SIMPLEPAY_START_AMOUNT_MISMATCH', { providerBody: body });
  }

  return {
    transactionId,
    orderRef,
    paymentUrl,
    currency,
    amountMinor,
    providerResponse: {
      transactionId,
      orderRef,
      merchant: responseMerchant,
      currency: responseCurrency,
      total: body.total ?? total,
      timeout: body.timeout || null,
    },
  };
}

export function buildSimplePayIpnAcknowledgement(
  rawBody: string,
  incomingSignature: string,
  receivedAt = new Date()
): SimplePayIpnAcknowledgement {
  const secretKey = configuredSecretKey();
  if (!verifySimplePaySignature(rawBody, incomingSignature, secretKey)) {
    throw new SimplePayAdapterError('SIMPLEPAY_IPN_SIGNATURE_INVALID');
  }

  const message = parseJsonObject(rawBody, 'SIMPLEPAY_IPN_JSON_INVALID') as SimplePayIpnMessage;
  const expectedMerchant = configuredMerchantId();
  if (String(message.merchant || '').trim() !== expectedMerchant) {
    throw new SimplePayAdapterError('SIMPLEPAY_IPN_MERCHANT_MISMATCH');
  }
  if (!String(message.orderRef || '').trim() || !String(message.transactionId ?? '').trim()) {
    throw new SimplePayAdapterError('SIMPLEPAY_IPN_REFERENCE_MISSING');
  }

  const responsePayload = {
    ...message,
    receiveDate: receivedAt.toISOString(),
  };
  const responseBody = JSON.stringify(responsePayload);
  const responseSignature = signSimplePayBody(responseBody, secretKey);

  return {
    message,
    responseBody,
    responseSignature,
  };
}
