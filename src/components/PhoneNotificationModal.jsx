// src/components/PhoneNotificationModal.jsx
import { useState, useEffect } from 'react';
import {
  Bell, BellOff, CheckCircle2, AlertTriangle, Volume2, VolumeX,
  Smartphone, Vibrate, Sparkles, X, Send
} from 'lucide-react';
import toast from 'react-hot-toast';
import Switch from './ui/Switch';
import Button from './ui/Button';
import Badge from './ui/Badge';
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  sendTestPhoneNotification,
} from '../lib/phoneNotifications';

export default function PhoneNotificationModal({ isOpen, onClose }) {
  const [prefs, setPrefs] = useState(() => getNotificationPreferences());
  const [permission, setPermission] = useState(() => getNotificationPermission());
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPrefs(getNotificationPreferences());
      setPermission(getNotificationPermission());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const supported = isNotificationSupported();

  const handleToggle = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    saveNotificationPreferences(next);
    if (key === 'enabled') {
      if (value) {
        toast.success('تم تشغيل إشعارات الهاتف الحية');
        // إذا لم يكن الإذن ممنوحاً، نطلبه فوراً لتسهيل الأمر على المدير
        if (permission !== 'granted') {
          handleRequestPermission();
        }
      } else {
        toast('تم إيقاف إشعارات الهاتف مؤقتاً', { icon: '🔕' });
      }
    }
  };

  const handleRequestPermission = async () => {
    const res = await requestNotificationPermission();
    setPermission(res);
    if (res === 'granted') {
      toast.success('تم منح إذن إشعارات الهاتف بنجاح!');
    } else if (res === 'denied') {
      toast.error('تم رفض إذن الإشعارات من إعدادات المتصفح');
    }
  };

  const handleTestNotification = async () => {
    setTesting(true);
    try {
      const res = await sendTestPhoneNotification();
      setPermission(res.permission);
      if (res.permission === 'denied') {
        toast.error('يرجى السماح بالإشعارات من إعدادات المتصفح أو موقع الويب');
      } else {
        toast.success('تم إرسال إشعار تجريبي! تفقّد شريط إشعارات هاتفك الآن');
      }
    } catch (error) {
      toast.error('تعذر إرسال الإشعار التجريبي');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-notif-title"
    >
      <div className="bg-surface rounded-2xl shadow-2xl border border-line w-full max-w-lg overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-surface-sunken/40">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </span>
            <div>
              <h2 id="phone-notif-title" className="text-base sm:text-lg font-black text-ink">
                إشعارات الهاتف الحية
              </h2>
              <p className="text-xs text-ink-muted">
                تنبيهات فورية في شريط إشعارات الهاتف عند المبيعات والتسجيل
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink rounded-lg hover:bg-surface-sunken transition-colors"
            aria-label="إغلاق النافذة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-5 overflow-y-auto">
          {/* Permission Status Box */}
          <div className="p-3.5 rounded-xl border border-line bg-surface-sunken flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {permission === 'granted' ? (
                <span className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </span>
              ) : (
                <span className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </span>
              )}
              <div>
                <p className="text-xs font-bold text-ink">حالة إذن إشعارات الهاتف</p>
                <p className="text-[11px] text-ink-muted">
                  {permission === 'granted'
                    ? 'إذن النظام مفعّل — ستصلك الإشعارات في شريط هاتفك'
                    : permission === 'denied'
                    ? 'تم حظر الإشعارات — يرجى السماح بها من إعدادات المتصفح'
                    : 'بحاجة إلى موافقة للسماح بإشعارات شريط الهاتف'}
                </p>
              </div>
            </div>

            {permission !== 'granted' && supported && (
              <Button
                variant="brand"
                size="sm"
                onClick={handleRequestPermission}
                className="w-full sm:w-auto shrink-0"
              >
                تفعيل إذن الهاتف
              </Button>
            )}

            {permission === 'granted' && (
              <Badge variant="success" size="sm">مسموح به</Badge>
            )}
          </div>

          {/* Master Switch */}
          <div className="p-4 rounded-xl border-2 border-brand/30 bg-brand/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${prefs.enabled ? 'bg-brand text-white' : 'bg-line text-ink-muted'}`}>
                {prefs.enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </span>
              <div>
                <p className="text-sm font-black text-ink">
                  {prefs.enabled ? 'إشعارات الهاتف قيد التشغيل' : 'إشعارات الهاتف معطلة'}
                </p>
                <p className="text-xs text-ink-muted">
                  المفتاح العام لتشغيل أو إيقاف جميع تنبيهات الهاتف
                </p>
              </div>
            </div>
            <Switch
              checked={prefs.enabled}
              onChange={(val) => handleToggle('enabled', val)}
              aria-label="تشغيل أو إلغاء إشعارات الهاتف"
            />
          </div>

          {/* Detailed Settings */}
          <div className={`space-y-3 transition-opacity ${prefs.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <h3 className="text-xs font-black text-ink-muted uppercase tracking-wider px-1">
              أنواع التنبيهات والأحداث
            </h3>

            {/* Sales Alerts */}
            <div className="p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken/30 transition-colors flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <span>💰 إشعارات المبيعات الجديدة</span>
                  <Badge variant="brand" size="xs">مبيعات حية</Badge>
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  يصلك إشعار فوري عند إتمام أي عملية بيع كرت في أي شبكة مع المبلغ
                </p>
              </div>
              <Switch
                checked={prefs.salesAlerts}
                onChange={(val) => handleToggle('salesAlerts', val)}
                disabled={!prefs.enabled}
                aria-label="إشعارات المبيعات الجديدة"
              />
            </div>

            {/* User Registration Alerts */}
            <div className="p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken/30 transition-colors flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <span>🎉 إشعار تسجيل حساب مستخدم جديد</span>
                  <Badge variant="success" size="xs">تسجيل فوري</Badge>
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  يصلك إشعار فوري في هاتفك عندما يدخل أي شخص جديد ويسجل حسابه
                </p>
              </div>
              <Switch
                checked={prefs.userAlerts}
                onChange={(val) => handleToggle('userAlerts', val)}
                disabled={!prefs.enabled}
                aria-label="إشعار تسجيل حساب مستخدم جديد"
              />
            </div>

            <h3 className="text-xs font-black text-ink-muted uppercase tracking-wider px-1 pt-1">
              خصائص التنبيه
            </h3>

            {/* Sound alert */}
            <div className="p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken/30 transition-colors flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-surface-sunken text-ink flex items-center justify-center shrink-0">
                  {prefs.sound ? <Volume2 className="w-4 h-4 text-brand" /> : <VolumeX className="w-4 h-4 text-ink-muted" />}
                </span>
                <div>
                  <p className="text-xs font-bold text-ink">نغمة صوتية مبهجة</p>
                  <p className="text-[11px] text-ink-muted">صوت تنبيه خفيف واحترافي عند وصول إشعار</p>
                </div>
              </div>
              <Switch
                checked={prefs.sound}
                onChange={(val) => handleToggle('sound', val)}
                disabled={!prefs.enabled}
                aria-label="نغمة صوتية للتنبيه"
              />
            </div>

            {/* Vibration */}
            <div className="p-3 rounded-xl border border-line bg-surface hover:bg-surface-sunken/30 transition-colors flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-surface-sunken text-ink flex items-center justify-center shrink-0">
                  <Vibrate className="w-4 h-4 text-brand" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink">اهتزاز الهاتف</p>
                  <p className="text-[11px] text-ink-muted">اهتزاز الجهاز مع التنبيه على الهواتف الذكية</p>
                </div>
              </div>
              <Switch
                checked={prefs.vibrate}
                onChange={(val) => handleToggle('vibrate', val)}
                disabled={!prefs.enabled}
                aria-label="اهتزاز الهاتف"
              />
            </div>
          </div>

          {/* Test button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleTestNotification}
              disabled={testing}
              className="w-full py-2.5 px-4 rounded-xl border border-brand text-brand hover:bg-brand/10 font-bold text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testing ? 'جارٍ إرسال الإشعار...' : 'تجربة إرسال إشعار إلى شريط هاتفك الآن'}</span>
            </button>
            <p className="text-[11px] text-center text-ink-muted mt-1.5">
              اضغط للتأكد من ظهور الإشعار في شريط هاتفك وسماع النغمة
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-line bg-surface-sunken/30 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}
