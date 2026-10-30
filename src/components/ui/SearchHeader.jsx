import { Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * رأس بحث بنمط Android: عنوان مضغوط + بحث + زر فلتر.
 * يستخدم sticky positioning ليظل مرئيًا عند التمرير.
 */
export default function SearchHeader({
  title,
  subtitle,
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'ابحث...',
  onFilterClick,
  filterCount = 0,
  actions = null,
  className,
}) {
  return (
    <div className={cn('sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-[var(--ui-paper)]/95 backdrop-blur-sm', className)}>
      {/* عنوان + إجراءات */}
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 mb-2.5 min-h-[32px]">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-[var(--ui-ink)] leading-tight truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[11px] text-[var(--ui-muted)] font-semibold mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
        </div>
      )}

      {/* بحث + فلتر */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ui-muted)] pointer-events-none" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full min-h-[48px] pr-10 pl-10 rounded-2xl bg-[var(--ui-surface)] border border-line text-sm text-[var(--ui-ink)] placeholder:text-[var(--ui-faint)] focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 transition-colors"
            aria-label={searchPlaceholder}
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-[var(--ui-muted)] hover:text-[var(--ui-ink)] hover:bg-[var(--ui-sunken)] transition-colors"
              aria-label="مسح البحث"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {onFilterClick && (
          <button
            type="button"
            onClick={onFilterClick}
            className={cn(
              'relative min-h-[48px] min-w-[48px] flex items-center justify-center rounded-2xl border transition-colors active:scale-95',
              filterCount > 0
                ? 'bg-brand text-white border-brand'
                : 'bg-[var(--ui-surface)] text-[var(--ui-ink-soft)] border-line hover:bg-[var(--ui-sunken)]',
            )}
            aria-label={`فلترة${filterCount > 0 ? ` (${filterCount} نشط)` : ''}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {filterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-brand text-[10px] font-black flex items-center justify-center border-2 border-brand">
                {filterCount}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
