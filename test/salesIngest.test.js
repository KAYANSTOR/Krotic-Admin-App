import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIngestInput,
  ingestSale,
  canonicalSalePayload,
  computePayloadHash,
  canonicalReceiptPayload,
  createInternalReceipt,
  verifyInternalReceipt,
} from '../api/sales/ingest.js';

const validBody = {
  saleId: 'sale_abc-123',
  amountMinor: 1500,
  currencyCode: 'yer',
  createdMs: 1_700_000_000_000,
  customerId: 'cust-1',
  cardId: 'card-9',
};

class FakeDocumentReference {
  constructor(db,path){this.db=db;this.path=path;}
  collection(name){return new FakeCollectionReference(this.db,`${this.path}/${name}`);}
}
class FakeCollectionReference {
  constructor(db,path){this.db=db;this.path=path;}
  doc(id){return new FakeDocumentReference(this.db,`${this.path}/${id}`);}
}
class FakeFirestore {
  constructor(){this.docs=new Map();}
  collection(name){return new FakeCollectionReference(this,name);}
  async runTransaction(callback){
    const writes=[]; let firstWrite=false;
    const tx={
      get:async ref=>{if(firstWrite)throw new Error('test caught Firestore read after write');const v=this.docs.get(ref.path);return {exists:v!==undefined,data:()=>v};},
      set:(ref,value,options={})=>{firstWrite=true;writes.push({ref,value,options});},
    };
    const result=await callback(tx);
    for(const {ref,value,options} of writes){const old=this.docs.get(ref.path)||{};this.docs.set(ref.path,options.merge?{...old,...value}:value);}
    return result;
  }
}
function ingestArgs(db,overrides={}){
 return {db,uid:'user-1',networkId:'NET-10001',
  payload:{saleId:'sale-1',saleUuid:'sale-1',amountMinor:500,amountRiyal:500,currencyCode:'YER',customerId:'customer-1',cardId:'card-1',createdMs:1700000000000},
  payloadHash:'hash-a',receipt:'verified-receipt',commissionRateBps:500,...overrides};
}
test('new sale reads all transaction documents before writing and stores whole-Riyal totals',async()=>{
 const db=new FakeFirestore();db.docs.set('networks/NET-10001',{totalSalesAmount:1000,totalCommissionDue:50,totalPaidAmount:20,outstandingBalance:30});
 const result=await ingestSale(ingestArgs(db));
 assert.equal(result.status,'created');assert.equal(result.amountRiyal,500);assert.equal(result.commissionRiyal,25);
 const sale=db.docs.get('networks/NET-10001/sales/sale-1');
 assert.equal(sale.amountMinor,500);assert.equal(sale.amountRiyal,500);assert.equal(sale.faceValue,500);assert.equal(sale.netAmount,475);
 assert.equal(sale.commissionMinor,25);assert.equal(sale.commissionRiyal,25);assert.equal(sale.moneyPolicyVersion,2);
 const network=db.docs.get('networks/NET-10001');
 assert.equal(network.totalSalesAmount,1500);assert.equal(network.totalCommissionDue,75);assert.equal(network.totalPaidAmount,20);assert.equal(network.outstandingBalance,55);
});
test('same current-version sale gets ACK without changing totals; changed payload conflicts',async()=>{
 const db=new FakeFirestore();db.docs.set('networks/NET-10001',{totalSalesAmount:500,totalCommissionDue:25,totalPaidAmount:0,outstandingBalance:25});
 db.docs.set('networks/NET-10001/sales/sale-1',{saleId:'sale-1',saleUuid:'sale-1',payloadHash:'hash-a',moneyPolicyVersion:2,amountRiyal:500,commissionRiyal:25});
 const dup=await ingestSale(ingestArgs(db));assert.equal(dup.status,'ALREADY_EXISTS_ACKED');assert.equal(dup.samePayload,true);
 const orig=ingestArgs(db);
 const conflict=await ingestSale(ingestArgs(db,{payloadHash:'hash-b',payload:{...orig.payload,amountMinor:600,amountRiyal:600}}));
 assert.equal(conflict.status,'conflict');assert.equal(conflict.error,'sale_id_payload_conflict');
 assert.equal(db.docs.get('networks/NET-10001').totalSalesAmount,500);
 assert.equal(db.docs.get('sale_ingest_registry/user-1_sale-1').reason,'sale_id_payload_conflict');
});
test('legacy sale with matching hash needs reconciliation and is not falsely ACKed',async()=>{
 const db=new FakeFirestore();db.docs.set('networks/NET-10001/sales/sale-1',{saleId:'sale-1',payloadHash:'hash-a',payloadPolicyVersion:1,amount:500});
 const result=await ingestSale(ingestArgs(db));assert.equal(result.status,'conflict');assert.equal(result.error,'legacy_sale_schema_requires_reconciliation');
});

