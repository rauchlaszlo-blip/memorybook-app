import crypto from 'crypto';

export type PayPalEnvironment = 'sandbox' | 'live';

export type CreatePayPalOrderInput = {
  purchaseId: string;
  amountMinor: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
};

export type PayPalOrderResult = {
  orderId: string;
  status: string;
  approvalUrl: string;
  providerResponse: Record<string, unknown>;
};

export type PayPalCaptureResult = {
  orderId: string;
  status: string;
  captureId: string;
  captureStatus: string;
  amountMinor: number;
  currency: string;
  capturedAt: string | null;
  providerResponse: Record<string, unknown>;
};

type PayPalLink = {
  href?: string;
  rel?: string;
  method?: string;
};

type PayPalAmount = {
  currency_code?: string;
  value?: string;
};

type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: PayPalAmount;
  create_time?: string;
  update_time?: string;
};

type PayPalPurchaseUnit = {
  reference_id?: string;
  custom_id?: string;
  payments?: {
    captures?: PayPalCapture[];
  };
};

type PayPalOrder = {
  id?: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: PayPalPurchaseUnit[];
};

type PayPalOAuthResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

export class PayPalAdapterError extends Error {
  status?: number;
  providerName?: string;
  providerIssue?: string;
  providerBody?: unknown;

  constructor(
    message: string,
    options: {
      status?: number;
      providerName?: string;
      providerIssue?: string;
      providerBody?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'PayPalAdapterError';
    this.status = options.status;
    this.providerName = options.providerName;
    this.providerIssue = options.providerIssue;
    this.providerBody = options.providerBody;
  }
}

const PAYPAL_SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com';
const PAYPAL_LIVE_BASE_URL = 'https://api-m.paypal.com';
const ZERO_DECIMAL_CURRENCIES = new Set(['HUF', 'JPY', 'TWD']);

let tokenCache: {
  environment: PayPalEnvironment;
  clientId: string;
  accessToken: string;
  expiresAt: number;
} | null = null;

function configuredEnvironment(): PayPalEnvironment {
  return String(process.env.PAYPAL_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'live'
    ? 'live'
    : 'sandbox';
}

function requiredCredential(name: 'PAYPAL_CLIENT_ID' | 'PAYPAL_CLIENT_SECRET'): string {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new PayPalAdapterError(`MISSING_${name}`);
  }
  return value;
}

function apiBaseUrl(environment: PayPalEnvironment): string {
  const override = String(process.env.PAYPAL_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;
  return environment === 'live' ? PAYPAL_LIVE_BASE_URL : PAYPAL_SANDBOX_BASE_URL;
}

function ensureEnvironmentAllowed(environment: PayPalEnvironment): void {
  if (environment === 'live' && process.env.PAYPAL_LIVE_ENABLED !== 'true') {
    throw new PayPalAdapterError('PAYPAL_LIVE_NOT_ENABLED');
  }
}

function currencyCode(value: string): string {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PayPalAdapterError('INVALID_PAYPAL_CURRENCY');
  }
  return currency;
}

function fractionDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currencyCode(currency)) ? 0 : 2;
}

function minorToPayPalValue(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new PayPalAdapterError('INVALID_PAYPAL_AMOUNT');
  }

  const digits = fractionDigits(currency);
  if (digits === 0) return String(amountMinor);

  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  return `${major}.${String(minor).padStart(2, '0')}`;
}

function paypalValueToMinor(value: string, currency: string): number {
  const digits = fractionDigits(currency);
  const normalized = String(value || '').trim();

  if (digits === 0) {
    if (!/^\d+$/.test(normalized)) {
      throw new PayPalAdapterError('INVALID_PAYPAL_CAPTURE_AMOUNT');
    }
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount)) {
      throw new PayPalAdapterError('INVALID_PAYPAL_CAPTURE_AMOUNT');
    }
    return amount;
  }

  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new PayPalAdapterError('INVALID_PAYPAL_CAPTURE_AMOUNT');
  }

  const major = Number(match[1]);
  const minor = Number(String(match[2] || '').padEnd(2, '0'));
  const result = major * 100 + minor;
  if (!Number.isSafeInteger(result)) {
    throw new PayPalAdapterError('INVALID_PAYPAL_CAPTURE_AMOUNT');
  }
  return result;
}

