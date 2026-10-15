// src/pages/SettingsPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  doc, setDoc, collection, getDocs, writeBatch, Timestamp,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { db } from '../firebase';
import {
  Settings, Save, Power, MessageSquare, Calendar, RefreshCw,
  ShieldCheck, AlertTriangle, Users,
} from 'lucide-react';
import PageHero from '../components/ui/PageHero';
import Section from '../components/ui/Section';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import DataFreshness from '../components/ui/DataFreshness';
import { Field, Input, Textarea } from '../components/ui/Field';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';
import { chunkArray, FIRESTORE_BATCH_LIMIT } from '../lib/billingHelpers';
import { updateSettings, batchExpiry, adminApiError } from '../lib/adminApi';
import { invalidateAdminDataCache, invalidateAdminGlobalConfigData, fetchGlobalConfig, getAdminDataCacheState, subscribeAdminDataCache } from '../lib/adminData';
import useAppRefresh from '../lib/useAppRefresh';

const DEFAULTS = {
  is_app_active: true,
  maintenance_message: '',
  default_trial_days: 30,
  default_trial_warning: '',
  default_commission_rate: 5,
  global_official_warning: '',
  warning_days_before_expiry: 5,
};

function SettingsSkeleton() {
  return (
    <div className="settings-page">
      <SkeletonPageHeader />
      <div className="settings-grid">
        <SkeletonCard lines={4} />
        <SkeletonCard lines={4} />
      </div>
    </div>
  );
}


