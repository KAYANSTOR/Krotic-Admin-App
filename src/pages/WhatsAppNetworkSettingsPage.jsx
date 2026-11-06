import { useState, useCallback } from 'react';
import { MessageCircle, ShieldAlert, RefreshCw, KeyRound, Unplug, Save, Activity, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchHeader from '../components/ui/SearchHeader';
import SettingsSection from '../components/ui/SettingsSection';
import { Field, Select } from '../components/ui/Field';
import { callAdminApi, adminApiError } from '../lib/adminApi';

const GATEWAY_STATUS_LABELS = {
  unlinked: 'غير مربوط',
  qr_pending: 'بانتظار QR',
  linking: 'جاري الربط',
  linked: 'مربوط',
  disconnected: 'مفصول',
  relink_required: 'يتطلب إعادة ربط',
  error: 'خطأ',
  unknown: 'غير معروف — يحتاج تدخل',
};

function formatMs(ms) {
  if (!Number.isSafeInteger(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString('ar-YE', { dateStyle: 'short', timeStyle: 'medium' });
  } catch {
    return String(ms);
  }
}

export default function WhatsAppNetworkSettingsPage() {
  const [networkId, setNetworkId] = useState('');
  const [config, setConfig] = useState(null);
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [provider, setProvider] = useState('cloud_api');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [linkStatus, setLinkStatus] = useState('unlinked');

  const load = useCallback(async () => {
    const id = networkId.trim();
    if (!id) {
      toast.error('أدخل معرّف الشبكة');
      return;
    }
    setLoading(true);
    try {
      const [cfgRes, stRes] = await Promise.all([
        callAdminApi('/api/whatsapp/network-config', { action: 'get', networkId: id }),
        callAdminApi('/api/whatsapp/network-config', { action: 'status', networkId: id }),
      ]);
      if (!cfgRes.ok) {
        toast.error(adminApiError(cfgRes.error, 'تعذر التحميل'));
        setConfig(null);
        setStatus(null);
        return;
      }
      const cfg = cfgRes.data?.config || {};
      setConfig(cfg);
      setHasAccessToken(Boolean(cfgRes.data?.hasAccessToken));
      const p = cfg.whatsappPrimaryProvider;
      setProvider(p === 'local_gateway' ? 'local_gateway_qr' : (p || 'cloud_api'));
      setPhoneNumberId(cfg.whatsappPhoneNumberId || '');
      setLinkStatus(cfg.whatsappCloudLinkStatus || 'unlinked');
      setTokenInput('');
      if (stRes.ok) setStatus(stRes.data);
      else setStatus(null);
      toast.success('تم التحميل');
    } finally {
      setLoading(false);
    }
  }, [networkId]);

  const saveConfig = async () => {
    const id = networkId.trim();
    if (!id) return;
    setSaving(true);
    try {
      const result = await callAdminApi('/api/whatsapp/network-config', {
        action: 'set',
        networkId: id,
        config: {
          whatsappPrimaryProvider: provider,
          whatsappPhoneNumberId: phoneNumberId || null,
          whatsappCloudLinkStatus: linkStatus,
        },
      });
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر الحفظ'));
        return;
      }
      setConfig(result.data?.config || null);
      toast.success('تم حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  const saveToken = async () => {
    const id = networkId.trim();
    const token = tokenInput.trim();
    if (!id || token.length < 20) {
      toast.error('التوكن غير صالح');
      return;
    }
    setSaving(true);
    try {
      const result = await callAdminApi('/api/whatsapp/network-config', {
        action: 'set_token',
        networkId: id,
        accessToken: token,
      });
      setTokenInput('');
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر حفظ التوكن'));
        return;
      }
      const body = result.data || {};
      if (body.accessToken || body.token || body.plaintext) {
        toast.error('استجابة غير آمنة من الخادم');
        return;
      }
      setHasAccessToken(true);
      toast.success('تم حفظ التوكن مشفراً');
    } finally {
      setSaving(false);
    }
  };

  const clearToken = async () => {
    const id = networkId.trim();
    if (!id) return;
    if (!window.confirm('حذف توكن الوصول وفصل الربط السري؟')) return;
    setSaving(true);
    try {
      const result = await callAdminApi('/api/whatsapp/network-config', {
        action: 'clear_token',
        networkId: id,
      });
      setTokenInput('');
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر الحذف'));
        return;
      }
      setHasAccessToken(false);
      toast.success('تم حذف التوكن');
    } finally {
      setSaving(false);
    }
  };

  const counts = status?.counts;
  const gateway = status?.gateway || null;
  const gatewayStatusKey = gateway?.status || 'unlinked';
  const gatewayNeedsAttention = gatewayStatusKey === 'unknown' || gatewayStatusKey === 'error' || gatewayStatusKey === 'relink_required';

  return (
    <div className="pb-24" dir="rtl">
      <SearchHeader
        title="إعدادات WhatsApp"
        subtitle="إدارة ربط الشبكة — التوكن وQR لا يُعرضان بعد الحفظ"
        actions={
          <button type="button" onClick={load} disabled={loading} className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]" aria-label="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <p>Access Token يُشفَّر على الخادم فقط. حالة جلسة البوابة تُقرأ من وثيقة غير سرّية — بلا QR ولا أسرار في الواجهة.</p>
      </div>

      <div className="mt-3 rounded-2xl bg-[var(--ui-surface)] border border-line p-4 space-y-3">
        <Field label="معرّف الشبكة (networkId)">
          <input
            className="w-full rounded-xl border border-line bg-[var(--ui-sunken)] px-3 py-2 text-sm font-mono"
            dir="ltr"
            value={networkId}
            onChange={(e) => setNetworkId(e.target.value)}
            placeholder="NET-10001"
            autoComplete="off"
          />
        </Field>
        <button type="button" onClick={load} disabled={loading || !networkId.trim()} className="w-full py-2.5 rounded-xl bg-[var(--ui-ink)] text-white text-sm font-bold disabled:opacity-50">
          تحميل الإعدادات والحالة
        </button>
      </div>

      {config && (
        <>
          <div className="mt-3">
            <SettingsSection title="جلسة البوابة (غير سرّية)" icon={Smartphone}>
              <div className={`p-3 rounded-xl border text-sm ${gatewayNeedsAttention ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-line bg-[var(--ui-sunken)]'}`}>
                <div className="font-bold">
                  {GATEWAY_STATUS_LABELS[gatewayStatusKey] || gatewayStatusKey}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[var(--ui-muted)]">آخر ظهور: </span>
                    {formatMs(gateway?.lastSeenAtMs)}
                  </div>
                  <div>
                    <span className="text-[var(--ui-muted)]">آخر تحديث: </span>
                    {formatMs(gateway?.updatedAtMs)}
                  </div>
                  <div>
                    <span className="text-[var(--ui-muted)]">رمز السبب: </span>
                    <span className="font-mono" dir="ltr">{gateway?.reasonCode || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[var(--ui-muted)]">الجهاز: </span>
                    {gateway?.deviceName || '—'}
                  </div>
                  <div className="col-span-2">
                    <span className="text-[var(--ui-muted)]">ربط أول مرة: </span>
                    {formatMs(gateway?.linkedAtMs)}
                  </div>
                </div>
                {gatewayNeedsAttention ? (
                  <p className="mt-2 text-[11px] font-medium">حالة تحتاج تدخلاً — لا إعادة إرسال آلية.</p>
                ) : null}
                {!gateway?.present ? (
                  <p className="mt-2 text-[11px] text-[var(--ui-muted)]">لا وثيقة جلسة بعد — الخدمة لم تكتب حالة بعد.</p>
                ) : null}
              </div>
            </SettingsSection>
          </div>

          <div className="mt-3">
            <SettingsSection title="حالة الربط والتشغيل" icon={Activity}>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded-lg bg-[var(--ui-sunken)]">Cloud: {config.whatsappCloudLinkStatus || '—'}</div>
                <div className="p-2 rounded-lg bg-[var(--ui-sunken)]">التوكن: {hasAccessToken ? 'محفوظ مشفّر' : 'غير موجود'}</div>
                <div className="p-2 rounded-lg bg-[var(--ui-sunken)] font-mono" dir="ltr">PN ID: {config.whatsappPhoneNumberId || '—'}</div>
                <div className="p-2 rounded-lg bg-[var(--ui-sunken)]">المزوّد: {config.whatsappPrimaryProvider || '—'}</div>
              </div>
              {counts ? (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg border border-line">إجمالي: {counts.deliveryTotal}</div>
                  <div className="p-2 rounded-lg border border-line">مرسل: {counts.sent}</div>
                  <div className="p-2 rounded-lg border border-line">واصل: {counts.delivered}</div>
                  <div className="p-2 rounded-lg border border-line">مقروء: {counts.read}</div>
                  <div className="p-2 rounded-lg border border-line">فشل: {counts.failed}</div>
                  <div className="p-2 rounded-lg border border-line">SMS معلّق: {counts.smsPending ?? 0}</div>
                  <div className="p-2 rounded-lg border border-line">SMS أُرسل: {counts.smsSent}</div>
                  <div className="p-2 rounded-lg border border-line">مراجعة: {counts.smsUnknown}</div>
                  <div className="p-2 rounded-lg border border-line">طابور: {counts.queueQueued}</div>
                  <div className="p-2 rounded-lg border border-line">جهاز: {counts.deviceTasksQueued}</div>
                </div>
              ) : null}
            </SettingsSection>
          </div>

          <div className="mt-3">
            <SettingsSection title="الربط والمزوّد" icon={MessageCircle}>
              <Field label="المزوّد الأساسي">
                <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="cloud_api">Cloud API</option>
                  <option value="local_gateway_qr">بوابة خادمية QR (موقوف حتى PoC)</option>
                </Select>
              </Field>
              <Field label="حالة الربط (Cloud)">
                <Select value={linkStatus} onChange={(e) => setLinkStatus(e.target.value)}>
                  <option value="unlinked">غير مربوط</option>
                  <option value="linked">مربوط</option>
                  <option value="error">خطأ</option>
                </Select>
              </Field>
              <Field label="Phone Number ID" hint="من Meta — ليس سراً">
                <input
                  className="w-full rounded-xl border border-line bg-[var(--ui-sunken)] px-3 py-2 text-sm font-mono"
                  dir="ltr"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <button type="button" onClick={saveConfig} disabled={saving} className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-teal-700 text-white text-sm font-bold disabled:opacity-50">
                <Save className="w-4 h-4" />
                حفظ الإعدادات
              </button>
            </SettingsSection>
          </div>

          <div className="mt-3">
            <SettingsSection title="Access Token (مشفّر)" icon={KeyRound}>
              <Field label="توكن جديد أو استبدال" hint="يُمسح من الحقل فوراً بعد الحفظ">
                <input
                  type="password"
                  className="w-full rounded-xl border border-line bg-[var(--ui-sunken)] px-3 py-2 text-sm font-mono"
                  dir="ltr"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  autoComplete="new-password"
                  placeholder="الصق التوكن هنا مرة واحدة"
                />
              </Field>
              <div className="flex gap-2">
                <button type="button" onClick={saveToken} disabled={saving || tokenInput.trim().length < 20} className="flex-1 py-2.5 rounded-xl bg-[var(--ui-ink)] text-white text-sm font-bold disabled:opacity-50">
                  حفظ مشفّر
                </button>
                <button type="button" onClick={clearToken} disabled={saving} className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-rose-300 text-rose-800 text-sm">
                  <Unplug className="w-4 h-4" />
                  حذف
                </button>
              </div>
            </SettingsSection>
          </div>
        </>
      )}
    </div>
  );
}
