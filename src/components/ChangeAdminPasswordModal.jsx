import { useEffect, useState } from 'react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { KeyRound, Eye, EyeOff, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';
import { logAdminAction, AUDIT_ACTIONS } from '../lib/auditLog';

// The current admin sign-in flow is password-only; keep the client minimum aligned with NIST SP 800-63B-4 guidance.
const MIN_LENGTH = 15;

export default function ChangeAdminPasswordModal({ isOpen, onClose }) {
  const { currentUser, adminData } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  // Clear sensitive form values whenever the modal is opened, including when
  // the parent controls isOpen directly instead of calling handleClose.
  useEffect(() => {
    if (!isOpen) return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setNeedsReauth(false);
  }, [isOpen]);

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

  const validate = () => {
    if (!auth.currentUser) return 'لم يتم العثور على جلسة مدير نشطة';
    if (needsReauth && !currentPassword) return 'أدخل كلمة المرور الحالية لتأكيد الهوية';
    if (newPassword.length < MIN_LENGTH) {
      return `كلمة المرور الجديدة يجب أن تكون ${MIN_LENGTH} أحرف على الأقل`;
    }
    if (newPassword !== confirmPassword) return 'كلمتا المرور غير متطابقتين';
    return null;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving) return;

    const validationError = validate();
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      toast.error('لم يتم العثور على جلسة مدير نشطة');
      return;
    }

    setSaving(true);
    try {
      // Reauthentication is needed only when requested by Firebase or when
      // the administrator has chosen to provide the current password.
      if (needsReauth || currentPassword.length > 0) {
        if (!currentPassword) {
          toast.error('أدخل كلمة المرور الحالية لتأكيد الهوية');
          return;
        }

        const userEmail = user.email || currentUser?.email || adminData?.email || '';
        if (!userEmail) {
          toast.error('تعذر تحديد بريد الحساب للتحقق من الهوية');
          return;
        }

        const credential = EmailAuthProvider.credential(userEmail, currentPassword);
        await reauthenticateWithCredential(user, credential);
      }

      await updatePassword(user, newPassword);

      // Audit logging is best-effort; a logging failure must not undo a
      // successful Firebase Authentication password change.
      await logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGE || 'admin:password_change',
        targetType: 'admin',
        targetId: user.uid,
        targetLabel: adminData?.name || user.email || 'المدير',
      }).catch((error) => console.warn('Audit failed:', error));

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
      } else if (error?.code === 'auth/network-request-failed') {
        toast.error('تعذر الاتصال بالخدمة. تحقق من الإنترنت ثم حاول مجدداً');
      } else {
        toast.error('تعذر تغيير كلمة المرور. حاول مرة أخرى');
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
          <div className="p-3 rounded-xl bg-warning-soft border border-warning/30 text-warning-ink text-xs flex items-start gap-2.5">
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
              onChange={(event) => setCurrentPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required={needsReauth}
            />
          </Field>
        )}

        <Field label="كلمة المرور الجديدة" hint={`${MIN_LENGTH} أحرف على الأقل.`} required>
          <Input
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
            endAdornment={
              <button
                type="button"
                className="field-adorn"
                onClick={() => setShowPassword((visible) => !visible)}
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
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
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
