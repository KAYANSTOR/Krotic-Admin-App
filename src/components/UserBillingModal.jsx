import { useState, useEffect, useMemo, useRef } from 'react';
import {
  DollarSign, CreditCard, RefreshCw, Plus, Bell, CheckCircle2,
  Sparkles, Check, ChevronDown, Calendar, Wallet, FileText, Send, AlertCircle
} from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';
import LoadingSpinner from './LoadingSpinner';
import { formatNumber, toDate } from '../lib/format';
import { monthKeyFromDate, getCurrentMonthKey } from '../lib/billingHelpers';
import { sumOutstanding, saleCommission } from '../lib/commission';
import {
  fetchUserBillingHistory,
  subscribeAdminDataCache,
} from '../lib/adminData';
import { recordPayment, adminApiError } from '../lib/adminApi';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const NOTIF_TEMPLATE_KEY = 'krotak:settlement-notification-template:v1';
const DEFAULT_NOTIF_TEMPLATE = 'تم تسوية عمولة {month} بمبلغ {amount} ريال، والمتبقي {remaining} ريال.';

function loadSavedNotificationTemplate() {
  try {
    return window.localStorage.getItem(NOTIF_TEMPLATE_KEY) || DEFAULT_NOTIF_TEMPLATE;
  } catch {
    return DEFAULT_NOTIF_TEMPLATE;
  }
}

function formatMonthArabic(monthKey) {
  if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return monthKey || '';
  const [year, month] = monthKey.split('-').map(Number);
  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  return `شهر ${monthNames[month - 1]} ${year}`;
}

function newIdempotencyKey(uid) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${uid.slice(0, 20)}-${random}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128);
}

