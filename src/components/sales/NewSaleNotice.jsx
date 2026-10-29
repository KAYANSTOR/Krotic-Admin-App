import { Zap } from 'lucide-react';
import { formatNumber } from '../../lib/format';

export default function NewSaleNotice({ notice, onClose }) {
  if (!notice) return null;

  return (
    <div
      key={notice.id}
      className="p-3.5 rounded-2xl bg-gradient-to-l from-emerald-600 to-teal-700 text-white shadow-lg flex items-center justify-between gap-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black">
            {notice.count === 1
              ? '⚡ عملية بيع جديدة الآن!'
              : '⚡ ' + formatNumber(notice.count) + ' مبيعات جديدة!'}
          </p>
          <p className="text-[11px] text-white/90 truncate">
            {notice.networkName} • المبيعات: <strong>{formatNumber(notice.totalFaceValue)} ر.ي</strong> • العمولة:{' '}
            <strong>{formatNumber(notice.totalCommission)} ر.ي</strong>
          </p>
        </div>
      </div>
      <button
        type="button"
        className="text-white/80 hover:text-white p-2 text-sm font-bold flex-shrink-0 min-w-[40px] min-h-[40px]"
        onClick={onClose}
        aria-label="إغلاق التنبيه"
      >
        ✕
      </button>
    </div>
  );
}
