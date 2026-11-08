import { formatNumber, formatDate } from '../../lib/format';
import { saleCommission, saleFaceValue, isCancelledSale, cancelledSaleCommission } from '../../lib/commission';
import { SALE_STATUS } from '../../lib/sales/constants';
import SaleVerificationBadge from './SaleVerificationBadge';

export default function SaleRow({ sale }) {
  const cancelled = isCancelledSale(sale);
  const status = cancelled
    ? SALE_STATUS.CANCELLED
    : SALE_STATUS[sale.status] || { text: sale.status, class: 'bg-slate-100 text-slate-800' };
  const comm = saleCommission(sale);

  return (
    <div className="p-3 rounded-xl bg-[var(--ui-surface)] border border-line space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-black font-mono tabular-nums ${cancelled ? 'text-[var(--ui-muted)] line-through' : 'text-[var(--ui-ink)]'}`}>
          {formatNumber(saleFaceValue(sale))} ر.ي
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.class}`}>
            {status.text}
          </span>
          <SaleVerificationBadge sale={sale} />
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px] text-[var(--ui-muted)]">
        <span dir="ltr" className="truncate">
          {sale.customerId || '—'}
        </span>
        <span dir="rtl">{formatDate(sale.createdAt, { withTime: true })}</span>
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-line/40 text-[11px]">
        <span className="text-[var(--ui-muted)]">العمولة</span>
        {cancelled ? (
          <strong className="font-mono text-[var(--ui-muted)]" title="بيع ملغى: لا تدخل عمولته في المستحق">
            <span className="line-through">{formatNumber(cancelledSaleCommission(sale))} ر.ي</span> • ملغاة
          </strong>
        ) : (
          <strong className={`font-mono ${comm === null ? 'text-[var(--ui-muted)]' : 'text-brand-deep'}`}>
            {comm === null ? 'غير محتسب' : `${formatNumber(comm)} ر.ي`}
          </strong>
        )}
      </div>
    </div>
  );
}
