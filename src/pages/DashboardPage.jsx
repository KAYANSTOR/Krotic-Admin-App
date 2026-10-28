import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../contexts/AuthContext.jsx';
import useAppRefresh from '../lib/useAppRefresh.js';
import useOnlineStatus from '../lib/useOnlineStatus.js';
import { PageSkeleton } from '../components/ui/Skeleton.jsx';
import { useLocalQuery } from '../lib/localDb/useLocalQuery.js';
import { useLocalDb } from '../lib/localDb/LocalDbContext.jsx';
import { loadLocalDashboard, loadLocalNetworkSales } from '../lib/localDb/localData.js';
import { adminApiError, rebuildFinancialAggregatesPage } from '../lib/adminApi.js';
import { formatNumber } from '../lib/format.js';
import {
  recentOperationsFromNetworks,
  loadBalanceVisible,
  saveBalanceVisible,
} from '../lib/dashboard/helpers.js';
import { loadRepairProgress, saveRepairProgress } from '../lib/dashboard/repairProgress.js';
import Button from '../components/ui/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';

import DashWelcome from '../components/dashboard/DashWelcome.jsx';
import DashAlerts from '../components/dashboard/DashAlerts.jsx';
import DashSummary from '../components/dashboard/DashSummary.jsx';
import DashServices from '../components/dashboard/DashServices.jsx';
import DashSettlement from '../components/dashboard/DashSettlement.jsx';
import RecentOperations from '../components/dashboard/RecentOperations.jsx';
import AggregateRepairTool from '../components/dashboard/AggregateRepairTool.jsx';

