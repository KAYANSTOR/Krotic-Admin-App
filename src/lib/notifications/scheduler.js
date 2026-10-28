import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../firebase';

/**
 * Writes a scheduled request to the dedicated queue. Delivery itself is handled
 * by the server-side dispatcher; this is intentionally not a direct delivery write.
 */
export async function scheduleNotificationRequest({
  title,
  body,
  audienceType,
  targetUid = null,
  scheduledAtMs,
}) {
  if (!Number.isFinite(scheduledAtMs) || scheduledAtMs <= Date.now()) {
    throw new RangeError('scheduled_time_invalid');
  }

  const payload = {
    title,
    body,
    audienceType,
    data: { route: '/account-notifications' },
    scheduledAt: scheduledAtMs,
    status: 'scheduled',
    createdBy: auth.currentUser?.uid || null,
    createdAt: serverTimestamp(),
    ...(audienceType === 'user' && targetUid ? { targetUid } : {}),
  };
  return addDoc(collection(db, 'notification_requests'), payload);
}
