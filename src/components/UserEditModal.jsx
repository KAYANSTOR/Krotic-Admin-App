import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Switch from './ui/Switch';
import { Field, Input, Textarea } from './ui/Field';
import { formatDateInput } from '../lib/format';

export default function UserEditModal({ isOpen, onClose, user, onSave }) {
  const [hasCustomWarning, setHasCustomWarning] = useState(false);
  const [warningMessage, setWarningMessage] = useState('');
  const [commissionRate, setCommissionRate] = useState('');
  const [subscriptionEnd, setSubscriptionEnd] = useState('');

  useEffect(() => {
    if (user && isOpen) {
      setHasCustomWarning(!!user.has_custom_warning);
      setWarningMessage(user.warning_message || '');
      setCommissionRate(user.commission_rate != null ? user.commission_rate : '');
      setSubscriptionEnd(formatDateInput(user.subscription_end_date));
    }
  }, [user, isOpen]);

  if (!isOpen || !user) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const updates = {};
    if (subscriptionEnd) {
      updates.subscription_end_date = new Date(subscriptionEnd);
    }
    if (commissionRate !== '') {
      updates.commission_rate = parseFloat(commissionRate);
    } else {
      updates.commission_rate = null;
    }
    updates.has_custom_warning = hasCustomWarning;
    if (hasCustomWarning) {
      updates.warning_message = warningMessage;
    } else {
      updates.warning_message = '';
    }
    onSave(user.uid, updates);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`تعديل بيانات: ${user.networkName || 'مستخدم'}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" type="submit" form="user-edit-form">حفظ التعديلات</Button>
        </>
      }
    >
      <form id="user-edit-form" onSubmit={handleSubmit} className="space-y-5">
        <Field label="تاريخ انتهاء الاشتراك">
          <Input type="date" value={subscriptionEnd} onChange={(e) => setSubscriptionEnd(e.target.value)} />
        </Field>

        <Field
          label="العمولة الخاصة (%)"
          hint="إذا تركته فارغاً أو صفر، سيتم حساب أرباح هذا الحساب بناءً على النسبة العامة."
        >
          <Input
            type="number" step="0.1" min="0" max="100"
            value={commissionRate}
            onChange={(e) => setCommissionRate(e.target.value)}
            placeholder="اتركه فارغاً لاستخدام العمولة العامة"
          />
        </Field>

        <div className="border-t pt-4">
          <Switch checked={hasCustomWarning} onChange={setHasCustomWarning} label="تخصيص رسالة تحذير لهذا المستخدم" />

          {hasCustomWarning ? (
            <div className="mt-3">
              <Textarea
                value={warningMessage}
                onChange={(e) => setWarningMessage(e.target.value)}
                rows={3}
                placeholder="أدخل رسالة التحذير الخاصة هنا..."
                required={hasCustomWarning}
              />
            </div>
          ) : (
            <p className="text-xs text-gray-500 mt-3">
              التطبيق سيعرض رسالة التحذير العامة المحددة في الإعدادات.
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
