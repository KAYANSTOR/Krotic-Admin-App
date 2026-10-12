import { useState, useEffect, useRef } from 'react';
import { DollarSign, CreditCard, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import FinancialVerificationNotice from './ui/FinancialVerificationNotice';
import LoadingSpinner from './LoadingSpinner';
import { formatNumber, toDate } from '../lib/format';
import { monthKeyFromDate } from '../lib/billingHelpers';
import {
  fetchUserBillingHistory,
  subscribeAdminDataCache,
} from '../lib/adminData';

export default function UserBillingModal({ isOpen, onClose, user }) {
  const userUid = user?.uid;
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedForUid, setLoadedForUid] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const refreshRequestId = useRef(0);

  useEffect(() => {
    if (!isOpen || !userUid) {
      refreshRequestId.current += 1;
      return undefined;
    }
    return subscribeAdminDataCache(`billing-history:${userUid}`, (history) => {
      setSales(history.sales);
      setPayments(history.payments);
      setLoadedForUid(userUid);
      setLoading(false);
    });
  }, [isOpen, userUid]);

  useEffect(() => {
    if (!isOpen || !userUid) return undefined;
    let active = true;
    setLoading(true);
    setHistoryError(null);
    setSales([]);
    setPayments([]);
    setLoadedForUid(null);
    fetchUserBillingHistory(userUid)
      .then((history) => {
        if (!active) return;
        setSales(history.sales);
        setPayments(history.payments);
        setLoadedForUid(userUid);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Error fetching financials:', error);
        setSales([]);
        setPayments([]);
        setHistoryError('تعذر تحميل سجل المبيعات والدفعات لهذا الحساب. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.');
        setLoadedForUid(userUid);
        toast.error('حدث خطأ أثناء جلب البيانات المالية');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      refreshRequestId.current += 1;
    };
  }, [isOpen, userUid]);

  const refreshBillingHistory = async () => {
    if (!userUid) return;
    const requestId = ++refreshRequestId.current;
    const requestedUid = userUid;
    setRefreshingHistory(true);
    try {
      const history = await fetchUserBillingHistory(requestedUid, { force: true });
      if (requestId !== refreshRequestId.current) return;
      setSales(history.sales);
      setPayments(history.payments);
      setLoadedForUid(requestedUid);
      toast.success('تم تحميل أحدث سجل كامل من خادم Firestore؛ لا يعني ذلك اعتماداً مالياً');
    } catch (error) {
      if (requestId !== refreshRequestId.current) return;
      console.error('Error refreshing financial history from server:', error);
      toast.error('تعذر تحميل السجل من الخادم؛ لم تُعرض النتيجة على أنها مصالحة مؤكدة');
    } finally {
      if (requestId === refreshRequestId.current) setRefreshingHistory(false);
    }
  };

  if (!isOpen || !user) return null;

  const monthsData = {};
  sales.forEach((sale) => {
    if (sale.status === 'COMPLETED' && sale.createdAt) {
      let date = null;
      try {
        date = toDate(sale.createdAt);
      } catch (error) {
        console.warn('Skipping sale with invalid createdAt:', error);
      }
      const monthKey = monthKeyFromDate(date);
      if (!monthKey) return;
      if (!monthsData[monthKey]) {
        monthsData[monthKey] = { reportedSales: 0, recordedPayments: 0 };
      }
      monthsData[monthKey].reportedSales += Number(sale.faceValue) || 0;
    }
  });

  payments.forEach((payment) => {
    const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(payment.month || '')
      ? payment.month
      : monthKeyFromDate(payment.timestamp);
    if (!monthKey) return;
    if (!monthsData[monthKey]) {
      monthsData[monthKey] = { reportedSales: 0, recordedPayments: 0 };
    }
    monthsData[monthKey].recordedPayments += Number(payment.amount) || 0;
  });

  const sortedMonths = Object.keys(monthsData).sort().reverse();

  let totalReportedSales = 0;
  let totalRecordedPayments = 0;
  Object.values(monthsData).forEach((m) => {
    totalReportedSales += m.reportedSales;
    totalRecordedPayments += m.recordedPayments;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={DollarSign}
      title={`سجل المبيعات والدفعات: ${user.networkName || 'الشبكة'}`}
      description="سجل تشغيلي؛ لا يمثل كشف عمولة أو تسوية خادمية معتمدة"
    >
      {loading || loadedForUid !== userUid ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-6">
          <FinancialVerificationNotice />
          {historyError && <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger-ink" role="alert">{historyError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="summary-block summary-block--gold">
              <p>قيمة مبيعات أبلغ بها التطبيق — غير متحققة (ريال يمني)</p>
              <strong>{formatNumber(totalReportedSales)}</strong>
            </div>
            <div className="summary-block summary-block--success">
              <p>دفعات مسجلة في اللوحة — ليست تسوية خادمية (ريال يمني)</p>
              <strong>{formatNumber(totalRecordedPayments)}</strong>
            </div>
          </div>

          <div className="bg-[var(--ui-sunken)] p-5 rounded-2xl border border-[var(--ui-line)]">
            <h4 className="font-bold flex items-center gap-2 mb-1"><CreditCard className="w-5 h-5" /> تسجيل/تسوية دفعة</h4>
            <p className="text-xs text-ink-secondary mb-4">
              تم إيقاف الكتابة المباشرة مؤقتاً. لا يمكن اعتماد دفعة أو تغيير حالة الحساب من المتصفح قبل توفير مسار خادمي idempotent وسياسة تسوية معتمدة.
            </p>
          </div>

          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <h4 className="font-bold flex items-center gap-2"><CreditCard className="w-5 h-5" /> تفاصيل الأشهر</h4>
              <Button variant="secondary" size="sm" icon={RefreshCw} loading={refreshingHistory} onClick={refreshBillingHistory}>
                تحديث كامل من الخادم
              </Button>
            </div>
            {sortedMonths.length === 0 ? (
              <p className="text-ink-secondary text-center py-4">لا يوجد حركات مسجلة</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="responsive-data-table w-full text-sm">
                  <thead>
                    <tr className="table-header">
                      <th className="px-4 py-3 text-right">الشهر</th>
                      <th className="px-4 py-3 text-right">قيمة مبيعات مُبلغ عنها وغير متحققة (ريال يمني)</th>
                      <th className="px-4 py-3 text-right">دفعات مسجلة وغير مسواة خادمياً (ريال يمني)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sortedMonths.map((month) => {
                      const m = monthsData[month];
                      return (
                        <tr key={month} className="hover:bg-surface-sunken">
                          <td className="px-4 py-3 font-bold" dir="ltr" data-label="الشهر">{month}</td>
                          <td className="px-4 py-3 text-ink-soft" data-label="قيمة مبيعات مُبلغ عنها وغير متحققة">{formatNumber(m.reportedSales)}</td>
                          <td className="px-4 py-3 text-ink-soft font-medium" data-label="دفعات مسجلة وغير مسواة خادمياً">{formatNumber(m.recordedPayments)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
