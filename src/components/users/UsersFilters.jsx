import { Search, X } from 'lucide-react';
import { FILTERS } from '../../lib/users/constants';

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
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          placeholder="ابحث باسم الشبكة، رقم الهاتف، المعرّف..."
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface shadow-xs"
          aria-label="بحث في المشتركين"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute left-3.5 top-3 text-muted hover:text-ink"
            aria-label="مسح البحث"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 flex-wrap text-xs font-semibold text-muted">
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

      <div
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar touch-pan-x"
        role="group"
        aria-label="فلاتر المستخدمين"
      >
        {FILTERS.map((filter) => {
          const isActive = filterType === filter.value;
          const count = filterCounts[filter.value] ?? 0;

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onFilterChange(filter.value)}
              aria-pressed={isActive}
              className={`flex-shrink-0 min-h-[40px] px-3 py-1.5 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-ink-soft border-line hover:bg-surface-sunken'
              }`}
            >
              <span>{filter.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-surface-sunken text-muted'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
