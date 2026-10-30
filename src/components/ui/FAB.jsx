import { cn } from '../../lib/cn';

/**
 * زر إجراء عائم — Material 3 Extended FAB.
 * يظهر فوق شريط التنقل السفلي.
 */
export default function FAB({ icon: Icon, label, onClick, extended = false, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'fixed z-40 flex items-center justify-center gap-2',
        'right-4 bottom-[calc(68px+env(safe-area-inset-bottom)+16px)]',
        'min-h-[56px] px-4 rounded-2xl',
        'bg-[var(--ui-brand)] text-white font-bold text-sm',
        'shadow-lg shadow-[var(--ui-brand)]/30',
        'active:scale-95 transition-transform',
        className,
      )}
      aria-label={label || 'إجراء'}
    >
      {Icon && <Icon className="w-5 h-5" />}
      {extended && label && <span>{label}</span>}
    </button>
  );
}
