import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { useLocalDb } from '../../lib/localDb/LocalDbContext';
import { useLocalQuery } from '../../lib/localDb/useLocalQuery';
import {
  loadLocalBillingHistory,
  loadLocalUsersWithBilling,
} from '../../lib/localDb/localData';
import { fetchInventorySnapshot } from '../../lib/inventorySnapshot';

function asError(error, uid) {
  const message = error instanceof Error ? error.message : String(error || 'تعذر تحميل السجل المالي');
  return Object.assign(new Error(message, { cause: error }), { profileUid: uid });
}

export function useUserProfile(uid) {
  const { runSync, syncing, lastSyncAt } = useLocalDb();
  const requestIdRef = useRef(0);

  const usersQuery = useLocalQuery(
    (localDb) => loadLocalUsersWithBilling(localDb),
    [],
    { enabled: Boolean(uid) },
  );
  const historyQuery = useLocalQuery(
    async (localDb) => {
      try {
        return { uid, history: await loadLocalBillingHistory(localDb, uid) };
      } catch (error) {
        throw asError(error, uid);
      }
    },
    [uid],
    { enabled: Boolean(uid) },
  );

  const user = useMemo(
    () => usersQuery.data?.users?.find((item) => item.uid === uid) || null,
    [usersQuery.data, uid],
  );
  const globalConfig = usersQuery.data?.globalConfig || null;
  const historyEnvelope = historyQuery.data?.uid === uid ? historyQuery.data : null;
  const allSales = useMemo(
    () => Array.isArray(historyEnvelope?.history?.sales) ? historyEnvelope.history.sales : [],
    [historyEnvelope],
  );
  const allPayments = useMemo(
    () => Array.isArray(historyEnvelope?.history?.payments) ? historyEnvelope.history.payments : [],
    [historyEnvelope],
  );

  const networkId = user ? (user.networkId || uid || null) : null;
  const [inventorySnapshot, setInventorySnapshot] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(Boolean(networkId));
  const [inventoryError, setInventoryError] = useState(null);

  const loadInventory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!networkId) {
      setInventorySnapshot(null);
      setInventoryError(null);
      setInventoryLoading(false);
      return null;
    }

    setInventoryLoading(true);
    setInventoryError(null);
    try {
      const snapshot = await fetchInventorySnapshot(networkId);
      if (requestId === requestIdRef.current) setInventorySnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.warn('Inventory snapshot read failed:', error);
      if (requestId === requestIdRef.current) setInventoryError(error);
      return null;
    } finally {
      if (requestId === requestIdRef.current) setInventoryLoading(false);
    }
  }, [networkId]);

  useEffect(() => {
    setInventorySnapshot(null);
    setInventoryError(null);
    setInventoryLoading(Boolean(networkId));
    void loadInventory();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadInventory, networkId]);

  const usersRefreshRef = useRef(usersQuery.refresh);
  const historyRefreshRef = useRef(historyQuery.refresh);
  useEffect(() => {
    usersRefreshRef.current = usersQuery.refresh;
  }, [usersQuery.refresh]);
  useEffect(() => {
    historyRefreshRef.current = historyQuery.refresh;
  }, [historyQuery.refresh]);

  const refresh = useCallback(async () => {
    try {
      await runSync({ reason: 'manual' });
    } catch (error) {
      console.warn('User profile sync failed:', error);
      toast.error('تعذرت مزامنة البيانات من الخادم؛ ستبقى البيانات المتاحة معروضة.');
    } finally {
      usersRefreshRef.current();
      historyRefreshRef.current();
      await loadInventory();
    }
  }, [runSync, loadInventory]);

  const historyError = historyQuery.error?.profileUid === uid ? historyQuery.error : null;
  const userLoadError = usersQuery.error || null;
  const loading = Boolean(uid) && !user && usersQuery.loading && !userLoadError;
  const error = userLoadError || historyError;

  return {
    user,
    globalConfig,
    allSales,
    allPayments,
    inventorySnapshot,
    inventoryLoading,
    inventoryError,
    reloadInventory: loadInventory,
    loading,
    userLoadError,
    historyError,
    error,
    refresh,
    syncing,
    lastSyncAt,
    historyLoading: Boolean(uid) && !historyEnvelope && !historyError,
    historyAvailable: Boolean(historyEnvelope),
  };
}
