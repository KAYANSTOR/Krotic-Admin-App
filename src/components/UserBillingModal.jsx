import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { X, DollarSign, PlusCircle, CreditCard } from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from './LoadingSpinner';

export default function UserBillingModal({ isOpen, onClose, user, globalCommission }) {
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Payment form state
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
      // 1. Fetch Sales
      const salesSnap = await getDocs(collection(db, 'networks', user.uid, 'sales'));
      const salesData = [];
      salesSnap.forEach(doc => salesData.push({ id: doc.id, ...doc.data() }));
      setSales(salesData);

      // 2. Fetch Payments
      const paymentsRef = collection(db, 'networks', user.uid, 'payments');
      const q = query(paymentsRef, orderBy('timestamp', 'desc'));
      const paymentsSnap = await getDocs(q);
      const paymentsData = [];
      paymentsSnap.forEach(doc => paymentsData.push({ id: doc.id, ...doc.data() }));
      setPayments(paymentsData);
      
    } catch (error) {
      console.error('Error fetching financials:', error);
      toast.error('حدث خطأ أثناء جلب البيانات المالية');
    }
    setLoading(false);
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
    try {
      await addDoc(collection(db, 'networks', user.uid, 'payments'), {
        amount: parseFloat(amount),
        month: selectedMonth,
        timestamp: Timestamp.now()
      });
      
      toast.success('تمت إضافة الدفعة بنجاح');
      setAmount('');
      fetchFinancials(); // Refresh data
    } catch (error) {
      console.error('Error adding payment:', error);
      toast.error('حدث خطأ أثناء إضافة الدفعة');
    }
    setIsAddingPayment(false);
  };

  if (!isOpen || !user) return null;

  // Process data by month
  const monthsData = {};
  
  // Active commission rate
  const activeRate = (user.commission_rate != null && user.commission_rate > 0) 
    ? user.commission_rate 
    : globalCommission;

  // Aggregate Sales
  sales.forEach(sale => {
    if (sale.status === 'COMPLETED' && sale.createdAt) {
      const date = new Date(sale.createdAt);
      // Format YYYY-MM
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthsData[monthKey]) {
        monthsData[monthKey] = { salesTotal: 0, commissionDue: 0, paid: 0 };
      }
      
      monthsData[monthKey].salesTotal += (sale.faceValue || 0);
      monthsData[monthKey].commissionDue += (sale.faceValue || 0) * (activeRate / 100);
    }
  });

  // Aggregate Payments
  payments.forEach(payment => {
    const monthKey = payment.month; // Expected YYYY-MM
    if (!monthsData[monthKey]) {
      monthsData[monthKey] = { salesTotal: 0, commissionDue: 0, paid: 0 };
    }
    monthsData[monthKey].paid += payment.amount;
  });

  // Sort months descending
  const sortedMonths = Object.keys(monthsData).sort().reverse();
  
  // Calculate Totals
  let totalDue = 0;
  let totalPaid = 0;
  Object.values(monthsData).forEach(m => {
    totalDue += m.commissionDue;
    totalPaid += m.paid;
  });
  const overallBalance = totalDue - totalPaid;

  const formatNumber = (num) => new Intl.NumberFormat('ar-YE').format(Math.round(num || 0));

  // Current month string for default selection
  const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-primary-600" />
              المالية والفوترة: {user.networkName || 'الشبكة'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">العمولة المطبقة: {activeRate}%</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-purple-50 p-4 rounded-xl border border-purple-100">
                <p className="text-sm text-purple-600 font-medium">إجمالي المستحقات (ريال يمني)</p>
                <p className="text-2xl font-bold text-purple-900 mt-1">{formatNumber(totalDue)}</p>
              </div>
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                <p className="text-sm text-emerald-600 font-medium">إجمالي المدفوع (ريال يمني)</p>
                <p className="text-2xl font-bold text-emerald-900 mt-1">{formatNumber(totalPaid)}</p>
              </div>
              <div className={`p-4 rounded-xl border ${overallBalance > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200'}`}>
                <p className={`text-sm font-medium ${overallBalance > 0 ? 'text-red-600' : 'text-gray-600'}`}>الديون المتبقية (ريال يمني)</p>
                <p className={`text-2xl font-bold mt-1 ${overallBalance > 0 ? 'text-red-900' : 'text-gray-900'}`}>
                  {formatNumber(overallBalance)}
                </p>
              </div>
            </div>

            {/* Add Payment Form */}
            <div className="bg-gray-50 p-5 rounded-xl border border-gray-200">
              <h4 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                <PlusCircle className="w-5 h-5" /> إضافة دفعة جديدة
              </h4>
              <form onSubmit={handleAddPayment} className="flex flex-col sm:flex-row gap-4 items-end">
                <div className="flex-1 w-full">
                  <label className="label-field">المبلغ المدفوع (ريال يمني)</label>
                  <input 
                    type="number" 
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="input-field bg-white" 
                    placeholder="أدخل المبلغ..."
                  />
                </div>
                <div className="flex-1 w-full">
                  <label className="label-field">مخصصة لشهر</label>
                  <input 
                    type="month" 
                    value={selectedMonth || currentMonthStr}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="input-field bg-white" 
                  />
                </div>
                <button type="submit" disabled={isAddingPayment} className="btn-success whitespace-nowrap h-[46px]">
                  {isAddingPayment ? 'جاري الإضافة...' : 'تأكيد الدفعة'}
                </button>
              </form>
            </div>

            {/* Monthly Breakdown */}
            <div>
              <h4 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                <CreditCard className="w-5 h-5" /> تفاصيل الأشهر
              </h4>
              {sortedMonths.length === 0 ? (
                <p className="text-gray-500 text-center py-4">لا يوجد حركات مسجلة</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="table-header">
                        <th className="px-4 py-3 text-right">الشهر</th>
                        <th className="px-4 py-3 text-right">إجمالي المبيعات (ريال يمني)</th>
                        <th className="px-4 py-3 text-right">العمولة المستحقة (ريال يمني)</th>
                        <th className="px-4 py-3 text-right">تم سداده (ريال يمني)</th>
                        <th className="px-4 py-3 text-right">المتبقي (ريال يمني)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedMonths.map(month => {
                        const m = monthsData[month];
                        const remaining = m.commissionDue - m.paid;
                        return (
                          <tr key={month} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-bold text-gray-900" dir="ltr">{month}</td>
                            <td className="px-4 py-3 text-gray-600">{formatNumber(m.salesTotal)}</td>
                            <td className="px-4 py-3 text-purple-600 font-medium">{formatNumber(m.commissionDue)}</td>
                            <td className="px-4 py-3 text-emerald-600 font-medium">{formatNumber(m.paid)}</td>
                            <td className="px-4 py-3">
                              <span className={`font-bold ${remaining > 0 ? 'text-red-600' : remaining < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
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
      </div>
    </div>
  );
}
