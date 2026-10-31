import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Settings as SettingsIcon, Power, MessageSquare, Calendar, RefreshCw,
  ShieldCheck, AlertTriangle, Users, KeyRound, Bell, Smartphone,
  Volume2, Vibrate, CheckCircle2, Send, Save, Cloud, Download,
} from 'lucide-react';

import {
  getNotificationPreferences,
  saveNotificationPreferences,
  subscribeNotificationPreferences,
  getNotificationPermission,
  requestNotificationPermission,
  sendTestPhoneNotification,
} from '../lib/phoneNotifications';

import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import ChangeAdminPasswordModal from '../components/ChangeAdminPasswordModal';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import SearchHeader from '../components/ui/SearchHeader';
import SettingsSection from '../components/ui/SettingsSection';
import SettingField from '../components/ui/SettingField';
import DangerZone from '../components/ui/DangerZone';
import SaveBar from '../components/ui/SaveBar';
import AppStatusHero from '../components/settings/AppStatusHero';

import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { updateSettings, batchExpiry, adminApiError } from '../lib/adminApi';
import { useLocalQuery } from '../lib/localDb/useLocalQuery';
import { useLocalDb } from '../lib/localDb/LocalDbContext';
import { loadLocalConfig } from '../lib/localDb/localData';
import { resetSyncCursors } from '../lib/localDb/syncEngine';
import useAppRefresh from '../lib/useAppRefresh';

const DEFAULTS = {
  is_app_active: true,
  maintenance_message: '',
  default_trial_days: 30,
  default_trial_warning: '',
  default_commission_rate: 5,
  global_official_warning: '',
  warning_days_before_expiry: 5,
  app_latest_version: '',
  app_latest_version_code: '',
};

