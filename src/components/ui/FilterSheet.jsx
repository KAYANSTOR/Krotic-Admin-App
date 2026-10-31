import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * لوحة فلترة سفلية — Android Filter Sheet.
 * تُفتح من زر ⚙️ في SearchHeader.
 */
export default function FilterSheet({ isOpen, onClose, title = 'الفلاتر', children, footer }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg bg-[var(--ui-surface)] rounded-t-3xl shadow-2xl flex flex-col max-h-[85dvh] animate-[sheet-up_250ms_cubic-bezier(.2,.75,.25,1)]">
        <div className="w-9 h-1 rounded-full bg-[var(--ui-line-strong)] mx-auto mt-2 mb-1" />
        <header className="flex items-center justify-between px-5 py-2.5 border-b border-line">
          <h3 className="text-base font-black text-[var(--ui-ink)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-[var(--ui-muted)] hover:bg-[var(--ui-sunken)]"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {children}
        </div>
        {footer && (
          <footer className="border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
