import { useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, CheckCircle2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchHeader from '../components/ui/SearchHeader';
import { Field } from '../components/ui/Field';
import { callAdminApi, adminApiError } from '../lib/adminApi';

/**
 * Admin review queue for smsOutcomeUnknown — no resend button.
 */
export default function WhatsAppUnknownOutcomesPage() {
  const [items, setItems] = useState([]);
  const [networkFilter, setNetworkFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await callAdminApi('/api/whatsapp/unknown-outcomes', {
        action: 'list',
        networkId: networkFilter.trim() || undefined,
        limit: 50,
      });
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر التحميل'));
        setItems([]);
        return;
      }
      setItems(result.data?.items || []);
    } finally {
      setLoading(false);
    }
  }, [networkFilter]);

  const review = async (deliveryOperationId, action) => {
    setBusyId(deliveryOperationId);
    try {
      const result = await callAdminApi('/api/whatsapp/unknown-outcomes', {
        action,
        deliveryOperationId,
        note: action === 'mark_resolved' ? 'resolved_offline_no_resend' : 'acknowledged',
      });
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر التحديث'));
        return;
      }
      toast.success(action === 'mark_resolved' ? 'تم الإغلاق' : 'تم التأكيد');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pb-24" dir="rtl">
      <SearchHeader
        title="مراجعة نتائج SMS غير المؤكدة"
        subtitle="عمليات smsOutcomeUnknown — بلا إعادة إرسال تلقائي"
        actions={
          <button type="button" onClick={load} disabled={loading} className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]" aria-label="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          هذه العمليات قد تكون وصلت للمزود دون تسجيل النتيجة. لا يوجد زر إعادة إرسال لمنع التكرار.
          أغلق العملية فقط بعد التحقق اليدوي خارج النظام.
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-[var(--ui-surface)] border border-line p-4 space-y-3">
        <Field label="تصفية بمعرّف الشبكة (اختياري)">
          <input
            className="w-full rounded-xl border border-line bg-[var(--ui-sunken)] px-3 py-2 text-sm font-mono"
            dir="ltr"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            placeholder="NET-10001"
          />
        </Field>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-[var(--ui-ink)] text-white text-sm font-bold disabled:opacity-50"
        >
          تحميل القائمة
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {items.length === 0 && !loading && (
          <div className="p-8 text-center rounded-2xl bg-[var(--ui-surface)] border border-line text-sm text-[var(--ui-muted)]">
            لا توجد عمليات معلّقة أو لم يتم التحميل بعد.
          </div>
        )}
        {items.map((item) => (
          <div key={item.deliveryOperationId} className="rounded-2xl border border-line bg-[var(--ui-surface)] p-4 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-xs break-all" dir="ltr">{item.deliveryOperationId}</p>
                <p className="text-xs text-[var(--ui-muted)] mt-1">
                  شبكة: <span className="font-mono" dir="ltr">{item.networkId}</span>
                  {item.saleUuid ? <> · بيع: <span className="font-mono" dir="ltr">{item.saleUuid}</span></> : null}
                </p>
                <p className="text-xs mt-1">السبب: {item.smsOutcomeUnknownReason || '—'}</p>
                <p className="text-[11px] text-[var(--ui-muted)]">
                  وقت التعليق:{' '}
                  {item.smsOutcomeUnknownAtMs
                    ? new Date(item.smsOutcomeUnknownAtMs).toLocaleString('ar')
                    : '—'}
                </p>
                <p className="text-[11px] text-[var(--ui-muted)]">
                  حالة المزود:{' '}
                  {item.smsProviderAcceptedAtMs
                    ? 'مقبول (مسجّل)'
                    : item.smsRequestStartedAtMs
                      ? 'طُلب دون تأكيد'
                      : 'غير معروف'}
                  {' · '}مراجعة: {item.adminReviewStatus || 'open'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busyId === item.deliveryOperationId}
                onClick={() => review(item.deliveryOperationId, 'acknowledge')}
                className="flex-1 py-2 rounded-xl border border-line text-xs font-bold"
              >
                تأكيد الاطلاع
              </button>
              <button
                type="button"
                disabled={busyId === item.deliveryOperationId}
                onClick={() => {
                  if (window.confirm('إغلاق دون إعادة إرسال؟ تأكد أنك راجعت الحالة خارج النظام.')) {
                    review(item.deliveryOperationId, 'mark_resolved');
                  }
                }}
                className="flex-1 py-2 rounded-xl bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                إغلاق آمن
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
