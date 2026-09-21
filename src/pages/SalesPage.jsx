import { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  DollarSign, TrendingUp, Search, Filter, RefreshCw,
  ChevronDown, ChevronUp, Receipt
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

  if (loading) return <LoadingSpinner size="lg" />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="page-title flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-primary-600" />
            المبيعات والعمولات
          </h1>
          <p className="text-gray-500 mt-1">سجل مبيعات جميع الشبكات</p>
        </div>
        <button onClick={fetchSales} className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          تحديث
        </button>
      </div>

      {/* Grand Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          icon={DollarSign}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div>
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
          <div>
            <label className="label-field">من تاريخ</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
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
      <div className="space-y-4">
        {networkSales.length === 0 ? (
          <div className="card text-center py-12 text-gray-500">
            لا يوجد مبيعات مسجلة بعد
          </div>
        ) : (
          networkSales.map((network) => {
            const stats = calcNetworkStats(network);
            const isExpanded = expandedNetwork === network.uid;

            return (
              <div key={network.uid} className="card p-0 overflow-hidden">
                {/* Network Header */}
                <button
                  onClick={() =>
                    setExpandedNetwork(isExpanded ? null : network.uid)
                  }
                  className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-primary-600" />
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {network.networkName || network.uid.substring(0, 12)}
                      </p>
                      <p className="text-sm text-gray-500" dir="ltr">
                        {network.phoneNumber}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="hidden sm:flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="text-gray-500">المبيعات</p>
                        <p className="font-bold text-gray-900">
                          {formatNumber(stats.totalFaceValue)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-500">العمولة ({network.commissionRate}%)</p>
                        <p className="font-bold text-purple-600">
                          {formatNumber(stats.adminEarnings)}
                        </p>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </button>

                {/* Expanded Sales Table */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    {/* Mobile stats */}
                    <div className="sm:hidden p-4 bg-gray-50 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-500">المبيعات</p>
                        <p className="font-bold">{formatNumber(stats.totalFaceValue)}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">العمولة ({network.commissionRate}%)</p>
                        <p className="font-bold text-purple-600">
                          {formatNumber(stats.adminEarnings)}
                        </p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
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
                              <td className="px-6 py-3 text-sm text-gray-600">
                                {formatDate(sale.createdAt)}
                              </td>
                              <td className="px-6 py-3 text-sm" dir="ltr">
                                {sale.customerId || '—'}
                              </td>
                              <td className="px-6 py-3 text-sm font-medium">
                                {formatNumber(sale.faceValue)}
                              </td>
                              <td className="px-6 py-3 text-sm text-gray-600">
                                {formatNumber(sale.commission)}
                              </td>
                              <td className="px-6 py-3 text-sm font-medium">
                                {formatNumber(sale.netAmount)}
                              </td>
                              <td className="px-6 py-3">
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
