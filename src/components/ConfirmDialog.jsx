import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input } from './ui/Field';

const VARIANT_BTN = { danger: 'danger', success: 'success', primary: 'primary' };

/**
 * نافذة تأكيد موحّدة.
 * `requireText` يفرض كتابة نص محدد قبل التنفيذ، للعمليات المدمّرة واسعة الأثر.
 */
export default function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message,
  confirmText = 'تأكيد', cancelText = 'إلغاء', variant = 'danger', requireText = null,
}) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTyped('');
      setSubmitError('');
      setSubmitting(false);
    }
  }, [isOpen]);

  const canConfirm = !requireText || typed.trim() === requireText;

  const handleConfirm = async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await onConfirm?.();
    } catch (error) {
      console.error('Confirmed admin action failed:', error);
      setSubmitError('تعذر تنفيذ الإجراء. لم يتم تأكيد نجاحه؛ تحقق من الاتصال ثم حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={AlertTriangle}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>{cancelText}</Button>
          <Button
            variant={VARIANT_BTN[variant] || 'danger'}
            onClick={handleConfirm}
            loading={submitting}
            disabled={!canConfirm || submitting}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="modal__message">{message}</p>
      {submitError && <p className="field-error" role="alert" aria-live="assertive">{submitError}</p>}

      {requireText && (
        <div className="mt-4">
          <Field label={`اكتب «${requireText}» للتأكيد`}>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={requireText}
              autoComplete="off"
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
