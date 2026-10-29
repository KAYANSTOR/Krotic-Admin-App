import { useState } from 'react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound, Eye, EyeOff, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

const MIN_LENGTH = 6;

export default function ChangeAdminPasswordModal({ isOpen, onClose }) {
  const { currentUser, adminData } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setNeedsReauth(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (newPassword.length < MIN_LENGTH) {
      toast.error(`كلمة المرور الجديدة يجب أن تكون ${MIN_LENGTH} أحرف على الأقل`);
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }

    if (!auth.currentUser) {
      toast.error('لم يتم العثور على جلسة مدير نشطة');
      return;
    }

    setSaving(true);
    try {
      // إذا طُلب إعادة المصادقة، ننفذها أولاً
      if (needsReauth || currentPassword) {
        if (!currentPassword) {
          toast.error('أدخل كلمة المرور الحالية لتأكيد الهوية');
          setSaving(false);
          return;
        }
        const userEmail = auth.currentUser?.email || currentUser?.email || adminData?.email || '';
        const credential = EmailAuthProvider.credential(userEmail, currentPassword);
        if (auth.currentUser) {
          await reauthenticateWithCredential(auth.currentUser, credential);
        }
      }

      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
      }

      // توثيق في سجل العمليات
      await logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGE || 'admin:password_change',
        targetType: 'admin',
        targetId: auth.currentUser?.uid || currentUser?.uid || 'admin',
        targetLabel: adminData?.name || auth.currentUser?.email || currentUser?.email || 'المدير',
      }).catch((err) => console.warn('Audit failed:', err));

      toast.success('تم تغيير كلمة المرور بنجاح');
      handleClose();
    } catch (error) {
      console.error('Password update error:', error);
      if (error?.code === 'auth/requires-recent-login') {
        setNeedsReauth(true);
        toast.error('لأسباب أمنية، يرجى كتابة كلمة المرور الحالية أولاً');
      } else if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
        toast.error('كلمة المرور الحالية غير صحيحة');
      } else if (error?.code === 'auth/weak-password') {
        toast.error('كلمة المرور ضعيفة، اختر كلمة مرور أقوى');
      } else {
        toast.error(error.message || 'تعذر تغيير كلمة المرور');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      icon={KeyRound}
      title="تغيير كلمة مرور المدير"
      description={`الحساب الحالي: ${currentUser?.email || adminData?.email || 'حساب المدير'}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            إلغاء
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="change-admin-password-form"
            icon={Check}
            loading={saving}
          >
            حفظ كلمة المرور الجديدة
          </Button>
        </>
      }
    >
      <form id="change-admin-password-form" onSubmit={handleSubmit} className="space-y-4">
        {needsReauth && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">مطلوب التحقق من الهوية</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                انتهت صلاحية جلسة تسجيل الدخول الأخيرة، يرجى إدخال كلمة مرورك الحالية لتأكيد التغيير.
              </p>
            </div>
          </div>
        )}

        {(needsReauth || currentPassword) && (
          <Field label="كلمة المرور الحالية" required>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
        )}

        <Field
          label="كلمة المرور الجديدة"
          hint={`${MIN_LENGTH} أحرف على الأقل.`}
          required
        >
          <Input
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            endAdornment={
              <button
                type="button"
                className="field-adorn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />
        </Field>

        <Field label="تأكيد كلمة المرور الجديدة" required>
          <Input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        <div className="p-2.5 rounded-lg bg-surface-sunken border border-line text-[11px] text-muted flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand shrink-0" />
          <span>سيتم تحديث كلمة المرور فوراً ويمكنك استخدامها في تسجيل الدخول القادم.</span>
        </div>
      </form>
    </Modal>
  );
}
