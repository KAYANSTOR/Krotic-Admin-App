import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

// Literal class names so the Tailwind scanner keeps the matching size rules.
const SIZES = { sm: 'modal--sm', md: 'modal--md', lg: 'modal--lg', xl: 'modal--xl' };

const isCoarsePointer = () =>
  typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

export default function Modal({ isOpen, onClose, title, icon: Icon, description, children, footer, size = 'md', className }) {
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    // قفل تمرير الخلفية. على الجوال نستخدم position:fixed للحفاظ على الموضع
    // (iOS يتجاهل overflow وحده)، وعلى سطح المكتب overflow كافٍ وأقل إزعاجاً.
    const body = document.body;
    const scrollY = window.scrollY;
    const useFixedLock = isCoarsePointer();
    if (useFixedLock) {
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.insetInline = '0';
    }
    body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = '';
      if (useFixedLock) {
        body.style.position = '';
        body.style.top = '';
        body.style.insetInline = '';
        window.scrollTo(0, scrollY);
      }
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) { setDragY(0); setDragging(false); }
  }, [isOpen]);

  if (!isOpen) return null;

  // سحب اللوحة للأسفل لإغلاقها على الأجهزة اللمسية فقط.
  const onHandlePointerDown = (event) => {
    if (!isCoarsePointer()) return;
    dragStartY.current = event.clientY;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onHandlePointerMove = (event) => {
    if (dragStartY.current == null) return;
    const delta = Math.max(0, event.clientY - dragStartY.current);
    setDragY(delta);
  };
  const onHandlePointerUp = () => {
    if (dragStartY.current == null) return;
    dragStartY.current = null;
    setDragging(false);
    if (dragY > 110) onClose();
    else setDragY(0);
  };

  return (
    <div className="modal-root" role="presentation">
      <div className="overlay" onClick={onClose} aria-hidden="true" />
      <div
        ref={sheetRef}
        className={cn('modal', SIZES[size] || SIZES.md, dragging && 'is-dragging', className)}
        role="dialog"
        aria-modal="true"
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        <div
          className="modal__grabber"
          aria-hidden="true"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        />
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
