import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * بطاقة قابلة للتوسيع — للبيانات الطويلة.
 */
export default function ExpandableCard({ title, subtitle, avatar, badges = [], summary = [], children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className="rounded-2xl bg-[var(--ui-surface)] border border-line overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-right p-3.5 hover:bg-[var(--ui-sunken)]/40 transition-colors"
      >
        <div className="flex items-start gap-3">
          {avatar}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-black text-[var(--ui-ink)] truncate">{title}</h3>
              {badges.map((b) => (
                <span
                  key={b.label}
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--ui-sunken)] text-[var(--ui-ink-soft)]"
                >
                  {b.label}
                </span>
              ))}
            </div>
            {subtitle && (
              <p className="text-[11px] text-[var(--ui-muted)] mt-0.5 font-mono truncate" dir="ltr">
                {subtitle}
              </p>
            )}
            {summary.length > 0 && (
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[var(--ui-ink-soft)]">
                {summary.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 min-w-0">
                    {s.icon && <s.icon className="w-3 h-3 text-[var(--ui-muted)] flex-shrink-0" />}
                    {s.label && <span className="text-[var(--ui-muted)]">{s.label}</span>}
                    <span className="font-bold truncate">{s.value}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <span className={`p-1.5 rounded-full text-[var(--ui-muted)] transition-transform ${open ? 'rotate-180' : ''}`}>
            <ChevronDown className="w-4 h-4" />
          </span>
        </div>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 border-t border-line/60 pt-3 space-y-2">
          {children}
        </div>
      )}
    </article>
  );
}
