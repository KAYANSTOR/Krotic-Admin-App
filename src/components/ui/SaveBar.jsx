export default function SaveBar({ onSave, saving }) {
  return (
    <div
      className="fixed z-30 inset-x-3 max-w-lg mx-auto"
      style={{ bottom: 'calc(68px + env(safe-area-inset-bottom) + 12px)' }}
    >
      <div className="flex items-center gap-2 p-2 rounded-2xl bg-[var(--ui-ink)] text-white shadow-2xl">
        <div className="flex-1 px-2 min-w-0">
          <p className="text-[11px] font-bold text-white/80">تغييرات غير محفوظة</p>
          <p className="text-[10px] text-white/60 mt-0.5 truncate">إعدادات التطبيق</p>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="min-h-[44px] px-5 rounded-xl bg-[var(--ui-brand)] hover:bg-[var(--ui-brand-deep)] font-black text-sm disabled:opacity-60 transition-colors"
        >
          {saving ? 'جارٍ الحفظ...' : 'حفظ الآن'}
        </button>
      </div>
    </div>
  );
}
