import { Clock3, ShieldCheck } from 'lucide-react';
import { isServerVerifiedSale } from '../../lib/commission';

export default function SaleVerificationBadge({ sale }) {
  if (isServerVerifiedSale(sale)) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
        title={'معتمد خادمياً (Ingest)\nHash: ' + (sale.payloadHash || '—')}
      >
        <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
        <span>معتمد خادمياً</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300"
      title="سجل قديم قبل ربط Ingest — لا يُحتسب كعمولة معتمدة تلقائياً"
    >
      <Clock3 className="w-3 h-3 text-amber-700" aria-hidden="true" />
      <span>سجل قديم</span>
    </span>
  );
}
