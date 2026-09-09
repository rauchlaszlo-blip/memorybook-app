import crypto from 'crypto';
import { pool } from '../db';
import {
  startSimplePayTransaction,
  type SimplePayIpnMessage,
  type SimplePayStartResult,
} from './simplepay';

type DbClient = {
  query: (text: string, params?: any[]) => Promise<any>;
};

type PurchaseRow = {
  id: string;
  purchaseMode: 'self' | 'gift';
  bookType: 'standard' | 'event';
  includedPages: number;
  purchaserUserId: string | null;
  purchaserEmail: string;
  paymentProvider: string;
  paymentStatus: string;
  providerReference: string | null;
  amountMinor: number | null;
  currency: string | null;
};

export class SimplePayPurchaseError extends Error {
  status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.name = 'SimplePayPurchaseError';
    this.status = status;
  }
}

function normalizeCurrency(value: unknown): string | null {
  const currency = String(value || '').trim().toUpperCase();
  return /^(HUF|EUR|USD)$/.test(currency) ? currency : null;
}

async function loadPurchase(purchaseId: string, db: DbClient): Promise<PurchaseRow> {
  const result = await db.query(
    `SELECT
       id,
       purchase_mode AS "purchaseMode",
       book_type AS "bookType",
       included_pages AS "includedPages",
       purchaser_user_id AS "purchaserUserId",
       purchaser_email AS "purchaserEmail",
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
    throw new SimplePayPurchaseError('PURCHASE_NOT_FOUND', 404);
  }

  return result.rows[0] as PurchaseRow;
}

function validateSimplePayPurchaseReady(purchase: PurchaseRow): {
  amountMinor: number;
  currency: string;
} {
  if (purchase.paymentProvider !== 'simplepay') {
    throw new SimplePayPurchaseError('PURCHASE_NOT_SIMPLEPAY');
  }
  if (purchase.paymentStatus === 'paid') {
    throw new SimplePayPurchaseError('PURCHASE_ALREADY_PAID');
  }
  if (purchase.paymentStatus === 'cancelled' || purchase.paymentStatus === 'refunded') {
    throw new SimplePayPurchaseError('PURCHASE_NOT_PAYABLE');
  }

  const amountMinor = Number(purchase.amountMinor);
  const currency = normalizeCurrency(purchase.currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !currency) {
    throw new SimplePayPurchaseError('PURCHASE_AMOUNT_NOT_READY');
  }
  if (!purchase.purchaserEmail || !purchase.purchaserEmail.includes('@')) {
    throw new SimplePayPurchaseError('PURCHASE_EMAIL_NOT_READY');
  }

  return { amountMinor, currency };
}

export async function createSimplePayTransactionForPurchase(
  purchaseId: string,
  redirectUrl: string,
  db: DbClient = pool
): Promise<{
  purchaseId: string;
  paymentStatus: 'pending';
  transaction: SimplePayStartResult;
}> {
  const purchase = await loadPurchase(purchaseId, db);
  const { amountMinor, currency } = validateSimplePayPurchaseReady(purchase);

  const transaction = await startSimplePayTransaction({
    purchaseId: purchase.id,
    amountMinor,
    currency,
    customerEmail: purchase.purchaserEmail,
    language: 'HU',
    redirectUrl,
  });

  if (
    purchase.providerReference &&
    purchase.providerReference !== transaction.transactionId &&
    purchase.paymentStatus === 'pending'
  ) {
    throw new SimplePayPurchaseError('SIMPLEPAY_TRANSACTION_REFERENCE_CONFLICT');
  }

  const updated = await db.query(
    `UPDATE purchases
     SET payment_status = 'pending',
         provider_reference = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
       AND payment_provider = 'simplepay'
       AND payment_status IN ('draft', 'pending')
     RETURNING id`,
    [transaction.transactionId, purchase.id]
  );

  if (updated.rowCount === 0) {
    throw new SimplePayPurchaseError('PURCHASE_PAYMENT_STATE_CHANGED');
  }

  return {
    purchaseId: purchase.id,
    paymentStatus: 'pending',
    transaction,
  };
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

function ipnTransactionId(message: SimplePayIpnMessage): string {
  return String(message.transactionId ?? '').trim();
}

function validPaidAt(message: SimplePayIpnMessage): string {
  const candidate = String(message.paymentDate || message.finishDate || '').trim();
  if (candidate && Number.isFinite(new Date(candidate).getTime())) {
    return new Date(candidate).toISOString();
  }
  return new Date().toISOString();
}

export async function finalizeSimplePayPurchaseFromIpn(
  message: SimplePayIpnMessage
): Promise<{
  purchaseId: string;
  paymentStatus: 'paid' | 'pending';
  providerStatus: string;
  entitlement: any | null;
  alreadyFinalized: boolean;
}> {
  const purchaseId = String(message.orderRef || '').trim();
  const transactionId = ipnTransactionId(message);
  const providerStatus = String(message.status || '').trim().toUpperCase();

  if (!purchaseId || !transactionId) {
    throw new SimplePayPurchaseError('SIMPLEPAY_IPN_REFERENCE_MISSING', 400);
  }

  const beforeFinalize = await loadPurchase(purchaseId, pool);
  if (beforeFinalize.paymentProvider !== 'simplepay') {
    throw new SimplePayPurchaseError('PURCHASE_NOT_SIMPLEPAY');
  }
  if (beforeFinalize.providerReference !== transactionId) {
    throw new SimplePayPurchaseError('SIMPLEPAY_TRANSACTION_REFERENCE_MISMATCH');
  }

  if (beforeFinalize.paymentStatus === 'paid') {
    const entitlement = await entitlementForPurchase(purchaseId, pool);
    if (!entitlement) {
      throw new SimplePayPurchaseError('PAID_PURCHASE_ENTITLEMENT_MISSING', 500);
    }
    return {
      purchaseId,
      paymentStatus: 'paid',
      providerStatus,
      entitlement,
      alreadyFinalized: true,
    };
  }

  if (providerStatus !== 'FINISHED') {
    return {
      purchaseId,
      paymentStatus: 'pending',
      providerStatus,
      entitlement: null,
      alreadyFinalized: false,
    };
  }

  if (beforeFinalize.paymentStatus !== 'pending') {
    throw new SimplePayPurchaseError('SIMPLEPAY_TRANSACTION_NOT_PENDING');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await loadPurchase(purchaseId, client);

    if (locked.paymentProvider !== 'simplepay') {
      throw new SimplePayPurchaseError('PURCHASE_NOT_SIMPLEPAY');
    }
    if (locked.providerReference !== transactionId) {
      throw new SimplePayPurchaseError('SIMPLEPAY_TRANSACTION_REFERENCE_MISMATCH');
    }

    if (locked.paymentStatus === 'paid') {
      const existingEntitlement = await entitlementForPurchase(purchaseId, client);
      if (!existingEntitlement) {
        throw new SimplePayPurchaseError('PAID_PURCHASE_ENTITLEMENT_MISSING', 500);
      }
      await client.query('COMMIT');
      return {
        purchaseId,
        paymentStatus: 'paid',
        providerStatus,
        entitlement: existingEntitlement,
        alreadyFinalized: true,
      };
    }

    if (locked.paymentStatus !== 'pending') {
      throw new SimplePayPurchaseError('PURCHASE_PAYMENT_STATE_CHANGED');
    }
    if (locked.purchaseMode === 'self' && !locked.purchaserUserId) {
      throw new SimplePayPurchaseError('SELF_PURCHASE_USER_MISSING', 500);
    }

    await client.query(
      `UPDATE purchases
       SET payment_status = 'paid',
           paid_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [validPaidAt(message), purchaseId]
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
      throw new SimplePayPurchaseError('ENTITLEMENT_CREATE_FAILED', 500);
    }

    await client.query('COMMIT');
    return {
      purchaseId,
      paymentStatus: 'paid',
      providerStatus,
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
