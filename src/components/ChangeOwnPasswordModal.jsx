import { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { auth } from '../firebase';
import { AUDIT_ACTIONS, logAdminAction } from '../lib/auditLog';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';

const MIN_PASSWORD_LENGTH = 6;

export default function ChangeOwnPasswordModal({ isOpen, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaving(false);
    }
  }, [isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      toast.error('انتهت الجلسة؛ سجّل الدخول من جديد.');
      return;
    }
    if (!user.providerData?.some((provider) => provider.providerId === 'password') || !user.email) {
      toast.error('حساب المدير لا يستخدم تسجيل الدخول بالبريد وكلمة المرور؛ لا يمكن تغييرها من هذا النموذج.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`كلمة المرور الجديدة يجب ألا تقل عن ${MIN_PASSWORD_LENGTH} أحرف.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('كلمتا المرور الجديدتان غير متطابقتين.');
      return;
    }
    if (newPassword === currentPassword) {
      toast.error('اختر كلمة مرور مختلفة عن الحالية.');
      return;
    }

    setSaving(true);
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      await logAdminAction({
        action: AUDIT_ACTIONS.ADMIN_PASSWORD_CHANGE,
        targetType: 'admin',
        targetId: user.uid,
        targetLabel: 'المدير الحالي',
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('تم تحديث كلمة مرور المدير بنجاح.');
      onClose?.();
    } catch (error) {
      const code = error?.code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        toast.error('كلمة المرور الحالية غير صحيحة.');
      } else if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
        toast.error('كلمة المرور الجديدة لا تحقق متطلبات Firebase. اختر كلمة أقوى.');
      } else if (code === 'auth/requires-recent-login') {
        toast.error('يلزم تسجيل الدخول مجددًا قبل تغيير كلمة المرور.');
      } else {
        toast.error('تعذر تغيير كلمة المرور. تحقق من الاتصال ثم حاول مرة أخرى.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="تغيير كلمة مرور المدير"
      icon={KeyRound}
      description="يجب إدخال كلمة المرور الحالية لإعادة التحقق من هويتك. لا تُحفظ كلمات المرور في لوحة الإدارة."
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button variant="primary" type="submit" form="change-own-password-form" loading={saving}>
            تحديث كلمة المرور
          </Button>
        </>
      )}
    >
      <form id="change-own-password-form" className="space-y-4" onSubmit={handleSubmit}>
        <Field label="كلمة المرور الحالية">
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="كلمة المرور الجديدة" hint={`6 أحرف على الأقل، وتُطبّق متطلبات Firebase.`}>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة">
          <Input
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </Field>
      </form>
    </Modal>
  );
}
