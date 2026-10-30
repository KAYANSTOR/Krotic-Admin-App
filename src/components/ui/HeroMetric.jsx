import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';

/**
 * بطاقة المؤشر الرئيسي — أكبر رقم في الشاشة.
 * يدعم: اتجاه (up/down/flat)، ملخص فرعي، لون Terracotta.
 */
export default function HeroMetric({
  label,
  value,
  unit,
  hint,
  trend,          // 'up' | 'down' | 'flat' | null
  trendLabel,
  icon: Icon,
  tone = 'brand',
  onClick,
  className,
}) {
  const ToneClass = {
    brand: 'from-[var(--ui-brand)] to-[var(--ui-brand-deep)]',
    success: 'from-emerald-600 to-emerald-800',
    warning: 'from-amber-500 to-amber-700',
    danger: 'from-rose-500 to-rose-700',
  }[tone] || 'from-[var(--ui-brand)] to-[var(--ui-brand-deep)]';

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const TrendColor = trend === 'up' ? 'text-emerald-300' : trend === 'down' ? 'text-rose-300' : 'text-white/60';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative w-full text-right overflow-hidden rounded-3xl',
        'bg-gradient-to-br p-5 sm:p-6',
        ToneClass,
        'text-white shadow-lg shadow-[var(--ui-brand)]/20',
        onClick && 'active:scale-[0.98] transition-transform',
        className,
      )}
    >
      {/* أشكال زخرفية */}
      <div className="absolute top-0 left-0 w-32 h-32 rounded-full bg-white/5 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-40 h-40 rounded-full bg-black/10 translate-x-1/3 translate-y-1/3 pointer-events-none" />

      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-bold text-white/80 uppercase tracking-wider">
            {label}
          </span>
          {Icon && (
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Icon className="w-4.5 h-4.5" />
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-4xl sm:text-5xl font-black tabular-nums leading-none tracking-tight">
            {typeof value === 'number' ? formatNumber(value) : value}
          </span>
          {unit && <span className="text-sm font-bold text-white/70">{unit}</span>}
        </div>

        {(trendLabel || hint) && (
          <div className="flex items-center justify-between gap-2 mt-3">
            {trendLabel && (
              <span className={cn('inline-flex items-center gap-1 text-xs font-bold', TrendColor)}>
                <TrendIcon className="w-3.5 h-3.5" />
                {trendLabel}
              </span>
            )}
            {hint && <span className="text-[11px] text-white/60 truncate">{hint}</span>}
          </div>
        )}
      </div>
    </Wrapper>
  );
}
