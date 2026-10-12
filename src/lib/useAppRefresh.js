import { useEffect, useRef } from 'react';

/**
 * يشترك في حدث التحديث العام `krotak:refresh` (يطلقه السحب للأسفل على الجوال
 * أو عودة الاتصال) وينفّذ أحدث مُعالج دون الحاجة لتثبيت المرجع.
 */
export default function useAppRefresh(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = () => { handlerRef.current?.(); };
    window.addEventListener('krotak:refresh', listener);
    return () => window.removeEventListener('krotak:refresh', listener);
  }, []);
}

export function emitAppRefresh() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('krotak:refresh'));
}
