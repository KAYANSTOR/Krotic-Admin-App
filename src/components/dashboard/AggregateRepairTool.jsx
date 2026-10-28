import { ChevronDown, Wrench, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Card } from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import { formatNumber } from '../../lib/format.js';

export default function AggregateRepairTool({
  progress,
  rebuilding,
  refreshing,
  onRequestRepair,
}) {
  if (progress.done) {
    const completedTime = progress.completedAt
      ? new Date(progress.completedAt).toLocaleString('ar-YE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : null;

    return (
      <Card className="dash-maintenance dash-maintenance--done">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-[var(--ui-success)]" aria-hidden="true" />
          <p className="text-sm font-extrabold text-[var(--ui-success-ink)]">
            اكتملت إعادة بناء المجاميع المالية
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          تمت معالجة {formatNumber(progress.processed)} شبكة
          {completedTime ? ` في ${completedTime}` : ''}.
        </p>
        <p className="mt-1 text-xs text-muted">
          تم حفظ حالة الإنجاز في هذا المتصفح فقط، ولا تنتقل تلقائياً إلى الأجهزة الأخرى.
        </p>
      </Card>
    );
  }

  const expanded = Boolean(progress.cursor) || progress.processed > 0;

  return (
    <Card className="dash-maintenance">
      <details open={expanded || undefined}>
        <summary className="dash-maintenance__summary">
          <span className="dash-maintenance__summary-main">
            <span className="dash-maintenance__icon" aria-hidden="true"><Wrench className="w-4 h-4" /></span>
            <span>
              <span className="dash-maintenance__title">أدوات صيانة الملخصات المالية</span>
              <span className="dash-maintenance__sub">إجراء متقدم يعيد بناء المجاميع من السجلات المخزنة.</span>
            </span>
          </span>
          <ChevronDown className="dash-maintenance__chevron" aria-hidden="true" />
        </summary>

        <div className="dash-maintenance__body">
          <p className="text-sm font-extrabold text-ink">صيانة الملخصات المالية القديمة</p>
          <p className="mt-1 text-xs leading-5 text-muted">
            تعيد حساب إجمالي المبيعات والعمولات والدفعات من السجلات المخزنة، ثم تحفظ الملخصات في Firestore لتستخدمها الشاشات سريعاً. لا تعدّل سجل البيع نفسه.
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--ui-warning-ink)]">
            قد تستهلك آلاف القراءات حسب حجم الشبكة. انتظر تجدد الحصة اليومية قبل تشغيلها. تتم معالجة شبكة واحدة في كل مرة.
          </p>

          {(progress.cursor || progress.processed > 0) && (
            <p className="mt-1 text-xs font-semibold text-ink-soft">
              تمت معالجة {formatNumber(progress.processed)} شبكة.
              التقدم محفوظ في هذا المتصفح فقط؛ اضغط المتابعة للدفعة التالية.
            </p>
          )}

          <div className="dash-maintenance__actions">
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={rebuilding}
              disabled={rebuilding || refreshing}
              onClick={onRequestRepair}
            >
              {rebuilding
                ? 'جارٍ إصلاح شبكة واحدة…'
                : refreshing
                  ? 'انتظر اكتمال التحديث'
                  : progress.cursor
                    ? 'متابعة الإصلاح (شبكة واحدة)'
                    : 'إصلاح الملخصات (شبكة واحدة)'}
            </Button>
          </div>
        </div>
      </details>
    </Card>
  );
}