test('accepts a well-formed sale payload and normalizes the currency', () => {
  const result = validateIngestInput(validBody);
  assert.equal(result.ok, true);
  assert.equal(result.value.currencyCode, 'YER');
  assert.equal(result.value.amountMinor, 1500);
  assert.equal(result.value.amountRiyal, 1500);
});

test('rejects malformed sale ids, amounts, currency, and timestamps', () => {
  assert.equal(validateIngestInput({ ...validBody, saleId: '' }).error, 'sale_id_required');
  assert.equal(validateIngestInput({ ...validBody, saleId: 'bad id!' }).error, 'sale_id_invalid');
  assert.equal(validateIngestInput({ ...validBody, amountMinor: 0 }).error, 'amount_invalid');
  // YER uses whole integer Riyals; a decimal is invalid, not multiples of 100.
  assert.equal(validateIngestInput({ ...validBody, amountMinor: 12.5 }).error, 'amount_invalid');
  assert.equal(validateIngestInput({ ...validBody, currencyCode: '' }).error, 'currency_invalid');
  assert.equal(validateIngestInput({ ...validBody, createdMs: 0 }).error, 'created_at_invalid');
});

test('payload hash is stable, server-side, and changes with content', () => {
  const payload = { ...validBody, uid: 'user-1' };
  const hash = computePayloadHash(payload);
  assert.equal(hash.length, 64);
  assert.equal(hash, computePayloadHash({ ...validBody, uid: 'user-1' }));
  assert.notEqual(hash, computePayloadHash({ ...validBody, uid: 'user-2' }));
  assert.notEqual(hash, computePayloadHash({ ...validBody, uid: 'user-1', amountMinor: 1501 }));
});

test('canonical representation pins the uid and field order', () => {
  const canonical = canonicalSalePayload({ ...validBody, uid: 'user-1' });
  assert.match(canonical, /"uid":"user-1"/);
  assert.equal(canonical, JSON.stringify({
    saleId: validBody.saleId,
    uid: 'user-1',
    amountMinor: validBody.amountMinor,
    currencyCode: validBody.currencyCode,
    customerId: validBody.customerId,
    cardId: validBody.cardId,
    createdMs: validBody.createdMs,
  }));
});

test('internal HMAC receipt verifies the exact sale payload and expires', () => {
  const payload = { ...validBody, uid: 'user-1', currencyCode: 'YER' };
  const timestamp = 1_700_000_000_000;
  const secret = 'staging-only-test-secret';
  const token = createInternalReceipt({ payload, timestamp, secret });

  assert.equal(canonicalReceiptPayload(payload, timestamp).startsWith(`${timestamp}.`), true);
  assert.equal(verifyInternalReceipt({ token, payload, secret, now: timestamp }).ok, true);
  assert.equal(verifyInternalReceipt({
    token,
    payload: { ...payload, amountMinor: 1501 },
    secret,
    now: timestamp,
  }).error, 'hmac_invalid');
  assert.equal(verifyInternalReceipt({
    token,
    payload,
    secret,
    now: timestamp + 6 * 60 * 1000,
  }).error, 'hmac_expired_or_malformed');
});

test('an HMAC receipt from another network key is rejected', () => {
  const payload = { ...validBody, uid: 'user-1', currencyCode: 'YER' };
  const timestamp = 1_700_000_000_000;
  const receipt = createInternalReceipt({ payload, timestamp, secret: 'network-secret-one' });
  assert.equal(verifyInternalReceipt({ token: receipt, payload, secret: 'network-secret-one', now: timestamp }).ok, true);
  assert.equal(verifyInternalReceipt({ token: receipt, payload, secret: 'network-secret-two', now: timestamp }).error, 'hmac_invalid');
});
