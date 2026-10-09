import { Clock, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import Button from './Button';

/**
 * مؤشر حداثة البيانات + زر تحديث قسري يتجاوز كاش القراءة القصير.
 * يعرض وقت آخر تحديث فعلي حتى لا يلتبس على المدير أن البيانات قديمة.
 */
export default function DataFreshness({ updatedAt, refreshing, onRefresh, className }) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={cn('freshness', className)}>
      {time && (
        <span className="freshness__time">
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          آخر تحديث {time}
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