export default function DashboardPage() {
  const { adminData } = useAuth();
  const { runSync, syncing, lastSyncAt } = useLocalDb();
  const online = useOnlineStatus();

  const [balanceVisible, setBalanceVisible] = useState(loadBalanceVisible);
  const [repairProgress, setRepairProgress] = useState(loadRepairProgress);
  const [repairConfirm, setRepairConfirm] = useState(null);
  const [rebuildingAggregates, setRebuildingAggregates] = useState(false);
  const [lastSalesUpdatedAt, setLastSalesUpdatedAt] = useState(null);
  const repairInFlightRef = useRef(false);

  const dashboardQuery = useLocalQuery((localDb) => loadLocalDashboard(localDb), []);
  const salesQuery = useLocalQuery((localDb) => loadLocalNetworkSales(localDb), []);

  const report = dashboardQuery.data;
  const stats = report?.stats || null;
  const appStatus = report?.appStatus || null;
  const monthlyDataWarning = Boolean(report?.monthlyDataWarning);
  const recentOperations = useMemo(
    () => recentOperationsFromNetworks(salesQuery.data || []),
    [salesQuery.data],
  );

  const loading = dashboardQuery.loading && !report;
  const error = dashboardQuery.error
    ? 'تعذر قراءة بيانات لوحة التحكم من القاعدة المحلية. أعد المحاولة.'
    : null;
  const salesSnapshotsReady = !dashboardQuery.loading && !salesQuery.loading;
  const realtimeError = Boolean(salesQuery.error);

  const dashboardRefresh = dashboardQuery.refresh;
  const salesRefresh = salesQuery.refresh;

  const refresh = useCallback(async () => {
    try {
      await runSync({ reason: 'manual' });
    } catch {
      toast.error('تعذر تحديث البيانات من الخادم. ستبقى البيانات المحلية معروضة.');
    } finally {
      dashboardRefresh();
      salesRefresh();
    }
  }, [runSync, dashboardRefresh, salesRefresh]);

  // Keep one global refresh listener; it always calls the newest refresh callback.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const stableRefresh = useCallback(() => refreshRef.current(), []);
  useAppRefresh(stableRefresh);

  useEffect(() => {
    saveBalanceVisible(balanceVisible);
  }, [balanceVisible]);

  useEffect(() => {
    if (salesQuery.data !== null && salesQuery.data !== undefined) {
      setLastSalesUpdatedAt(Date.now());
    }
  }, [salesQuery.data]);

  const requestRepair = useCallback(() => {
    if (
      repairInFlightRef.current
      || rebuildingAggregates
      || syncing
      || repairProgress.done
    ) return;

    const resume = Boolean(repairProgress.cursor);
    setRepairConfirm({
      title: resume ? 'متابعة إصلاح المجاميع المالية' : 'إصلاح المجاميع المالية',
      message: `${resume ? 'متابعة' : 'بدء'} إعادة بناء المجاميع المالية لشبكة واحدة من سجلات المبيعات والمدفوعات؟ قد تستهلك العملية آلاف قراءات Firestore بحسب حجم الشبكة. إذا كانت الحصة اليومية مستنفدة، انتظر تجددها قبل التشغيل. لن تُعالج شبكة أخرى حتى تطلب المتابعة مرة أخرى.`,
      variant: 'primary',
    });
  }, [rebuildingAggregates, syncing, repairProgress]);

  const performRepair = useCallback(async () => {
    if (
      repairInFlightRef.current
      || rebuildingAggregates
      || syncing
      || repairProgress.done
    ) return false;

    repairInFlightRef.current = true;
    setRebuildingAggregates(true);

    let cursor = repairProgress.cursor || null;
    let processed = Number(repairProgress.processed) || 0;

    try {
      const response = await rebuildFinancialAggregatesPage({ cursor, limit: 1 });
      if (!response.ok) {
        throw new Error(adminApiError(response.error, 'تعذر إعادة بناء المجاميع المالية'));
      }

      const result = response.data || {};
      processed += Number(result.processed) || 0;
      cursor = typeof result.nextCursor === 'string' && result.nextCursor
        ? result.nextCursor
        : null;
      const done = result.done === true || !cursor;
      const nextProgress = {
        processed,
        cursor: done ? null : cursor,
        done,
        completedAt: done ? new Date().toISOString() : null,
      };

      setRepairProgress(nextProgress);
      saveRepairProgress(nextProgress);

      // Refresh failure is handled inside refresh and must not repeat a successful repair page.
      await refresh();

      if (done) {
        toast.success(`اكتملت إعادة بناء مجاميع ${formatNumber(processed)} شبكة. حدّث شاشة المستخدمين إذا كانت مفتوحة.`);
      } else {
        toast.success(`أُصلحت شبكة واحدة. الإجمالي ${formatNumber(processed)} شبكة؛ يمكنك متابعة الدفعة التالية عند استعدادك.`);
      }
      return true;
    } catch (repairError) {
      const nextProgress = {
        processed,
        cursor,
        done: false,
        completedAt: null,
      };
      setRepairProgress(nextProgress);
      saveRepairProgress(nextProgress);
      toast.error(
        repairError instanceof Error
          ? repairError.message
          : 'توقفت إعادة بناء المجاميع. يمكنك الاستئناف بعد تجدد حصة Firestore.',
      );
      return false;
    } finally {
      repairInFlightRef.current = false;
      setRebuildingAggregates(false);
    }
  }, [rebuildingAggregates, syncing, repairProgress, refresh]);

  const commissionDue = Math.max(0, Number(stats?.totalCommissionDue) || 0);
  const commissionOutstanding = Math.max(0, Number(stats?.totalCommissionOutstanding) || 0);
  const commissionSettled = Math.max(0, commissionDue - commissionOutstanding);
  const settlementPercent = commissionDue > 0
    ? Math.min(100, Math.round((commissionSettled / commissionDue) * 100))
    : 0;

  const maintenance = Boolean(appStatus && !appStatus.is_app_active);
  const adminName = String(adminData?.name ?? '').trim() || 'المدير';
  const adminInitial = adminName.charAt(0) || 'م';

  if (loading) return <PageSkeleton />;

  return (
    <div className="dashboard-page">
      <DashWelcome
        adminName={adminName}
        adminInitial={adminInitial}
        online={online}
        lastSyncAt={lastSyncAt}
        refreshing={loading || syncing}
        onRefresh={refresh}
      />

      <DashAlerts
        maintenance={maintenance}
        appStatus={appStatus}
        salesSyncing={!salesSnapshotsReady && Boolean(stats)}
        realtimeError={realtimeError}
        monthlyDataWarning={monthlyDataWarning}
        error={error}
        onRetry={refresh}
      />

      {stats && (
        <>
          <DashSummary
            stats={stats}
            balanceVisible={balanceVisible}
            onToggleBalance={() => setBalanceVisible((visible) => !visible)}
          />
          <DashServices />
          <DashSettlement
            commissionDue={commissionDue}
            commissionOutstanding={commissionOutstanding}
            commissionSettled={commissionSettled}
            settlementPercent={settlementPercent}
          />
          <RecentOperations
            operations={recentOperations}
            lastUpdatedAt={lastSalesUpdatedAt}
          />
        </>
      )}

      <AggregateRepairTool
        progress={repairProgress}
        rebuilding={rebuildingAggregates}
        refreshing={syncing}
        onRequestRepair={requestRepair}
      />

      {!stats && !error && (
        <div className="dash-empty" role="status">
          <span className="dash-empty__icon" aria-hidden="true">
            <Users className="w-6 h-6" />
          </span>
          <p className="dash-empty__title">لا توجد بيانات لعرضها بعد</p>
          <p className="dash-empty__desc">
            لم يتم العثور على مستخدمين أو مبيعات مسجّلة حتى الآن.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link to="/users" className="btn btn--primary btn--sm min-h-[44px]">إدارة المستخدمين</Link>
            <Link to="/sales" className="btn btn--secondary btn--sm min-h-[44px]">فتح المبيعات</Link>
            <Button variant="secondary" size="sm" onClick={refresh} disabled={syncing}>
              {syncing ? 'جارٍ التحديث' : 'تحديث البيانات'}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(repairConfirm)}
        onClose={() => setRepairConfirm(null)}
        onConfirm={async () => {
          const succeeded = await performRepair();
          if (!succeeded) return false;
          setRepairConfirm(null);
          return true;
        }}
        title={repairConfirm?.title || ''}
        message={repairConfirm?.message || ''}
        variant={repairConfirm?.variant || 'primary'}
      />
    </div>
  );
}
