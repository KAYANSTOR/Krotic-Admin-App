import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DollarSign, Wallet, TrendingUp, Download, RefreshCw, Inbox, AlertCircle,
  ShieldCheck, Clock, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';

import { formatNumber, formatDate, toDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalNetworkSales } from '../lib/localDb/localData';
import {
  saleCommission, saleFaceValue, isCompletedSale, isCancelledSale, sumOutstanding,
  isServerVerifiedSale, sumVerifiedOutstanding,
} from '../lib/commission';

import {
  NETWORK_PAGE_SIZE, SALE_ROW_LIMIT, FILTER_STORAGE_KEY,
  DATE_PRESETS, STATUS_FILTERS, VERIFICATION_FILTERS,
} from '../lib/sales/constants';
import { saleDomId, loadSavedFilters } from '../lib/sales/helpers';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import StatPills from '../components/ui/StatPills';
import DataCard from '../components/ui/DataCard';
import FilterSheet from '../components/ui/FilterSheet';
import useInfiniteScroll from '../hooks/useInfiniteScroll';

import NetworkSalesSheet from '../components/sales/NetworkSalesSheet';
import NewSaleNotice from '../components/sales/NewSaleNotice';
import SaleRow from '../components/sales/SaleRow';

/** فلتر الحالة يستخدم المُسند المالي المشترك نفسه (O-07) بدل مقارنة نصية خام. */
function saleMatchesStatusFilter(sale, statusFilter) {
  if (statusFilter === 'COMPLETED') return isCompletedSale(sale);
  if (statusFilter === 'CANCELLED') return isCancelledSale(sale);
  return sale.status === statusFilter;
}

