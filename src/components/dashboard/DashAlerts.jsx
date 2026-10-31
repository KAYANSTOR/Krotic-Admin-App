import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '../ui/Button.jsx';

export default function DashAlerts({
  maintenance,
  appStatus,
  salesSyncing,
  realtimeError,
  monthlyDataWarning,
  error,
  onRetry,
}) {
  return (
    <>
      {maintenance && (
        <div className="dash-alert" role="status" aria-live="polite">
          <span className="dash-alert__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">التطبيق في وضع الصيانة</p>
            {appStatus?.maintenance_message && (
              <p className="dash-alert__msg">{appStatus.maintenance_message}</p>
            )}
          </div>
        </div>
      )}

      {salesSyncing && (
        <div className="dash-alert" role="status" aria-live="polite">
          <span className="dash-alert__icon" aria-hidden="true"><RefreshCw className="w-5 h-5" /></span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">جارٍ مزامنة المؤشرات المالية</p>
            <p className="dash-alert__msg">
              تتحدّث المجاميع مع وصول سجلات الشبكات؛ قد تتغير الأرقام حتى اكتمال المزامنة.
            </p>
          </div>
        </div>
      )}

      {realtimeError && (
        <div className="dash-alert" role="alert" aria-live="assertive">
          <span className="dash-alert__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-alert__body">
            <p className="dash-alert__title">تعذر مزامنة بعض تحديثات المبيعات</p>
            <p className="dash-alert__msg">
              قد تكون قائمة العمليات غير مكتملة. حدّث البيانات قبل الاعتماد على الأرقام أو تنفيذ تسوية مالية.
            </p>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
              إعادة المحاولة
            </Button>
          </div>
        </div>
      )}

      {monthlyDataWarning && (
        <div className="dash-error" role="status" aria-live="polite">
          <span className="dash-error__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-error__body">
            <p className="dash-error__title">تفصيل الأشهر غير مكتمل</p>
            <p className="dash-error__msg">
              الإجماليات المالية محفوظة. يجري استعادة التفصيل الشهري من سجلات المبيعات عند غياب بيانات التجميع.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="dash-error" role="alert" aria-live="assertive">
          <span className="dash-error__icon" aria-hidden="true"><AlertTriangle className="w-5 h-5" /></span>
          <div className="dash-error__body">
            <p className="dash-error__title">تعذر تحميل بيانات لوحة التحكم</p>
            <p className="dash-error__msg">{error}</p>
          </div>
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry}>
            إعادة المحاولة
          </Button>
        </div>
      )}
    </>
  );
}
