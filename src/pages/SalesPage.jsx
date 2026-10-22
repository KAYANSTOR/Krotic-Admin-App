import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DollarSign, Filter, Download, CheckCircle2, ShieldCheck, Clock3,
  ChevronDown, ChevronUp, Wallet, Inbox, AlertCircle,
  RefreshCw, TrendingUp, Activity, Search, X, Calendar, ArrowUpRight, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHero from '../components/ui/PageHero';
import { Card } from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';
import { formatNumber, formatDate, toDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalNetworkSales } from '../lib/localDb/localData';
import { saleCommission, saleFaceValue, isCompletedSale, sumOutstanding, hasUnverifiedCommission, isServerVerifiedSale, sumVerifiedOutstanding, sumLegacyUnverifiedSales } from '../lib/commission';
import { mergeSalesByIdentity } from '../lib/salesReadCompat';

const NETWORK_PAGE_SIZE = 12;
const FILTER_STORAGE_KEY = 'krotak:sales-filters:v4';

function toDateInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DATE_PRESETS = [
  { key: 'today', label: 'اليوم', range: () => { const t = new Date(); return [toDateInput(t), toDateInput(t)]; } },
  { key: 'week', label: 'آخر 7 أيام', range: () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 6); return [toDateInput(f), toDateInput(t)]; } },
  { key: 'month', label: 'آخر 30 يوماً', range: () => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 29); return [toDateInput(f), toDateInput(t)]; } },
  { key: 'thisMonth', label: 'هذا الشهر', range: () => { const t = new Date(); return [toDateInput(new Date(t.getFullYear(), t.getMonth(), 1)), toDateInput(t)]; } },
];

function loadSavedFilters() {
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      statusFilter: typeof parsed?.statusFilter === 'string' ? parsed.statusFilter : 'all',
      dateFrom: typeof parsed?.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed?.dateTo === 'string' ? parsed.dateTo : '',
    };
  } catch {
    return null;
  }
}
const SALE_ROW_LIMIT = 50;

function SaleVerificationBadge({ sale }) {
  const verified = isServerVerifiedSale(sale);
  if (verified) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
        title={`معتمد عبر خادم Ingest مع توقيع HMAC ومطابقة بصمة الهاش\nHash: ${sale.payloadHash || '—'}`}
      >
        <ShieldCheck className="w-3 h-3 text-emerald-600" />
        <span>معتمد خادمياً</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300"
      title="سجل بيع قديم مباشر من التطبيق قبل ربط Ingest. لا يُحتسب كعمولة معتمدة تلقائياً قبل المراجعة والتسوية."
    >
      <Clock3 className="w-3 h-3 text-amber-700" />
      <span>سجل قديم (قيد المطابقة)</span>
    </span>
  );
}

