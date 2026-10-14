import { useEffect, useState } from 'react';
import { CalendarPlus, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Field, Input, Select, Textarea } from './ui/Field';
import { adminApiError, approveSettlement, createAdminIdempotencyKey } from '../lib/adminApi';
import { formatNumber } from '../lib/format';

function currentMonthInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function SettlementModal({ isOpen, onClose, network, amountMinor, onSuccess }) {
  const [amount, setAmount] = useState('');
  const [month, setMonth] = useState(currentMonthInput);
  const [extensionDays, setExtensionDays] = useState('0');
  const [note, setNote] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(String(Math.round(Number(amountMinor) || 0)));
    setMonth(currentMonthInput());
    setExtensionDays('0');
    setNote('');
    setIdempotencyKey(createAdminIdempotencyKey(`settlement-${network?.uid || 'network'}`));
  }, [isOpen, amountMinor, network?.uid]);

  const submit = async (event) => {
    event.preventDefault();
    const parsedAmount = Number(amount);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      toast.error('أدخل مبلغ التسوية كرقم صحيح أكبر من صفر');
      return;
    }
    setSaving(true);
    const result = await approveSettlement({
      uid: network.uid,
      amountMinor: parsedAmount,
      month,
      extensionDays: Number(extensionDays),
      note: note.trim(),
      idempotencyKey,
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(adminApiError(result.error));
      return;
    }
    toast.success(result.data?.ack ? 'التسوية معتمدة سابقاً (لم تُكرَّر)' : 'تم اعتماد التسوية بنجاح');
    onSuccess?.(result.data);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="اعتماد تسوية العمولة"
      icon={CheckCircle2}
      description={`الشبكة: ${network?.networkName || network?.uid || '—'}`}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button>
          <Button variant="success" onClick={submit} loading={saving} icon={CheckCircle2}>اعتماد التسوية</Button>
        </>
      )}
    >
      <form id="settlement-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-xl bg-surface-sunken p-3 text-sm text-ink-secondary">
          المبلغ المقترح من عمولة النتائج الحالية: <strong className="text-ink">{formatNumber(amountMinor)} ريال</strong>
        </div>
        <Field label="مبلغ التسوية (ريال)" required htmlFor="settlement-amount">
          <Input id="settlement-amount" type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </Field>
        <Field label="شهر العمولة" required htmlFor="settlement-month" hint="سيظهر هذا الشهر في إشعار المستخدم داخل التطبيق.">
          <Input id="settlement-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} required />
        </Field>
        <Field label="تمديد الاشتراك" htmlFor="settlement-extension" hint="التمديد إداري وصريح؛ يبدأ من الآن إن كان الاشتراك منتهياً.">
          <Select id="settlement-extension" value={extensionDays} onChange={(event) => setExtensionDays(event.target.value)}>
            <option value="0">بدون تمديد</option>
            <option value="30">تمديد 30 يوماً</option>
          </Select>
        </Field>
        <Field label="ملاحظة (اختياري)" htmlFor="settlement-note">
          <Textarea id="settlement-note" rows="3" maxLength="200" value={note} onChange={(event) => setNote(event.target.value)} placeholder="مثال: تسوية شهر أكتوبر" />
        </Field>
        <div className="flex items-start gap-2 text-xs text-ink-tertiary">
          <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>سيصل للمستخدم إشعار بسداد عمولة الشهر المحدد. لن يتم تعديل أو حذف أي عملية بيع سابقة.</span>
        </div>
      </form>
    </Modal>
  );
}
