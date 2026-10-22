import { useEffect } from 'react';
import { syncAll } from './syncEngine';

/**
 * يشغّل المزامنة التزاندية عند الدخول، وعند عودة التبويب المرئي، وعند عودة الإنترنت.
 * لا يشغّل مستمعين على مجموعات Firebase.
 */
export function useAutoSync(localDb, { enabled = true } = {}) {
  useEffect(() => {
    if (!localDb || !enabled) return undefined;
    const run = (reason) => syncAll(localDb, { reason })
      .catch((error) => console.warn('Local sync failed:', error));

    run('enter');
    const onVisible = () => { if (document.visibilityState === 'visible') run('visible'); };
    const onOnline = () => run('online');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [localDb, enabled]);
}

export default useAutoSync;