export default function SalesPage() {
  const [expandedNetwork, setExpandedNetwork] = useState(null);
  const savedFilters = useMemo(loadSavedFilters, []);
  const [statusFilter, setStatusFilter] = useState(savedFilters?.statusFilter || 'all');
  const [verificationFilter, setVerificationFilter] = useState('all'); // 'all' | 'verified' | 'legacy'
  const [dateFrom, setDateFrom] = useState(savedFilters ? savedFilters.dateFrom : '');
  const [dateTo, setDateTo] = useState(savedFilters ? savedFilters.dateTo : '');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('networks'); // 'networks' | 'live' | 'stats'
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [newSaleNotice, setNewSaleNotice] = useState(null);
  const [visibleNetworks, setVisibleNetworks] = useState(NETWORK_PAGE_SIZE);
  const [fullSales, setFullSales] = useState({});
  const saleNoticeTimer = useRef(null);
  const lastSeenSaleMs = useRef(null);
  const { runSync, syncing, lastSyncAt } = useLocalDb();

  // المبيعات تُقرأ من القاعدة المحلية (collectionGroup sales) — لا مستمعات Firestore.
  const salesQuery = useLocalQuery((localDb) => loadLocalNetworkSales(localDb), []);
  const networkSales = useMemo(
    () => (salesQuery.data || []).map((network) => ({ ...network, fullHistoryLoaded: true })),
    [salesQuery.data],
  );
  const loading = salesQuery.loading && !salesQuery.data;
  const realtimeReady = !salesQuery.loading;
  const partialErrors = salesQuery.error
    ? ['تعذر قراءة سجل المبيعات من القاعدة المحلية. أعد المحاولة.']
    : [];

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    salesQuery.refresh();
  };

  // يُستخدم من زر التحديث والتصدير: مزامنة تزايدية ثم إعادة قراءة محلية.
  const load = refresh;

  useAppRefresh(refresh);

  // تنبيه «عملية بيع جديدة» يعتمد على فروق المزامنة المحلية بدل onSnapshot.
  useEffect(() => {
    const completed = [];
    (salesQuery.data || []).forEach((network) => {
      (network.sales || []).forEach((sale) => {
        if (sale.status !== 'COMPLETED') return;
        const ms = Number(sale.createdAtMs) || toDate(sale.createdAt)?.getTime() || 0;
        completed.push({ sale, ms, networkName: network.networkName || network.uid });
      });
    });
    if (!completed.length) return undefined;
    const maxMs = completed.reduce((max, item) => Math.max(max, item.ms), 0);
    if (lastSeenSaleMs.current === null) {
      lastSeenSaleMs.current = maxMs;
      return undefined;
    }
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
      if (statusFilter !== 'all' && !(statusFilter === 'COMPLETED' ? isCompletedSale(sale) : sale.status === statusFilter)) return false;
      if (verificationFilter === 'verified' && !isServerVerifiedSale(sale)) return false;
      if (verificationFilter === 'legacy' && isServerVerifiedSale(sale)) return false;
      if (dateFrom || dateTo) {
        const saleDate = toDate(sale.createdAt);
        if (!saleDate || Number.isNaN(saleDate.getTime())) return false;
        if (dateFrom) {
          const fromDate = new Date(`${dateFrom}T00:00:00`);
          if (saleDate < fromDate) return false;
        }
        if (dateTo) {
          const endDate = new Date(`${dateTo}T23:59:59.999`);
          if (saleDate > endDate) return false;
        }
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
    const verifiedFaceValue = verified.reduce((sum, sale) => sum + (Number(sale.faceValue) || 0), 0);
    const legacyFaceValue = legacy.reduce((sum, sale) => sum + (Number(sale.faceValue) || 0), 0);

    // العمولات المعتمدة خادمياً فقط
    const verifiedCommission = sumVerifiedOutstanding(completed);
    // عمولات السجلات القديمة تقديرية لأغراض التدقيق والمراجعة
    const legacyEstimatedCommission = legacy.reduce((sum, s) => sum + (saleCommission(s) ?? 0), 0);
    const totalCommission = summaryAvailable
      ? Math.max(0, (Number(network.totalCommissionDue) || 0) - (Number(network.totalPaid) || 0))
      : verifiedCommission;
    const unverified = legacy.length > 0;

    return {
      totalSales: completed.length,
      completedCount: summaryAvailable ? (Number(network.totalTransactions) || 0) : completed.length,
      verifiedCount: verified.length,
      legacyCount: legacy.length,
      totalFaceValue,
      verifiedFaceValue,
      legacyFaceValue,
      totalCommission,
      verifiedCommission,
      legacyEstimatedCommission,
      unverified,
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
        JSON.stringify({ statusFilter, dateFrom, dateTo })
      );
    } catch {
      // safe fallback
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

  const filteredNetworks = useMemo(() => {
    if (!searchQuery.trim()) return networkSales;
    const q = searchQuery.toLowerCase();
    return networkSales.filter((n) =>
      n.networkName?.toLowerCase().includes(q) ||
      n.phoneNumber?.includes(q) ||
      n.uid?.includes(q)
    );
  }, [networkSales, searchQuery]);

  const visibleNetworkList = useMemo(
    () => filteredNetworks.slice(0, visibleNetworks),
    [filteredNetworks, visibleNetworks]
  );
  const hasMoreNetworks = filteredNetworks.length > visibleNetworkList.length;

  const grandTotals = useMemo(() => {
    return networkSales.reduce(
      (acc, network) => {
        const stats = calcNetworkStats(network);
        acc.totalSales += stats.totalFaceValue;
        acc.totalCommission += stats.totalCommission;
        acc.totalCount += stats.completedCount;
        acc.verifiedCount += stats.verifiedCount;
        acc.legacyCount += stats.legacyCount;
        acc.verifiedCommission += stats.verifiedCommission;
        acc.legacyEstimatedCommission += stats.legacyEstimatedCommission;
        return acc;
      },
      {
        totalSales: 0,
        totalCommission: 0,
        totalCount: 0,
        verifiedCount: 0,
        legacyCount: 0,
        verifiedCommission: 0,
        legacyEstimatedCommission: 0,
      }
    );
  }, [networkSales, calcNetworkStats]);

  // جدول بث العمليات المباشرة عبر جميع الشبكات (مرتب بالأحدث أولاً)
  const allLiveSales = useMemo(() => {
    const flat = [];
    for (const net of networkSales) {
      const filtered = filterSales(net.sales || []);
      for (const sale of filtered) {
        flat.push({
          ...sale,
          networkName: net.networkName || `شبكة ${net.uid.slice(0, 8)}`,
          networkPhone: net.phoneNumber || '',
          networkUid: net.uid,
        });
      }
    }
    return flat.sort((a, b) => {
      const timeA = toDate(a.createdAt)?.getTime() || 0;
      const timeB = toDate(b.createdAt)?.getTime() || 0;
      return timeB - timeA;
    });
  }, [networkSales, filterSales]);

  const statusLabel = {
    COMPLETED: { text: 'مكتمل', class: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    ROLLED_BACK: { text: 'مسترجع', class: 'bg-amber-100 text-amber-800 border-amber-300' },
    SMS_PENDING: { text: 'بانتظار SMS', class: 'bg-sky-100 text-sky-800 border-sky-300' },
  };

  const handleExportSales = useCallback(() => {
    const sourceNetworks = networkSales;
    const rows = sourceNetworks.flatMap((network) => {
      const stats = calcNetworkStats(network);
      return stats.filteredSales.map((sale) => ({ network, sale }));
    });
    if (!rows.length) {
      toast.error('لا توجد بيانات للتصدير');
      return;
    }
    downloadCsv(`sales-${csvStamp()}`, rows, [
      { label: 'الشبكة', value: (r) => r.network.networkName || r.network.uid },
      { label: 'رقم الهاتف', value: (r) => r.network.phoneNumber || '' },
      { label: 'التاريخ', value: (r) => formatDate(r.sale.createdAt, { withTime: true }) },
      { label: 'الزبون', value: (r) => r.sale.customerId || '' },
      { label: 'قيمة البيع (ر.ي)', value: (r) => Math.round(Number(r.sale.faceValue) || 0) },
      { label: 'حالة البيع', value: (r) => r.sale.status || '' },
      { label: 'التوثيق الخادمي', value: (r) => isServerVerifiedSale(r.sale) ? 'معتمد خادمياً (Ingest)' : 'سجل قديم (غير متحقق منه)' },
      { label: 'بصمة العملية Hash', value: (r) => r.sale.payloadHash || '—' },
      { label: 'إيصال التوقيع', value: (r) => r.sale.verificationReceipt || '—' },
      { label: 'نسبة العمولة (%)', value: (r) => r.network.commissionRate },
      { label: 'العمولة غير المسوّاة', value: (r) => r.sale.status !== 'COMPLETED' || saleCommission(r.sale) === null ? '' : sumOutstanding([r.sale]) },
    ]);
    toast.success('تم تصدير سجل المبيعات كملف CSV');
  }, [networkSales, calcNetworkStats]);

  const hasActiveFilters = statusFilter !== 'all' || verificationFilter !== 'all' || dateFrom || dateTo || searchQuery;

  const resetFilters = () => {
    setStatusFilter('all');
    setVerificationFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
  };

  if (loading && networkSales.length === 0) return <PageSkeleton />;

  return (
    <div className="sales-page space-y-4 pb-20">
      {/* Android Top Page Header */}
      <PageHero
        icon={DollarSign}
        title="المبيعات والعمولات المباشرة"
        subtitle="متابعة فورية لمبيعات كروت الشبكات وحساب العمولات"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={Download} onClick={handleExportSales}>
              تصدير CSV
            </Button>
            <DataFreshness
              lastSyncedAt={lastSyncAt}
              refreshing={loading || syncing}
              onRefresh={refresh}
            />
          </div>
        }
      />

      {!realtimeReady && (
        <div className="users-error users-error--warning mb-4" role="status" aria-live="polite">
          <span className="users-error__icon"><RefreshCw className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">جارٍ تحديث سجل جميع الشبكات</p>
            <p className="users-error__msg">تظهر السجلات أولاً بأول؛ الإجماليات مؤقتة حتى اكتمال تحميل كل الشبكات.</p>
          </div>
        </div>
      )}

      {/* Floating Android Realtime Sale Toast */}
      {newSaleNotice && (
        <div key={newSaleNotice.id} className="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-lg flex items-center justify-between gap-3 animate-bounce">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </span>
            <div>
              <p className="text-xs font-black">
                {newSaleNotice.count === 1 ? '⚡ عملية بيع جديدة الآن!' : `⚡ ${formatNumber(newSaleNotice.count)} مبيعات جديدة!`}
              </p>
              <p className="text-[11px] text-white/90">
                {newSaleNotice.networkName} • المبيعات: <strong>{formatNumber(newSaleNotice.totalFaceValue)} ر.ي</strong> • العمولة: <strong>{formatNumber(newSaleNotice.totalCommission)} ر.ي</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            className="text-white/80 hover:text-white p-1 text-sm font-bold"
            onClick={() => setNewSaleNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Android Material 3 KPI Header Cards (3 بطاقات واضحة) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-bold">المبيعات المكتملة</span>
            <DollarSign className="w-4 h-4 text-brand" />
          </div>
          <p className="text-lg font-black text-ink font-mono">{formatNumber(grandTotals.totalSales)}</p>
          <div className="flex items-center gap-1.5 text-[10px] text-muted mt-0.5">
            <span className="text-emerald-700 font-bold">{formatNumber(grandTotals.verifiedCount)} معتمدة</span>
            <span>•</span>
            <span className="text-amber-800 font-semibold">{formatNumber(grandTotals.legacyCount)} قديمة</span>
            <span className="text-muted">(ضمن السجلات المحمّلة)</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-bold">العمولة المعتمدة خادمياً</span>
            <Wallet className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-lg font-black text-emerald-600 font-mono">{formatNumber(grandTotals.verifiedCommission)}</p>
          <span className="text-[10px] text-muted block truncate">
            {grandTotals.legacyEstimatedCommission > 0
              ? `+ ${formatNumber(grandTotals.legacyEstimatedCommission)} ر.ي قديمة للمراجعة`
              : 'غير مسوّاة'}
          </span>
        </div>

        <div className="p-3.5 rounded-2xl bg-surface border border-line shadow-xs col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-bold">عدد العمليات الناجحة</span>
            <TrendingUp className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-lg font-black text-ink font-mono">{formatNumber(grandTotals.totalCount)}</p>
          <span className="text-[10px] text-muted">عملية بيع مكتملة</span>
        </div>
      </div>

      {/* Android App Segmented Bar (3 تبويبات سريعة) */}
      <div className="android-tabs" role="tablist" aria-label="أقسام المبيعات">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'networks'}
          onClick={() => setActiveTab('networks')}
          className={`android-tab ${activeTab === 'networks' ? 'is-active' : ''}`}
        >
          <DollarSign className="w-4 h-4 ml-1" />
          <span>شبكات المبيعات</span>
          <span className="android-tab__badge">{networkSales.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'live'}
          onClick={() => setActiveTab('live')}
          className={`android-tab ${activeTab === 'live' ? 'is-active' : ''}`}
        >
          <Zap className="w-4 h-4 ml-1 text-emerald-500 animate-pulse" />
          <span>البث المباشر</span>
          <span className="android-tab__badge">{allLiveSales.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'stats'}
          onClick={() => setActiveTab('stats')}
          className={`android-tab ${activeTab === 'stats' ? 'is-active' : ''}`}
        >
          <Activity className="w-4 h-4 ml-1" />
          <span>الفلاتر والتقرير</span>
        </button>
      </div>

      {/* Android Horizontal Filter Chips (قابلة للسحب بالأصبع بدون شريط تمرير مزعج) */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
          <button
            type="button"
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
              !dateFrom && !dateTo
                ? 'bg-brand text-white border-brand shadow-xs'
                : 'bg-surface text-ink-soft border-line hover:bg-surface-sunken'
            }`}
          >
            كل التواريخ
          </button>

          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                activePreset === preset.key
                  ? 'bg-brand text-white border-brand shadow-xs'
                  : 'bg-surface text-ink-soft border-line hover:bg-surface-sunken'
              }`}
            >
              {preset.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowCustomDate(!showCustomDate)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1 ${
              dateFrom && !activePreset ? 'bg-brand text-white border-brand' : 'bg-surface text-ink-soft border-line'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>تاريخ مخصص</span>
          </button>
        </div>

                {/* فلتر التوثيق (معتمد خادمياً مقابل سجل قديم) */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
          {[
            { value: 'all', label: 'كافة سجلات المبيعات' },
            { value: 'verified', label: '🛡️ معتمدة خادمياً فقط (Ingest)' },
            { value: 'legacy', label: '⏳ سجلات قديمة (قيد المطابقة)' },
          ].map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVerificationFilter(v.value)}
              className={`flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                verificationFilter === v.value
                  ? 'bg-brand text-white border-brand shadow-xs'
                  : 'bg-surface text-ink-soft border-line/60 hover:text-ink'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* فلاتر الحالة كرقائق أندرويد */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x">
          {[
            { value: 'all', label: 'كافة الحالات' },
            { value: 'COMPLETED', label: 'مكتمل فقط' },
            { value: 'ROLLED_BACK', label: 'مسترجع' },
            { value: 'SMS_PENDING', label: 'بانتظار SMS' },
          ].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatusFilter(s.value)}
              className={`flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                statusFilter === s.value
                  ? 'bg-ink text-surface border-ink'
                  : 'bg-surface-sunken text-muted border-line/60 hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="flex-shrink-0 px-2.5 py-1 text-xs text-danger hover:underline font-bold"
            >
              إلغاء التصفية ✕
            </button>
          )}
        </div>

        {/* منتقي التاريخ المخصص إن اختاره المدير */}
        {showCustomDate && (
          <div className="p-3 bg-surface border border-line rounded-xl grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-muted block mb-1">من تاريخ</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input-field text-xs py-1.5"
              />
            </div>
            <div>
              <label className="text-muted block mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input-field text-xs py-1.5"
              />
            </div>
          </div>
        )}
      </div>

      {/* حقل البحث السريع بالاسم أو الهاتف */}
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="ابحث باسم الشبكة أو رقم الهاتف..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute left-3.5 top-3 text-muted hover:text-ink"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ===================== TAB 1: NETWORKS ===================== */}
      {activeTab === 'networks' && (
        <div className="space-y-3">
          {filteredNetworks.length === 0 ? (
            <Card className="p-8 text-center rounded-2xl">
              <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
                <Inbox className="w-6 h-6" />
              </span>
              <p className="font-bold text-ink">لا توجد شبكات مطابقة</p>
              <p className="text-xs text-muted mt-1">جرّب تغيير فلاتر التاريخ أو كلمة البحث.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleNetworkList.map((network) => {
                const stats = calcNetworkStats(network);
                const isExpanded = expandedNetwork === network.uid;
                const displayName = network.networkName || `شبكة ${network.uid.substring(0, 10)}`;
                const showAllSales = Boolean(fullSales[network.uid]);
                const shownSales = showAllSales
                  ? stats.filteredSales
                  : stats.filteredSales.slice(0, SALE_ROW_LIMIT);
                const hiddenSales = stats.filteredSales.length - shownSales.length;

                return (
                  <div
                    key={network.uid}
                    className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-3 transition-all"
                  >
                    {/* رأس بطاقة الشبكة */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-brand-soft text-brand-deep flex items-center justify-center font-black text-sm flex-shrink-0">
                          {displayName.charAt(0)}
                        </div>
                        <div>
                          <h4 className="text-sm font-extrabold text-ink leading-tight">{displayName}</h4>
                          <p className="text-xs text-muted mt-0.5" dir="ltr">{network.phoneNumber || 'بدون هاتف'}</p>
                        </div>
                      </div>

                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-surface-sunken text-ink-soft">
                        {stats.completedCount} عملية
                      </span>
                    </div>

                    {/* مقاييس البطاقة المالية (أندرويد) */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-surface-sunken/60 border border-line/60">
                      <div>
                        <span className="text-[10px] text-muted block font-semibold">المبيعات المكتملة</span>
                        <span className="text-sm font-black text-ink font-mono">{formatNumber(stats.totalFaceValue)} ر.ي</span>
                      </div>
                      <div className="text-left">
                        <span className="text-[10px] text-muted block font-semibold">العمولة غير المسوّاة</span>
                        <span className="text-sm font-black text-emerald-600 font-mono">{formatNumber(stats.totalCommission)} ر.ي</span>
                      </div>
                    </div>

                    {/* زر التوسيع لعرض عمليات البيع */}
                    <button
                      type="button"
                      onClick={() => setExpandedNetwork(isExpanded ? null : network.uid)}
                      className="w-full flex items-center justify-between py-1.5 px-2 text-xs font-bold text-ink-soft hover:text-brand transition-colors"
                    >
                      <span>{isExpanded ? 'إخفاء سجل العمليات' : (network.fullHistoryLoaded ? `عرض العمليات (${stats.filteredSales.length})` : `عرض آخر ${stats.filteredSales.length} من ${stats.completedCount} عملية`)}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {/* قائمة العمليات كإيصالات أندرويد للموبايل */}
                    {isExpanded && (
                      <div className="pt-2 border-t border-line/80 space-y-2">
                        {stats.filteredSales.length === 0 ? (
                          <p className="text-xs text-center text-muted py-3">لا توجد عمليات بيع تطابق الفلاتر</p>
                        ) : (
                          shownSales.map((sale) => (
                            <div
                              key={sale.id}
                              className="p-2.5 rounded-xl bg-surface border border-line/60 space-y-1.5 hover:border-brand/40 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-black text-ink font-mono">
                                  {formatNumber(saleFaceValue(sale))} ر.ي
                                </span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusLabel[sale.status]?.class || 'bg-slate-100 text-slate-800'}`}>
                                    {statusLabel[sale.status]?.text || sale.status}
                                  </span>
                                  <SaleVerificationBadge sale={sale} />
                                </div>
                              </div>
                              <div className="flex items-center justify-between text-[11px] text-muted">
                                <span>الزبون: <strong className="text-ink-soft" dir="ltr">{sale.customerId || '—'}</strong></span>
                                <span dir="rtl">{formatDate(sale.createdAt, { withTime: true })}</span>
                              </div>
                              <div className="text-[11px] text-ink-soft pt-1 border-t border-line/40 flex justify-between">
                                <span>العمولة المحسوبة:</span>
                                <strong className="text-brand-deep font-mono">
                                  {saleCommission(sale) === null ? 'غير متحقق' : `${formatNumber(saleCommission(sale))} ر.ي`}
                                </strong>
                              </div>
                            </div>
                          ))
                        )}

                        {hiddenSales > 0 && (
                          <button
                            type="button"
                            onClick={() => setFullSales((prev) => ({ ...prev, [network.uid]: true }))}
                            className="w-full py-2 text-xs text-brand font-bold bg-brand-soft/30 rounded-xl hover:bg-brand-soft/50 transition-colors"
                          >
                            عرض باقي العمليات ({hiddenSales} إضافية)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {hasMoreNetworks && (
                <Button
                  variant="secondary"
                  size="md"
                  block
                  onClick={() => setVisibleNetworks((v) => v + NETWORK_PAGE_SIZE)}
                  className="rounded-xl font-bold"
                >
                  عرض المزيد من الشبكات ({filteredNetworks.length - visibleNetworkList.length} متبقية)
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 2: LIVE FEED ===================== */}
      {activeTab === 'live' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 text-xs">
            <span className="font-bold text-ink-soft flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              بث مباشر لآخر العمليات المسجلة على النظام:
            </span>
            <span className="text-muted">{allLiveSales.length} عملية</span>
          </div>

          {allLiveSales.length === 0 ? (
            <Card className="p-8 text-center rounded-2xl">
              <Inbox className="w-6 h-6 mx-auto mb-2 text-muted" />
              <p className="font-bold text-ink text-sm">لا توجد عمليات بعد</p>
              <p className="text-xs text-muted mt-1">ستظهر كل عملية بيع جديدة فور حدوثها هنا تلقائياً.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {allLiveSales.slice(0, 40).map((sale) => (
                <div
                  key={sale.id}
                  className="p-3 rounded-2xl bg-surface border border-line shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-ink">{sale.networkName}</p>
                      <p className="text-[11px] text-muted" dir="rtl">{formatDate(sale.createdAt, { withTime: true })}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-ink font-mono">{formatNumber(saleFaceValue(sale))} ر.ي</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusLabel[sale.status]?.class || 'bg-slate-100 text-slate-800'}`}>
                        {statusLabel[sale.status]?.text || sale.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1.5 border-t border-line/60 text-ink-soft">
                    <span>العميل: <strong dir="ltr">{sale.customerId || '—'}</strong></span>
                    <span>العمولة: <strong className="text-emerald-600 font-mono">{saleCommission(sale) === null ? '—' : `${formatNumber(saleCommission(sale))} ر.ي`}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================== TAB 3: STATS & SUMMARY ===================== */}
      {activeTab === 'stats' && (
        <div className="space-y-3">
          <Card className="p-4 rounded-2xl space-y-4">
            <h3 className="text-sm font-extrabold text-ink flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand" />
              التقرير المالي وحالة التسويات
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-2 border-b border-line">
                <span className="text-muted">إجمالي المبيعات المكتملة</span>
                <strong className="font-mono text-ink text-sm">{formatNumber(grandTotals.totalSales)} ريال</strong>
              </div>
              <div className="flex justify-between py-2 border-b border-line">
                <span className="text-muted">إجمالي العمولات غير المسوّاة</span>
                <strong className="font-mono text-emerald-600 text-sm">{formatNumber(grandTotals.totalCommission)} ريال</strong>
              </div>
              <div className="flex justify-between py-2 border-b border-line">
                <span className="text-muted">عدد الشبكات النشطة ذات المبيعات</span>
                <strong className="text-ink">{networkSales.length} شبكة</strong>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted">إجمالي العمليات المنجزة</span>
                <strong className="font-mono text-ink">{formatNumber(grandTotals.totalCount)} عملية</strong>
              </div>
            </div>

            <Button
              variant="primary"
              size="lg"
              block
              icon={Download}
              onClick={handleExportSales}
              className="mt-3 font-bold"
            >
              تصدير التقرير المالي الشامل (CSV)
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
