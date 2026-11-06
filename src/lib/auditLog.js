import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase.js';
import { AUDIT_ACTION_META } from './auditActions.js';

export {
  AUDIT_ACTION_META, AUDIT_ACTIONS, normalizeAuditAction, auditActionLabel, auditActionTone,
} from './auditActions.js';

/**
 * سجل تدقيق إداري: يوثّق كل إجراء مؤثر يقوم به المدير.
 * الكتابة best-effort: فشل التسجيل لا يُفشل الإجراء الأصلي.
 */
export const AUDIT_COLLECTION = 'admin_audit_logs';

export async function logAdminAction({ action, targetType, targetId, targetLabel, details }) {
  if (!Object.hasOwn(AUDIT_ACTION_META, action)) {
    console.warn('audit log: unknown action key', action);
    return false;
  }
  const actor = auth.currentUser;
  const now = Date.now();
  try {
    await addDoc(collection(db, AUDIT_COLLECTION), {
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      targetLabel: targetLabel || null,
      details: details || null,
      actorUid: actor?.uid || null,
      actorEmail: actor?.email || null,
      createdAt: serverTimestamp(),
      createdAtMs: now,
      // المزامنة التزايدية تقرأ admin_audit_logs بحقل updatedAtMs؛ غيابه يجعل
      // الحدث غير مرئي في شاشة «سجل العمليات» إلى الأبد.
      updatedAtMs: now,
    });
    return true;
  } catch (error) {
    // لا نُفشل الإجراء الأصلي بسبب تعذّر التسجيل.
    console.warn('audit log write failed', error);
    return false;
  }
}
