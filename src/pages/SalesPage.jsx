import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, DollarSign, RefreshCw, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';

import { formatDate, toDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalNetworkSales } from '../lib/localDb/localData';
import {
  isCompletedSale,
  isServerVerifiedSale,
  saleCommission,
  saleFaceValue,
  sumOutstanding,
  sumVerifiedOutstanding,
} from '../lib/commission';

import {
  DATE_PRESETS,
  FILTER_STORAGE_KEY,
  NETWORK_PAGE_SIZE,
  SALE_ROW_LIMIT,
} from '../lib/sales/constants';
import { loadSavedFilters, saleDomId } from '../lib/sales/helpers';

import SalesHeader from '../components/sales/SalesHeader';
import SalesStats from '../components/sales/SalesStats';
import SalesFilters from '../components/sales/SalesFilters';
import NewSaleNotice from '../components/sales/NewSaleNotice';
import SalesNetworkCard from '../components/sales/SalesNetworkCard';
import SalesLiveFeed from '../components/sales/SalesLiveFeed';
import SalesSummaryTab from '../components/sales/SalesSummaryTab';

export default function SalesPage() {
  const location = useLocation();
  const focusSaleId = location.state?.focusSaleId;
  const [expandedNetwork, setExpandedNetwork] = useState(null);
  const savedFilters = useMemo(loadSavedFilters, []);
  const [statusFilter, setStatusFilter] = useState(savedFilters?.statusFilter || 'all');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(savedFilters ? savedFilters.dateFrom : '');
  const [dateTo, setDateTo] = useState(savedFilters ? savedFilters.dateTo : '');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('networks');
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [newSaleNotice, setNewSaleNotice] = useState(null);
  const [visibleNetworks, setVisibleNetworks] = useState(NETWORK_PAGE_SIZE);
  const [fullSales, setFullSales] = useState({});
  const saleNoticeTimer = useRef(null);
  const lastSeenSaleMs = useRef(null);
  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // اقرأ من قاعدة الإدارة المحلية؛ لا تُنشئ مستمعات Firestore من هذه الصفحة.
  const salesQuery = useLocalQuery((localDb) => loadLocalNetworkSales(localDb), []);
  const networkSales = useMemo(
    () => (salesQuery.data || []).map((network) => ({ ...network, fullHistoryLoaded: true })),
    [salesQuery.data],
  );
  const loading = salesQuery.loading && !salesQuery.data;
  const realtimeReady = !salesQuery.loading;

  const refresh = useCallback(async () => {
    await runSync({ reason: 'manual' });
    salesQuery.refresh();
  }, [runSync, salesQuery.refresh]);

  useAppRefresh(refresh);

  // تنبيه البيع الجديد يلتقط الفرق بين نتائج المزامنة المحلية المتعاقبة.
  useEffect(() => {
    const completed = [];
    (salesQuery.data || []).forEach((network) => {
      (network.sales || []).forEach((sale) => {
        if (sale.status !== 'COMPLETED') return;
        const milliseconds = Number(sale.createdAtMs) || toDate(sale.createdAt)?.getTime() || 0;
        completed.push({
          sale,
          milliseconds,
          networkName: network.networkName || network.uid,
        });
      });
    });

    if (!completed.length) return undefined;
    const latestMilliseconds = completed.reduce(
      (latest, item) => Math.max(latest, item.milliseconds),
      0,
    );
    if (lastSeenSaleMs.current === null) {
      lastSeenSaleMs.current = latestMilliseconds;
      return undefined;
    }
    if (latestMilliseconds <= lastSeenSaleMs.current) return undefined;

    const added = completed.filter((item) => item.milliseconds > lastSeenSaleMs.current);
    lastSeenSaleMs.current = latestMilliseconds;
    const totalFaceValue = added.reduce(
      (sum, item) => sum + (Number(item.sale.faceValue) || 0),
      0,
    );
    const totalCommission = sumOutstanding(added.map((item) => item.sale));
    const networkNames = [...new Set(added.map((item) => item.networkName))];

    setNewSaleNotice({
      id: Date.now(),
      count: added.length,
      totalFaceValue,
      totalCommission,
      networkName: networkNames.length === 1 ? networkNames[0] : 'عدة شبكات',
    });

    if (saleNoticeTimer.current) window.clearTimeout(saleNoticeTimer.current);
    saleNoticeTimer.current = window.setTimeout(() => setNewSaleNotice(null), 7000);
    return undefined;
  }, [salesQuery.data]);

  useEffect(() => () => {
    if (saleNoticeTimer.current) window.clearTimeout(saleNoticeTimer.current);
  }, []);

  const filterSales = useCallback((sales) => sales.filter((sale) => {
    if (
      statusFilter !== 'all' &&
      !(statusFilter === 'COMPLETED' ? isCompletedSale(sale) : sale.status === statusFilter)
    ) return false;
    if (verificationFilter === 'verified' && !isServerVerifiedSale(sale)) return false;
    if (verificationFilter === 'legacy' && isServerVerifiedSale(sale)) return false;

    if (dateFrom || dateTo) {
      const saleDate = toDate(sale.createdAt);
      if (!saleDate || Number.isNaN(saleDate.getTime())) return false;
      if (dateFrom) {
        const fromDate = new Date(dateFrom + 'T00:00:00');
        if (saleDate < fromDate) return false;
      }
      if (dateTo) {
        const toDateInclusive = new Date(dateTo + 'T23:59:59.999');
        if (saleDate > toDateInclusive) return false;
      }
    }
    return true;
  }), [statusFilter, verificationFilter, dateFrom, dateTo]);

  const calcNetworkStats = useCallback((network) => {
    const filtered = filterSales(network.sales || []);
    const completed = filtered.filter(isCompletedSale);
    const useLifetimeSummary = statusFilter === 'all'
      && verificationFilter === 'all'
      && !dateFrom
      && !dateTo;
    const summaryAvailable = useLifetimeSummary && network.summaryAvailable === true;
    const verified = completed.filter(isServerVerifiedSale);
    const legacy = completed.filter((sale) => !isServerVerifiedSale(sale));

    const totalFaceValue = summaryAvailable
      ? (Number(network.totalFaceValue) || 0)
      : completed.reduce((sum, sale) => sum + saleFaceValue(sale), 0);
    const verifiedFaceValue = verified.reduce(
      (sum, sale) => sum + (Number(sale.faceValue) || 0),
      0,
    );
    const legacyFaceValue = legacy.reduce(
      (sum, sale) => sum + (Number(sale.faceValue) || 0),
      0,
    );

    // العمولات المعتمدة خادمياً فقط؛ السجلات القديمة تقديرية للمراجعة.
    const verifiedCommission = sumVerifiedOutstanding(completed);
    const legacyEstimatedCommission = legacy.reduce(
      (sum, sale) => sum + (saleCommission(sale) ?? 0),
      0,
    );
    const totalCommission = summaryAvailable
      ? Math.max(0, (Number(network.totalCommissionDue) || 0) - (Number(network.totalPaid) || 0))
      : verifiedCommission;

    return {
      totalSales: completed.length,
      completedCount: summaryAvailable
        ? (Number(network.totalTransactions) || 0)
        : completed.length,
      verifiedCount: verified.length,
      legacyCount: legacy.length,
      totalFaceValue,
      verifiedFaceValue,
      legacyFaceValue,
      totalCommission,
      verifiedCommission,
      legacyEstimatedCommission,
      unverified: legacy.length > 0,
      filteredSales: filtered,
    };
  }, [filterSales, statusFilter, verificationFilter, dateFrom, dateTo]);

  useEffect(() => {
    setVisibleNetworks(NETWORK_PAGE_SIZE);
  }, [statusFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ statusFilter, dateFrom, dateTo }),
      );
    } catch {
      // لا يؤثر تعذر التخزين المحلي على عمل التصفية الحالية.
    }
  }, [statusFilter, dateFrom, dateTo]);

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return null;
    const found = DATE_PRESETS.find((preset) => {
      const [from, to] = preset.range();
      return from === dateFrom && to === dateTo;
    });
    return found?.key || null;
  }, [dateFrom, dateTo]);

  const applyPreset = (preset) => {
    const [from, to] = preset.range();
    setDateFrom(from);
    setDateTo(to);
  };

  const resetFilters = () => {
    setStatusFilter('all');
    setVerificationFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const filteredNetworks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return networkSales;
    return networkSales.filter((network) => (
      network.networkName?.toLowerCase().includes(query)
      || network.phoneNumber?.includes(query)
      || network.uid?.toLowerCase().includes(query)
    ));
  }, [networkSales, searchQuery]);

  const visibleNetworkList = useMemo(
    () => filteredNetworks.slice(0, visibleNetworks),
    [filteredNetworks, visibleNetworks],
  );
  const hasMoreNetworks = filteredNetworks.length > visibleNetworkList.length;

  const grandTotals = useMemo(() => networkSales.reduce((totals, network) => {
    const stats = calcNetworkStats(network);
    totals.totalSales += stats.totalFaceValue;
    totals.totalCommission += stats.totalCommission;
    totals.totalCount += stats.completedCount;
    totals.verifiedCount += stats.verifiedCount;
    totals.legacyCount += stats.legacyCount;
    totals.verifiedCommission += stats.verifiedCommission;
    totals.legacyEstimatedCommission += stats.legacyEstimatedCommission;
    return totals;
  }, {
    totalSales: 0,
    totalCommission: 0,
    totalCount: 0,
    verifiedCount: 0,
    legacyCount: 0,
    verifiedCommission: 0,
    legacyEstimatedCommission: 0,
  }), [networkSales, calcNetworkStats]);

  const allLiveSales = useMemo(() => {
    const flatSales = [];
    for (const network of networkSales) {
      const filtered = filterSales(network.sales || []);
      for (const sale of filtered) {
        flatSales.push({
          ...sale,
          networkName: network.networkName || ('شبكة ' + String(network.uid || '').slice(0, 8)),
          networkPhone: network.phoneNumber || '',
          networkUid: network.uid,
        });
      }
    }
    return flatSales.sort((first, second) => (
      (toDate(second.createdAt)?.getTime() || 0) - (toDate(first.createdAt)?.getTime() || 0)
    ));
  }, [networkSales, filterSales]);

  // روابط لوحة التحكم تفتح البث المباشر وتضع التركيز على العملية المطلوبة.
  useEffect(() => {
    if (focusSaleId == null || focusSaleId === '') return;
    setActiveTab('live');
    setSearchQuery('');
    setStatusFilter('all');
    setVerificationFilter('all');
    setDateFrom('');
    setDateTo('');
    setShowCustomDate(false);
  }, [focusSaleId]);

  useEffect(() => {
    if (focusSaleId == null || focusSaleId === '' || activeTab !== 'live') return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(saleDomId(focusSaleId))?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSaleId, activeTab, allLiveSales]);

  const handleExportSales = useCallback(() => {
    const rows = networkSales.flatMap((network) => {
      const stats = calcNetworkStats(network);
      return stats.filteredSales.map((sale) => ({ network, sale }));
    });

    if (!rows.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }

    downloadCsv('sales-' + csvStamp(), rows, [
      { label: 'الشبكة', value: (row) => row.network.networkName || row.network.uid },
      { label: 'رقم الهاتف', value: (row) => row.network.phoneNumber || '' },
      { label: 'التاريخ', value: (row) => formatDate(row.sale.createdAt, { withTime: true }) },
      { label: 'الزبون', value: (row) => row.sale.customerId || '' },
      { label: 'قيمة البيع (ر.ي)', value: (row) => Math.round(Number(row.sale.faceValue) || 0) },
      { label: 'حالة البيع', value: (row) => row.sale.status || '' },
      {
        label: 'التوثيق الخادمي',
        value: (row) => isServerVerifiedSale(row.sale) ? 'معتمد خادمياً (Ingest)' : 'سجل قديم (غير متحقق منه)',
      },
      { label: 'بصمة العملية Hash', value: (row) => row.sale.payloadHash || '—' },
      { label: 'إيصال التوقيع', value: (row) => row.sale.verificationReceipt || '—' },
      { label: 'نسبة العمولة (%)', value: (row) => row.network.commissionRate },
      {
        label: 'العمولة غير المسوّاة',
        value: (row) => row.sale.status !== 'COMPLETED' || saleCommission(row.sale) === null
          ? ''
          : sumOutstanding([row.sale]),
      },
    ]);
    toast.success('تم تصدير سجل المبيعات كملف CSV');
  }, [networkSales, calcNetworkStats]);

  const hasActiveFilters = Boolean(
    statusFilter !== 'all'
    || verificationFilter !== 'all'
    || dateFrom
    || dateTo
    || searchQuery,
  );

  if (loading && networkSales.length === 0) return <PageSkeleton />;

  return (
    <div className="sales-page space-y-4 pb-20">
      <SalesHeader
        onExport={handleExportSales}
        lastSyncedAt={lastSyncAt}
        refreshing={loading || syncing}
        onRefresh={refresh}
      />

      {!realtimeReady && (
        <div className="users-error users-error--warning" role="status" aria-live="polite">
          <span className="users-error__icon"><RefreshCw className="w-5 h-5" aria-hidden="true" /></span>
          <div className="users-error__body">
            <p className="users-error__title">جارٍ تحديث السجل</p>
            <p className="users-error__msg">تظهر السجلات أولاً بأول؛ الإجماليات مؤقتة حتى اكتمال التحميل.</p>
          </div>
        </div>
      )}

      <NewSaleNotice notice={newSaleNotice} onClose={() => setNewSaleNotice(null)} />
      <SalesStats totals={grandTotals} />

      <div className="android-tabs" role="group" aria-label="أقسام المبيعات">
        <button
          type="button"
          aria-pressed={activeTab === 'networks'}
          onClick={() => setActiveTab('networks')}
          className={'android-tab min-h-[44px] ' + (activeTab === 'networks' ? 'is-active' : '')}
        >
          <DollarSign className="w-4 h-4 ml-1" aria-hidden="true" />
          <span>الشبكات</span>
          <span className="android-tab__badge">{networkSales.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'live'}
          onClick={() => setActiveTab('live')}
          className={'android-tab min-h-[44px] ' + (activeTab === 'live' ? 'is-active' : '')}
        >
          <Zap className="w-4 h-4 ml-1" aria-hidden="true" />
          <span>البث المباشر</span>
          <span className="android-tab__badge">{allLiveSales.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'stats'}
          onClick={() => setActiveTab('stats')}
          className={'android-tab min-h-[44px] ' + (activeTab === 'stats' ? 'is-active' : '')}
        >
          <Activity className="w-4 h-4 ml-1" aria-hidden="true" />
          <span>التقرير</span>
        </button>
      </div>

      <SalesFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        verificationFilter={verificationFilter}
        onVerificationChange={setVerificationFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        activePreset={activePreset}
        onApplyPreset={applyPreset}
        showCustomDate={showCustomDate}
        onToggleCustomDate={() => setShowCustomDate((shown) => !shown)}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetFilters}
      />

      {activeTab === 'networks' && (
        <div className="space-y-3">
          {filteredNetworks.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-surface border border-line">
              <p className="font-bold text-[var(--ui-ink)]">لا توجد شبكات مطابقة</p>
              <p className="text-xs text-[var(--ui-muted)] mt-1">جرّب تغيير الفلاتر أو كلمة البحث.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleNetworkList.map((network) => (
                <SalesNetworkCard
                  key={network.uid}
                  network={network}
                  stats={calcNetworkStats(network)}
                  isExpanded={expandedNetwork === network.uid}
                  onToggle={() => setExpandedNetwork((current) => current === network.uid ? null : network.uid)}
                  onShowMore={() => setFullSales((current) => ({ ...current, [network.uid]: true }))}
                  showAllSales={Boolean(fullSales[network.uid])}
                  saleRowLimit={SALE_ROW_LIMIT}
                />
              ))}
              {hasMoreNetworks && (
                <button
                  type="button"
                  onClick={() => setVisibleNetworks((current) => current + NETWORK_PAGE_SIZE)}
                  className="w-full min-h-[44px] py-3 rounded-xl font-bold text-sm bg-[var(--ui-sunken)] hover:bg-line/40 transition-colors"
                >
                  عرض المزيد ({filteredNetworks.length - visibleNetworkList.length} متبقية)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'live' && (
        <SalesLiveFeed sales={allLiveSales} focusSaleId={focusSaleId} limit={40} />
      )}

      {activeTab === 'stats' && (
        <SalesSummaryTab
          totals={grandTotals}
          networksCount={networkSales.length}
          onExport={handleExportSales}
        />
      )}
    </div>
  );
}
