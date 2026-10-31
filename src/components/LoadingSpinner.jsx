import { cn } from '../lib/cn';

/**
 * مؤشر تحميل موحّد — Material 3 + Terracotta
 * لا يعتمد على أي CSS خارجي؛ يعمل حتى لو فشل تحميل stylesheet رئيسي.
 */
export default function LoadingSpinner({ size = 'md', text = null, fullPage = false, className }) {
  const sizes = {
    sm: 'w-6 h-6 border-2',
    md: 'w-10 h-10 border-2',
    lg: 'w-14 h-14 border-[3px]',
    xl: 'w-20 h-20 border-4',
  };

  return (
    <div
      className={cn(
        'inline-flex flex-col items-center justify-center gap-3',
        fullPage && 'min-h-screen w-full',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn('inline-block rounded-full animate-spin', sizes[size] || sizes.md)}
        style={{
          borderColor: 'rgba(var(--ui-primary-rgb), 0.18)',
          borderTopColor: 'var(--ui-brand)',
        }}
        aria-hidden="true"
      />
      {text && (
        <span className="text-xs font-bold text-[var(--ui-muted)] text-center max-w-xs">
          {text}
        </span>
      )}
      {text && <span className="sr-only">{text}</span>}
    </div>
  );
}
