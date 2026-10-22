/**
 * ناقل أحداث بسيط للمزامنة: يتيح لواجهة المستخدم أن تعرف بالصفوف الجديدة
 * دون أي مستمع Firestore (onSnapshot).
 */
const listeners = new Set();

/** يسجّل مستمعاً لأحداث المزامنة. يعيد دالة لإلغاء الاشتراك. */
export function onSyncEvent(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** يبث حدث مزامنة إلى كل المستمعين. */
export function emitSyncEvent(event) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error('Sync event listener failed:', error);
    }
  });
}

export default onSyncEvent;
