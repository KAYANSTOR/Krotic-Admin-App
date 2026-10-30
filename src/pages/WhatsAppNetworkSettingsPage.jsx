import { useState, useCallback } from 'react';
import { MessageCircle, ShieldAlert, RefreshCw, KeyRound, Unplug, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import SearchHeader from '../components/ui/SearchHeader';
import SettingsSection from '../components/ui/SettingsSection';
import { Field, Select } from '../components/ui/Field';
import { adminFetch } from '../lib/adminApi';

/**
 * Limited admin UI for WhatsApp network config + sealed access token.
 * Token is never shown after save, never stored in localStorage.
 */
export default function WhatsAppNetworkSettingsPage() {
  const [networkId, setNetworkId] = useState('');
  const [config, setConfig] = useState(null);
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
      const result = await adminFetch('/api/whatsapp/network-config', {
        method: 'POST',
        body: { action: 'get', networkId: id },
      });
      if (!result.ok) {
        toast.error(result.error || 'تعذر التحميل');
        setConfig(null);
        return;
      }
      const cfg = result.data?.config || {};
      setConfig(cfg);
      setProvider(cfg.whatsappPrimaryProvider || 'cloud_api');
      setPhoneNumberId(cfg.whatsappPhoneNumberId || '');
      setLinkStatus(cfg.whatsappCloudLinkStatus || 'unlinked');
      setTokenInput(''); // never refill token
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
      const result = await adminFetch('/api/whatsapp/network-config', {
        method: 'POST',
        body: {
          action: 'set',
          networkId: id,
          config: {
            whatsappPrimaryProvider: provider,
            whatsappPhoneNumberId: phoneNumberId || null,
            whatsappCloudLinkStatus: linkStatus,
          },
        },
      });
      if (!result.ok) {
        toast.error(result.error || 'تعذر الحفظ');
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
      const result = await adminFetch('/api/whatsapp/network-config', {
        method: 'POST',
        body: { action: 'set_token', networkId: id, accessToken: token },
      });
      // Clear input immediately — do not keep secret in React state longer than needed
      setTokenInput('');
      if (!result.ok) {
        toast.error(result.error || 'تعذر حفظ التوكن');
        return;
      }
      if (result.data && (result.data.accessToken || result.data.token)) {
        toast.error('استجابة غير آمنة من الخادم');
        return;
      }
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
      const result = await adminFetch('/api/whatsapp/network-config', {
        method: 'POST',
        body: { action: 'clear_token', networkId: id },
      });
      setTokenInput('');
      if (!result.ok) {
        toast.error(result.error || 'تعذر الحذف');
        return;
      }
      toast.success('تم حذف التوكن');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24" dir="rtl">
      <SearchHeader
        title="إعدادات WhatsApp"
        subtitle="إدارة ربط الشبكة — التوكن لا يُعرض بعد الحفظ"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2.5 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]"
            aria-label="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      />

      <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Access Token يُشفَّر على الخادم فقط. لن يظهر في الواجهة بعد الإدخال، ولا يُحفظ في المتصفح.
        </p>
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
        <button
          type="button"
          onClick={load}
          disabled={loading || !networkId.trim()}
          className="w-full py-2.5 rounded-xl bg-[var(--ui-ink)] text-white text-sm font-bold disabled:opacity-50"
        >
          تحميل الإعدادات
        </button>
      </div>

      {config && (
        <>
          <div className="mt-3">
            <SettingsSection title="الربط والمزوّد" icon={MessageCircle}>
              <Field label="المزوّد الأساسي">
                <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="cloud_api">Cloud API</option>
                  <option value="local_gateway">Local Gateway (موقوف)</option>
                </Select>
              </Field>
              <Field label="حالة الربط">
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
              {config.whatsappUpdatedAtMs ? (
                <p className="text-[11px] text-[var(--ui-muted)]">
                  آخر تحديث: {new Date(config.whatsappUpdatedAtMs).toLocaleString('ar')}
                </p>
              ) : null}
              <button
                type="button"
                onClick={saveConfig}
                disabled={saving}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-teal-700 text-white text-sm font-bold disabled:opacity-50"
              >
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
                <button
                  type="button"
                  onClick={saveToken}
                  disabled={saving || tokenInput.trim().length < 20}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--ui-ink)] text-white text-sm font-bold disabled:opacity-50"
                >
                  حفظ مشفّر
                </button>
                <button
                  type="button"
                  onClick={clearToken}
                  disabled={saving}
                  className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-rose-300 text-rose-800 text-sm"
                >
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
