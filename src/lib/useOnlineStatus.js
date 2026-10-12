import { useEffect, useState } from 'react';

/**
 * يتتبّع حالة اتصال المتصفح. يبدأ بقيمة `true` أثناء التصيير على الخادم/
 * قبل أول حدث، ثم يضبطها من navigator.onLine وأحداث online/offline.
 */
export default function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
