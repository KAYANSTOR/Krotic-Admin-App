import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

// Literal class names so the Tailwind scanner keeps the matching size rules.
const SIZES = { sm: 'modal--sm', md: 'modal--md', lg: 'modal--lg', xl: 'modal--xl' };

export default function Modal({ isOpen, onClose, title, icon: Icon, description, children, footer, size = 'md', className }) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-root" role="presentation">
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div className={cn('modal', SIZES[size] || SIZES.md, className)} role="dialog" aria-modal="true">
        {(title || Icon) && (
          <div className="modal__header">
            <div className="flex items-start gap-3 min-w-0">
              {Icon && <span className="icon-tile icon-tile--brand icon-tile--sm shrink-0"><Icon className="w-4 h-4" aria-hidden="true" /></span>}
              <div className="min-w-0">
                <h3 className="modal__title">{title}</h3>
                {description && <p className="modal__desc">{description}</p>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="modal__close" aria-label="إغلاق">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
