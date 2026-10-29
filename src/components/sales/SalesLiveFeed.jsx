import { Inbox } from 'lucide-react';
import { SALE_STATUS } from '../../lib/sales/constants';
import { saleDomId } from '../../lib/sales/helpers';
import { formatDate, formatNumber } from '../../lib/format';
import { saleCommission, saleFaceValue } from '../../lib/commission';
import SaleVerificationBadge from './SaleVerificationBadge';

export default function SalesLiveFeed({ sales, focusSaleId, limit = 40 }) {
  const statusMeta = (status) => SALE_STATUS[status] || {
    text: status || 'غير محدد',
    class: 'bg-slate-100 text-slate-800 border-slate-300',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1 text-xs">
        <span className="font-bold text-[var(--ui-ink-soft)] flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" aria-hidden="true" />
          بث مباشر لآخر العمليات:
        </span>
        <span className="text-[var(--ui-muted)]">{sales.length} عملية</span>
      </div>

      {sales.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-surface border border-line">
          <Inbox className="w-6 h-6 mx-auto mb-2 text-[var(--ui-muted)]" aria-hidden="true" />
          <p className="font-bold text-[var(--ui-ink)] text-sm">لا توجد عمليات</p>
          <p className="text-xs text-[var(--ui-muted)] mt-1">
            ستظهر كل عملية بيع جديدة هنا تلقائياً بعد المزامنة.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sales.slice(0, limit).map((sale) => {
            const status = statusMeta(sale.status || 'COMPLETED');
            const commission = saleCommission(sale);
            const isFocused = focusSaleId != null && String(sale.id) === String(focusSaleId);
            return (
              <div
                id={saleDomId(sale.id)}
                key={sale.id}
                className={
                  'p-3 rounded-2xl bg-surface border shadow-xs space-y-2 ' +
                  (isFocused ? 'ring-2 ring-brand border-brand bg-brand/5' : 'border-line')
                }
                aria-current={isFocused ? 'true' : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-[var(--ui-ink)] truncate">
                      {sale.networkName}
                    </p>
                    <p className="text-[11px] text-[var(--ui-muted)]" dir="rtl">
                      {formatDate(sale.createdAt, { withTime: true })}
                    </p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p className="text-sm font-black text-[var(--ui-ink)] font-mono">
                      {formatNumber(saleFaceValue(sale))} ر.ي
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end mt-1">
                      <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full border ' + status.class}>
                        {status.text}
                      </span>
                      <SaleVerificationBadge sale={sale} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs pt-1.5 border-t border-line/60 text-[var(--ui-ink-soft)]">
                  <span>
                    العميل:{' '}
                    <strong dir="ltr">{sale.customerId || '—'}</strong>
                  </span>
                  <span>
                    العمولة:{' '}
                    <strong className="text-emerald-600 font-mono">
                      {commission === null ? '—' : formatNumber(commission) + ' ر.ي'}
                    </strong>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
