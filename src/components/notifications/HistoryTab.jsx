import { useMemo, useState, useDeferredValue } from 'react';
import { Bell, CheckCircle2, Trash2, Inbox, Search, X } from 'lucide-react';
import { Card } from '../ui/Card';
import { formatNotificationDate } from '../../lib/notifications/timestamps';
import { AUDIENCE } from '../../lib/notifications/constants';

export default function HistoryTab({ notifications, deleting, hidden = false, onRequestDelete }) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    if (!query) return notifications;
    return notifications.filter((notification) => (
      String(notification.title || '').toLocaleLowerCase().includes(query)
      || String(notification.message || '').toLocaleLowerCase().includes(query)
    ));
  }, [notifications, deferredSearch]);

  return (
    <div className="space-y-3" hidden={hidden}>
      <div className="relative">
        <Search className="w-4 h-4 absolute right-3.5 top-3.5 text-muted pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          placeholder="ابحث في سجل الإشعارات..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="input-field pr-10 text-xs py-2.5 rounded-xl bg-surface"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="absolute left-3.5 top-2.5 text-muted hover:text-ink" aria-label="مسح البحث">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card className="p-8 text-center rounded-2xl">
          <span className="empty-state__icon icon-tile icon-tile--neutral icon-tile--lg mx-auto mb-3">
            <Inbox className="w-6 h-6" aria-hidden="true" />
          </span>
          <p className="font-bold text-ink">لا توجد إشعارات سابقة</p>
          <p className="text-xs text-muted mt-1">
            {search ? 'لا توجد نتائج تطابق بحثك.' : 'لم يتم إرسال أي إشعارات بعد.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((notification, index) => (
            <article
              key={notification.id || `notification-${notification.displayTimestamp || index}-${index}`}
              className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-2 hover:border-brand/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-brand-soft text-brand-deep flex items-center justify-center flex-shrink-0 mt-0.5" aria-hidden="true">
                    <Bell className="w-4.5 h-4.5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-extrabold text-ink leading-snug">{notification.title || 'إشعار بدون عنوان'}</h4>
                    <p className="text-xs text-ink-soft mt-1 leading-relaxed whitespace-pre-wrap">{notification.message || notification.body || ''}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRequestDelete(notification)}
                  disabled={deleting}
                  className="p-2 min-w-[44px] min-h-[44px] text-muted hover:text-danger hover:bg-danger-soft/30 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
                  title="حذف الإشعار"
                  aria-label={`حذف الإشعار: ${notification.title || ''}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-muted pt-2 border-t border-line/50">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {notification.status === 'sent' ? 'مرسل' : (notification.status || 'غير محدد')}
                  </span>
                  <span>•</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-sunken text-[10px] font-semibold text-ink-soft">
                    {notification.type === AUDIENCE.USER ? 'خاص بمشترك' : 'بث عام للجميع'}
                  </span>
                  <span>•</span>
                  <span>{notification.sentCount ?? 1} جهاز</span>
                </div>
                <span dir="rtl">{formatNotificationDate(notification.displayTimestamp)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