export default function UserBillingModal({ isOpen, onClose, user, initialMonth }) {
  const userUid = user?.uid;
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedForUid, setLoadedForUid] = useState(null);
  const [historyError, setHistoryError] = useState(null);

  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const refreshRequestId = useRef(0);

  const [payAmount, setPayAmount] = useState('');
  const [payMonth, setPayMonth] = useState(() => initialMonth || getCurrentMonthKey());
  const [payMode, setPayMode] = useState('full'); // 'full' | 'partial'
  const [payKey, setPayKey] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);

  // إعدادات إشعار التسوية الفوري لهاتف العميل
  const [sendNotification, setSendNotification] = useState(true);
  const [notificationTemplate, setNotificationTemplate] = useState(loadSavedNotificationTemplate);
  const [customNotificationMessage, setCustomNotificationMessage] = useState('');
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);

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
    setPayAmount('');
    setPayMode('full');
    setPayMonth(initialMonth || getCurrentMonthKey());
    setPayKey(newIdempotencyKey(userUid));
    setSendNotification(true);
    setCustomNotificationMessage('');
    setIsEditingTemplate(false);

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

  // حساب البيانات المالية الخاصة بالشهر المختار بدقة
  const monthFinancials = useMemo(() => {
    const monthSales = sales.filter((s) => s.status === 'COMPLETED' && monthKeyFromDate(s.createdAt) === payMonth);
    const monthSalesTotal = monthSales.reduce((sum, s) => sum + (Number(s.faceValue) || 0), 0);
    const monthCommissionTotal = monthSales.reduce((sum, s) => sum + (saleCommission(s) ?? 0), 0);
    const monthOutstanding = sumOutstanding(monthSales);

    const monthRecordedPayments = payments
      .filter((p) => (p.month || monthKeyFromDate(p.timestamp)) === payMonth)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return {
      monthSalesTotal,
      monthCommissionTotal,
      monthRecordedPayments,
      monthOutstanding,
      count: monthSales.length,
    };
  }, [sales, payments, payMonth]);

  // مزامنة خيار التسديد الكامل مع العمولة المستحقة للشهر
  useEffect(() => {
    if (payMode === 'full') {
      const due = monthFinancials.monthOutstanding > 0 ? monthFinancials.monthOutstanding : 0;
      setPayAmount(due > 0 ? String(due) : '');
    }
  }, [payMode, monthFinancials.monthOutstanding, payMonth]);

  // حساب المتبقي التقديري بعد هذه العملية
  const remainingAfterPayment = useMemo(() => {
    const due = monthFinancials.monthOutstanding;
    const paying = Number(payAmount) || 0;
    return Math.max(0, due - paying);
  }, [monthFinancials.monthOutstanding, payAmount]);

  // توليد نص الإشعار الافتراضي بناءً على القالب المعتمد
  const generatedNotificationBody = useMemo(() => {
    const monthName = formatMonthArabic(payMonth);
    const amountStr = formatNumber(Number(payAmount) || 0);
    const remainingStr = formatNumber(remainingAfterPayment);
    const network = user?.networkName || 'المشترك';

    return notificationTemplate
      .replace(/{month}/g, monthName)
      .replace(/{amount}/g, amountStr)
      .replace(/{remaining}/g, remainingStr)
      .replace(/{networkName}/g, network);
  }, [notificationTemplate, payMonth, payAmount, remainingAfterPayment, user?.networkName]);

  const activeNotificationText = customNotificationMessage.trim() ? customNotificationMessage : generatedNotificationBody;

  const handleSaveCustomTemplate = () => {
    if (!customNotificationMessage.trim()) {
      toast.error('اكتب نص القالب أولاً');
      return;
    }
    try {
      window.localStorage.setItem(NOTIF_TEMPLATE_KEY, customNotificationMessage);
      setNotificationTemplate(customNotificationMessage);
      toast.success('تم حفظ قالب الإشعار بشكل دائم لجميع التسويات القادمة');
      setIsEditingTemplate(false);
    } catch {
      toast.error('تعذر حفظ القالب في المتصفح');
    }
  };

  const handleResetTemplate = () => {
    try {
      window.localStorage.removeItem(NOTIF_TEMPLATE_KEY);
      setNotificationTemplate(DEFAULT_NOTIF_TEMPLATE);
      setCustomNotificationMessage('');
      setIsEditingTemplate(false);
      toast.success('تمت استعادة قالب الإشعار الافتراضي');
    } catch {
      // safe fallback
    }
  };

  const handleRecordPayment = async (event) => {
    event.preventDefault();
    if (!userUid || savingPayment) return;
    const amount = Number(payAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      toast.error('أدخل مبلغاً صحيحاً بالريال أكبر من صفر');
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth)) {
      toast.error('صيغة الشهر يجب أن تكون YYYY-MM');
      return;
    }

    setSavingPayment(true);
    try {
      const result = await recordPayment({
        uid: userUid,
        amount,
        month: payMonth,
        idempotencyKey: payKey || newIdempotencyKey(userUid),
      });
      if (!result.ok) {
        toast.error(adminApiError(result.error));
        return;
      }

      // إرسال إشعار فوري لهاتف المشترك (FCM) وتسجيله في Firestore
      if (sendNotification) {
        const notifTitle = `تسوية عمولة ${formatMonthArabic(payMonth)}`;
        const notifBody = activeNotificationText;

        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (idToken) {
            // إرسال FCM فوري يصل كإشعار في شريط هاتف العميل
            await fetch('/api/send-fcm', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                title: notifTitle,
                body: notifBody,
                targetUid: userUid,
                data: {
                  route: '/account-notifications',
                  click_action: 'FLUTTER_NOTIFICATION_CLICK',
                },
              }),
            }).catch((err) => console.warn('FCM dispatch error:', err));
          }

          // تسجيل الإشعار في مستندات إشعارات المستخدم داخل Firestore
          await addDoc(collection(db, 'users', userUid, 'notifications'), {
            title: notifTitle,
            message: notifBody,
            body: notifBody,
            type: 'settlement_approved',
            month: payMonth,
            amount,
            remaining: remainingAfterPayment,
            is_read: false,
            timestamp: Date.now(),
            createdAt: serverTimestamp(),
          }).catch((err) => console.warn('Firestore notification write error:', err));

          void logAdminAction({
            action: AUDIT_ACTIONS.NOTIFICATION_SEND,
            targetType: 'user',
            targetId: userUid,
            targetLabel: user?.networkName || userUid,
            details: { title: notifTitle, message: notifBody },
          }).catch(() => {});
        } catch (notifErr) {
          console.warn('Failed to dispatch settlement notification:', notifErr);
        }
      }

      void logAdminAction({
        action: AUDIT_ACTIONS.PAYMENT_ADD,
        targetType: 'user',
        targetId: userUid,
        targetLabel: user?.networkName || userUid,
        details: {
          amount,
          month: payMonth,
          payMode,
          remainingAfter: remainingAfterPayment,
          ack: Boolean(result.data?.ack),
          notificationSent: sendNotification,
        },
      }).catch((error) => console.error('Payment audit write failed:', error));

      const successMsg = result.data?.ack
        ? 'الدفعة مسجلة سابقاً (لم تُكرَّر)'
        : sendNotification
          ? `تم اعتماد التسوية وإرسال الإشعار لهاتف ${user?.networkName || 'المشترك'} بنجاح`
          : 'تم تسجيل الدفعة على الخادم بنجاح';

      toast.success(successMsg, { duration: 5000 });
      setPayAmount('');
      setPayKey(newIdempotencyKey(userUid));
      void refreshBillingHistory();
    } catch (error) {
      console.error('Payment submission failed:', error);
      toast.error('تعذر تأكيد تسجيل الدفعة. أعد المحاولة؛ لن تتكرر الدفعة إذا كان الخادم قد سجلها.');
    } finally {
      setSavingPayment(false);
    }
  };

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
      toast.success('تم تحميل أحدث سجل كامل من خادم Firestore');
    } catch (error) {
      if (requestId !== refreshRequestId.current) return;
      console.error('Error refreshing financial history from server:', error);
      toast.error('تعذر تحميل السجل من الخادم');
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
        monthsData[monthKey] = { reportedSales: 0, recordedPayments: 0, commissionDue: 0, outstanding: 0 };
      }
      monthsData[monthKey].reportedSales += Number(sale.faceValue) || 0;
      monthsData[monthKey].commissionDue += (saleCommission(sale) ?? 0);
      monthsData[monthKey].outstanding += (sale.status === 'COMPLETED' ? (saleCommission(sale) ?? 0) - (Number(sale.paidRiyal ?? sale.paidMinor) || 0) : 0);
    }
  });

  payments.forEach((payment) => {
    const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(payment.month || '')
      ? payment.month
      : monthKeyFromDate(payment.timestamp);
    if (!monthKey) return;
    if (!monthsData[monthKey]) {
      monthsData[monthKey] = { reportedSales: 0, recordedPayments: 0, commissionDue: 0, outstanding: 0 };
    }
    monthsData[monthKey].recordedPayments += Number(payment.amount) || 0;
  });

  const sortedMonths = Object.keys(monthsData).sort().reverse();

  let totalReportedSales = 0;
  let totalRecordedPayments = 0;
  let totalCommissionDue = 0;
  Object.values(monthsData).forEach((m) => {
    totalReportedSales += m.reportedSales;
    totalRecordedPayments += m.recordedPayments;
    totalCommissionDue += m.commissionDue;
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      icon={DollarSign}
      title={`الفوترة وتسوية العمولات: ${user.networkName || 'الشبكة'}`}
      description="احتساب العمولة المستحقة للشهر المحدد، تسديد كامل أو جزئي، وإرسال إشعار فوري لهاتف العميل"
    >
      {loading || loadedForUid !== userUid ? (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-5">
          {historyError && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger-ink" role="alert">
              {historyError}
            </div>
          )}

          {/* الإجماليات الشاملة للحساب */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
              <span className="text-[11px] text-muted block mb-0.5 font-bold">إجمالي مبيعات المشترك</span>
              <p className="text-base sm:text-lg font-black text-ink font-mono">{formatNumber(totalReportedSales)} ر.ي</p>
            </div>
            <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs">
              <span className="text-[11px] text-muted block mb-0.5 font-bold">إجمالي العمولات المستحقة</span>
              <p className="text-base sm:text-lg font-black text-brand-deep font-mono">{formatNumber(totalCommissionDue)} ر.ي</p>
            </div>
            <div className="p-3 rounded-2xl bg-surface border border-line shadow-xs col-span-2 sm:col-span-1">
              <span className="text-[11px] text-muted block mb-0.5 font-bold">إجمالي ما تم سداده</span>
              <p className="text-base sm:text-lg font-black text-emerald-600 font-mono">{formatNumber(totalRecordedPayments)} ر.ي</p>
            </div>
          </div>

          {/* صندوق إنشاء التسوية المخصص بنمط أندرويد */}
          <div className="bg-surface-sunken p-4 sm:p-5 rounded-2xl border border-line space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm flex items-center gap-2 text-ink">
                <CreditCard className="w-4.5 h-4.5 text-brand" />
                <span>إنشاء واعتماد تسوية عمولة</span>
              </h4>
              <span className="text-xs font-bold text-brand bg-brand-soft px-2.5 py-1 rounded-full">
                {formatMonthArabic(payMonth)}
              </span>
            </div>

            <form onSubmit={handleRecordPayment} className="space-y-4">
              {/* 1. اختيار الشهر المستهدف للتسوية */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-ink">شهر التسوية (YYYY-MM)</label>
                  <Input
                    type="month"
                    dir="ltr"
                    value={payMonth}
                    onChange={(e) => setPayMonth(e.target.value)}
                    className="font-bold text-xs"
                    required
                  />
                </div>

                {/* 2. بطاقة العمولة المستحقة للشهر المحدد */}
                <div className="p-3 rounded-xl bg-surface border border-line/80 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted font-bold">العمولة المستحقة لشهر {payMonth}:</span>
                    <span className="font-black font-mono text-sm text-brand-deep">
                      {formatNumber(monthFinancials.monthOutstanding)} ر.ي
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted pt-1 border-t border-line/40">
                    <span>مبيعات الشهر: {formatNumber(monthFinancials.monthSalesTotal)} ر.ي</span>
                    <span>سُدّد منه: {formatNumber(monthFinancials.monthRecordedPayments)} ر.ي</span>
                  </div>
                </div>
              </div>

              {/* 3. خيارات التسديد: كامل أو جزئي */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-ink">طريقة التسديد</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayMode('full')}
                    className={`p-3 rounded-xl border text-right transition-all flex items-center gap-2.5 active:scale-98 ${
                      payMode === 'full'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold ring-2 ring-emerald-500/30'
                        : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${payMode === 'full' ? 'bg-emerald-600 text-white' : 'bg-surface-sunken text-muted'}`}>
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black">تسديد كامل</p>
                      <p className="text-[10px] text-muted">كامل المستحق ({formatNumber(monthFinancials.monthOutstanding)} ر.ي)</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPayMode('partial');
                      if (payMode === 'full') setPayAmount('');
                    }}
                    className={`p-3 rounded-xl border text-right transition-all flex items-center gap-2.5 active:scale-98 ${
                      payMode === 'partial'
                        ? 'border-brand bg-brand-soft/20 text-brand-deep font-bold ring-2 ring-brand/30'
                        : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${payMode === 'partial' ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'}`}>
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black">تسديد جزئي</p>
                      <p className="text-[10px] text-muted">إدخال مبلغ محدد من العمولة</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* 4. حقل المبلغ والمتبقي بعد التسوية */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink">المبلغ المراد سداده حالياً (ريال يمني)</label>
                  {payAmount && (
                    <span className="text-xs font-bold text-emerald-600">
                      المتبقي بعد السداد: {formatNumber(remainingAfterPayment)} ر.ي
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={payAmount}
                    onChange={(e) => {
                      setPayAmount(e.target.value);
                      if (payMode === 'full') setPayMode('partial');
                    }}
                    placeholder={monthFinancials.monthOutstanding > 0 ? String(monthFinancials.monthOutstanding) : '0'}
                    className="text-base font-bold font-mono pl-14"
                    required
                  />
                  <span className="absolute left-3 top-2.5 text-xs text-muted font-bold pointer-events-none">
                    ر.ي
                  </span>
                </div>

                {/* أزرار مبالغ سريعة */}
                {monthFinancials.monthOutstanding > 0 && (
                  <div className="flex gap-2 pt-1 overflow-x-auto no-scrollbar">
                    <button
                      type="button"
                      onClick={() => { setPayMode('full'); setPayAmount(String(monthFinancials.monthOutstanding)); }}
                      className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px] font-bold text-ink-soft hover:text-brand transition-colors"
                    >
                      كامل المستحق ({formatNumber(monthFinancials.monthOutstanding)} ر.ي)
                    </button>
                    {monthFinancials.monthOutstanding >= 2 && (
                      <button
                        type="button"
                        onClick={() => { setPayMode('partial'); setPayAmount(String(Math.round(monthFinancials.monthOutstanding / 2))); }}
                        className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px] font-bold text-ink-soft hover:text-brand transition-colors"
                      >
                        النصف (50%): {formatNumber(Math.round(monthFinancials.monthOutstanding / 2))} ر.ي
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* 5. قسم إشعار الهاتف الفوري (FCM) — دائم ومفعل ومعدل */}
              <div className="p-3.5 rounded-xl bg-surface border border-line space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendNotification}
                      onChange={(e) => setSendNotification(e.target.checked)}
                      className="w-4 h-4 rounded text-brand focus:ring-brand accent-brand cursor-pointer"
                    />
                    <span className="text-xs font-black text-ink flex items-center gap-1.5">
                      <Bell className="w-3.5 h-3.5 text-brand" />
                      إرسال إشعار فوري لهاتف العميل (تطبيق كروتك برو)
                    </span>
                  </label>
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                    مفعّل دائماً
                  </span>
                </div>

                {sendNotification && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-muted">
                      <span>نص الإشعار الذي سيظهر في هاتف العميل:</span>
                      <div className="flex items-center gap-2">
                        {!isEditingTemplate ? (
                          <button
                            type="button"
                            onClick={() => {
                              setIsEditingTemplate(true);
                              setCustomNotificationMessage(activeNotificationText);
                            }}
                            className="text-brand font-bold hover:underline"
                          >
                            تعديل النص
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={handleSaveCustomTemplate}
                              className="text-emerald-600 font-bold hover:underline"
                            >
                              حفظ كقالب دائم
                            </button>
                            <span>•</span>
                            <button
                              type="button"
                              onClick={handleResetTemplate}
                              className="text-danger font-bold hover:underline"
                            >
                              استعادة الافتراضي
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isEditingTemplate ? (
                      <div className="space-y-1.5">
                        <textarea
                          rows={2}
                          value={customNotificationMessage}
                          onChange={(e) => setCustomNotificationMessage(e.target.value)}
                          className="input-field text-xs resize-none"
                          placeholder="اكتب قالب الإشعار هنا..."
                        />
                        <p className="text-[10px] text-muted">
                          المتغيرات المتاحة: {'{month}'} اسم الشهر، {'{amount}'} المبلغ، {'{remaining}'} المتبقي.
                        </p>
                      </div>
                    ) : (
                      <div className="p-2.5 rounded-lg bg-slate-900 text-white text-xs space-y-1 shadow-xs border border-slate-800">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-bold text-slate-200">كروتك برو • الآن</span>
                          <span>إشعار تسوية</span>
                        </div>
                        <p className="text-slate-100 font-medium leading-relaxed">
                          {activeNotificationText}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* زر اعتماد وتسجيل التسوية */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                icon={Plus}
                loading={savingPayment}
                className="h-12 font-black shadow-md shadow-brand/20 active:scale-98"
              >
                {savingPayment ? 'جارٍ تسجيل واعتماد التسوية...' : `اعتماد تسوية ${payAmount ? `${formatNumber(Number(payAmount))} ر.ي` : ''}`}
              </Button>
            </form>
          </div>

          {/* تفاصيل الأشهر السابقة */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm flex items-center gap-2 text-ink">
                <Calendar className="w-4 h-4 text-muted" />
                <span>سجل الأشهر والعمولات</span>
              </h4>
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                loading={refreshingHistory}
                onClick={refreshBillingHistory}
              >
                تحديث السجل
              </Button>
            </div>

            {sortedMonths.length === 0 ? (
              <p className="text-muted text-center py-4 text-xs">لا يوجد حركات مسجلة</p>
            ) : (
              <div className="space-y-2">
                {sortedMonths.map((month) => {
                  const m = monthsData[month];
                  const isCurrentSelected = month === payMonth;

                  return (
                    <div
                      key={month}
                      className={`p-3 rounded-xl border transition-all ${
                        isCurrentSelected ? 'bg-surface border-brand/50 shadow-xs ring-1 ring-brand/20' : 'bg-surface border-line'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-extrabold text-xs text-ink">{formatMonthArabic(month)}</span>
                          <span className="text-[10px] text-muted mr-2 font-mono" dir="ltr">({month})</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setPayMonth(month); setPayMode('full'); }}
                          className="text-[11px] font-bold text-brand hover:underline px-2 py-0.5 rounded-md hover:bg-brand-soft"
                        >
                          تحديد للتسوية
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-line/60 text-xs">
                        <div>
                          <span className="text-[10px] text-muted block">المبيعات</span>
                          <span className="font-bold font-mono text-ink">{formatNumber(m.reportedSales)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted block">العمولة</span>
                          <span className="font-bold font-mono text-brand-deep">{formatNumber(m.commissionDue)}</span>
                        </div>
                        <div className="text-left">
                          <span className="text-[10px] text-muted block">المسدد</span>
                          <span className="font-bold font-mono text-emerald-600">{formatNumber(m.recordedPayments)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
