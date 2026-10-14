import { useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Textarea } from './ui/Field';
import { adminApiError, cancelSale, createAdminIdempotencyKey } from '../lib/adminApi';
import { formatNumber } from '../lib/format';

export default function CancelSaleModal({ isOpen, onClose, network, sale, onSuccess }) {
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setIdempotencyKey(createAdminIdempotencyKey(`cancel-${sale?.id || 'sale'}`));
  }, [isOpen, sale?.id]);

  const submit = async (event) => {
    event.preventDefault();
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error('سبب الإلغاء مطلوب');
      return;
    }
    setSaving(true);
    const result = await cancelSale({
      uid: network.uid,
      saleId: sale.id,
      reason: trimmedReason,
      idempotencyKey,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(adminApiError(result.error));
      return;
    }
    toast.success(result.data?.ack ? 'الإلغاء مسجل سابقاً (لم يُكرَّر)' : 'تم إلغاء البيع وتسجيل الأثر');
    onSuccess?.(result.data);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="إلغاء عملية بيع"
      icon={Ban}
      description="سيتم تغيير الحالة فقط دون حذف سجل البيع."
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button variant="danger" onClick={submit} loading={saving} icon={Ban}>تأكيد إلغاء البيع</Button>
        </>
      )}
    >
      <form id="cancel-sale-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-xl bg-surface-sunken p-3 text-sm text-ink-secondary">
          <div>الشبكة: <strong className="text-ink">{network?.networkName || network?.uid || '—'}</strong></div>
          <div className="mt-1">رقم البيع: <code dir="ltr">{sale?.id}</code> • القيمة: <strong className="text-ink">{formatNumber(sale?.faceValue)} ريال</strong></div>
        </div>
        <Field label="سبب الإلغاء" required htmlFor="cancel-sale-reason" hint="سيُحفظ السبب في سجل الإلغاء وسجل العمليات الإداري.">
          <Textarea id="cancel-sale-reason" rows="4" maxLength="200" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اكتب سبباً واضحاً للإلغاء" required />
        </Field>
      </form>
    </Modal>
  );
}
