import { DollarSign, Download } from 'lucide-react';
import PageHero from '../ui/PageHero';
import Button from '../ui/Button';
import DataFreshness from '../ui/DataFreshness';

export default function SalesHeader({ onExport, lastSyncedAt, refreshing, onRefresh }) {
  return (
    <PageHero
      icon={DollarSign}
      kicker="المبيعات"
      title="المبيعات والعمولات"
      subtitle="متابعة فورية لمبيعات كروت الشبكات وحساب العمولات"
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" icon={Download} onClick={onExport}>
            تصدير CSV
          </Button>
          <DataFreshness
            lastSyncedAt={lastSyncedAt}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        </div>
      }
    />
  );
}
