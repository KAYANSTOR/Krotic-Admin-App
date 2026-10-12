import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DollarSign, Filter, Download,
  ChevronDown, ChevronUp, Wallet, Inbox, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { PageSkeleton } from '../components/ui/Skeleton';
import useAppRefresh from '../lib/useAppRefresh';
import { formatNumber, formatDate } from '../lib/format';
import { downloadCsv, csvStamp } from '../lib/csv';
import { fetchNetworkSales, getAdminDataCacheState, subscribeAdminDataCache } from '../lib/adminData';

const NETWORK_PAGE_SIZE = 10;
const FILTER_STORAGE_KEY = 'krotak:sales-filters';

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

/** نُذكّر آخر فلتر استخدمه المدير حتى لا يعيد ضبطه في كل مرة. */
function loadSavedFilters() {
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      statusFilter: typeof parsed?.statusFilter === 'string' ? parsed.statusFilter : 'COMPLETED',
      dateFrom: typeof parsed?.dateFrom === 'string' ? parsed.dateFrom : '',
      dateTo: typeof parsed?.dateTo === 'string' ? parsed.dateTo : '',
    };
  } catch {
    return null;
  }
}
const SALE_ROW_LIMIT = 50;

export default function SalesPage() {
  const [networkSales, setNetworkSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedNetwork, setExpandedNetwork] = useState(null);
  const savedFilters = useMemo(loadSavedFilters, []);
  const [statusFilter, setStatusFilter] = useState(savedFilters?.statusFilter || 'COMPLETED');
  const [dateFrom, setDateFrom] = useState(savedFilters?.dateFrom || '');
  const [dateTo, setDateTo] = useState(savedFilters?.dateTo || '');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [cacheState, setCacheState] = useState(null);
  const [partialErrors, setPartialErrors] = useState([]);
  const [visibleNetworks, setVisibleNetworks] = useState(NETWORK_PAGE_SIZE);
  const [fullSales, setFullSales] = useState({});
  const latestRequestId = useRef(0);

  const load = useCallback(async ({ force = false } = {}) => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    try {
      const data = await fetchNetworkSales({ force });
      if (requestId !== latestRequestId.current) return;
      setNetworkSales(data);
      setPartialErrors(Array.isArray(data.errors) ? data.errors : []);
      setUpdatedAt(Date.now());
      setCacheState(getAdminDataCacheState('network-sales'));
    } catch (error) {
      if (requestId !== latestRequestId.current) return;
      console.error('Error fetching sales:', error);
      toast.error('خطأ في تحميل بيانات المبيعات');
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeAdminDataCache('network-sales', (data, state) => {
    setNetworkSales(data);
    setPartialErrors(Array.isArray(data.errors) ? data.errors : []);
    setUpdatedAt(Date.now());
    setCacheState(state);
    setLoading(false);
  }), []);

  useEffect(() => {
    load();
    return () => { latestRequestId.current += 1; };
  }, [load]);

  // السحب للأسفل على الجوال يعيد جلب بيانات المبيعات (force).
  useAppRefresh(() => load({ force: true }));

  const filterSales = useCallback((sales) => {
    return sales.filter((sale) => {
      if (statusFilter !== 'all' && sale.status !== statusFilter) return false;
      if (dateFrom || dateTo) {
        const saleDate = new Date(sale.createdAt);
        if (dateFrom && saleDate < new Date(dateFrom)) return false;
        if (dateTo) {
          const toDate = new Date(dateTo);
          toDate.setHours(23, 59, 59, 999);
          if (saleDate > toDate) return false;
        }
      }
      return true;
    });
  }, [statusFilter, dateFrom, dateTo]);

  const calcNetworkStats = useCallback((network) => {
    const filtered = filterSales(network.sales);
    const completed = filtered.filter((s) => s.status === 'COMPLETED');
    const totalFaceValue = completed.reduce((sum, s) => sum + (s.faceValue || 0), 0);
    return {
      totalSales: filtered.length,
      completedCount: completed.length,
      totalFaceValue,
      filteredSales: filtered,
    };
  }, [filterSales]);

  useEffect(() => {
    setVisibleNetworks(NETWORK_PAGE_SIZE);
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FILTER_STORAGE_KEY,
        JSON.stringify({ statusFilter, dateFrom, dateTo })
      );
    } catch {
      // التخزين المحلي قد يكون معطّلاً؛ الفلاتر تعمل بدون حفظ.
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

  const visibleNetworkList = useMemo(
    () => networkSales.slice(0, visibleNetworks),
    [networkSales, visibleNetworks]
  );
  const hasMoreNetworks = networkSales.length > visibleNetworkList.length;

  const grandTotals = useMemo(() => {
    return networkSales.reduce(
      (acc, network) => {
        const stats = calcNetworkStats(network);
        acc.totalSales += stats.totalFaceValue;
        acc.totalCount += stats.completedCount;
        return acc;
      },
      { totalSales: 0, totalCount: 0 }
    );
  }, [networkSales, calcNetworkStats]);

  const statusLabel = {
    COMPLETED: { text: 'مكتمل حسب التطبيق — غير متحقق', class: 'badge-warning' },
    ROLLED_BACK: { text: 'مسترجع حسب التطبيق — غير متحقق', class: 'badge-warning' },
    SMS_PENDING: { text: 'بانتظار SMS حسب التطبيق', class: 'badge-warning' },
  };

  const handleExportSales = useCallback(() => {
    const rows = networkSales.flatMap((network) => {
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
      { label: 'القيمة المرسلة من التطبيق (غير متحققة)', value: (r) => Math.round(Number(r.sale.faceValue) || 0) },
      { label: 'حالة التطبيق (غير متحققة)', value: (r) => r.sale.status || '' },
    ]);
    toast.success('تم تصدير السجلات المحمّلة فقط (حتى 50 سجلاً لكل شبكة)');
  }, [networkSales, calcNetworkStats]);

  const hasActiveFilters = statusFilter !== 'COMPLETED' || dateFrom || dateTo;

  const resetFilters = () => {
    setStatusFilter('COMPLETED');
    setDateFrom('');
    setDateTo('');
  };

  if (loading) return <PageSkeleton />;

  return (
    <div className="sales-page">
      <PageHeader
        icon={DollarSign}
        title="سجل المبيعات المبلّغ عنها"
        description="سجلات أبلغ بها التطبيق؛ القيم والحالات غير معتمدة خادمياً"
        actions={
          <DataFreshness updatedAt={updatedAt} lastSyncedAt={cacheState?.lastSyncedAt} refreshing={loading} fromCache={cacheState?.fromCache} onRefresh={() => load({ force: true })} />
        }
      />

      <p className="mb-4 text-sm text-ink-secondary" role="note">
        الملخص والتصدير يعتمدان على أحدث 50 سجلاً محمّلاً لكل شبكة؛ لا يتضمنان عمولة أو صافي APK ولا يمثلان كشف تسوية.
      </p>

      {partialErrors.length > 0 && (
        <div className="users-error users-error--warning mb-4" role="status" aria-live="polite">
          <span className="users-error__icon"><AlertCircle className="w-5 h-5" /></span>
          <div className="users-error__body">
            <p className="users-error__title">بعض الشبكات غير محمّلة</p>
            <p className="users-error__msg">
              تعذّر تجميع مبيعات {partialErrors.length} شبكة. غالباً السبب فهرس Firestore المركّب الناقص على
              المبيعات (status + faceValue)؛ باقي الشبكات معروضة أدناه.
            </p>
            <details className="users-error__details">
              <summary>عرض التفاصيل</summary>
              <ul>
                {partialErrors.map((message, index) => (
                  <li key={index} dir="ltr">{message}</li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}

      <div className="grid-kpi">
        <StatCard title="قيمة السجلات المبلّغ عنها (غير متحققة)" value={formatNumber(grandTotals.totalSales)} icon={DollarSign} tone="brand" subtitle="ريال يمني • أحدث 50/شبكة" />
        <StatCard title="حالات اكتمال أبلغ بها التطبيق" value={formatNumber(grandTotals.totalCount)} icon={Wallet} tone="warning" subtitle="غير متحققة • ضمن السجلات المحمّلة" />
      </div>

      <Card className="sales-filters">
        <div className="sales-filters__head">
          <div className="sales-filters__title">
            <Filter className="w-4 h-4" aria-hidden="true" />
            <span>تصفية النتائج</span>
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="sales-filters__reset">
              إعادة تعيين
            </button>
          )}
        </div>
        <div className="sales-filters__presets" role="group" aria-label="فلاتر تاريخ سريعة">
          <button
            type="button"
            className={`sales-preset ${!dateFrom && !dateTo ? 'is-active' : ''}`}
            aria-pressed={!dateFrom && !dateTo}
            onClick={() => { setDateFrom(''); setDateTo(''); }}
          >
            الكل
          </button>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`sales-preset ${activePreset === preset.key ? 'is-active' : ''}`}
              aria-pressed={activePreset === preset.key}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="sales-filters__grid">
          <div className="sales-filters__field">
            <label className="label-field">حالة البيع</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field">
              <option value="all">الكل</option>
              <option value="COMPLETED">مكتمل حسب التطبيق (غير متحقق)</option>
              <option value="ROLLED_BACK">مسترجع حسب التطبيق (غير متحقق)</option>
              <option value="SMS_PENDING">بانتظار SMS حسب التطبيق</option>
            </select>
          </div>
          <div className="sales-filters__field">
            <label className="label-field">من تاريخ</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div className="sales-filters__field">
            <label className="label-field">إلى تاريخ</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
        </div>
      </Card>

      <Section
        eyebrow="السجل"
        title="شبكات المبيعات"
        description={`${formatNumber(networkSales.length)} شبكة لديها مبيعات مسجّلة`}
        action={
          <Button variant="secondary" size="sm" icon={Download} onClick={handleExportSales}>
            تصدير CSV
          </Button>
        }
      >
      <div className="sales-networks">
        {networkSales.length === 0 ? (
          <Card className="sales-empty">
            <span className="sales-empty__icon icon-tile icon-tile--neutral icon-tile--lg">
              <Inbox className="w-6 h-6" aria-hidden="true" />
            </span>
            <p className="sales-empty__title">لا يوجد مبيعات مسجلة بعد</p>
            <p className="sales-empty__desc">
              ستظهر هنا سجلات البيع التي يرسلها التطبيق، دون اعتبارها اعتماداً مالياً.
            </p>
          </Card>
        ) : (
          visibleNetworkList.map((network) => {
            const stats = calcNetworkStats(network);
            const isExpanded = expandedNetwork === network.uid;
            const displayName = network.networkName || network.uid.substring(0, 12);
            const showAllSales = Boolean(fullSales[network.uid]);
            const shownSales = showAllSales
              ? stats.filteredSales
              : stats.filteredSales.slice(0, SALE_ROW_LIMIT);
            const hiddenSales = stats.filteredSales.length - shownSales.length;

            return (
              <div
                key={network.uid}
                className={`card card--flush sales-network ${isExpanded ? 'is-expanded' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedNetwork(isExpanded ? null : network.uid)}
                  className="sales-network__toggle"
                  aria-expanded={isExpanded}
                >
                  <div className="sales-network__identity">
                    <span className="sales-network__avatar icon-tile icon-tile--brand">
                      <DollarSign className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div className="sales-network__meta">
                      <p className="sales-network__name">{displayName}</p>
                      <p className="sales-network__phone" dir="ltr">
                        {network.phoneNumber || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="sales-network__stats">
                    <div className="sales-network__stat">
                      <span className="sales-network__stat-label">القيمة المبلّغ عنها (غير متحققة)</span>
                      <span className="sales-network__stat-value">
                        {formatNumber(stats.totalFaceValue)}
                      </span>
                    </div>
                    <div className="sales-network__stat">
                      <span className="sales-network__stat-label">حالات مكتملة حسب التطبيق (غير متحققة)</span>
                      <span className="sales-network__stat-value">
                        {formatNumber(stats.completedCount)}
                      </span>
                    </div>
                    <span className="sales-network__chevron">
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="w-5 h-5" aria-hidden="true" />
                      )}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="sales-network__body">
                    <div className="sales-network__mobile-stats">
                      <div className="sales-network__mobile-stat">
                        <span>قيمة مبلّغ عنها (غير متحققة)</span>
                        <strong>{formatNumber(stats.totalFaceValue)}</strong>
                      </div>
                      <div className="sales-network__mobile-stat">
                        <span>حالات اكتمال أبلغ بها التطبيق</span>
                        <strong>{formatNumber(stats.completedCount)}</strong>
                      </div>
                    </div>

                    {stats.filteredSales.length === 0 ? (
                      <div className="sales-network__empty">
                        <AlertCircle className="w-5 h-5" aria-hidden="true" />
                        <span>لا توجد مبيعات مطابقة للفلاتر الحالية</span>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="responsive-data-table w-full">
                          <thead>
                            <tr className="table-header">
                              <th className="text-right px-6 py-3">التاريخ</th>
                              <th className="text-right px-6 py-3">الزبون</th>
                              <th className="text-right px-6 py-3">القيمة المرسلة (غير متحققة)</th>
                              <th className="text-right px-6 py-3">حالة التطبيق (غير متحققة)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {shownSales.map((sale) => (
                              <tr key={sale.id} className="hover:bg-surface-sunken">
                                <td className="px-6 py-3 text-sm text-ink-soft" data-label="التاريخ">
                                  {formatDate(sale.createdAt, { withTime: true })}
                                </td>
                                <td className="px-6 py-3 text-sm" dir="ltr" data-label="الزبون">
                                  {sale.customerId || '—'}
                                </td>
                                <td className="px-6 py-3 text-sm font-medium" data-label="القيمة المرسلة (غير متحققة)">
                                  {formatNumber(sale.faceValue)}
                                </td>
                                <td className="px-6 py-3" data-label="حالة التطبيق (غير متحققة)">
                                  <span className={statusLabel[sale.status]?.class || 'badge-info'}>
                                    {statusLabel[sale.status]?.text || sale.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {hiddenSales > 0 && (
                      <div className="sales-network__more">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={ChevronDown}
                          onClick={() => setFullSales((prev) => ({ ...prev, [network.uid]: true }))}
                        >
                          عرض بقية السجلات المحمّلة ({formatNumber(hiddenSales)})
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {networkSales.length > 0 && (
        <div className="list-footer">
          <p className="list-footer__count">
            يُعرض {formatNumber(visibleNetworkList.length)} من {formatNumber(networkSales.length)} شبكة
          </p>
          {hasMoreNetworks && (
            <Button
              variant="secondary"
              icon={ChevronDown}
              onClick={() => setVisibleNetworks((count) => count + NETWORK_PAGE_SIZE)}
            >
              عرض المزيد
            </Button>
          )}
        </div>
      )}
      </Section>
    </div>
  );
}
