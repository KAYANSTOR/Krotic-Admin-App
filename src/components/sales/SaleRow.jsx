import { formatNumber, formatDate } from '../../lib/format';
import { saleCommission, saleFaceValue } from '../../lib/commission';
import { SALE_STATUS } from '../../lib/sales/constants';
import SaleVerificationBadge from './SaleVerificationBadge';

export default function SaleRow({ sale }) {
  const status = SALE_STATUS[sale.status] || { text: sale.status, class: 'bg-slate-100 text-slate-800' };
  const comm = saleCommission(sale);
  const isSettled = comm !== null && sale.status === 'COMPLETED';

  return (
    <div className="p-3 rounded-xl bg-[var(--ui-surface)] border border-line space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-black font-mono text-[var(--ui-ink)] tabular-nums">
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
        <strong className={`font-mono ${comm === null ? 'text-[var(--ui-muted)]' : 'text-brand-deep'}`}>
          {comm === null ? 'غير محتسب' : `${formatNumber(comm)} ر.ي`}
        </strong>
      </div>
    </div>
  );
}
