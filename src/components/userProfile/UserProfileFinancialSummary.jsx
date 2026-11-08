import { DollarSign, Wallet } from 'lucide-react';
import Section from '../ui/Section';
import StatCard from '../ui/StatCard';
import { formatNumber } from '../../lib/format';
import { formatMonthArabic } from '../../lib/users/profileHelpers';

export default function UserProfileFinancialSummary({
  historyMonth, setHistoryMonth, monthOptions, totalSales,
  verifiedCommissionDue, legacyEstimatedCommission, verifiedOutstanding, totalPaid,
  cancelledTransactions = 0, cancelledSalesValue = 0,
}) {
  const periodSubtitle = historyMonth === 'all' ? 'كل الأشهر • ريال يمني' : formatMonthArabic(historyMonth);
  return (
          <Section eyebrow="المؤشرات المالية" title="ملخص المبيعات والعمولات">
            <div className="flex items-center justify-between my-2 flex-wrap gap-2">
              <p className="text-xs text-muted">تُعرض جميع الفترات افتراضياً، ويمكن اختيار شهر محدد.</p>
              <label className="flex items-center gap-2 text-xs font-semibold text-muted">
                الفترة
                <select
                  value={historyMonth}
                  onChange={(event) => setHistoryMonth(event.target.value)}
                  className="input-field py-2 text-xs min-h-[44px]"
                  aria-label="فترة المؤشرات المالية"
                >
                  <option value="all">كل الأشهر</option>
                  {monthOptions.map((month) => (
                    <option key={month} value={month}>{formatMonthArabic(month)}</option>
                  ))}
                </select>
              </label>
            </div>
    
            <div className="grid-kpi">
              <StatCard
                title={historyMonth === 'all' ? 'إجمالي المبيعات' : 'مبيعات الشهر المحدد'}
                value={formatNumber(totalSales)}
                icon={DollarSign}
                tone="brand"
                subtitle={cancelledTransactions > 0
                  ? `${periodSubtitle} • لا يشمل ${formatNumber(cancelledTransactions)} ملغاة (${formatNumber(cancelledSalesValue)} ر.ي)`
                  : periodSubtitle}
              />
              <StatCard
                title="العمولة المعتمدة خادمياً"
                value={formatNumber(verifiedCommissionDue)}
                icon={Wallet}
                tone="warning"
                subtitle={legacyEstimatedCommission > 0
                  ? `+ ${formatNumber(legacyEstimatedCommission)} ر.ي قديمة للمراجعة`
                  : historyMonth === 'all' ? 'كل العمولات المعتمدة' : 'العمولة المعتمدة لهذا الشهر'}
              />
              <StatCard
                title="المتبقي غير المسوّى"
                value={formatNumber(verifiedOutstanding)}
                icon={Wallet}
                tone="success"
                subtitle="من سجلات المبيعات المعتمدة فقط"
              />
              <StatCard
                title="الدفعات المسجلة"
                value={formatNumber(totalPaid)}
                icon={DollarSign}
                tone="neutral"
                subtitle={historyMonth === 'all' ? 'إجمالي الدفعات في كل الأشهر' : `دفعات ${formatMonthArabic(historyMonth)}`}
              />
            </div>
    
            {historyMonth === 'all' && legacyEstimatedCommission > 0 && (
              <p className="text-xs leading-5 text-amber-800 mt-2" role="note">
                العمولات التقديرية للسجلات القديمة معروضة للمراجعة فقط ولا تدخل ضمن عمولة الإدارة المعتمدة.
              </p>
            )}
          </Section>
  );
}
