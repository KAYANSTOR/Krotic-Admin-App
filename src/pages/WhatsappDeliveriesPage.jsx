import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCheck, Clock, MessageSquare, RefreshCw, Send, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../firebase';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import ExpandableCard from '../components/ui/ExpandableCard';
import {
  DELIVERY_STATE_LABELS,
  FINAL_OUTCOME_LABELS,
  WHATSAPP_STATUS_LABELS,
  deliveryDetailRows,
  deliveryErrorText,
  deliveryNotices,
  fallbackReasonLabel,
  formatMs,
  outcomeTone,
  reportQuery,
} from '../lib/whatsappDeliveryReport';

const NOTICE_CLASSES = {
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  danger: 'bg-rose-50 border-rose-200 text-rose-800',
};

/** تقرير تسليم WhatsApp وSMS البديل (الخطة §4.4). قراءة فقط عبر GET /api/admin/whatsapp-deliveries. */
export default function WhatsappDeliveriesPage() {
  const [filters, setFilters] = useState({ networkId: '', state: '', from: '', to: '' });
  const [data, setData] = useState({ deliveries: [], summary: null, truncated: false });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);

  const refresh = useCallback(async (activeFilters) => {
    setRefreshing(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('missing_token');
      const token = await user.getIdToken();
      const response = await fetch(`/api/admin/whatsapp-deliveries?${reportQuery(activeFilters)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        throw new Error(typeof result.error === 'string' ? result.error : 'delivery_report_failed');
      }
      setData({
        deliveries: Array.isArray(result.deliveries) ? result.deliveries : [],
        summary: result.summary || null,
        truncated: result.truncated === true,
      });
      setLoadedAt(new Date());
    } catch (cause) {
      const message = deliveryErrorText(cause?.message);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh({ networkId: '', state: '', from: '', to: '' }); }, [refresh]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.deliveries;
    return data.deliveries.filter((d) => [d.deliveryOperationId, d.saleRef, d.orderRef, d.cardRef, d.customerRef, d.to, d.messageId, d.networkId]
      .some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
  }, [data.deliveries, search]);

  const summary = data.summary;
  const onSubmit = (event) => {
    event.preventDefault();
    void refresh(filters);
  };

  if (loading) {
    return (
      <div className="space-y-4 pb-24">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-32 rounded-3xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-24 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SearchHeader
        title="تقرير تسليم WhatsApp"
        subtitle={loadedAt ? `آخر قراءة: ${loadedAt.toLocaleTimeString('ar-YE')}` : 'التسليم والإيصالات وSMS البديل'}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم العملية، الطلب، الكرت، الرقم..."
        actions={(
          <button
            type="button"
            onClick={() => refresh(filters)}
            disabled={refreshing}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] disabled:opacity-50"
            aria-label="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
      />

      <form onSubmit={onSubmit} className="mt-2 grid grid-cols-2 lg:grid-cols-5 gap-2 text-xs">
        <label className="flex flex-col gap-1">
          <span className="font-bold text-[var(--ui-muted)]">الشبكة</span>
          <input
            value={filters.networkId}
            onChange={(e) => setFilters((f) => ({ ...f, networkId: e.target.value }))}
            placeholder="NET-10016"
            dir="ltr"
            className="px-3 py-2 rounded-xl border border-line bg-[var(--ui-surface)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold text-[var(--ui-muted)]">الحالة</span>
          <select
            value={filters.state}
            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value }))}
            className="px-3 py-2 rounded-xl border border-line bg-[var(--ui-surface)]"
          >
            <option value="">كل الحالات</option>
            {Object.entries(DELIVERY_STATE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold text-[var(--ui-muted)]">من تاريخ</span>
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="px-3 py-2 rounded-xl border border-line bg-[var(--ui-surface)]" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-bold text-[var(--ui-muted)]">إلى تاريخ</span>
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="px-3 py-2 rounded-xl border border-line bg-[var(--ui-surface)]" />
        </label>
        <button type="submit" disabled={refreshing}
          className="col-span-2 lg:col-span-1 self-end px-4 py-2 rounded-xl bg-[var(--ui-brand)] text-white font-bold disabled:opacity-50">
          تطبيق الفلاتر
        </button>
      </form>

      {error && (
        <div className="mt-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={() => refresh(filters)} className="font-bold underline">إعادة المحاولة</button>
        </div>
      )}

      {summary && (
        <div className="mt-3 space-y-2">
          <HeroMetric
            label="عمليات التسليم"
            value={summary.total}
            unit="عملية"
            icon={Send}
            trend={summary.byOutcome.none > 0 ? 'down' : 'flat'}
            trendLabel={`${summary.byOutcome.whatsapp} WhatsApp • ${summary.byOutcome.sms} SMS • ${summary.byOutcome.none} لم يتم`}
            hint={`${summary.byOutcome.pending} قيد المعالجة • ${summary.lateDelivery} تسليم متأخر • ${summary.smsAfterDelivered} SMS بعد التسليم`}
            tone={summary.byOutcome.none > 0 ? 'danger' : 'brand'}
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            {Object.entries(summary.byState).filter(([, n]) => n > 0).map(([state, n]) => (
              <div key={state} className="p-2.5 rounded-xl bg-[var(--ui-surface)] border border-line">
                <p className="text-[var(--ui-muted)] font-bold">{DELIVERY_STATE_LABELS[state] || state}</p>
                <p className="text-base font-black tabular-nums">{n}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {visible.length === 0 ? (
          <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
            <MessageSquare className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
            <p className="font-bold text-[var(--ui-ink)]">لا توجد عمليات تسليم</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">{search ? 'لا توجد نتائج مطابقة.' : 'لم تُسجّل عمليات ضمن هذه الفلاتر.'}</p>
          </div>
        ) : visible.map((d) => {
          const notices = deliveryNotices(d);
          const tone = outcomeTone(d.finalOutcome);
          return (
            <ExpandableCard
              key={`${d.networkId}:${d.deliveryOperationId}`}
              avatar={(
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone === 'success' ? 'bg-emerald-100 text-emerald-700'
                  : tone === 'danger' ? 'bg-rose-100 text-rose-700' : tone === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-brand/10 text-brand-deep'}`}>
                  {d.finalOutcome === 'sms' ? <Smartphone className="w-4 h-4" /> : <CheckCheck className="w-4 h-4" />}
                </div>
              )}
              title={FINAL_OUTCOME_LABELS[d.finalOutcome] || d.finalOutcome}
              subtitle={d.deliveryOperationId}
              badges={[
                { label: DELIVERY_STATE_LABELS[d.state] || d.state },
                { label: WHATSAPP_STATUS_LABELS[d.whatsappStatus] || d.whatsappStatus },
                ...(d.fallback ? [{ label: fallbackReasonLabel(d.fallback.reason) }] : []),
                ...(notices.length ? [{ label: 'تنبيه' }] : []),
              ]}
              summary={[
                { icon: Clock, label: 'الإرسال', value: formatMs(d.acceptedAtMs || d.createdAtMs) },
                { label: 'الشبكة', value: d.networkId || '—' },
                { label: 'الكرت', value: d.cardRef || '—' },
              ]}
            >
              {notices.map((n) => (
                <div key={n.text} className={`p-2.5 rounded-lg border text-[11px] ${NOTICE_CLASSES[n.tone] || NOTICE_CLASSES.warning}`}>{n.text}</div>
              ))}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {deliveryDetailRows(d).map((row) => (
                  <div key={row.key} className="p-2 rounded-lg bg-[var(--ui-sunken)]/60 min-w-0">
                    <dt className="text-[10px] text-[var(--ui-muted)] font-bold">{row.label}</dt>
                    <dd className={`text-[11px] mt-0.5 break-words ${row.mono ? 'font-mono' : 'font-bold'}`} dir={row.mono ? 'ltr' : undefined}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </ExpandableCard>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-[var(--ui-faint)] py-4">
        {data.truncated ? `يعرض أحدث ${data.deliveries.length} عملية — ضيّق الفلاتر لرؤية الأقدم. ` : ''}
        لا تُخزَّن نصوص الرسائل ولا أرقام الكروت السرية في هذا التقرير.
      </p>
    </div>
  );
}
