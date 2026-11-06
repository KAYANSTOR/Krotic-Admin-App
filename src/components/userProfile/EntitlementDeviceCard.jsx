import { useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { Field, Textarea } from '../ui/Field';
import { formatDate } from '../../lib/format';
import { rebindEntitlementDevice, adminApiError } from '../../lib/adminApi';

const SELF_TRANSFER_LIMIT = 3;
const SELF_TRANSFER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const PENDING_REASONS = {
  device_transfer_limit_reached: 'تجاوز حد النقل الذاتي (3 مرات خلال 30 يوماً)',
  installation_replaced: 'محاولة العودة إلى تثبيت سبق استبداله',
};

function shortId(value) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

/**
 * Licensed device of the account, with admin approval for an installation the
 * server refused to move automatically (entitlementPendingTransfer).
 */
export default function EntitlementDeviceCard({ user, uid, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const bound = user?.entitlementInstallationId || '';
  const pending = user?.entitlementPendingTransfer?.installationId
    ? user.entitlementPendingTransfer
    : null;
  const now = Date.now();
  const recentTransfers = Array.isArray(user?.entitlementAutoTransfersMs)
    ? user.entitlementAutoTransfersMs.filter((ms) => Number(ms) > now - SELF_TRANSFER_WINDOW_MS).length
    : 0;

  const approve = async () => {
    if (!pending || !reason.trim()) return;
    setBusy(true);
    const result = await rebindEntitlementDevice({
      uid,
      installationId: pending.installationId,
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(adminApiError(result.error, 'تعذر نقل الترخيص'));
      return;
    }
    toast.success('تم نقل الترخيص. سيعمل التطبيق على الجهاز الجديد عند فتحه متصلاً بالإنترنت.');
    setOpen(false);
    setReason('');
    await onChanged?.();
  };

  return (
    <Card>
      <dl className="user-card__meta" style={{ background: 'transparent', border: 0, padding: 0 }}>
        <div className="user-card__meta-item">
          <dt>الجهاز المرخّص</dt>
          <dd dir="ltr" className="font-mono" title={bound}>{shortId(bound)}</dd>
        </div>
        <div className="user-card__meta-item">
          <dt>آخر نقل</dt>
          <dd>{user?.entitlementLastTransferAtMs || user?.entitlementReboundAtMs
            ? formatDate(user.entitlementLastTransferAtMs || user.entitlementReboundAtMs, { withTime: true })
            : '—'}</dd>
        </div>
        <div className="user-card__meta-item">
          <dt>النقل الذاتي خلال 30 يوماً</dt>
          <dd>{recentTransfers} / {SELF_TRANSFER_LIMIT}</dd>
        </div>
      </dl>

      {pending ? (
        <div className="mt-4 flex flex-wrap items-center gap-3" role="status">
          <Badge tone="warning">طلب نقل معلّق</Badge>
          <span className="text-sm">
            جهاز جديد <span dir="ltr" className="font-mono" title={pending.installationId}>{shortId(pending.installationId)}</span>
            {' — '}{PENDING_REASONS[pending.reason] || 'رفض النقل التلقائي'}
            {pending.requestedAtMs ? ` — ${formatDate(pending.requestedAtMs, { withTime: true })}` : ''}
          </span>
          <Button variant="primary" size="sm" icon={ShieldCheck} onClick={() => setOpen(true)}>
            الموافقة على النقل
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted mt-4">
          إعادة تثبيت التطبيق تنقل الترخيص تلقائياً حتى 3 مرات خلال 30 يوماً. بعدها يظهر هنا طلب للموافقة.
        </p>
      )}

      <Modal
        isOpen={open}
        onClose={() => !busy && setOpen(false)}
        title="نقل الترخيص إلى الجهاز الجديد"
        icon={ShieldCheck}
        description="سيتوقف الجهاز السابق عن البيع، ويعمل الجهاز الجديد عند اتصاله بالإنترنت."
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>إلغاء</Button>
            <Button variant="primary" onClick={approve} loading={busy} disabled={busy || !reason.trim()}>
              تأكيد النقل
            </Button>
          </>
        )}
      >
        <Field label="سبب الموافقة" htmlFor="rebind-reason" required hint="يُحفظ في سجل التدقيق.">
          <Textarea
            id="rebind-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: العميل غيّر هاتفه وتم التحقق منه هاتفياً"
          />
        </Field>
      </Modal>
    </Card>
  );
}
