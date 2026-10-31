import { cn } from '../../lib/cn';

/**
 * بطاقة صف موحّدة — Android Data Card.
 *
 * بنية:
 *   [Avatar] [الاسم + شارة]
 *            [حقيقة 1] [حقيقة 2] [حقيقة 3]
 *   ─────────────────────────────────
 *   [سطر ثانوي خفيف]
 */
export default function DataCard({
  avatar,           // { initial, tone } أو node
  title,
  subtitle,
  badges = [],      // [{ label, tone }]
  facts = [],       // [{ icon, label, value }]
  trailing,         // node (مثل ⋮)
  onClick,
  footer,
  className,
}) {
  const Wrapper = onClick ? 'button' : 'div';

  const TONES = {
    brand: 'bg-brand/15 text-brand-deep border-brand/25',
    success: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    warning: 'bg-amber-100 text-amber-800 border-amber-300',
    danger: 'bg-rose-100 text-rose-800 border-rose-300',
    neutral: 'bg-[var(--ui-sunken)] text-[var(--ui-muted)] border-line',
  };

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group w-full text-right rounded-2xl bg-[var(--ui-surface)] border border-line',
        'transition-all hover:border-brand/30 hover:shadow-sm',
        onClick && 'active:scale-[0.99]',
        className,
      )}
    >
      <div className="p-3.5 flex items-start gap-3">
        {avatar && (
          <div
            className={cn(
              'flex-shrink-0 w-11 h-11 rounded-2xl border flex items-center justify-center font-black text-base',
              avatar.node ? 'bg-transparent border-0' : TONES[avatar.tone || 'brand'],
            )}
            aria-hidden="true"
          >
            {avatar.node || avatar.initial}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-black text-[var(--ui-ink)] truncate">
                  {title}
                </h3>
                {badges.map((b) => (
                  <span
                    key={b.label}
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border',
                      TONES[b.tone || 'neutral'],
                    )}
                  >
                    {b.label}
                  </span>
                ))}
              </div>
              {subtitle && (
                <p className="text-xs text-[var(--ui-muted)] font-semibold mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>

            {trailing && (
              <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                {trailing}
              </div>
            )}
          </div>

          {facts.length > 0 && (
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[var(--ui-ink-soft)]">
              {facts.map((fact, i) => (
                <span key={i} className="inline-flex items-center gap-1 min-w-0">
                  {fact.icon && <fact.icon className="w-3 h-3 text-[var(--ui-muted)] flex-shrink-0" />}
                  {fact.label && (
                    <span className="text-[var(--ui-muted)]">{fact.label}</span>
                  )}
                  <span className="font-bold truncate">{fact.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {footer && (
        <div className="px-3.5 pb-3.5 pt-0" onClick={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </Wrapper>
  );
}
