import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * قائمة إجراءات بنمط Bottom Sheet — بديل زر ⋮.
 * تُفتح عند الضغط على أيقونة في بطاقة.
 */
export default function OverflowMenu({ isOpen, onClose, title, subtitle, actions = [] }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const TONES = {
    neutral: 'text-[var(--ui-ink)] bg-[var(--ui-sunken)]',
    brand: 'text-[var(--ui-brand-deep)] bg-brand/10',
    success: 'text-emerald-800 bg-emerald-50',
    danger: 'text-rose-800 bg-rose-50',
    warning: 'text-amber-800 bg-amber-50',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-[ui-fade_150ms_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg bg-[var(--ui-surface)] rounded-t-3xl shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] animate-[sheet-up_250ms_cubic-bezier(.2,.75,.25,1)]">
        <div className="w-9 h-1 rounded-full bg-[var(--ui-line-strong)] mx-auto mt-2 mb-1" />
        <header className="flex items-center justify-between px-5 py-2.5">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-black text-[var(--ui-ink)] truncate">{title}</h3>}
            {subtitle && <p className="text-[11px] text-[var(--ui-muted)] mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-3 pb-2 grid grid-cols-1 gap-1">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => { onClose(); action.onClick(); }}
              disabled={action.disabled}
              className={cn(
                'flex items-center gap-3 min-h-[52px] px-3 rounded-2xl font-bold text-sm text-right active:scale-[0.98] transition-transform disabled:opacity-40',
                TONES[action.tone || 'neutral'],
              )}
            >
              {action.icon && (
                <span className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0">
                  <action.icon className="w-4 h-4" />
                </span>
              )}
              <span className="flex-1">{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
