import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign, TrendingUp, Filter, RefreshCw,
  ChevronDown, ChevronUp, Receipt, Wallet, Inbox, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import Button from '../components/ui/Button';
import StatCard from '../components/ui/StatCard';
import Section from '../components/ui/Section';
import DataFreshness from '../components/ui/DataFreshness';
import { PageSkeleton } from '../components/ui/Skeleton';
import { formatNumber, formatDate } from '../lib/format';
import { fetchNetworkSales, clearAdminDataCache } from '../lib/adminData';

const NETWORK_PAGE_SIZE = 10;
const SALE_ROW_LIMIT = 50;

export default function SalesPage() {
  const [networkSales, setNetworkSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedNetwork, setExpandedNetwork] = useState(null);
  const [statusFilter, setStatusFilter] = useState('COMPLETED');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [visibleNetworks, setVisibleNetworks] = useState(NETWORK_PAGE_SIZE);
  const [fullSales, setFullSales] = useState({});

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    if (force) clearAdminDataCache();
    try {
      const data = await fetchNetworkSales();
      setNetworkSales(data);
      setUpdatedAt(Date.now());
    } catch (error) {
      console.error('Error fetching sales:', error);
      toast.error('خطأ في تحميل بيانات المبيعات');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    const totalNetAmount = completed.reduce((sum, s) => sum + (s.netAmount || 0), 0);
    const adminEarnings = totalFaceValue * (network.commissionRate / 100);
    return {
      totalSales: filtered.length,
      completedCount: completed.length,
      totalFaceValue,
      totalNetAmount,
      adminEarnings,
      filteredSales: filtered,
    };
  }, [filterSales]);

  useEffect(() => {
    setVisibleNetworks(NETWORK_PAGE_SIZE);
  }, [statusFilter, dateFrom, dateTo]);

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
        acc.totalNet += stats.totalNetAmount;
        acc.totalEarnings += stats.adminEarnings;
        acc.totalCount += stats.completedCount;
        return acc;
      },
      { totalSales: 0, totalNet: 0, totalEarnings: 0, totalCount: 0 }
    );
  }, [networkSales, calcNetworkStats]);

  const statusLabel = {
    COMPLETED: { text: 'مكتمل', class: 'badge-success' },
    ROLLED_BACK: { text: 'مسترجع', class: 'badge-danger' },
    SMS_PENDING: { text: 'بانتظار SMS', class: 'badge-warning' },
  };

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
        title="المبيعات والعمولات"
        description="سجل مبيعات جميع الشبكات وأرباح الإدارة"
        actions={
          <DataFreshness updatedAt={updatedAt} refreshing={loading} onRefresh={() => load({ force: true })} />
        }
      />

      <div className="grid-kpi">
        <StatCard title="إجمالي المبيعات" value={formatNumber(grandTotals.totalSales)} icon={DollarSign} tone="brand" subtitle="ريال يمني" />
        <StatCard title="إجمالي الصافي" value={formatNumber(grandTotals.totalNet)} icon={Receipt} tone="neutral" subtitle="ريال يمني" />
        <StatCard title="أرباح الإدارة" value={formatNumber(grandTotals.totalEarnings)} icon={TrendingUp} tone="gold" subtitle="ريال يمني" />
        <StatCard title="عمليات مكتملة" value={formatNumber(grandTotals.totalCount)} icon={Wallet} tone="success" subtitle="عملية" />
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
        <div className="sales-filters__grid">
          <div className="sales-filters__field">
            <label className="label-field">حالة البيع</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field">
              <option value="all">الكل</option>
              <option value="COMPLETED">مكتمل</option>
              <option value="ROLLED_BACK">مسترجع</option>
              <option value="SMS_PENDING">بانتظار SMS</option>
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
      >
      <div className="sales-networks">
        {networkSales.length === 0 ? (
          <Card className="sales-empty">
            <span className="sales-empty__icon icon-tile icon-tile--neutral icon-tile--lg">
              <Inbox className="w-6 h-6" aria-hidden="true" />
            </span>
            <p className="sales-empty__title">لا يوجد مبيعات مسجلة بعد</p>
            <p className="sales-empty__desc">
              ستظهر هنا مبيعات الشبكات وأرباح الإدارة بمجرد تسجيل أول عملية.
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
                      <span className="sales-network__stat-label">المبيعات</span>
                      <span className="sales-network__stat-value">
                        {formatNumber(stats.totalFaceValue)}
                      </span>
                    </div>
                    <div className="sales-network__stat">
                      <span className="sales-network__stat-label">
                        العمولة ({network.commissionRate}%)
                      </span>
                      <span className="sales-network__stat-value sales-network__stat-value--gold">
                        {formatNumber(stats.adminEarnings)}
                      </span>
                    </div>
                    <div className="sales-network__stat sales-network__stat--count">
                      <span className="sales-network__stat-label">عمليات</span>
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
                        <span>المبيعات</span>
                        <strong>{formatNumber(stats.totalFaceValue)}</strong>
                      </div>
                      <div className="sales-network__mobile-stat">
                        <span>العمولة ({network.commissionRate}%)</span>
                        <strong className="sales-network__stat-value--gold">
                          {formatNumber(stats.adminEarnings)}
                        </strong>
                      </div>
                      <div className="sales-network__mobile-stat">
                        <span>عمليات مكتملة</span>
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
                              <th className="text-right px-6 py-3">القيمة</th>
                              <th className="text-right px-6 py-3">العمولة (صراف)</th>
                              <th className="text-right px-6 py-3">الصافي</th>
                              <th className="text-right px-6 py-3">الحالة</th>
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
                                <td className="px-6 py-3 text-sm font-medium" data-label="القيمة">
                                  {formatNumber(sale.faceValue)}
                                </td>
                                <td className="px-6 py-3 text-sm text-ink-soft" data-label="العمولة (صراف)">
                                  {formatNumber(sale.commission)}
                                </td>
                                <td className="px-6 py-3 text-sm font-medium" data-label="الصافي">
                                  {formatNumber(sale.netAmount)}
                                </td>
                                <td className="px-6 py-3" data-label="الحالة">
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
                          عرض {formatNumber(hiddenSales)} عملية إضافية
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
