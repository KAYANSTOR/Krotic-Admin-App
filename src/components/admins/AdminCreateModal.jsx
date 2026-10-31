import { useState, useEffect } from 'react';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Field, Input } from '../ui/Field';

export default function AdminCreateModal({ isOpen, onClose, onCreate, creating }) {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData({ name: '', email: '', phone: '', password: '' });
      setShowPassword(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await onCreate(formData);
    if (success) onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      icon={UserPlus}
      title="إضافة مدير جديد"
      description="سيتمكن هذا الحساب من تسجيل الدخول وإدارة اللوحة."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={creating}>إلغاء</Button>
          <Button
            variant="primary"
            type="submit"
            form="admin-create-form"
            icon={UserPlus}
            loading={creating}
          >
            إنشاء الحساب
          </Button>
        </>
      }
    >
      <form id="admin-create-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="الاسم الكامل" required>
          <Input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="أدخل الاسم"
            required
            autoComplete="name"
          />
        </Field>

        <Field label="البريد الإلكتروني" required>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="admin@example.com"
            required
            autoComplete="email"
            dir="ltr"
          />
        </Field>

        <Field label="رقم الهاتف" required>
          <Input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="07xxxxxxxxx"
            required
            autoComplete="tel"
            dir="ltr"
          />
        </Field>

        <Field label="كلمة المرور" hint="6 أحرف على الأقل. يمكن للمدير تغييرها لاحقاً." required>
          <Input
            type={showPassword ? 'text' : 'password'}
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder="••••••••"
            minLength={6}
            required
            autoComplete="new-password"
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
      </form>
    </Modal>
  );
}
