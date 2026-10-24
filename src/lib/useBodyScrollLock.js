import { useEffect } from 'react';

// قفل موحّد لتمرير الخلفية يمكن استخدامه من أكثر من طبقة (قائمة جانبية، لوحة سفلية)
// دون أن يلغي أحدها تأثير الآخر. النوافذ المنبثقة تحتفظ بقفلها الخاص في Modal.
let activeLocks = 0;
let previousOverflow = '';

export default function useBodyScrollLock(locked) {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return undefined;
    const body = document.body;
    if (activeLocks === 0) {
      previousOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    }
    activeLocks += 1;
    return () => {
      activeLocks = Math.max(0, activeLocks - 1);
      if (activeLocks === 0) body.style.overflow = previousOverflow;
    };
  }, [locked]);
}
