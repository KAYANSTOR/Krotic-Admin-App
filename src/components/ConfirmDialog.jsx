import { AlertTriangle } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';

const VARIANT_BTN = { danger: 'danger', success: 'success', primary: 'primary' };

export default function ConfirmDialog({
  isOpen, onClose, onConfirm, title, message,
  confirmText = 'تأكيد', cancelText = 'إلغاء', variant = 'danger',
}) {
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
          <Button variant={VARIANT_BTN[variant] || 'danger'} onClick={onConfirm}>{confirmText}</Button>
        </>
      }
    >
      <p className="modal__message">{message}</p>
    </Modal>
  );
}
