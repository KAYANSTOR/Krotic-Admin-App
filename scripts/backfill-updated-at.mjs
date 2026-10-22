import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';

const PAGE_SIZE = 400;
const APPLY = process.argv.includes('--apply');
const projectArgument = process.argv.find((argument) => argument.startsWith('--project='));
const confirmArgument = process.argv.find((argument) => argument.startsWith('--confirm-project='));
const projectId = projectArgument?.slice('--project='.length)
  || process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT;

if (!projectId) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT or pass --project=<project-id>; no Firebase project was selected.');
}
if (APPLY && confirmArgument?.slice('--confirm-project='.length) !== projectId) {
  throw new Error('Apply mode requires --confirm-project=<same-project-id> as an additional safeguard.');
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const targets = [
  { name: 'users', query: () => db.collection('users') },
  { name: 'networks', query: () => db.collection('networks') },
  { name: 'sales', query: () => db.collectionGroup('sales') },
  { name: 'payments', query: () => db.collectionGroup('payments') },
  { name: 'admin_aggregates', query: () => db.collection('admin_aggregates') },
  { name: 'app_settings', query: () => db.collection('app_settings') },
];

function timestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.isFinite(value) ? value : null;
}

function bestMs(data) {
  for (const value of [
    data.updatedAtMs,
    data.createdAtMs,
    data.ingestedAtMs,
    data.recordedAtMs,
    data.updatedAt,
    data.createdAt,
    data.created_at,
    data.verifiedAt,
    data.timestamp,
    data.last_seen_at,
  ]) {
    const millis = timestampMs(value);
    if (millis !== null && millis > 0) return millis;
  }
  return 1;
}

console.log(`Firestore updatedAtMs backfill: project=${projectId} mode=${APPLY ? 'apply' : 'dry-run'}`);

for (const target of targets) {
  let cursor = null;
  let scanned = 0;
  let missing = 0;
  let noDate = 0;

  for (;;) {
    let query = target.query().orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let pageMissing = 0;
    for (const document of snapshot.docs) {
      scanned += 1;
      if (document.get('updatedAtMs') !== undefined) continue;
      missing += 1;
      pageMissing += 1;
      const updatedAtMs = bestMs(document.data() || {});
      if (updatedAtMs === 1) noDate += 1;
      if (APPLY) batch.update(document.ref, { updatedAtMs });
    }

    if (APPLY && pageMissing > 0) await batch.commit();
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  console.log(`${target.name}: scanned=${scanned} missing=${missing} noDate=${noDate} ${APPLY ? 'applied' : 'dry-run'}`);
}