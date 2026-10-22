import { useEffect, useMemo, useState } from 'react';
import { useLocalDb } from './LocalDbContext.jsx';
import { onSyncEvent } from './syncEvents.js';

/**
 * خطّاف قراءة تفاعلي من القاعدة المحلية.
 * يُعيد القيم التي يقرأها الاستعلام، ويعيد القراءة تلقائياً بعد كل مزامنة.
 * لا يقرأ من Firestore إطلاقاً.
 */
export function useLocalQuery(queryFn, deps = [], { enabled = true } = {}) {
  const { localDb } = useLocalDb();
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    if (!localDb) {
      setState({ data: null, error: null, loading: true });
      return undefined;
    }

    let active = true;
    setState((current) => ({ ...current, loading: current.data === null }));

    Promise.resolve()
      .then(() => queryFn(localDb))
      .then((data) => {
        if (!active) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (!active) return;
        console.error('Local query failed:', error);
        setState({ data: null, error, loading: false });
      });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDb, enabled, version, ...deps]);

  // إعادة القراءة بعد كل مزامنة ناجحة.
  useEffect(() => onSyncEvent(() => setVersion((current) => current + 1)), []);

  return useMemo(() => ({
    ...state,
    refresh: () => setVersion((current) => current + 1),
    isEmpty: state.data !== null && Array.isArray(state.data) && state.data.length === 0,
  }), [state]);
}

export default useLocalQuery;
