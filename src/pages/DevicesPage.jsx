import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  RefreshCw, Smartphone, AlertTriangle, Clock, User, Hash, Activity,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../firebase';

import SearchHeader from '../components/ui/SearchHeader';
import HeroMetric from '../components/ui/HeroMetric';
import DataCard from '../components/ui/DataCard';
import ExpandableCard from '../components/ui/ExpandableCard';

function formatTimestamp(value, ms) {
  const date = value ? new Date(value) : ms ? new Date(ms) : null;
  if (!date || Number.isNaN(date.getTime())) return 'غير متوفر';
  return date.toLocaleString('ar-YE', { dateStyle: 'medium', timeStyle: 'short' });
}

function errorText(code) {
  switch (code) {
    case 'not_admin': return 'هذا الحساب ليس حساب إدارة.';
    case 'firestore_quota_exceeded': return 'حصة Firestore غير كافية.';
    case 'server_not_configured': return 'خدمة Firebase غير مهيأة.';
    case 'missing_token':
    case 'invalid_token': return 'انتهت الجلسة — سجّل الدخول مجدداً.';
    default: return 'تعذر جلب سجلات الأجهزة.';
  }
}

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);
  const [search, setSearch] = useState('');

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

  const filteredDevices = useMemo(() => {
    if (!search.trim()) return devices;
    const q = search.toLowerCase();
    return devices.filter((d) =>
      (d.accountId || '').toLowerCase().includes(q) ||
      (d.networkId || '').toLowerCase().includes(q) ||
      (d.installationId || '').toLowerCase().includes(q) ||
      (d.appVersion || '').toLowerCase().includes(q) ||
      (d.lastError || '').toLowerCase().includes(q),
    );
  }, [devices, search]);

  const stats = useMemo(() => ({
    total: devices.length,
    withErrors: devices.filter((d) => d.lastError).length,
    withPending: devices.filter((d) => Number(d.pendingCount) > 0).length,
    withUnknown: devices.filter((d) => Number(d.unknownDeliveryCount) > 0).length,
  }), [devices]);

  if (loading) {
    return (
      <div className="space-y-4 pb-24">
        <div className="h-16 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-32 rounded-3xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-24 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
        <div className="h-24 rounded-2xl bg-[var(--ui-sunken)]/60 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="pb-24">
      <SearchHeader
        title="الأجهزة والمراقبة"
        subtitle={loadedAt ? `آخر قراءة: ${loadedAt.toLocaleTimeString('ar-YE')}` : 'بيانات المراقبة'}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بمعرّف الجهاز، الحساب، الإصدار..."
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)] hover:text-[var(--ui-ink)] disabled:opacity-50"
            aria-label="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      {error && (
        <div className="mt-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button type="button" onClick={refresh} className="font-bold underline">إعادة المحاولة</button>
        </div>
      )}

      <div className="mt-3">
        <HeroMetric
          label="الأجهزة المراقبة"
          value={stats.total}
          unit="جهاز"
          icon={Smartphone}
          trend={stats.withErrors > 0 ? 'down' : 'flat'}
          trendLabel={stats.withErrors > 0 ? `${stats.withErrors} بأخطاء` : 'كل الأجهزة سليمة'}
          hint={`${stats.withPending} معلّق • ${stats.withUnknown} غير معروف`}
          tone={stats.withErrors > 0 ? 'danger' : 'brand'}
        />
      </div>

      <div className="mt-3 space-y-2.5">
        {filteredDevices.length === 0 ? (
          <div className="p-10 text-center rounded-2xl bg-[var(--ui-surface)] border border-line">
            <Smartphone className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" />
            <p className="font-bold text-[var(--ui-ink)]">لا توجد سجلات</p>
            <p className="text-xs text-[var(--ui-muted)] mt-1">
              {search ? 'لا توجد نتائج مطابقة.' : 'لم تُسجّل أجهزة heartbeat بعد.'}
            </p>
          </div>
        ) : (
          filteredDevices.map((device) => {
            const hasError = Boolean(device.lastError);
            const pending = Number(device.pendingCount) || 0;
            const unknown = Number(device.unknownDeliveryCount) || 0;

            return (
              <ExpandableCard
                key={`${device.networkId}:${device.installationId}`}
                avatar={
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hasError ? 'bg-rose-100 text-rose-700' : 'bg-brand/10 text-brand-deep'}`}>
                    <Smartphone className="w-4 h-4" />
                  </div>
                }
                title={device.accountId || 'حساب غير متوفر'}
                subtitle={device.installationId || 'installation غير معروف'}
                badges={[
                  ...(hasError ? [{ label: '⚠️ خطأ', tone: 'danger' }] : []),
                  ...(pending > 0 ? [{ label: `${pending} معلّق`, tone: 'warning' }] : []),
                ]}
                summary={[
                  { icon: Hash, label: 'الإصدار', value: device.appVersion || '—' },
                  { icon: Clock, label: 'آخر استلام', value: formatTimestamp(device.serverReceivedAt, device.serverReceivedAtMs) },
                ]}
              >
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-[var(--ui-sunken)]/60">
                    <dt className="text-[10px] text-[var(--ui-muted)] font-bold">الحساب</dt>
                    <dd className="text-[11px] font-mono truncate mt-0.5" dir="ltr" title={device.accountId}>
                      {device.accountId || '—'}
                    </dd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--ui-sunken)]/60">
                    <dt className="text-[10px] text-[var(--ui-muted)] font-bold">الشبكة</dt>
                    <dd className="text-[11px] font-mono truncate mt-0.5" dir="ltr" title={device.networkId}>
                      {device.networkId || '—'}
                    </dd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--ui-sunken)]/60">
                    <dt className="text-[10px] text-[var(--ui-muted)] font-bold">المعلّق</dt>
                    <dd className="text-sm font-black tabular-nums mt-0.5">
                      {Number.isInteger(pending) ? pending : '—'}
                    </dd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--ui-sunken)]/60">
                    <dt className="text-[10px] text-[var(--ui-muted)] font-bold">غير معروف</dt>
                    <dd className="text-sm font-black tabular-nums mt-0.5">
                      {Number.isInteger(unknown) ? unknown : '—'}
                    </dd>
                  </div>
                </dl>

                {hasError && (
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                    <p className="font-bold">آخر خطأ:</p>
                    <p className="font-mono break-words mt-0.5" dir="ltr">{device.lastError}</p>
                  </div>
                )}

                {Array.isArray(device.riskSignals) && device.riskSignals.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                    <p className="font-bold">إشارات خطر:</p>
                    <p className="mt-0.5">{device.riskSignals.join('، ')}</p>
                  </div>
                )}
              </ExpandableCard>
            );
          })
        )}
      </div>

      <p className="text-center text-[11px] text-[var(--ui-faint)] py-4">
        يعرض آخر {devices.length} سجل — بيانات مراقبة وليست إثباتاً مالياً
      </p>
    </div>
  );
}