export default function SalesPage() {
  const location = useLocation();
  const focusSaleId = location.state?.focusSaleId;
  const savedFilters = useMemo(loadSavedFilters, []);

  const [statusFilter, setStatusFilter] = useState(savedFilters?.statusFilter || 'all');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState(savedFilters ? savedFilters.dateFrom : '');
  const [dateTo, setDateTo] = useState(savedFilters ? savedFilters.dateTo : '');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('networks');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [openNetwork, setOpenNetwork] = useState(null);
  const [newSaleNotice, setNewSaleNotice] = useState(null);
  const [visibleNetworks, setVisibleNetworks] = useState(NETWORK_PAGE_SIZE);
  const [fullSales, setFullSales] = useState({});
  const saleNoticeTimer = useRef(null);
  const lastSeenSaleMs = useRef(null);
  const { runSync, syncing, lastSyncAt } = useLocalDb();

  const salesQuery = useLocalQuery((localDb) => loadLocalNetworkSales(localDb), []);
  const networkSales = useMemo(
    () => (salesQuery.data || []).map((n) => ({ ...n, fullHistoryLoaded: true })),
    [salesQuery.data],
  );
  const loading = salesQuery.loading && !salesQuery.data;
  const realtimeReady = !salesQuery.loading;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    salesQuery.refresh();
  };
  useAppRefresh(refresh);

  // تنبيه البيع الجديد (منقول حرفيًا)
  useEffect(() => {
    const completed = [];
    (salesQuery.data || []).forEach((network) => {
      (network.sales || []).forEach((sale) => {
        if (!isCompletedSale(sale)) return;
        const ms = Number(sale.createdAtMs) || toDate(sale.createdAt)?.getTime() || 0;
        completed.push({ sale, ms, networkName: network.networkName || network.uid });
      });
    });
    if (!completed.length) return undefined;
    const maxMs = completed.reduce((max, item) => Math.max(max, item.ms), 0);
    if (lastSeenSaleMs.current === null) { lastSeenSaleMs.current = maxMs; return undefined; }
    if (maxMs <= lastSeenSaleMs.current) return undefined;
    const added = completed.filter((item) => item.ms > lastSeenSaleMs.current);
    lastSeenSaleMs.current = maxMs;

    const totalFaceValue = added.reduce((sum, item) => sum + (Number(item.sale.faceValue) || 0), 0);
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

  const filterSales = useCallback((sales) => {
    return sales.filter((sale) => {
      if (statusFilter !== 'all' && !saleMatchesStatusFilter(sale, statusFilter)) return false;
      if (verificationFilter === 'verified' && !isServerVerifiedSale(sale)) return false;
      if (verificationFilter === 'legacy' && isServerVerifiedSale(sale)) return false;
      if (dateFrom || dateTo) {
        const saleDate = toDate(sale.createdAt);
        if (!saleDate || Number.isNaN(saleDate.getTime())) return false;
        if (dateFrom) { const f = new Date(`${dateFrom}T00:00:00`); if (saleDate < f) return false; }
        if (dateTo) { const t = new Date(`${dateTo}T23:59:59.999`); if (saleDate > t) return false; }
      }
      return true;
    });
  }, [statusFilter, verificationFilter, dateFrom, dateTo]);

  const calcNetworkStats = useCallback((network) => {
    const filtered = filterSales(network.sales || []);
    const completed = filtered.filter(isCompletedSale);
    const useLifetimeSummary = statusFilter === 'all' && verificationFilter === 'all' && !dateFrom && !dateTo;
    const summaryAvailable = useLifetimeSummary && network.summaryAvailable === true;
    const verified = completed.filter(isServerVerifiedSale);
    const legacy = completed.filter((s) => !isServerVerifiedSale(s));

    const totalFaceValue = summaryAvailable
      ? (Number(network.totalFaceValue) || 0)
      : completed.reduce((sum, sale) => sum + saleFaceValue(sale), 0);

    const verifiedCommission = sumVerifiedOutstanding(completed);
    const legacyEstimatedCommission = legacy.reduce((sum, s) => sum + (saleCommission(s) ?? 0), 0);
    const totalCommission = summaryAvailable
      ? Math.max(0, (Number(network.totalCommissionDue) || 0) - (Number(network.totalPaid) || 0))
      : verifiedCommission;

    return {
      completedCount: summaryAvailable ? (Number(network.totalTransactions) || 0) : completed.length,
      verifiedCount: verified.length,
      legacyCount: legacy.length,
      totalFaceValue,
      totalCommission,
      verifiedCommission,
      legacyEstimatedCommission,
      filteredSales: filtered,
    };
  }, [filterSales, statusFilter, verificationFilter, dateFrom, dateTo]);

  useEffect(() => { setVisibleNetworks(NETWORK_PAGE_SIZE); }, [statusFilter, dateFrom, dateTo, searchQuery]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ statusFilter, dateFrom, dateTo }),
      );
    } catch { /* noop */ }
  }, [statusFilter, dateFrom, dateTo]);

  const activePreset = useMemo(() => {
    if (!dateFrom && !dateTo) return null;
    const found = DATE_PRESETS.find((preset) => {
      const [f, t] = preset.range();
      return f === dateFrom && t === dateTo;
    });
    return found?.key || null;
  }, [dateFrom, dateTo]);

  const applyPreset = (preset) => {
    const [f, t] = preset.range();
    setDateFrom(f);
    setDateTo(t);
  };

  const resetFilters = () => {
    setStatusFilter('all');
    setVerificationFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  const filteredNetworks = useMemo(() => {
    if (!searchQuery.trim()) return networkSales;
    const q = searchQuery.toLowerCase();
    return networkSales.filter((n) =>
      n.networkName?.toLowerCase().includes(q) ||
      n.phoneNumber?.includes(q) ||
      n.uid?.includes(q),
    );
  }, [networkSales, searchQuery]);

  const visibleNetworkList = useMemo(
    () => filteredNetworks.slice(0, visibleNetworks),
    [filteredNetworks, visibleNetworks],
  );
  const hasMoreNetworks = filteredNetworks.length > visibleNetworkList.length;

  const grandTotals = useMemo(() => {
    return networkSales.reduce(
      (acc, network) => {
        const s = calcNetworkStats(network);
        acc.totalSales += s.totalFaceValue;
        acc.totalCommission += s.totalCommission;
        acc.totalCount += s.completedCount;
        acc.verifiedCount += s.verifiedCount;
        acc.legacyCount += s.legacyCount;
        acc.verifiedCommission += s.verifiedCommission;
        acc.legacyEstimatedCommission += s.legacyEstimatedCommission;
        return acc;
      },
      { totalSales: 0, totalCommission: 0, totalCount: 0, verifiedCount: 0, legacyCount: 0, verifiedCommission: 0, legacyEstimatedCommission: 0 },
    );
  }, [networkSales, calcNetworkStats]);

  const allLiveSales = useMemo(() => {
    const flat = [];
    for (const net of networkSales) {
      const filtered = filterSales(net.sales || []);
      for (const sale of filtered) {
        flat.push({
          ...sale,
          networkName: net.networkName || `شبكة ${net.uid.slice(0, 8)}`,
          networkUid: net.uid,
        });
      }
    }
    return flat.sort((a, b) => {
      const ta = toDate(a.createdAt)?.getTime() || 0;
      const tb = toDate(b.createdAt)?.getTime() || 0;
      return tb - ta;
    });
  }, [networkSales, filterSales]);

  useEffect(() => {
    if (focusSaleId == null || focusSaleId === '') return;
    setActiveTab('live');
    setSearchQuery('');
    setStatusFilter('all');
    setVerificationFilter('all');
    setDateFrom('');
    setDateTo('');
  }, [focusSaleId]);

  useEffect(() => {
    if (focusSaleId == null || focusSaleId === '' || activeTab !== 'live') return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(saleDomId(focusSaleId))?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusSaleId, activeTab, allLiveSales]);

  const handleExportSales = useCallback(() => {
    const rows = networkSales.flatMap((network) => {
      const stats = calcNetworkStats(network);
      return stats.filteredSales.map((sale) => ({ network, sale }));
    });
    if (!rows.length) { toast.error('لا توجد بيانات للتصدير'); return; }
    downloadCsv(`sales-${csvStamp()}`, rows, [
      { label: 'الشبكة', value: (r) => r.network.networkName || r.network.uid },
      { label: 'الهاتف', value: (r) => r.network.phoneNumber || '' },
      { label: 'التاريخ', value: (r) => formatDate(r.sale.createdAt, { withTime: true }) },
      { label: 'الزبون', value: (r) => r.sale.customerId || '' },
      { label: 'القيمة (ر.ي)', value: (r) => Math.round(Number(r.sale.faceValue) || 0) },
      { label: 'الحالة', value: (r) => r.sale.status || '' },
      { label: 'التوثيق', value: (r) => isServerVerifiedSale(r.sale) ? 'معتمد' : 'قديم' },
      { label: 'Hash', value: (r) => r.sale.payloadHash || '—' },
      { label: 'نسبة العمولة (%)', value: (r) => r.network.commissionRate },
      { label: 'العمولة', value: (r) => !isCompletedSale(r.sale) || saleCommission(r.sale) === null ? '' : sumOutstanding([r.sale]) },
    ]);
    toast.success('تم التصدير');
  }, [networkSales, calcNetworkStats]);

  const activeFiltersCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (verificationFilter !== 'all' ? 1 : 0) +
    (dateFrom || dateTo ? 1 : 0);

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => setVisibleNetworks((v) => v + NETWORK_PAGE_SIZE),
    hasMore: hasMoreNetworks,
  });

  if (loading && networkSales.length === 0) return <PageSkeleton />;

  const openNetworkStats = openNetwork ? calcNetworkStats(openNetwork) : null;

  return (
    <div className="pb-24">
      <SearchHeader
        title="المبيعات"
        subtitle={`${formatNumber(networkSales.length)} شبكة • ${formatNumber(grandTotals.totalCount)} عملية`}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="ابحث باسم الشبكة أو الرقم..."
        onFilterClick={() => setFilterSheetOpen(true)}
        filterCount={activeFiltersCount}
        actions={
          <button
            type="button"
            onClick={handleExportSales}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)]"
            aria-label="تصدير CSV"
          >
            <Download className="w-4 h-4" />
          </button>
        }
      />

      {!realtimeReady && (
        <div className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
          <RefreshCw className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />
          <p>جارٍ تحديث السجل — الإجماليات مؤقتة حتى اكتمال التحميل.</p>
        </div>
      )}

      <NewSaleNotice notice={newSaleNotice} onClose={() => setNewSaleNotice(null)} />

      <div className="mt-3">
        <HeroMetric
          label="إجمالي المبيعات"
          value={grandTotals.totalSales}
          unit="ر.ي"
          icon={DollarSign}
          trend={grandTotals.verifiedCount > grandTotals.legacyCount ? 'up' : 'flat'}
          trendLabel={`${formatNumber(grandTotals.verifiedCommission)} ر.ي عمولة معتمدة`}
          hint={`${formatNumber(grandTotals.totalCount)} عملية مكتملة`}
          tone="brand"
        />
      </div>

      <div className="mt-3">
        <StatPills
          items={[
            { key: 'verified', icon: ShieldCheck, label: 'معتمدة', value: formatNumber(grandTotals.verifiedCount), tone: 'success' },
            { key: 'legacy', icon: Clock, label: 'قديمة', value: formatNumber(grandTotals.legacyCount), tone: 'warning' },
            { key: 'commission', icon: Wallet, label: 'العمولة', value: `${formatNumber(grandTotals.verifiedCommission)} ر.ي`, tone: 'brand' },
            { key: 'sales', icon: TrendingUp, label: 'المبيعات', value: `${formatNumber(grandTotals.totalSales)} ر.ي`, tone: 'neutral' },
          ]}
        />
      </div>

      <div className="mt-3 android-tabs" role="group" aria-label="أقسام المبيعات">
        <button
          type="button"
          aria-pressed={activeTab === 'networks'}
          onClick={() => setActiveTab('networks')}
          className={`android-tab min-h-[44px] ${activeTab === 'networks' ? 'is-active' : ''}`}
        >
          <DollarSign className="w-4 h-4 ml-1" />
          <span>الشبكات</span>
          <span className="android-tab__badge">{filteredNetworks.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'live'}
          onClick={() => setActiveTab('live')}
          className={`android-tab min-h-[44px] ${activeTab === 'live' ? 'is-active' : ''}`}
        >
          <Zap className="w-4 h-4 ml-1" />
          <span>البث المباشر</span>
          <span className="android-tab__badge">{allLiveSales.length}</span>
        </button>
      </div>

      {activeTab === 'networks' && (
        <div className="mt-3 space-y-2.5">
          {filteredNetworks.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
              <Inbox className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
              <p className="font-bold text-[var(--ui-ink)]">لا توجد شبكات مطابقة</p>
              <p className="text-xs text-[var(--ui-muted)] mt-1">جرّب تعديل الفلاتر أو البحث.</p>
            </div>
          ) : (
            <>
              {visibleNetworkList.map((network) => {
                const s = calcNetworkStats(network);
                const displayName = network.networkName || `شبكة ${network.uid.substring(0, 10)}`;
                return (
                  <DataCard
                    key={network.uid}
                    avatar={{ initial: displayName.charAt(0), tone: 'brand' }}
                    title={displayName}
                    subtitle={network.phoneNumber || 'بدون هاتف'}
                    badges={[
                      { label: `${s.completedCount} عملية`, tone: 'neutral' },
                      ...(s.legacyCount > 0 ? [{ label: `${s.legacyCount} قديمة`, tone: 'warning' }] : []),
                    ]}
                    facts={[
                      { icon: DollarSign, label: 'المبيعات', value: `${formatNumber(s.totalFaceValue)} ر.ي` },
                      { icon: Wallet, label: 'العمولة', value: `${formatNumber(s.totalCommission)} ر.ي` },
                    ]}
                    onClick={() => setOpenNetwork(network)}
                  />
                );
              })}

              {hasMoreNetworks && (
                <div ref={sentinelRef} className="py-6 flex justify-center" role="status" aria-live="polite">
                  <div className="flex items-center gap-2 text-xs text-[var(--ui-muted)] font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    جارٍ التحميل...
                  </div>
                </div>
              )}

              {!hasMoreNetworks && filteredNetworks.length > 0 && (
                <p className="text-center text-[11px] text-[var(--ui-faint)] py-4">
                  وصلت للنهاية — {formatNumber(filteredNetworks.length)} شبكة
                </p>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'live' && (
        <div className="mt-3 space-y-2">
          {allLiveSales.length === 0 ? (
            <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
              <Inbox className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
              <p className="font-bold text-[var(--ui-ink)]">لا توجد عمليات</p>
              <p className="text-xs text-[var(--ui-muted)] mt-1">ستظهر العمليات فور تسجيلها.</p>
            </div>
          ) : (
            allLiveSales.slice(0, 40).map((sale) => (
              <div key={sale.id} id={saleDomId(sale.id)}>
                <SaleRow sale={sale} />
              </div>
            ))
          )}
        </div>
      )}

      {/* Bottom Sheet — عمليات الشبكة */}
      <NetworkSalesSheet
        isOpen={Boolean(openNetwork)}
        onClose={() => setOpenNetwork(null)}
        network={openNetwork}
        stats={openNetworkStats}
        onShowMore={() => setOpenNetwork((prev) => prev ? { ...prev } : null) || setFullSales((p) => ({ ...p, [openNetwork.uid]: true }))}
        showAllSales={openNetwork ? Boolean(fullSales[openNetwork.uid]) : false}
        saleRowLimit={SALE_ROW_LIMIT}
      />

      {/* Bottom Sheet — الفلاتر */}
      <FilterSheet
        isOpen={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="فلاتر المبيعات"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="flex-1 min-h-[48px] rounded-xl border border-line font-bold text-sm text-[var(--ui-ink-soft)] hover:bg-[var(--ui-sunken)]"
            >
              إعادة تعيين
            </button>
            <button
              type="button"
              onClick={() => setFilterSheetOpen(false)}
              className="flex-1 min-h-[48px] rounded-xl bg-[var(--ui-brand)] text-white font-bold text-sm"
            >
              تطبيق
            </button>
          </div>
        }
      >
        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">الفترة الزمنية</label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className={`min-h-[40px] px-3 rounded-full border font-bold text-xs ${
                !dateFrom && !dateTo
                  ? 'bg-brand text-white border-brand'
                  : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line'
              }`}
            >
              الكل
            </button>
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset)}
                className={`min-h-[40px] px-3 rounded-full border font-bold text-xs ${
                  activePreset === preset.key
                    ? 'bg-brand text-white border-brand'
                    : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-line text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-line text-xs"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">التوثيق</label>
          <div className="grid grid-cols-3 gap-2">
            {VERIFICATION_FILTERS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => setVerificationFilter(v.value)}
                className={`min-h-[44px] rounded-xl border font-bold text-xs ${
                  verificationFilter === v.value
                    ? 'bg-brand text-white border-brand'
                    : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-black text-[var(--ui-ink)] block mb-2">الحالة</label>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(s.value)}
                className={`min-h-[44px] rounded-xl border font-bold text-xs ${
                  statusFilter === s.value
                    ? 'bg-[var(--ui-ink)] text-[var(--ui-surface)] border-[var(--ui-ink)]'
                    : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </FilterSheet>
    </div>
  );
}
