import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Smartphone, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import PageHero from '../components/ui/PageHero';
import Button from '../components/ui/Button';

function formatTimestamp(value, milliseconds) {
  const date = value ? new Date(value) : milliseconds ? new Date(milliseconds) : null;
  if (!date || Number.isNaN(date.getTime())) return 'غير متوفر';
  return date.toLocaleString('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });
}

function errorText(code) {
  switch (code) {
    case 'not_admin': return 'هذا الحساب ليس حساب إدارة.';
    case 'firestore_quota_exceeded': return 'حصة Firestore غير كافية لقراءة السجلات الآن.';
    case 'server_not_configured': return 'خدمة Firebase في الخادم غير مهيأة.';
    case 'missing_token':
    case 'invalid_token': return 'انتهت جلسة الإدارة؛ سجّل الدخول مجدداً.';
    default: return 'تعذر جلب سجلات الأجهزة. أعد المحاولة.';
  }
}

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('missing_token');
      const token = await user.getIdToken();
      const response = await fetch('/api/device-heartbeats?limit=100', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) {
        throw new Error(typeof result.error === 'string' ? result.error : 'heartbeat_query_failed');
      }
      setDevices(Array.isArray(result.devices) ? result.devices : []);
      setLoadedAt(new Date());
    } catch (cause) {
      const message = errorText(cause?.message);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="space-y-5 pb-16" dir="rtl">
      <PageHero
        icon={Smartphone}
        title="الأجهزة ومراقبة المزامنة"
        subtitle="سجلات heartbeat التي أرسلها التطبيق. هذه بيانات مراقبة وليست إثباتاً مالياً أو مصدر قرار الاستحقاق."
        meta={loadedAt ? `آخر قراءة: ${loadedAt.toLocaleString('ar-YE')}` : 'لا توجد قراءة حديثة'}
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} disabled={refreshing}>
            {refreshing ? 'جاري التحديث…' : 'تحديث'}
          </Button>
        }
      />

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        </section>
      ) : null}

      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600" aria-live="polite">
          جاري تحميل سجلات الأجهزة…
        </section>
      ) : !error && devices.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">
          لا توجد سجلات heartbeat مسجلة حتى الآن.
        </section>
      ) : devices.length > 0 ? (
        <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-[1050px] w-full text-right text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-3">الحساب / الشبكة</th>
                <th className="px-4 py-3">الجهاز</th>
                <th className="px-4 py-3">الإصدار</th>
                <th className="px-4 py-3">آخر استلام خادمي</th>
                <th className="px-4 py-3">المعلّق</th>
                <th className="px-4 py-3">UNKNOWN</th>
                <th className="px-4 py-3">آخر خطأ / إشارات</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={`${device.networkId}:${device.installationId}`} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{device.accountId || 'غير متوفر'}</div>
                    <div className="mt-1 text-xs text-slate-500">{device.networkId || 'غير متوفر'}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{device.installationId || 'غير متوفر'}</td>
                  <td className="px-4 py-3 text-slate-700">{device.appVersion || 'غير متوفر'} / {device.releaseId || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{formatTimestamp(device.serverReceivedAt, device.serverReceivedAtMs)}</td>
                  <td className="px-4 py-3 tabular-nums">{Number.isInteger(device.pendingCount) ? device.pendingCount : 'غير متوفر'}</td>
                  <td className="px-4 py-3 tabular-nums">{Number.isInteger(device.unknownDeliveryCount) ? device.unknownDeliveryCount : 'غير متوفر'}</td>
                  <td className="max-w-72 break-words px-4 py-3 text-xs text-slate-600">
                    {device.lastError || 'لا يوجد خطأ مسجل'}
                    {Array.isArray(device.riskSignals) && device.riskSignals.length > 0 ? (
                      <div className="mt-1 text-amber-700">{device.riskSignals.join('، ')}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">يعرض آخر {devices.length} سجل فقط. لا توجد مزامنة لحظية؛ استخدم زر التحديث عند الحاجة.</p>
        </section>
      ) : null}
    </div>
  );
}
