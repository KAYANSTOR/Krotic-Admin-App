import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, updateDoc, writeBatch, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Settings, Save, Power, AlertTriangle, MessageSquare, Percent, Calendar, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import LoadingSpinner from '../components/LoadingSpinner';
import ConfirmDialog from '../components/ConfirmDialog';

export default function SettingsPage() {
  const [config, setConfig] = useState({
    is_app_active: true,
    maintenance_message: '',
    default_trial_days: 3,
    default_trial_warning: '',
    default_commission_rate: 5,
    global_official_warning: '',
    warning_days_before_expiry: 5
  });
  
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
        setConfig({ ...config, ...configDoc.data() });
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
      setConfig({ ...config, is_app_active: true });
    }
  };

  const confirmDisableApp = () => {
    setConfig({ ...config, is_app_active: false });
    setShowConfirm(false);
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
            subscription_end_date: newExpiry
          });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
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

  if (loading) return <LoadingSpinner size="lg" />;

  return (
    <div>
      <div className="mb-8">
        <h1 className="page-title flex items-center gap-3">
          <Settings className="w-7 h-7 text-primary-600" />
          الإعدادات العامة
        </h1>
        <p className="text-gray-500 mt-1">التحكم بإعدادات التطبيق، العمولات، والرسائل</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Basic App Status */}
        <div className="card space-y-6 h-fit">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Power className="w-5 h-5" />
            حالة التطبيق الأساسية
          </h3>
          
          <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50">
            <div>
              <p className="font-medium text-gray-900">تشغيل / إيقاف التطبيق</p>
              <p className="text-sm text-gray-500 mt-1">
                عند الإيقاف سيتم إغلاق التطبيق عند جميع المستخدمين
              </p>
            </div>
            <button
              onClick={toggleAppStatus}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${
                config.is_app_active ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-300 shadow-sm ${
                  config.is_app_active ? 'translate-x-2' : 'translate-x-8'
                }`}
              />
            </button>
          </div>

          {!config.is_app_active && (
            <div>
              <label className="label-field">رسالة الصيانة</label>
              <textarea
                value={config.maintenance_message}
                onChange={(e) => setConfig({ ...config, maintenance_message: e.target.value })}
                className="input-field resize-none"
                rows={3}
                placeholder="التطبيق متوقف مؤقتاً للصيانة..."
              />
            </div>
          )}

          <div className="pt-4 border-t">
            <label className="label-field flex items-center gap-2">
              <Percent className="w-4 h-4" />
              العمولة العامة الافتراضية (%)
            </label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={config.default_commission_rate}
              onChange={(e) => setConfig({ ...config, default_commission_rate: parseFloat(e.target.value) || 0 })}
              className="input-field max-w-xs"
            />
            <p className="text-xs text-gray-500 mt-2">
              سيتم تطبيق هذه النسبة على جميع المستخدمين ما لم تقم بتخصيص عمولة خاصة لحساب معين.
            </p>
          </div>
        </div>

        {/* Global Warnings */}
        <div className="card space-y-6 h-fit">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            نظام التحذيرات
          </h3>

          <div>
            <label className="label-field">تفعيل التحذير قبل (أيام)</label>
            <input
              type="number"
              min="1"
              max="30"
              value={config.warning_days_before_expiry}
              onChange={(e) => setConfig({ ...config, warning_days_before_expiry: parseInt(e.target.value) || 5 })}
              className="input-field max-w-xs"
            />
            <p className="text-xs text-gray-500 mt-1">يحدد عدد الأيام التي سيظهر فيها التحذير قبل إيقاف التطبيق.</p>
          </div>

          <div>
            <label className="label-field">رسالة التحذير للرسميين (العامة)</label>
            <textarea
              value={config.global_official_warning}
              onChange={(e) => setConfig({ ...config, global_official_warning: e.target.value })}
              className="input-field resize-none"
              rows={3}
              placeholder="عزيزي المستخدم، اقترب موعد تصفية الحساب..."
            />
          </div>

          <div>
            <label className="label-field">رسالة التحذير للتجريبيين (العامة)</label>
            <textarea
              value={config.default_trial_warning}
              onChange={(e) => setConfig({ ...config, default_trial_warning: e.target.value })}
              className="input-field resize-none"
              rows={3}
              placeholder="أنت تستخدم النسخة التجريبية..."
            />
          </div>
          
          <div>
             <label className="label-field">الأيام التجريبية الافتراضية للمسجلين الجدد</label>
             <input
                type="number"
                min="1"
                max="365"
                value={config.default_trial_days}
                onChange={(e) => setConfig({ ...config, default_trial_days: parseInt(e.target.value) || 3 })}
                className="input-field max-w-xs"
              />
          </div>
        </div>
      </div>
      
      {/* Save Global Settings */}
      <div className="flex justify-end mb-10">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2 px-8"
        >
          {saving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
          حفظ التغييرات
        </button>
      </div>

      {/* Batch Operations */}
      <div className="card border-blue-200 bg-blue-50/30">
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600" />
          إدارة تواريخ الانتهاء المجمعة
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          يمكنك من هنا توحيد تاريخ انتهاء الاشتراك (التصفية) لجميع **المستخدمين الرسميين** دفعة واحدة بضغطة زر.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 max-w-sm">
            <label className="label-field">اختر تاريخ الانتهاء الموحد الجديد</label>
            <input 
              type="date"
              value={batchDate}
              onChange={(e) => setBatchDate(e.target.value)}
              className="input-field bg-white"
            />
          </div>
          <button 
            onClick={() => setShowBatchConfirm(true)}
            disabled={!batchDate || updatingBatch}
            className="btn-primary bg-blue-600 hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4 inline ml-2" />
            تطبيق على جميع الرسميين
          </button>
        </div>
      </div>

      {/* Confirms */}
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
