import DataFreshness from '../ui/DataFreshness.jsx';

export default function DashWelcome({
  adminName,
  adminInitial,
  online,
  lastSyncAt,
  refreshing,
  onRefresh,
}) {
  return (
    <header className="dash-welcome" aria-label="ترحيب">
      <span className="dash-welcome__avatar" aria-hidden="true">{adminInitial}</span>
      <div className="dash-welcome__identity">
        <p className="dash-welcome__eyebrow">لوحة الإدارة</p>
        <h1 className="dash-welcome__title">أهلاً، {adminName}</h1>
        <p className={`dash-welcome__status ${online ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite">
          <span className="dash-welcome__dot" aria-hidden="true" />
          {online ? 'النظام متصل' : 'غير متصل — تُعرض بيانات محلية'}
        </p>
      </div>
      <DataFreshness
        className="dash-welcome__freshness"
        lastSyncedAt={lastSyncAt}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </header>
  );
}
