import { Clock, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import Button from './Button';

/**
 * مؤشر حداثة البيانات + زر تحديث قسري يتجاوز كاش القراءة القصير.
 * يعرض وقت آخر تحديث فعلي حتى لا يلتبس على المدير أن البيانات قديمة.
 */
export default function DataFreshness({ updatedAt, lastSyncedAt, refreshing, onRefresh, className, fromCache = null }) {
  const time = (lastSyncedAt || updatedAt)
    ? new Date(lastSyncedAt || updatedAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={cn('freshness', className)}>
      {fromCache ? (
        <span className="freshness__time" role="status">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          نسخة محلية؛ قد لا تكون الأحدث
        </span>
      ) : time && (
        <span className="freshness__time">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          {lastSyncedAt ? `تحقق من الخادم ${time}` : `وقت العرض/التحميل ${time}`}
        </span>
      )}
      <Button
        variant="secondary"
        size="sm"
        icon={RefreshCw}
        onClick={onRefresh}
        loading={refreshing}
      >
        {refreshing ? 'جارٍ التحديث' : 'تحديث'}
      </Button>
    </div>
  );
}
