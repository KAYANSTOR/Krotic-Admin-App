function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Return the identifiers that can identify one sale across legacy and current
 * network collections. The first available identifier is the preferred key,
 * while all available aliases are useful when reconciling two snapshots.
 */
export function saleIdentityKeys(sale = {}) {
  const keys = [];
  const saleUuid = nonEmptyString(sale.saleUuid);
  const saleId = nonEmptyString(sale.saleId);
  const documentId = nonEmptyString(sale.id);
  if (saleUuid) keys.push(`saleUuid:${saleUuid}`);
  if (saleId) keys.push(`saleId:${saleId}`);
  if (documentId) keys.push(`documentId:${documentId}`);
  return keys;
}

/**
 * Firestore path order is significant: records from the current networkId
 * path are inserted first, so a duplicate from the uid path cannot replace
 * the current record.
 */
export function mergeSalesByIdentity(currentSales = [], legacySales = []) {
  const merged = [];
  const identityToIndex = new Map();
  const append = (records) => {
    records.forEach((sale) => {
      const keys = saleIdentityKeys(sale);
      const existingIndex = keys.map((key) => identityToIndex.get(key)).find((index) => index !== undefined);
      if (existingIndex !== undefined) {
        keys.forEach((key) => identityToIndex.set(key, existingIndex));
        return;
      }
      const index = merged.length;
      merged.push(sale);
      keys.forEach((key) => identityToIndex.set(key, index));
    });
  };
  append(currentSales);
  append(legacySales);
  return merged;
}

export function salesNetworkIds(uid, networkId) {
  const ids = [nonEmptyString(networkId), nonEmptyString(uid)].filter(Boolean);
  return [...new Set(ids)];
}
