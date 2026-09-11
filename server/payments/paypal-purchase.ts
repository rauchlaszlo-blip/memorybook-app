import crypto from 'crypto';
import { pool } from '../db';
import {
  capturePayPalOrder,
  createPayPalOrder,
  type PayPalCaptureResult,
  type PayPalOrderResult,
} from './paypal';

type DbClient = {
  query: (text: string, params?: any[]) => Promise<any>;
};

type PurchaseRow = {
  id: string;
  purchaseMode: 'self' | 'gift';
  bookType: 'standard' | 'event' | 'dedication';
  includedPages: number;
  purchaserUserId: string | null;
  paymentProvider: string;
  paymentStatus: string;
  providerReference: string | null;
  amountMinor: number | null;
  currency: string | null;
};

export class PayPalPurchaseError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = 'PayPalPurchaseError';
    this.status = status;
  }
}

function normalizeCurrency(value: unknown): string | null {
  const currency = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function purchaseDescription(purchase: PurchaseRow): string {
  if (purchase.bookType === 'event') return 'MemoryBook – event guestbook';
  if (purchase.bookType === 'dedication') return 'MemoryBook – dedication book';
  return `MemoryBook – standard book (${Math.max(1, Number(purchase.includedPages) || 30)} pages)`;
}

async function loadPurchase(purchaseId: string, db: DbClient): Promise<PurchaseRow> {
  const result = await db.query(
    `SELECT
       id,
       purchase_mode AS "purchaseMode",
       book_type AS "bookType",
       included_pages AS "includedPages",
       purchaser_user_id AS "purchaserUserId",
       payment_provider AS "paymentProvider",
       payment_status AS "paymentStatus",
       provider_reference AS "providerReference",
       amount_minor AS "amountMinor",
       currency
     FROM purchases
     WHERE id = $1`,
    [purchaseId]
  );

  if (result.rowCount === 0) {
    throw new PayPalPurchaseError('PURCHASE_NOT_FOUND', 404);
  }

  return result.rows[0] as PurchaseRow;
}

function validatePayPalPurchaseReady(purchase: PurchaseRow): {
  amountMinor: number;
  currency: string;
} {
  if (purchase.paymentProvider !== 'paypal') {
    throw new PayPalPurchaseError('PURCHASE_NOT_PAYPAL');
  }
  if (purchase.paymentStatus === 'paid') {
    throw new PayPalPurchaseError('PURCHASE_ALREADY_PAID');
  }
  if (purchase.paymentStatus === 'cancelled' || purchase.paymentStatus === 'refunded') {
    throw new PayPalPurchaseError('PURCHASE_NOT_PAYABLE');
  }

  const amountMinor = Number(purchase.amountMinor);
  const currency = normalizeCurrency(purchase.currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !currency) {
    throw new PayPalPurchaseError('PURCHASE_AMOUNT_NOT_READY');
  }

  return { amountMinor, currency };
}

export async function createPayPalOrderForPurchase(
  purchaseId: string,
  urls: { returnUrl: string; cancelUrl: string },
  db: DbClient = pool
): Promise<{
  purchaseId: string;
  paymentStatus: 'pending';
  order: PayPalOrderResult;
}> {
  const purchase = await loadPurchase(purchaseId, db);
  const { amountMinor, currency } = validatePayPalPurchaseReady(purchase);

  const order = await createPayPalOrder({
    purchaseId: purchase.id,
    amountMinor,
    currency,
    description: purchaseDescription(purchase),
    returnUrl: urls.returnUrl,
    cancelUrl: urls.cancelUrl,
  });

  if (
    purchase.providerReference &&
    purchase.providerReference !== order.orderId &&
    purchase.paymentStatus === 'pending'
  ) {
    throw new PayPalPurchaseError('PAYPAL_ORDER_REFERENCE_CONFLICT');
  }

  const updated = await db.query(
    `UPDATE purchases
     SET payment_status = 'pending',
         provider_reference = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
       AND payment_provider = 'paypal'
       AND payment_status IN ('draft', 'pending')
     RETURNING id`,
    [order.orderId, purchase.id]
  );

  if (updated.rowCount === 0) {
    throw new PayPalPurchaseError('PURCHASE_PAYMENT_STATE_CHANGED');
  }

  return {
    purchaseId: purchase.id,
    paymentStatus: 'pending',
    order,
  };
}

function validateCaptureAgainstPurchase(
  purchase: PurchaseRow,
  capture: PayPalCaptureResult
): void {
  const amountMinor = Number(purchase.amountMinor);
  const currency = normalizeCurrency(purchase.currency);

  if (capture.orderId !== purchase.providerReference) {
    throw new PayPalPurchaseError('PAYPAL_ORDER_REFERENCE_MISMATCH');
  }
  if (capture.status !== 'COMPLETED' || capture.captureStatus !== 'COMPLETED') {
    throw new PayPalPurchaseError('PAYPAL_CAPTURE_NOT_COMPLETED');
  }
  if (capture.amountMinor !== amountMinor || capture.currency !== currency) {
    throw new PayPalPurchaseError('PAYPAL_CAPTURE_AMOUNT_MISMATCH');
  }
}

async function entitlementForPurchase(purchaseId: string, db: DbClient) {
  const result = await db.query(
    `SELECT
       id,
       purchase_id AS "purchaseId",
       assigned_user_id AS "assignedUserId",
       gift_token AS "giftToken",
       book_type AS "bookType",
       included_pages AS "includedPages",
       status,
       created_at AS "createdAt"
     FROM book_entitlements
     WHERE purchase_id = $1`,
    [purchaseId]
  );
  return result.rows[0] || null;
}

export async function capturePayPalPaymentForPurchase(
  purchaseId: string,
  orderId: string
): Promise<{
  purchaseId: string;
  paymentStatus: 'paid';
  capture: PayPalCaptureResult;
  entitlement: any;
  alreadyFinalized: boolean;
}> {
  const beforeCapture = await loadPurchase(purchaseId, pool);

  if (beforeCapture.paymentProvider !== 'paypal') {
    throw new PayPalPurchaseError('PURCHASE_NOT_PAYPAL');
  }

  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) {
    throw new PayPalPurchaseError('PAYPAL_ORDER_ID_REQUIRED', 400);
  }

  if (
    beforeCapture.providerReference &&
    beforeCapture.providerReference !== normalizedOrderId
  ) {
    throw new PayPalPurchaseError('PAYPAL_ORDER_REFERENCE_MISMATCH');
  }

  if (beforeCapture.paymentStatus === 'paid') {
    const entitlement = await entitlementForPurchase(purchaseId, pool);
    if (!entitlement) {
      throw new PayPalPurchaseError('PAID_PURCHASE_ENTITLEMENT_MISSING', 500);
    }

    return {
      purchaseId,
      paymentStatus: 'paid',
      capture: {
        orderId: beforeCapture.providerReference || normalizedOrderId,
        status: 'COMPLETED',
        captureId: '',
        captureStatus: 'COMPLETED',
        amountMinor: Number(beforeCapture.amountMinor),
        currency: normalizeCurrency(beforeCapture.currency) || '',
        capturedAt: null,
        providerResponse: { alreadyFinalized: true },
      },
      entitlement,
      alreadyFinalized: true,
    };
  }

  if (beforeCapture.paymentStatus !== 'pending') {
    throw new PayPalPurchaseError('PAYPAL_ORDER_NOT_PENDING');
  }

  if (!beforeCapture.providerReference) {
    throw new PayPalPurchaseError('PAYPAL_ORDER_REFERENCE_MISSING');
  }

  const capture = await capturePayPalOrder(normalizedOrderId);
  validateCaptureAgainstPurchase(beforeCapture, capture);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await loadPurchase(purchaseId, client);

    if (locked.paymentProvider !== 'paypal') {
      throw new PayPalPurchaseError('PURCHASE_NOT_PAYPAL');
    }
    if (locked.providerReference !== capture.orderId) {
      throw new PayPalPurchaseError('PAYPAL_ORDER_REFERENCE_MISMATCH');
    }

    if (locked.paymentStatus === 'paid') {
      const existingEntitlement = await entitlementForPurchase(purchaseId, client);
      if (!existingEntitlement) {
        throw new PayPalPurchaseError('PAID_PURCHASE_ENTITLEMENT_MISSING', 500);
      }
      await client.query('COMMIT');
      return {
        purchaseId,
        paymentStatus: 'paid',
        capture,
        entitlement: existingEntitlement,
        alreadyFinalized: true,
      };
    }

    if (locked.paymentStatus !== 'pending') {
      throw new PayPalPurchaseError('PURCHASE_PAYMENT_STATE_CHANGED');
    }

    validateCaptureAgainstPurchase(locked, capture);

    if (locked.purchaseMode === 'self' && !locked.purchaserUserId) {
      throw new PayPalPurchaseError('SELF_PURCHASE_USER_MISSING', 500);
    }

    const paidAt = capture.capturedAt && Number.isFinite(new Date(capture.capturedAt).getTime())
      ? new Date(capture.capturedAt).toISOString()
      : new Date().toISOString();

    await client.query(
      `UPDATE purchases
       SET payment_status = 'paid',
           paid_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [paidAt, purchaseId]
    );

    const entitlementId = `entitlement-${crypto.randomUUID()}`;
    const giftToken = locked.purchaseMode === 'gift' ? `gift-${crypto.randomUUID()}` : null;

    await client.query(
      `INSERT INTO book_entitlements (
         id,
         purchase_id,
         assigned_user_id,
         gift_token,
         book_type,
         included_pages,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'available')
       ON CONFLICT (purchase_id) DO NOTHING`,
      [
        entitlementId,
        purchaseId,
        locked.purchaseMode === 'self' ? locked.purchaserUserId : null,
        giftToken,
        locked.bookType,
        Number(locked.includedPages) || 0,
      ]
    );

    const entitlement = await entitlementForPurchase(purchaseId, client);
    if (!entitlement) {
      throw new PayPalPurchaseError('ENTITLEMENT_CREATE_FAILED', 500);
    }

    await client.query('COMMIT');
    return {
      purchaseId,
      paymentStatus: 'paid',
      capture,
      entitlement,
      alreadyFinalized: false,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