export default function SettingsPage() {
  const [config, setConfig] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cacheState, setCacheState] = useState(null);

  // For batch update expiry
  const [batchDate, setBatchDate] = useState('');
  const [updatingBatch, setUpdatingBatch] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const savedAppStatus = useRef(DEFAULTS.is_app_active);

  const fetchConfig = useCallback(async ({ force = false } = {}) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const loaded = await fetchGlobalConfig({ force });
      setConfig((prev) => ({
        ...prev,
        ...loaded,
        default_commission_rate: loaded?.default_commission_rate ?? 5,
      }));
      savedAppStatus.current = loaded?.is_app_active ?? DEFAULTS.is_app_active;
      setCacheState(getAdminDataCacheState('global-config'));
      setUpdatedAt(Date.now());
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error('خطأ في تحميل الإعدادات');
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const handleRefresh = () => fetchConfig({ force: true });

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // يعكس تحديثات الكاش (بما فيها الجلب الخلفي) في الصفحة.
  useEffect(() => subscribeAdminDataCache('global-config', (data) => {
    if (!data) return;
    setConfig((prev) => ({ ...prev, ...data, default_commission_rate: data.default_commission_rate ?? 5 }));
    savedAppStatus.current = data.is_app_active ?? savedAppStatus.current;
    setCacheState(getAdminDataCacheState('global-config'));
  }), []);

  // السحب للأسفل على الجوال يعيد الجلب قسرياً.
  useAppRefresh(() => fetchConfig({ force: true }));

  const handleSave = async () => {
    if (saving) return false;
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
      };
      const result = await updateSettings(patch);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر حفظ الإعدادات على الخادم'));
        return false;
      }

      invalidateAdminGlobalConfigData();
      const previousAppStatus = savedAppStatus.current;
      savedAppStatus.current = patch.is_app_active;
      if (previousAppStatus !== patch.is_app_active) {
        await logAdminAction({
          action: AUDIT_ACTIONS.APP_STATUS_CHANGE,
          targetType: 'settings',
          targetId: 'global_config',
          targetLabel: 'حالة التطبيق',
          details: { is_app_active: patch.is_app_active },
        });
      }
      void logAdminAction({
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
      }).catch((error) => console.warn('Settings audit write failed:', error));
      toast.success('تم حفظ الإعدادات بنجاح');
      return true;
    } catch (error) {
      console.error('Settings save failed:', error);
      toast.error('تعذر حفظ الإعدادات. تحقق من الاتصال ثم حاول مرة أخرى.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleAppStatus = () => {
    if (config.is_app_active) {
      setShowConfirm(true);
    } else {
      setConfig((prev) => ({ ...prev, is_app_active: true }));
    }
  };

  const confirmDisableApp = () => {
    // This confirms the proposed form value only. The status is actually
    // changed for users only after the global "Save changes" request succeeds.
    setConfig((prev) => ({ ...prev, is_app_active: false }));
    setShowConfirm(false);
  };

  const handleBatchUpdateExpiry = async () => {
    if (!batchDate) {
      toast.error('يرجى تحديد التاريخ أولاً');
      return false;
    }
    setUpdatingBatch(true);
    try {
      const subscriptionEndsAt = new Date(batchDate).getTime();
      const result = await batchExpiry(subscriptionEndsAt);
      if (!result.ok) {
        toast.error(adminApiError(result.error, 'تعذر تحديث تواريخ الانتهاء'));
        return false;
      }
      setShowBatchConfirm(false);
      const updated = Number(result.data?.updated) || 0;
      if (updated > 0) {
        invalidateAdminDataCache(['all-users', 'users-with-billing', 'dashboard-stats']);
        void logAdminAction({
          action: AUDIT_ACTIONS.SUBSCRIPTION_BATCH,
          targetType: 'settings',
          targetId: 'global_config',
          targetLabel: 'تواريخ الانتهاء المجمّعة',
          details: { affected_users: updated, new_date: batchDate },
        }).catch((error) => console.warn('Batch expiry audit failed:', error));
        toast.success(`تم تحديث تاريخ الانتهاء لـ ${updated} حساب رسمي بنجاح`);
      } else {
        toast.error('لا يوجد حسابات رسمية لتحديثها');
      }
      setBatchDate('');
      return true;
    } catch (error) {
      console.error('Batch expiry update failed:', error);
      toast.error('تعذر إكمال تحديث التواريخ. تحقق من الاتصال ثم حاول مرة أخرى.');
      return false;
    } finally {
      setUpdatingBatch(false);
    }
  };

  const update = (patch) => setConfig((prev) => ({ ...prev, ...patch }));
  const isActive = config.is_app_active;

  if (loading) return <SettingsSkeleton />;

  return (
    <div className="settings-page">
      <PageHero
        icon={Settings}
        title="الإعدادات العامة"
        subtitle="التحكم بإعدادات التطبيق، العمولات، والرسائل الموجّهة للمستخدمين."
        actions={
          <>
            <DataFreshness
              updatedAt={updatedAt}
              refreshing={loading || refreshing}
              onRefresh={handleRefresh}
              fromCache={cacheState?.fromCache ?? null}
            />
            <Button as={Link} to="/admins" variant="secondary" icon={ShieldCheck}>
              إدارة المدراء
            </Button>
          </>
        }
      />

      <Section eyebrow="الإعدادات العامة" aria-label="إعدادات التطبيق">
        {/* ===== حالة التطبيق ===== */}
        <Card>
          <CardHeader
            icon={Power}
            title="حالة التطبيق"
            description="التحكم بتشغيل الخدمة والعمولة العامة الافتراضية."
            action={
              <Badge tone={isActive ? 'success' : 'danger'} dot>
                {isActive ? 'يعمل' : 'متوقف'}
              </Badge>
            }
          />

          <div className="settings-row">
            <div className="settings-row__body">
              <p className="settings-row__title">تشغيل / إيقاف التطبيق</p>
              <p className="settings-row__desc">
                عند الإيقاف سيتم إغلاق التطبيق عند جميع المستخدمين.
              </p>
            </div>
            <Switch
              id="app-active-switch"
              checked={isActive}
              onChange={toggleAppStatus}
            />
          </div>

          {!isActive && (
            <div className="settings-field-block">
              <Field label="رسالة الصيانة" hint="تظهر لجميع المستخدمين أثناء إيقاف التطبيق.">
                <Textarea
                  value={config.maintenance_message || ''}
                  onChange={(e) => update({ maintenance_message: e.target.value })}
                  rows={3}
                  className="resize-none"
                  placeholder="التطبيق متوقف مؤقتاً للصيانة..."
                />
              </Field>
            </div>
          )}

          <div className="settings-field-block settings-divider">
            <Field
              label="العمولة العامة الافتراضية (%)"
              hint="5% افتراضياً وقابلة للتعديل من لوحة الإدارة. لا يعيد تغييرها تسعير سجلات تاريخية تلقائياً."
            >
              <Input
                type="number"
                min="0"
                max="20"
                step="0.1"
                inputMode="decimal"
                value={config.default_commission_rate ?? ''}
                onChange={(e) => update({ default_commission_rate: e.target.value === '' ? null : Number(e.target.value) })}
                className="max-w-[10rem]"
              />
            </Field>
          </div>
        </Card>

        {/* ===== نظام التحذيرات ===== */}
        <Card>
          <CardHeader
            icon={MessageSquare}
            title="نظام التحذيرات"
            description="الرسائل التي تُعرض للمستخدمين قبل انتهاء الاشتراك."
          />

          <div className="settings-field-block">
            <Field
              label="تفعيل التحذير قبل (أيام)"
              hint="عدد الأيام التي يظهر فيها التحذير قبل إيقاف التطبيق."
            >
              <Input
                type="number"
                min="1"
                max="7"
                inputMode="numeric"
                value={config.warning_days_before_expiry}
                onChange={(e) => update({ warning_days_before_expiry: parseInt(e.target.value, 10) || 5 })}
                className="max-w-[10rem]"
              />
            </Field>
          </div>

          <div className="settings-field-block">
            <Field label="رسالة التحذير للرسميين (العامة)">
              <Textarea
                value={config.global_official_warning || ''}
                onChange={(e) => update({ global_official_warning: e.target.value })}
                rows={3}
                className="resize-none"
                placeholder="عزيزي المستخدم، اقترب موعد تصفية الحساب..."
              />
            </Field>
          </div>

          <div className="settings-field-block">
            <Field label="رسالة التحذير للتجريبيين (العامة)">
              <Textarea
                value={config.default_trial_warning || ''}
                onChange={(e) => update({ default_trial_warning: e.target.value })}
                rows={3}
                className="resize-none"
                placeholder="أنت تستخدم النسخة التجريبية..."
              />
            </Field>
          </div>

          <div className="settings-field-block">
            <Field
              label="الأيام التجريبية الافتراضية للمسجلين الجدد"
              hint="تُمنح تلقائياً لكل حساب تجريبي جديد."
            >
              <Input
                type="number"
                min="0"
                max="30"
                inputMode="numeric"
                value={config.default_trial_days}
                onChange={(e) => update({ default_trial_days: parseInt(e.target.value, 10) || 0 })}
                className="max-w-[10rem]"
              />
            </Field>
          </div>
        </Card>
      </Section>

      {/* ===== شريط الحفظ ===== */}
      <div className="settings-savebar">
        <p className="settings-savebar__hint">
          تُحفظ التغييرات في إعدادات التطبيق العامة وتُطبّق فوراً على المستخدمين.
        </p>
        <Button variant="primary" size="lg" icon={Save} loading={saving} onClick={handleSave}>
          حفظ التغييرات
        </Button>
      </div>

      {/* ===== العمليات المجمعة ===== */}
      <Section eyebrow="العمليات المجمّعة" aria-label="إدارة تواريخ الانتهاء المجمّعة">
      <Card className="settings-batch">
        <CardHeader
          icon={Calendar}
          title="إدارة تواريخ الانتهاء المجمّعة"
          description="توحيد تاريخ انتهاء الاشتراك لجميع المستخدمين الرسميين دفعة واحدة."
          action={
            <Badge tone="warning">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
              عملية مؤثرة
            </Badge>
          }
        />

        <div className="settings-batch__form">
          <Field label="تاريخ الانتهاء الموحّد الجديد" className="settings-batch__field">
            <Input
              type="date"
              value={batchDate}
              onChange={(e) => setBatchDate(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            icon={RefreshCw}
            disabled={!batchDate || updatingBatch}
            loading={updatingBatch}
            onClick={() => setShowBatchConfirm(true)}
          >
            تطبيق على جميع الرسميين
          </Button>
        </div>

        <p className="settings-batch__note">
          <Users className="w-4 h-4" aria-hidden="true" />
          يؤثر هذا الإجراء على الحسابات الرسمية فقط، ولا يمسّ الحسابات التجريبية.
        </p>
      </Card>
      </Section>

      {/* ===== نوافذ التأكيد ===== */}
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmDisableApp}
        title="إيقاف التطبيق"
        message="سيتم تحديد حالة التطبيق كمتوقف في نموذج الإعدادات. لن يُطبَّق التغيير على المستخدمين إلا بعد الضغط على «حفظ التغييرات» بنجاح."
        confirmText="تأكيد حالة الإيقاف"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showBatchConfirm}
        onClose={() => setShowBatchConfirm(false)}
        onConfirm={handleBatchUpdateExpiry}
        title="تحديث مجمع للتواريخ"
        message={`سيتم تغيير تاريخ الانتهاء لجميع الحسابات الرسمية ليصبح: ${batchDate}. هذا الإجراء واسع الأثر ولا يمكن التراجع عنه دفعة واحدة.`}
        confirmText="نعم، قم بالتحديث"
        variant="primary"
        requireText="تأكيد"
      />
    </div>
  );
}
