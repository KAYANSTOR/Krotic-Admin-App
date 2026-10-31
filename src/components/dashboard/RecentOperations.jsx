import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import Section from '../ui/Section.jsx';
import { Card } from '../ui/Card.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import Badge from '../ui/Badge.jsx';
import { formatDate, formatNumber } from '../../lib/format.js';
import { saleStatusMeta } from '../../lib/dashboard/helpers.js';

function operationKey(operation, index) {
  if (operation.id != null && String(operation.id) !== '') return String(operation.id);
  const networkName = String(operation.networkName || 'شبكة');
  const createdAt = operation.createdAt?.toMillis?.()
    ?? (operation.createdAt instanceof Date ? operation.createdAt.getTime() : String(operation.createdAt ?? 'unknown'));
  return `${networkName}-${createdAt}-${index}`;
}

export default function RecentOperations({ operations, lastUpdatedAt }) {
  const updatedTime = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Section
      eyebrow="آخر العمليات"
      title="آخر مبيعات الشبكات"
      action={<Link to="/sales" className="section__link">عرض الكل</Link>}
      aria-label="آخر العمليات"
    >
      {updatedTime && (
        <p className="text-xs text-muted mb-2" role="status" aria-live="polite">
          تم تحديث قائمة العمليات {updatedTime}
        </p>
      )}
      {operations.length === 0 ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="لا توجد عمليات حديثة"
            description="ستظهر أحدث مبيعات الشبكات هنا بعد مزامنتها."
            action={<Link to="/sales" className="btn btn--secondary btn--sm">فتح المبيعات</Link>}
          />
        </Card>
      ) : (
        <ul className="recent-operations">
          {operations.map((operation, index) => {
            const status = saleStatusMeta(operation.status);
            return (
              <li key={operationKey(operation, index)}>
                <Link
                  to="/sales"
                  state={operation.id ? { focusSaleId: operation.id } : undefined}
                  className="recent-operation min-h-[44px]"
                  aria-label={`${operation.networkName}، ${formatNumber(operation.faceValue)} ريال، ${status.label}`}
                >
                  <span className="recent-operation__icon">
                    <CreditCard className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <span className="recent-operation__body">
                    <strong>{operation.networkName}</strong>
                    <span>
                      {formatDate(operation.createdAt, { withTime: true })}
                      {' • '}
                      {operation.customerId || 'عميل غير محدد'}
                    </span>
                  </span>
                  <span className="recent-operation__end">
                    <span className="recent-operation__amount">
                      {formatNumber(operation.faceValue)} <small>ريال</small>
                    </span>
                    <Badge tone={status.tone} dot>{status.label}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
