import { Search, X } from 'lucide-react';
import { FILTERS } from '../../lib/users/constants.js';

export default function UsersFilters({
  searchTerm,
  onSearchChange,
  filterType,
  onFilterChange,
  filterCounts,
  versionSort,
  onVersionSortChange,
}) {
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none" />
        <input
          type="search"
          placeholder="بحث: اسم، هاتف، معرّف، إصدار..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface shadow-xs"
          aria-label="البحث في المشتركين"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute left-3.5 top-3 text-muted hover:text-ink"
            aria-label="مسح البحث"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-muted">
        ترتيب الإصدارات
        <select
          className="input-field py-2 text-xs"
          value={versionSort}
          onChange={(event) => onVersionSortChange(event.target.value)}
        >
          <option value="none">الترتيب الافتراضي</option>
          <option value="oldest">الأقدم أولاً</option>
          <option value="newest">الأحدث أولاً</option>
        </select>
      </label>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x" aria-label="تصفية المشتركين">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${
              filterType === filter.value
                ? 'bg-brand text-white border-brand shadow-xs'
                : 'bg-surface text-ink-soft border-line hover:bg-surface-sunken'
            }`}
            aria-pressed={filterType === filter.value}
          >
            <span>{filter.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              filterType === filter.value ? 'bg-white/20 text-white' : 'bg-surface-sunken text-muted'
            }`}>
              {filterCounts[filter.value] ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
