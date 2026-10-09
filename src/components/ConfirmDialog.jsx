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

  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  const canConfirm = !requireText || typed.trim() === requireText;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={AlertTriangle}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
          <Button
            variant={VARIANT_BTN[variant] || 'danger'}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <p className="modal__message">{message}</p>

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
