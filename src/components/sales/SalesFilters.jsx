import { Calendar, Search, X } from 'lucide-react';
import { DATE_PRESETS, STATUS_FILTERS, VERIFICATION_FILTERS } from '../../lib/sales/constants';

export default function SalesFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  verificationFilter,
  onVerificationChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  activePreset,
  onApplyPreset,
  showCustomDate,
  onToggleCustomDate,
  hasActiveFilters,
  onResetFilters,
}) {
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const chipClass = (active) => (
    'flex-shrink-0 min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-bold border transition-colors ' +
    (active
      ? 'bg-brand text-white border-brand'
      : 'bg-surface text-[var(--ui-ink-soft)] border-line hover:bg-[var(--ui-sunken)]')
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x" aria-label="التصفية حسب التاريخ">
        <button
          type="button"
          onClick={() => { onDateFromChange(''); onDateToChange(''); }}
          aria-pressed={!hasDateFilter}
          className={chipClass(!hasDateFilter)}
        >
          كل التواريخ
        </button>
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onApplyPreset(preset)}
            aria-pressed={activePreset === preset.key}
            className={chipClass(activePreset === preset.key)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleCustomDate}
          aria-pressed={Boolean(dateFrom && !activePreset)}
          className={
            'flex-shrink-0 min-h-[40px] px-3.5 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1 ' +
            (dateFrom && !activePreset
              ? 'bg-brand text-white border-brand'
              : 'bg-surface text-[var(--ui-ink-soft)] border-line')
          }
        >
          <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
          <span>تاريخ مخصص</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x" aria-label="التصفية حسب التوثيق">
        {VERIFICATION_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onVerificationChange(option.value)}
            aria-pressed={verificationFilter === option.value}
            className={
              'flex-shrink-0 min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ' +
              (verificationFilter === option.value
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-[var(--ui-ink-soft)] border-line/60 hover:text-[var(--ui-ink)]')
            }
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x" aria-label="التصفية حسب حالة العملية">
        {STATUS_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onStatusChange(option.value)}
            aria-pressed={statusFilter === option.value}
            className={
              'flex-shrink-0 min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ' +
              (statusFilter === option.value
                ? 'bg-[var(--ui-ink)] text-[var(--ui-surface)] border-[var(--ui-ink)]'
                : 'bg-[var(--ui-sunken)] text-[var(--ui-muted)] border-line/60 hover:text-[var(--ui-ink)]')
            }
          >
            {option.label}
          </button>
        ))}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="flex-shrink-0 px-2.5 py-1 text-xs text-[var(--ui-danger)] hover:underline font-bold"
          >
            إلغاء التصفية ✕
          </button>
        )}
      </div>

      {showCustomDate && (
        <div className="p-3 bg-surface border border-line rounded-xl grid grid-cols-2 gap-2 text-xs">
          <div>
            <label htmlFor="sales-date-from" className="text-[var(--ui-muted)] block mb-1">من تاريخ</label>
            <input
              id="sales-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.target.value)}
              className="input-field text-xs py-1.5"
            />
          </div>
          <div>
            <label htmlFor="sales-date-to" className="text-[var(--ui-muted)] block mb-1">إلى تاريخ</label>
            <input
              id="sales-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => onDateToChange(event.target.value)}
              className="input-field text-xs py-1.5"
            />
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-[var(--ui-muted)] pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          placeholder="ابحث باسم الشبكة أو رقم الهاتف..."
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface"
          aria-label="بحث في الشبكات"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute left-3.5 top-3 text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
            aria-label="مسح البحث"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
