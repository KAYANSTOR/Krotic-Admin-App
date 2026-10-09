import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, orderBy, Timestamp, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { DollarSign, PlusCircle, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';
import LoadingSpinner from './LoadingSpinner';
import { formatNumber } from '../lib/format';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

export default function UserBillingModal({ isOpen, onClose, user, globalCommission }) {
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [isAddingPayment, setIsAddingPayment] = useState(false);

  useEffect(() => {
    if (user && isOpen) {
      fetchFinancials();
    }
  }, [user, isOpen]);

  const fetchFinancials = async () => {
    setLoading(true);
    try {
      const salesSnap = await getDocs(collection(db, 'networks', user.uid, 'sales'));
      const salesData = [];
      salesSnap.forEach((doc) => salesData.push({ id: doc.id, ...doc.data() }));
      setSales(salesData);

      const paymentsRef = collection(db, 'networks', user.uid, 'payments');
      const q = query(paymentsRef, orderBy('timestamp', 'desc'));
      const paymentsSnap = await getDocs(q);
      const paymentsData = [];
      paymentsSnap.forEach((doc) => paymentsData.push({ id: doc.id, ...doc.data() }));
      setPayments(paymentsData);
    } catch (error) {
      console.error('Error fetching financials:', error);
      toast.error('حدث خطأ أثناء جلب البيانات المالية');
    }
    setLoading(false);
  };

  const notifyClientPayment = async (paidAmount, monthKey) => {
    const monthLabel = monthKey || 'الشهر الحالي';
    const formattedAmount = new Intl.NumberFormat('ar-YE').format(Math.round(paidAmount));
    const title = 'تم سداد عمولة';
    const body = `تم تسجيل سداد مبلغ ${formattedAmount} ريال يمني لعمولة شهر ${monthLabel}. يتم تحديث المتبقي تلقائياً في حسابك.`;

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        console.warn('notifyClientPayment: no admin token');
        return;
      }

      const res = await fetch('/api/send-fcm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          title,
          body,
          targetUid: user.uid,
          data: {
            route: '/commission',
            type: 'commission_payment',
            month: monthKey,
            amount: String(paidAmount),
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        console.warn('notifyClientPayment: FCM failed', data.error || res.status);
      }
    } catch (err) {
      console.warn('notifyClientPayment: network error', err);
    }

    try {
      await addDoc(collection(db, 'users', user.uid, 'notifications'), {
        title,
        message: body,
        body,
        is_read: false,
        type: 'commission_payment',
        month: monthKey,
        amount: paidAmount,
        timestamp: Date.now(),
        createdAt: serverTimestamp(),
      });
    } catch (logErr) {
      console.warn('notifyClientPayment: inbox write failed', logErr);
    }
  };

  const handleAddPayment = async (e) => {
    e.preventDefault();
    if (!amount || amount <= 0) {
      toast.error('يرجى إدخال مبلغ صحيح');
      return;
    }
    if (!selectedMonth) {
      toast.error('يرجى اختيار الشهر الخاص بالدفعة');
      return;
    }

    setIsAddingPayment(true);
    const paidValue = parseFloat(amount);
    const monthKey = selectedMonth;

    try {
      await addDoc(collection(db, 'networks', user.uid, 'payments'), {
        amount: paidValue,
        month: monthKey,
        timestamp: Timestamp.now(),
      });

      await notifyClientPayment(paidValue, monthKey);

      logAdminAction({
        action: AUDIT_ACTIONS.PAYMENT_ADD,
        targetType: 'user',
        targetId: user.uid,
        targetLabel: user.networkName || user.phoneNumber || user.uid,
        details: { amount: paidValue, month: monthKey },
      });

      toast.success('تمت إضافة الدفعة وإشعار العميل بنجاح');
      setAmount('');
      fetchFinancials();
    } catch (error) {
      console.error('Error adding payment:', error);
      toast.error('حدث خطأ أثناء إضافة الدفعة');
    }
    setIsAddingPayment(false);
  };

  if (!isOpen || !user) return null;

  const monthsData = {};
  const activeRate =
    user.commission_rate != null && user.commission_rate > 0
      ? user.commission_rate
      : globalCommission;

  sales.forEach((sale) => {
    if (sale.status === 'COMPLETED' && sale.createdAt) {
      const date = new Date(sale.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthsData[monthKey]) {
        monthsData[monthKey] = { salesTotal: 0, commissionDue: 0, paid: 0 };
      }
      monthsData[monthKey].salesTotal += sale.faceValue || 0;
      monthsData[monthKey].commissionDue += (sale.faceValue || 0) * (activeRate / 100);
    }
  });

  payments.forEach((payment) => {
    const monthKey = payment.month;
    if (!monthsData[monthKey]) {
      monthsData[monthKey] = { salesTotal: 0, commissionDue: 0, paid: 0 };
    }
    monthsData[monthKey].paid += payment.amount;
  });

  const sortedMonths = Object.keys(monthsData).sort().reverse();

  let totalDue = 0;
  let totalPaid = 0;
  Object.values(monthsData).forEach((m) => {
    totalDue += m.commissionDue;
    totalPaid += m.paid;
  });
  const overallBalance = totalDue - totalPaid;

  const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={DollarSign}
      title={`المالية والفوترة: ${user.networkName || 'الشبكة'}`}
      description={`العمولة المطبقة: ${activeRate}%`}
    >
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="summary-block summary-block--gold">
              <p>إجمالي المستحقات (ريال يمني)</p>
              <strong>{formatNumber(totalDue)}</strong>
            </div>
            <div className="summary-block summary-block--success">
              <p>إجمالي المدفوع (ريال يمني)</p>
              <strong>{formatNumber(totalPaid)}</strong>
            </div>
            <div className={`summary-block ${overallBalance > 0 ? 'summary-block--danger' : 'summary-block--neutral'}`}>
              <p>الديون المتبقية (ريال يمني)</p>
              <strong>{formatNumber(overallBalance)}</strong>
            </div>
          </div>

          <div className="bg-[var(--ui-sunken)] p-5 rounded-2xl border border-[var(--ui-line)]">
            <h4 className="font-bold flex items-center gap-2 mb-1"><PlusCircle className="w-5 h-5" /> إضافة دفعة جديدة</h4>
            <p className="text-xs text-ink-secondary mb-4">
              عند تأكيد الدفعة يُرسل إشعار فوري إلى تطبيق العميل، ويُحدَّث المتبقي تلقائياً (مستحق −
              مدفوع). إذا سُدّد الشهر بالكامل يظهر صفر ويبدأ الحساب من المبيعات الجديدة.
            </p>
            <form onSubmit={handleAddPayment} className="flex flex-col sm:flex-row gap-4 items-end">
              <div className="flex-1 w-full">
                <Field label="المبلغ المدفوع (ريال يمني)">
                  <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="أدخل المبلغ..." />
                </Field>
              </div>
              <div className="flex-1 w-full">
                <Field label="مخصصة لشهر">
                  <Input type="month" value={selectedMonth || currentMonthStr} onChange={(e) => setSelectedMonth(e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="success" loading={isAddingPayment} className="whitespace-nowrap h-[46px]">
                {isAddingPayment ? 'جاري الإضافة...' : 'تأكيد الدفعة'}
              </Button>
            </form>
          </div>

          <div>
            <h4 className="font-bold flex items-center gap-2 mb-4"><CreditCard className="w-5 h-5" /> تفاصيل الأشهر</h4>
            {sortedMonths.length === 0 ? (
              <p className="text-ink-secondary text-center py-4">لا يوجد حركات مسجلة</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="responsive-data-table w-full text-sm">
                  <thead>
                    <tr className="table-header">
                      <th className="px-4 py-3 text-right">الشهر</th>
                      <th className="px-4 py-3 text-right">إجمالي المبيعات (ريال يمني)</th>
                      <th className="px-4 py-3 text-right">العمولة المستحقة (ريال يمني)</th>
                      <th className="px-4 py-3 text-right">تم سداده (ريال يمني)</th>
                      <th className="px-4 py-3 text-right">المتبقي (ريال يمني)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sortedMonths.map((month) => {
                      const m = monthsData[month];
                      const remaining = m.commissionDue - m.paid;
                      return (
                        <tr key={month} className="hover:bg-surface-sunken">
                          <td className="px-4 py-3 font-bold" dir="ltr" data-label="الشهر">{month}</td>
                          <td className="px-4 py-3 text-ink-soft" data-label="إجمالي المبيعات">{formatNumber(m.salesTotal)}</td>
                          <td className="px-4 py-3 text-ink-soft font-medium" data-label="العمولة المستحقة">{formatNumber(m.commissionDue)}</td>
                          <td className="px-4 py-3 text-ink-soft font-medium" data-label="تم سداده">{formatNumber(m.paid)}</td>
                          <td className="px-4 py-3" data-label="المتبقي">
                            <span className={`font-bold ${remaining > 0 ? 'text-danger-ink' : remaining < 0 ? 'text-success-ink' : 'text-ink'}`}>
                              {formatNumber(remaining)}
                            </span>
                          </td>
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
