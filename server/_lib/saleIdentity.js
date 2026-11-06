import { createHash } from 'node:crypto';

/**
 * Sale identity contract shared by every server path that receives a sale id
 * from the Android app (sales ingest).
 *
 * The app may use dotted ids (e.g. wallet references like `7850.73`), so the
 * accepted alphabet is `[A-Za-z0-9._-]`, 1..128 chars. One rule, one module:
 * a sale accepted by ingest is never rejected later by delivery.
 */
export const MAX_SALE_ID_LENGTH = 128;
export const SALE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Ids stored before dotted ids were accepted keep their raw document name. */
const LEGACY_SALE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidSaleId(value) {
  return typeof value === 'string' && SALE_ID_PATTERN.test(value);
}

/**
 * Stable Firestore document id for a sale. Legacy ids stay as-is to preserve
 * existing idempotency records; other valid ids map to a sha256 digest.
 */
export function saleDocumentId(saleUuid) {
  if (LEGACY_SALE_ID_PATTERN.test(saleUuid)) return saleUuid;
  return createHash('sha256').update(`sale_uuid:${saleUuid}`).digest('hex');
}
