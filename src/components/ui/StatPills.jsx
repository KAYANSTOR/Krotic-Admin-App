import { cn } from '../../lib/cn';

/**
 * صف أفقي من "الحبوب" الإحصائية — قابلة للتمرير ولمسة.
 * كل حبة: تسمية + قيمة + لون دلالي اختياري.
 */
export default function StatPills({ items, className, onItemClick }) {
  return (
    <div
      className={cn('flex gap-2 overflow-x-auto pb-1 no-scrollbar touch-pan-x', className)}
      role="group"
      aria-label="إحصاءات سريعة"
    >
      {items.map((item) => {
        const Tone = {
          brand: 'text-[var(--ui-brand-deep)] bg-brand/10 border-brand/20',
          success: 'text-emerald-800 bg-emerald-50 border-emerald-200',
          warning: 'text-amber-800 bg-amber-50 border-amber-200',
          danger: 'text-rose-800 bg-rose-50 border-rose-200',
          neutral: 'text-[var(--ui-ink-soft)] bg-[var(--ui-sunken)] border-line',
        }[item.tone || 'neutral'];

        const Wrapper = onItemClick ? 'button' : 'div';

        return (
          <Wrapper
            key={item.key}
            type={onItemClick ? 'button' : undefined}
            onClick={onItemClick ? () => onItemClick(item) : undefined}
            className={cn(
              'flex-shrink-0 flex items-center gap-2 rounded-full border px-3 py-1.5',
              Tone,
              onItemClick && 'active:scale-95 transition-transform',
            )}
          >
            {item.icon && <item.icon className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-bold whitespace-nowrap">{item.label}</span>
            <span className="text-xs font-black tabular-nums whitespace-nowrap">
              {item.value}
            </span>
          </Wrapper>
        );
      })}
    </div>
  );
}
