// src/pages/SalesPage.jsx
import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DollarSign, TrendingUp, Filter, RefreshCw,
  ChevronDown, ChevronUp, Receipt, Wallet, Inbox, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import StatsCard from '../components/StatsCard';

export default function SalesPage() {
  const [networkSales, setNetworkSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedNetwork, setExpandedNetwork] = useState(null);
  const [statusFilter, setStatusFilter] = useState('COMPLETED');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    fetchSales();
  }, []);

  const fetchSales = async () => {
    setLoading(true);
    try {
      // Fetch global config
      const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
      let globalCommission = 5;
      if (configDoc.exists()) {
        globalCommission = configDoc.data().default_commission_rate || 5;
      }

      const usersSnap = await getDocs(collection(db, 'users'));
      const allNetworkSales = [];

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();

        // Fetch network metadata
        let networkName = '';
        let phoneNumber = '';
        try {
          const metaDoc = await getDoc(
            doc(db, 'networks', userDoc.id, '_metadata', 'info')
          );
          if (metaDoc.exists()) {
            networkName = metaDoc.data().name || '';
            phoneNumber = metaDoc.data().phoneNumber || '';
          }
        } catch (e) {}

        // Active rate
        const activeRate = (userData.commission_rate != null && userData.commission_rate > 0)
          ? userData.commission_rate
          : globalCommission;

        // Fetch sales
        const salesSnap = await getDocs(
          collection(db, 'networks', userDoc.id, 'sales')
        );
        const sales = [];
        salesSnap.forEach((saleDoc) => {
          sales.push({ id: saleDoc.id, ...saleDoc.data() });
        });

        if (sales.length > 0) {
          allNetworkSales.push({
            uid: userDoc.id,
            networkName,
            phoneNumber,
            commissionRate: activeRate,
            isCustomRate: userData.commission_rate != null && userData.commission_rate > 0,
            sales,
          });
        }
      }

      setNetworkSales(allNetworkSales);
    } catch (error) {
      console.error('Error fetching sales:', error);
      toast.error('خطأ في تحميل بيانات المبيعات');
    }
    setLoading(false);
  };

  const filterSales = (sales) => {
    return sales.filter((sale) => {
      // Status filter
      if (statusFilter !== 'all' && sale.status !== statusFilter) return false;

      // Date filter
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
  };

  const calcNetworkStats = (network) => {
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
  };

  // Grand totals
  const grandTotals = networkSales.reduce(
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

  const formatNumber = (num) => {
    return new Intl.NumberFormat('ar-YE').format(Math.round(num || 0));
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleDateString('ar-YE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

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

  if (loading) return <LoadingSpinner size="lg" />;

  return (
    <div className="sales-page">
      {/* Page Header */}
      <div className="sales-header">
        <div className="sales-header__main">
          <span className="sales-header__icon icon-tile icon-tile--brand icon-tile--lg">
            <DollarSign className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="page-title">المبيعات والعمولات</h1>
            <p className="sales-header__desc">سجل مبيعات جميع الشبكات وأرباح الإدارة</p>
          </div>
        </div>
        <div className="sales-header__actions">
          <button
            onClick={fetchSales}
            className="btn-secondary flex items-center gap-2"
            type="button"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </button>
        </div>
      </div>

      {/* Grand Totals */}
      <div className="sales-kpi">
        <StatsCard
          title="إجمالي المبيعات"
          value={formatNumber(grandTotals.totalSales)}
          icon={DollarSign}
          color="blue"
          subtitle="ريال يمني"
        />
        <StatsCard
          title="إجمالي الصافي"
          value={formatNumber(grandTotals.totalNet)}
          icon={Receipt}
          color="cyan"
          subtitle="ريال يمني"
        />
        <StatsCard
          title="أرباح الإدارة"
          value={formatNumber(grandTotals.totalEarnings)}
          icon={TrendingUp}
          color="purple"
          subtitle="ريال يمني"
        />
        <StatsCard
          title="عمليات مكتملة"
          value={formatNumber(grandTotals.totalCount)}
          icon={Wallet}
          color="green"
          subtitle="عملية"
        />
      </div>

      {/* Filters */}
      <div className="card sales-filters">
        <div className="sales-filters__head">
          <div className="sales-filters__title">
            <Filter className="w-4 h-4" aria-hidden="true" />
            <span>تصفية النتائج</span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="sales-filters__reset"
            >
              إعادة تعيين
            </button>
          )}
        </div>
        <div className="sales-filters__grid">
          <div className="sales-filters__field">
            <label className="label-field">حالة البيع</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field"
            >
              <option value="all">الكل</option>
              <option value="COMPLETED">مكتمل</option>
              <option value="ROLLED_BACK">مسترجع</option>
              <option value="SMS_PENDING">بانتظار SMS</option>
            </select>
          </div>
          <div className="sales-filters__field">
            <label className="label-field">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>
          <div className="sales-filters__field">
            <label className="label-field">إلى تاريخ</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field"
            />
          </div>
        </div>
      </div>

      {/* Networks Sales */}
      <div className="sales-networks">
        {networkSales.length === 0 ? (
          <div className="card sales-empty">
            <span className="sales-empty__icon icon-tile icon-tile--neutral icon-tile--lg">
              <Inbox className="w-6 h-6" aria-hidden="true" />
            </span>
            <p className="sales-empty__title">لا يوجد مبيعات مسجلة بعد</p>
            <p className="sales-empty__desc">
              ستظهر هنا مبيعات الشبكات وأرباح الإدارة بمجرد تسجيل أول عملية.
            </p>
          </div>
        ) : (
          networkSales.map((network) => {
            const stats = calcNetworkStats(network);
            const isExpanded = expandedNetwork === network.uid;
            const displayName = network.networkName || network.uid.substring(0, 12);

            return (
              <div
                key={network.uid}
                className={`card card--flush sales-network ${isExpanded ? 'is-expanded' : ''}`}
              >
                {/* Network Header */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedNetwork(isExpanded ? null : network.uid)
                  }
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

                {/* Expanded Sales Table */}
                {isExpanded && (
                  <div className="sales-network__body">
                    {/* Mobile stats */}
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
                          <tbody className="divide-y divide-gray-50">
                            {stats.filteredSales.map((sale) => (
                              <tr key={sale.id} className="hover:bg-gray-50">
                                <td
                                  className="px-6 py-3 text-sm text-gray-600"
                                  data-label="التاريخ"
                                >
                                  {formatDate(sale.createdAt)}
                                </td>
                                <td
                                  className="px-6 py-3 text-sm"
                                  dir="ltr"
                                  data-label="الزبون"
                                >
                                  {sale.customerId || '—'}
                                </td>
                                <td
                                  className="px-6 py-3 text-sm font-medium"
                                  data-label="القيمة"
                                >
                                  {formatNumber(sale.faceValue)}
                                </td>
                                <td
                                  className="px-6 py-3 text-sm text-gray-600"
                                  data-label="العمولة (صراف)"
                                >
                                  {formatNumber(sale.commission)}
                                </td>
                                <td
                                  className="px-6 py-3 text-sm font-medium"
                                  data-label="الصافي"
                                >
                                  {formatNumber(sale.netAmount)}
                                </td>
                                <td className="px-6 py-3" data-label="الحالة">
                                  <span
                                    className={
                                      statusLabel[sale.status]?.class || 'badge-info'
                                    }
                                  >
                                    {statusLabel[sale.status]?.text || sale.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