function stableRequestId(scope: 'create' | 'capture', value: string): string {
  const hex = crypto.createHash('sha256').update(`${scope}:${value}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function providerErrorDetails(body: unknown): { providerName?: string; providerIssue?: string } {
  if (!body || typeof body !== 'object') return {};
  const data = body as any;
  const firstDetail = Array.isArray(data.details) ? data.details[0] : null;
  return {
    providerName: data.name ? String(data.name) : undefined,
    providerIssue: firstDetail?.issue
      ? String(firstDetail.issue)
      : data.message
        ? String(data.message)
        : undefined,
  };
}

async function accessToken(environment: PayPalEnvironment): Promise<string> {
  ensureEnvironmentAllowed(environment);
  const clientId = requiredCredential('PAYPAL_CLIENT_ID');
  const clientSecret = requiredCredential('PAYPAL_CLIENT_SECRET');

  if (
    tokenCache &&
    tokenCache.environment === environment &&
    tokenCache.clientId === clientId &&
    tokenCache.expiresAt > Date.now() + 60_000
  ) {
    return tokenCache.accessToken;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const response = await fetch(`${apiBaseUrl(environment)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    const details = providerErrorDetails(body);
    throw new PayPalAdapterError('PAYPAL_OAUTH_FAILED', {
      status: response.status,
      ...details,
      providerBody: body,
    });
  }

  const token = body as PayPalOAuthResponse;
  if (!token?.access_token) {
    throw new PayPalAdapterError('PAYPAL_ACCESS_TOKEN_MISSING', { providerBody: body });
  }

  const expiresInSeconds = Number(token.expires_in) || 300;
  tokenCache = {
    environment,
    clientId,
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max(60, expiresInSeconds) * 1000,
  };

  return token.access_token;
}

async function paypalRequest<T>(
  path: string,
  init: RequestInit,
  requestId?: string
): Promise<T> {
  const environment = configuredEnvironment();
  const token = await accessToken(environment);
  const response = await fetch(`${apiBaseUrl(environment)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await parseResponseBody(response);

  if (!response.ok) {
    const details = providerErrorDetails(body);
    throw new PayPalAdapterError('PAYPAL_API_REQUEST_FAILED', {
      status: response.status,
      ...details,
      providerBody: body,
    });
  }

  return body as T;
}

export function getPayPalCapabilities() {
  const environment = configuredEnvironment();
  const missingConfiguration: string[] = [];
  if (!String(process.env.PAYPAL_CLIENT_ID || '').trim()) missingConfiguration.push('PAYPAL_CLIENT_ID');
  if (!String(process.env.PAYPAL_CLIENT_SECRET || '').trim()) missingConfiguration.push('PAYPAL_CLIENT_SECRET');
  if (environment === 'live' && process.env.PAYPAL_LIVE_ENABLED !== 'true') {
    missingConfiguration.push('PAYPAL_LIVE_ENABLED');
  }

  return {
    environment,
    credentialsConfigured: missingConfiguration.every((value) => value === 'PAYPAL_LIVE_ENABLED')
      ? Boolean(String(process.env.PAYPAL_CLIENT_ID || '').trim()) && Boolean(String(process.env.PAYPAL_CLIENT_SECRET || '').trim())
      : missingConfiguration.length === 0,
    liveRequested: environment === 'live',
    liveEnabled: environment === 'live' && process.env.PAYPAL_LIVE_ENABLED === 'true',
    enabled: missingConfiguration.length === 0,
    missingConfiguration,
  };
}

export async function createPayPalOrder(
  input: CreatePayPalOrderInput
): Promise<PayPalOrderResult> {
  const currency = currencyCode(input.currency);
  const order = await paypalRequest<PayPalOrder>(
    '/v2/checkout/orders',
    {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: input.purchaseId,
            custom_id: input.purchaseId,
            description: input.description,
            amount: {
              currency_code: currency,
              value: minorToPayPalValue(input.amountMinor, currency),
            },
          },
        ],
        application_context: {
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
          user_action: 'PAY_NOW',
        },
      }),
    },
    stableRequestId('create', input.purchaseId)
  );

  const approvalUrl =
    order.links?.find((link) => link.rel === 'approve' || link.rel === 'payer-action')?.href || '';
  if (!order.id || !approvalUrl) {
    throw new PayPalAdapterError('PAYPAL_ORDER_RESPONSE_INCOMPLETE', { providerBody: order });
  }

  return {
    orderId: order.id,
    status: String(order.status || 'CREATED'),
    approvalUrl,
    providerResponse: {
      id: order.id,
      status: order.status || null,
      approvalUrl,
    },
  };
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResult> {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) {
    throw new PayPalAdapterError('PAYPAL_ORDER_ID_REQUIRED');
  }

  const order = await paypalRequest<PayPalOrder>(
    `/v2/checkout/orders/${encodeURIComponent(normalizedOrderId)}/capture`,
    { method: 'POST', body: '{}' },
    stableRequestId('capture', normalizedOrderId)
  );

  const captures = order.purchase_units?.flatMap((unit) => unit.payments?.captures || []) || [];
  const capture = captures.find((item) => item.status === 'COMPLETED') || captures[0];
  const captureCurrency = currencyCode(capture?.amount?.currency_code || '');

  if (!order.id || !capture?.id || !capture.amount?.value) {
    throw new PayPalAdapterError('PAYPAL_CAPTURE_RESPONSE_INCOMPLETE', { providerBody: order });
  }

  return {
    orderId: order.id,
    status: String(order.status || ''),
    captureId: capture.id,
    captureStatus: String(capture.status || ''),
    amountMinor: paypalValueToMinor(capture.amount.value, captureCurrency),
    currency: captureCurrency,
    capturedAt: capture.create_time || capture.update_time || null,
    providerResponse: {
      orderId: order.id,
      orderStatus: order.status || null,
      captureId: capture.id,
      captureStatus: capture.status || null,
      amount: capture.amount,
      capturedAt: capture.create_time || capture.update_time || null,
    },
  };
}