const TABS = [
  { key: 'app', label: 'التطبيق', icon: SettingsIcon },
  { key: 'notifications', label: 'الإشعارات', icon: Bell },
  { key: 'security', label: 'الأمان', icon: ShieldCheck },
  { key: 'advanced', label: 'متقدم', icon: Cloud },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('app');
  const [config, setConfig] = useState(DEFAULTS);
  const [serverConfig, setServerConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // Notifications
  const [notifPrefs, setNotifPrefs] = useState(() => getNotificationPreferences());
  const [notifPermission, setNotifPermission] = useState(() => getNotificationPermission());
  const [testingNotif, setTestingNotif] = useState(false);

  // Batch expiry
  const [batchDate, setBatchDate] = useState('');
  const [updatingBatch, setUpdatingBatch] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // Full sync
  const [fullSyncing, setFullSyncing] = useState(false);
  const [showFullSyncConfirm, setShowFullSyncConfirm] = useState(false);

  const savedAppStatus = useRef(DEFAULTS.is_app_active);

  const { runSync, syncing, lastSyncAt, localDb } = useLocalDb();
  const configQuery = useLocalQuery((localDb) => loadLocalConfig(localDb), []);

  // ==== Load ====
  useEffect(() => {
    const loaded = configQuery.data;
    if (!loaded) return;
    setServerConfig(loaded);
    setConfig((prev) => ({
      ...prev,
      ...loaded,
      default_commission_rate: loaded?.default_commission_rate ?? 5,
    }));
    savedAppStatus.current = loaded?.is_app_active ?? savedAppStatus.current;
  }, [configQuery.data]);

  const loading = configQuery.loading && !configQuery.data;
  const refreshing = syncing;

  const refresh = async () => {
    await runSync({ reason: 'manual' });
    configQuery.refresh();
  };
  useAppRefresh(refresh);

  // ==== Dirty check ====
  const dirty = useMemo(() => {
    if (!serverConfig) return false;
    return (
      Boolean(config.is_app_active) !== Boolean(serverConfig.is_app_active) ||
      (config.maintenance_message || '') !== (serverConfig.maintenance_message || '') ||
      Number(config.default_commission_rate) !== Number(serverConfig.default_commission_rate ?? 5) ||
      Number(config.default_trial_days) !== Number(serverConfig.default_trial_days ?? 30) ||
      (config.default_trial_warning || '') !== (serverConfig.default_trial_warning || '') ||
      (config.global_official_warning || '') !== (serverConfig.global_official_warning || '') ||
      Number(config.warning_days_before_expiry) !== Number(serverConfig.warning_days_before_expiry ?? 5) ||
      (config.app_latest_version || '') !== (serverConfig.app_latest_version || '') ||
      Number(config.app_latest_version_code || 0) !== Number(serverConfig.app_latest_version_code || 0)
    );
  }, [config, serverConfig]);

  // ==== Notifications subscription ====
  useEffect(() => subscribeNotificationPreferences(setNotifPrefs), []);

  const handleNotifToggle = (key, value) => {
    const next = { ...notifPrefs, [key]: value };
    setNotifPrefs(next);
    saveNotificationPreferences(next);
    if (key === 'enabled') {
      if (value) {
        toast.success('تم تشغيل إشعارات الهاتف');
        if (notifPermission !== 'granted') handleRequestNotifPermission();
      } else {
        toast('تم إيقاف إشعارات الهاتف', { icon: '🔕' });
      }
    }
  };

  const handleRequestNotifPermission = async () => {
    const res = await requestNotificationPermission();
    setNotifPermission(res);
    if (res === 'granted') toast.success('تم منح إذن الإشعارات');
    else if (res === 'denied') toast.error('تم حظر الإشعارات من المتصفح');
  };

  const handleSendTestNotif = async () => {
    setTestingNotif(true);
    try {
      const res = await sendTestPhoneNotification();
      setNotifPermission(res.permission);
      if (res.permission === 'denied') toast.error('يرجى السماح بالإشعارات');
      else toast.success('تم إرسال إشعار تجريبي');
    } catch {
      toast.error('تعذر الإرسال');
    } finally {
      setTestingNotif(false);
    }
  };

  // ==== App status toggle ====
  const toggleAppStatus = () => {
    if (config.is_app_active) setShowConfirm(true);
    else setConfig((prev) => ({ ...prev, is_app_active: true }));
  };

  const confirmDisableApp = () => {
    setConfig((prev) => ({ ...prev, is_app_active: false }));
    setShowConfirm(false);
  };

  // ==== Save ====
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const patch = {
        is_app_active: config.is_app_active,
        maintenance_message: config.maintenance_message || '',
        default_trial_days: Number(config.default_trial_days),
        default_trial_warning: config.default_trial_warning || '',
        default_commission_rate: Number(config.default_commission_rate),
        global_official_warning: config.global_official_warning || '',
        warning_days_before_expiry: Number(config.warning_days_before_expiry),
        app_latest_version: String(config.app_latest_version || '').trim(),
        ...(Number(config.app_latest_version_code) > 0
          ? { app_latest_version_code: Number(config.app_latest_version_code) }
          : {}),
      };
      const result = await updateSettings(patch);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر حفظ الإعدادات'));
        return;
      }

      await refresh();

      const prevAppStatus = savedAppStatus.current;
      savedAppStatus.current = patch.is_app_active;
      if (prevAppStatus !== patch.is_app_active) {
        await logAdminAction({
          action: AUDIT_ACTIONS.APP_STATUS_CHANGE,
          targetType: 'settings',
          targetId: 'global_config',
          targetLabel: 'حالة التطبيق',
          details: { is_app_active: patch.is_app_active },
        }).catch(() => {});
      }
      logAdminAction({
        action: AUDIT_ACTIONS.SETTINGS_SAVE,
        targetType: 'settings',
        targetId: 'global_config',
        targetLabel: 'الإعدادات العامة',
        details: {
          default_commission_rate: patch.default_commission_rate,
          default_trial_days: patch.default_trial_days,
          warning_days_before_expiry: patch.warning_days_before_expiry,
          is_app_active: patch.is_app_active,
        },
      }).catch(() => {});
      toast.success('تم حفظ الإعدادات');
    } catch (err) {
      console.error('Settings save failed:', err);
      toast.error('تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  };

  // ==== Batch expiry ====
  const handleBatchUpdateExpiry = async () => {
    if (!batchDate) { toast.error('حدد التاريخ أولاً'); return false; }
    setUpdatingBatch(true);
    try {
      const subscriptionEndsAt = new Date(batchDate).getTime();
      const result = await batchExpiry(subscriptionEndsAt);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر تحديث التواريخ'));
        return false;
      }
      setShowBatchConfirm(false);
      const updated = Number(result.data?.updated) || 0;
      if (updated > 0) {
        await refresh();
        await logAdminAction({
          action: AUDIT_ACTIONS.SUBSCRIPTION_BATCH,
          targetType: 'settings',
          targetId: 'global_config',
          targetLabel: 'تواريخ الانتهاء المجمّعة',
          details: { affected_users: updated, new_date: batchDate },
        }).catch(() => {});
        toast.success(`تم تحديث ${updated} حساب رسمي`);
      } else {
        toast.error('لا يوجد حسابات رسمية للتحديث');
      }
      setBatchDate('');
      return true;
    } catch (err) {
      console.error('Batch expiry failed:', err);
      toast.error('تعذر إكمال تحديث التواريخ');
      return false;
    } finally {
      setUpdatingBatch(false);
    }
  };

  // ==== Full sync ====
  const handleFullSync = async () => {
    if (!localDb) { toast.error('القاعدة المحلية غير متاحة'); return false; }
    if (fullSyncing) return false;
    setFullSyncing(true);
    try {
      await resetSyncCursors(localDb);
      await runSync({ reason: 'manual' });
      configQuery.refresh();
      setShowFullSyncConfirm(false);
      toast.success('اكتملت المزامنة الكاملة');
      return true;
    } catch (err) {
      console.error('Full sync failed:', err);
      toast.error('تعذرت المزامنة الكاملة');
      return false;
    } finally {
      setFullSyncing(false);
    }
  };

  const update = (patch) => setConfig((prev) => ({ ...prev, ...patch }));

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonPageHeader />
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  return (
    <div className="pb-32">
      <SearchHeader
        title="الإعدادات"
        subtitle={config.is_app_active ? 'التطبيق يعمل' : '⚠️ التطبيق متوقف'}
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder=""
        onFilterClick={null}
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

      <div className="mt-3">
        <AppStatusHero
          active={Boolean(config.is_app_active)}
          onToggle={toggleAppStatus}
          maintenanceMessage={config.maintenance_message}
        />
      </div>

      {/* Tabs */}
      <div className="mt-3 android-tabs" role="group" aria-label="أقسام الإعدادات">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`android-tab min-h-[44px] ${activeTab === tab.key ? 'is-active' : ''}`}
          >
            <tab.icon className="w-4 h-4 ml-1" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {activeTab === 'app' && (
          <>
            <SettingsSection
              title="الإصدار المنشور"
              description="للمقارنة مع آخر نسخة أبلغت عنها الأجهزة."
              icon={Smartphone}
            >
              <SettingField label="رقم الإصدار" hint="صيغة ثلاثية مثل 1.0.16">
                <input
                  type="text"
                  dir="ltr"
                  value={config.app_latest_version || ''}
                  onChange={(e) => update({ app_latest_version: e.target.value })}
                  placeholder="1.0.16"
                  className="input-field w-full min-h-[44px] text-sm"
                />
              </SettingField>
              <SettingField label="versionCode المنشور" hint="عدد صحيح موجب">
                <input
                  type="number"
                  dir="ltr"
                  min="1"
                  value={config.app_latest_version_code || ''}
                  onChange={(e) => update({ app_latest_version_code: e.target.value === '' ? '' : Number(e.target.value) })}
                  placeholder="16"
                  className="input-field w-full min-h-[44px] text-sm"
                />
              </SettingField>
            </SettingsSection>

            <SettingsSection
              title="العمولة والاشتراكات"
              description="القيم الافتراضية للحسابات الجديدة."
              icon={Power}
            >
              <SettingField
                label="العمولة العامة (%)"
                hint="5% افتراضياً. لا يعيد تسعير السجلات التاريخية."
              >
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.1"
                  value={config.default_commission_rate ?? ''}
                  onChange={(e) => update({ default_commission_rate: e.target.value === '' ? null : Number(e.target.value) })}
                  className="input-field w-full max-w-[10rem] min-h-[44px] text-sm"
                />
              </SettingField>
              <SettingField
                label="أيام التحذير قبل الانتهاء"
                hint="عدد الأيام التي يظهر فيها التحذير قبل الإيقاف."
              >
                <input
                  type="number"
                  min="1"
                  max="7"
                  value={config.warning_days_before_expiry}
                  onChange={(e) => update({ warning_days_before_expiry: parseInt(e.target.value, 10) || 5 })}
                  className="input-field w-full max-w-[10rem] min-h-[44px] text-sm"
                />
              </SettingField>
              <SettingField
                label="الأيام التجريبية الافتراضية"
                hint="تُمنح تلقائياً لكل حساب تجريبي جديد."
              >
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={config.default_trial_days}
                  onChange={(e) => update({ default_trial_days: parseInt(e.target.value, 10) || 0 })}
                  className="input-field w-full max-w-[10rem] min-h-[44px] text-sm"
                />
              </SettingField>
            </SettingsSection>

            <SettingsSection
              title="رسائل التحذير"
              description="الرسائل التي تُعرض للمستخدمين قبل انتهاء الاشتراك."
              icon={MessageSquare}
            >
              <SettingField label="رسالة الرسميين">
                <textarea
                  rows={3}
                  value={config.global_official_warning || ''}
                  onChange={(e) => update({ global_official_warning: e.target.value })}
                  placeholder="عزيزي المستخدم، اقترب موعد تصفية الحساب..."
                  className="input-field w-full resize-none text-sm"
                />
              </SettingField>
              <SettingField label="رسالة التجريبيين">
                <textarea
                  rows={3}
                  value={config.default_trial_warning || ''}
                  onChange={(e) => update({ default_trial_warning: e.target.value })}
                  placeholder="أنت تستخدم النسخة التجريبية..."
                  className="input-field w-full resize-none text-sm"
                />
              </SettingField>
            </SettingsSection>
          </>
        )}

        {activeTab === 'notifications' && (
          <>
            <SettingsSection
              title="إشعارات الهاتف الحية"
              description="تنبيهات فورية في شريط إشعارات هاتفك عند المبيعات والتسجيل."
              icon={Smartphone}
            >
              {notifPermission !== 'granted' && (
                <div className="px-4 py-3 bg-amber-50">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-900">إذن الإشعارات غير مفعّل</p>
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        {notifPermission === 'denied'
                          ? 'تم حظر الإشعارات — يرجى السماح بها من إعدادات المتصفح.'
                          : 'بحاجة إلى موافقة لإظهار الإشعارات.'}
                      </p>
                    </div>
                    {notifPermission !== 'denied' && (
                      <button
                        type="button"
                        onClick={handleRequestNotifPermission}
                        className="text-[11px] font-bold text-amber-900 underline"
                      >
                        السماح
                      </button>
                    )}
                  </div>
                </div>
              )}

              <SettingField
                label="تشغيل إشعارات الهاتف"
                hint="المفتاح الرئيسي لجميع التنبيهات."
                switch={{
                  checked: notifPrefs.enabled,
                  onChange: (v) => handleNotifToggle('enabled', v),
                }}
              />
              <SettingField
                label="إشعارات المبيعات 💰"
                hint="تنبيه فوري عند بيع أي كرت في أي شبكة."
                switch={{
                  checked: notifPrefs.salesAlerts,
                  onChange: (v) => handleNotifToggle('salesAlerts', v),
                  disabled: !notifPrefs.enabled,
                }}
              />
              <SettingField
                label="إشعارات تسجيل مستخدم 🎉"
                hint="تنبيه عند تسجيل أي شخص حساباً جديداً."
                switch={{
                  checked: notifPrefs.userAlerts,
                  onChange: (v) => handleNotifToggle('userAlerts', v),
                  disabled: !notifPrefs.enabled,
                }}
              />
              <SettingField
                label="نغمة صوتية"
                hint="نغمة خفيفة عند وصول أي إشعار."
                switch={{
                  checked: notifPrefs.sound,
                  onChange: (v) => handleNotifToggle('sound', v),
                  disabled: !notifPrefs.enabled,
                }}
              />
              <SettingField
                label="اهتزاز الهاتف"
                hint="اهتزاز الجهاز عند التنبيه."
                switch={{
                  checked: notifPrefs.vibrate,
                  onChange: (v) => handleNotifToggle('vibrate', v),
                  disabled: !notifPrefs.enabled,
                }}
              />
            </SettingsSection>

            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-[11px]">
                {notifPermission === 'granted' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700 font-bold">الإذن مفعّل</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span className="text-[var(--ui-muted)]">الإذن غير مفعّل</span>
                  </>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={Send}
                loading={testingNotif}
                onClick={handleSendTestNotif}
              >
                تجربة إشعار
              </Button>
            </div>
          </>
        )}

        {activeTab === 'security' && (
          <>
            <SettingsSection
              title="أمان حساب المدير"
              description="إدارة كلمة المرور وحماية لوحة الإدارة."
              icon={KeyRound}
            >
              <div className="px-4 py-3">
                <p className="text-sm font-bold text-[var(--ui-ink)]">كلمة مرور المدير</p>
                <p className="text-[11px] text-[var(--ui-muted)] mt-0.5">
                  يمكنك تغيير كلمة المرور الحالية لتأمين حسابك.
                </p>
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(true)}
                  className="mt-3 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-[var(--ui-brand)] text-white font-bold text-sm active:scale-95 transition-transform"
                >
                  <KeyRound className="w-4 h-4" />
                  تغيير كلمة المرور
                </button>
              </div>
            </SettingsSection>

            <SettingsSection
              title="حسابات المدراء"
              description="إدارة المدراء الذين يمكنهم الوصول للوحة."
              icon={Users}
            >
              <Link
                to="/admins"
                className="flex items-center justify-between gap-2 px-4 py-3 min-h-[56px] hover:bg-[var(--ui-sunken)] transition-colors"
              >
                <div>
                  <p className="text-sm font-bold text-[var(--ui-ink)]">إدارة المدراء</p>
                  <p className="text-[11px] text-[var(--ui-muted)] mt-0.5">
                    إضافة، حذف، أو تعديل صلاحيات المدراء
                  </p>
                </div>
                <ShieldCheck className="w-5 h-5 text-[var(--ui-muted)]" />
              </Link>
            </SettingsSection>
          </>
        )}

        {activeTab === 'advanced' && (
          <>
            <DangerZone
              title="تواريخ الانتهاء المجمّعة"
              description="توحيد تاريخ انتهاء الاشتراك لجميع الحسابات الرسمية دفعة واحدة."
              icon={Calendar}
            >
              <div>
                <label className="text-xs font-bold text-rose-900 block mb-1.5">
                  تاريخ الانتهاء الموحّد الجديد
                </label>
                <input
                  type="date"
                  value={batchDate}
                  onChange={(e) => setBatchDate(e.target.value)}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-rose-300 bg-white text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowBatchConfirm(true)}
                disabled={!batchDate || updatingBatch}
                className="w-full min-h-[44px] rounded-xl bg-rose-600 text-white font-bold text-sm disabled:opacity-50 hover:bg-rose-700 transition-colors"
              >
                {updatingBatch ? 'جارٍ التحديث...' : 'تطبيق على جميع الرسميين'}
              </button>
              <p className="text-[11px] text-rose-700 flex items-start gap-1.5">
                <Users className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                يؤثر هذا الإجراء على الحسابات الرسمية فقط، ولا يمسّ التجريبية.
              </p>
            </DangerZone>

            <DangerZone
              title="إعادة المزامنة الكاملة"
              description="مسح مؤشرات المزامنة المحلية وإعادة قراءة كل البيانات من Firestore."
              icon={RefreshCw}
            >
              <p className="text-[11px] text-rose-800 leading-relaxed">
                استخدمها بعد ترحيل <code className="font-mono bg-rose-100 px-1 rounded">updatedAtMs</code> للوثائق القديمة،
                أو إذا ظهرت القوائم ناقصة. المزامنة اليومية تزايدية وتقرأ التغييرات فقط.
              </p>
              <button
                type="button"
                onClick={() => setShowFullSyncConfirm(true)}
                disabled={fullSyncing || !localDb}
                className="w-full min-h-[44px] rounded-xl bg-rose-600 text-white font-bold text-sm disabled:opacity-50 hover:bg-rose-700 transition-colors"
              >
                {fullSyncing ? 'جارٍ المزامنة...' : 'بدء المزامنة الكاملة'}
              </button>
              <p className="text-[11px] text-rose-700 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                قد تستهلك عدداً كبيراً من قراءات Firestore.
              </p>
            </DangerZone>
          </>
        )}
      </div>

      {/* Save Bar — يظهر فقط عند وجود تغييرات غير محفوظة */}
      {dirty && <SaveBar onSave={handleSave} saving={saving} />}

      {/* Modals */}
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmDisableApp}
        title="إيقاف التطبيق"
        message="سيتم تحديد حالة التطبيق كمتوقف في النموذج. لن يُطبَّق على المستخدمين إلا بعد الضغط على «حفظ الآن»."
        confirmText="تأكيد الإيقاف"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showBatchConfirm}
        onClose={() => setShowBatchConfirm(false)}
        onConfirm={handleBatchUpdateExpiry}
        title="تحديث مجمّع للتواريخ"
        message={`سيتم تغيير تاريخ الانتهاء لجميع الحسابات الرسمية إلى: ${batchDate}. لا يمكن التراجع.`}
        confirmText="نعم، حدّث"
        variant="primary"
        requireText="تأكيد"
      />

      <ConfirmDialog
        isOpen={showFullSyncConfirm}
        onClose={() => setShowFullSyncConfirm(false)}
        onConfirm={handleFullSync}
        title="مزامنة كاملة"
        message="ستُمسح مؤشرات المزامنة المحلية وتُعاد قراءة كل المجموعات. قد تستهلك قراءات كثيرة."
        confirmText="نعم، ابدأ"
        variant="primary"
        requireText="تأكيد"
      />

      <ChangeAdminPasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
}
