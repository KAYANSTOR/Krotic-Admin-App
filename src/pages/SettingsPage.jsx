// src/pages/SettingsPage.jsx
import { useState, useEffect } from 'react';
import {
  doc, getDoc, setDoc, collection, getDocs, writeBatch, Timestamp,
} from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import {
  Settings, Save, Power, MessageSquare, Calendar, RefreshCw,
  ShieldCheck, AlertTriangle, Users,
} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Switch from '../components/ui/Switch';
import { Field, Input, Textarea } from '../components/ui/Field';
import ConfirmDialog from '../components/ConfirmDialog';
import { SkeletonCard, SkeletonPageHeader } from '../components/ui/Skeleton';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const DEFAULTS = {
  is_app_active: true,
  maintenance_message: '',
  default_trial_days: 3,
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
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // For batch update expiry
  const [batchDate, setBatchDate] = useState('');
  const [updatingBatch, setUpdatingBatch] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const configDoc = await getDoc(doc(db, 'app_settings', 'global_config'));
      if (configDoc.exists()) {
        setConfig((prev) => ({ ...prev, ...configDoc.data() }));
      }
    } catch (error) {
      console.error('Error fetching config:', error);
      toast.error('خطأ في تحميل الإعدادات');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'app_settings', 'global_config'), config, { merge: true });
      logAdminAction({
        action: AUDIT_ACTIONS.SETTINGS_SAVE,
        targetType: 'settings',
        targetId: 'global_config',
        targetLabel: 'الإعدادات العامة',
        details: {
          default_commission_rate: config.default_commission_rate,
          default_trial_days: config.default_trial_days,
          warning_days_before_expiry: config.warning_days_before_expiry,
          is_app_active: config.is_app_active,
        },
      });
      toast.success('تم حفظ الإعدادات بنجاح');
    } catch (error) {
      console.error('Error saving config:', error);
      toast.error('خطأ في حفظ الإعدادات');
    }
    setSaving(false);
  };

  const toggleAppStatus = () => {
    if (config.is_app_active) {
      setShowConfirm(true);
    } else {
      setConfig((prev) => ({ ...prev, is_app_active: true }));
    }
  };

  const confirmDisableApp = () => {
    setConfig((prev) => ({ ...prev, is_app_active: false }));
    setShowConfirm(false);
    logAdminAction({
      action: AUDIT_ACTIONS.APP_STATUS_CHANGE,
      targetType: 'settings',
      targetId: 'global_config',
      targetLabel: 'حالة التطبيق',
      details: { is_app_active: false },
    });
  };

  const handleBatchUpdateExpiry = async () => {
    if (!batchDate) {
      toast.error('يرجى تحديد التاريخ أولاً');
      return;
    }

    setUpdatingBatch(true);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const batch = writeBatch(db);
      let count = 0;

      const newExpiry = Timestamp.fromDate(new Date(batchDate));

      usersSnap.forEach((userDoc) => {
        const userData = userDoc.data();
        if (userData.is_trial === false) { // Only update official users
          batch.update(doc(db, 'users', userDoc.id), {
            subscription_end_date: newExpiry,
          });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        logAdminAction({
          action: AUDIT_ACTIONS.SUBSCRIPTION_BATCH,
          targetType: 'settings',
          targetId: 'global_config',
          targetLabel: 'تواريخ الانتهاء المجمّعة',
          details: { affected_users: count, new_date: batchDate },
        });
        toast.success(`تم تحديث تاريخ الانتهاء لـ ${count} حساب رسمي بنجاح`);
      } else {
        toast.error('لا يوجد حسابات رسمية لتحديثها');
      }
      setBatchDate('');
    } catch (error) {
      console.error('Error batch updating:', error);
      toast.error('حدث خطأ أثناء تحديث التواريخ');
    }
    setUpdatingBatch(false);
    setShowBatchConfirm(false);
  };

  const update = (patch) => setConfig((prev) => ({ ...prev, ...patch }));
  const isActive = config.is_app_active;

  if (loading) return <SettingsSkeleton />;

  return (
    <div className="settings-page">
      <PageHeader
        icon={Settings}
        title="الإعدادات العامة"
        description="التحكم بإعدادات التطبيق، العمولات، والرسائل الموجّهة للمستخدمين."
        actions={
          <Button as={Link} to="/admins" variant="secondary" icon={ShieldCheck}>
            إدارة المدراء
          </Button>
        }
      />

      <div className="settings-grid">
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
              hint="تُطبّق على جميع المستخدمين ما لم تُخصَّص عمولة خاصة لحساب معيّن."
            >
              <Input
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                value={config.default_commission_rate}
                onChange={(e) => update({ default_commission_rate: parseFloat(e.target.value) || 0 })}
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
                max="30"
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
                min="1"
                max="365"
                inputMode="numeric"
                value={config.default_trial_days}
                onChange={(e) => update({ default_trial_days: parseInt(e.target.value, 10) || 3 })}
                className="max-w-[10rem]"
              />
            </Field>
          </div>
        </Card>
      </div>

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

      {/* ===== نوافذ التأكيد ===== */}
      <ConfirmDialog
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmDisableApp}
        title="إيقاف التطبيق"
        message="هل أنت متأكد من إيقاف التطبيق؟ سيتم إغلاقه عند جميع المستخدمين فوراً."
        confirmText="نعم، أوقف التطبيق"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={showBatchConfirm}
        onClose={() => setShowBatchConfirm(false)}
        onConfirm={handleBatchUpdateExpiry}
        title="تحديث مجمع للتواريخ"
        message={`هل أنت متأكد من تغيير تاريخ الانتهاء لجميع الحسابات الرسمية ليصبح: ${batchDate}؟`}
        confirmText="نعم، قم بالتحديث"
        variant="primary"
      />
    </div>
  );
}
