import { Package, RefreshCw } from 'lucide-react';
import Section from '../ui/Section';
import StatCard from '../ui/StatCard';
import Button from '../ui/Button';
import { formatDate, formatNumber } from '../../lib/format';

export default function UserInventorySection({
  snapshot,
  loading,
  error,
  onRetry,
  salesCount,
}) {
  const breakdown = Array.isArray(snapshot?.breakdown) ? snapshot.breakdown : null;
  const hasSnapshot = Boolean(snapshot);

  return (
    <Section
      eyebrow="المخزون المزامَن"
      title="الكروت لدى العميل"
      description="ملخص أعداد المخزون المزامَن من تطبيق Android (متاح/محجوز/مباع)، دون أرقام الكروت السرية. تبقى تفاصيل الأرقام محلية في التطبيق ولا تُرفع."
    >
      {error && (
        <div className="users-error users-error--warning mb-3" role="alert" aria-live="assertive">
          تعذرت قراءة المخزون من آخر محاولة.
          <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} disabled={loading} className="ms-2">
            {loading ? 'جارٍ إعادة المحاولة…' : 'إعادة محاولة قراءة المخزون'}
          </Button>
        </div>
      )}

      <div className="grid-kpi">
        <StatCard
          title="الكروت المباعة (سجلات البيع)"
          value={formatNumber(Number(salesCount) || 0)}
          icon={Package}
          tone="brand"
          subtitle="عدد سجلات البيع المتاحة لكل الأشهر"
        />
        <StatCard
          title="الكروت غير المباعة"
          value={loading && !hasSnapshot
            ? '…'
            : hasSnapshot
              ? formatNumber(Number(snapshot.totalAvailableCards) || 0)
              : 'غير متاح'}
          icon={Package}
          tone="neutral"
          subtitle={loading
            ? 'جارٍ تحديث ملخص المخزون'
            : error
              ? 'تعذرت القراءة؛ أعد المحاولة'
              : hasSnapshot
                ? 'الأعداد المتاحة في آخر مزامنة'
                : 'لم تصل وثيقة مخزون من تطبيق Android بعد'}
        />
      </div>

      {hasSnapshot && (
        <>
          <div className="grid-kpi mt-3">
            <StatCard title="الكروت المتاحة" value={formatNumber(Number(snapshot.totalAvailableCards) || 0)} icon={Package} tone="success" />
            <StatCard title="الكروت المحجوزة" value={formatNumber(Number(snapshot.totalReservedCards) || 0)} icon={Package} tone="warning" />
            <StatCard title="الكروت المباعة محلياً" value={formatNumber(Number(snapshot.totalSoldCards) || 0)} icon={Package} tone="brand" />
            <StatCard title="الكروت التالفة" value={formatNumber(Number(snapshot.totalInvalidCards) || 0)} icon={Package} tone="danger" />
          </div>

          <p className="text-xs text-muted mt-2">
            آخر مزامنة للمخزون: {formatDate(snapshot.generatedAtMs || snapshot.updatedAtMs, { withTime: true })}
            {' • المراجعة '}
            {formatNumber(Number(snapshot.inventoryRevision) || 0)}
          </p>

          {breakdown && breakdown.length > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full min-w-[520px] text-right text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-600">
                    <th className="px-3 py-3 font-bold">الفئة</th>
                    <th className="px-3 py-3 font-bold">العملة</th>
                    <th className="px-3 py-3 font-bold">المتاح</th>
                    <th className="px-3 py-3 font-bold">المحجوز</th>
                    <th className="px-3 py-3 font-bold">المباع</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row, index) => (
                    <tr
                      key={`${row?.catalogId || 'catalog'}-${row?.denomination ?? 0}-${row?.currency || 'currency'}-${index}`}
                      className="border-b border-stone-100 last:border-0"
                    >
                      <td className="px-3 py-3 font-semibold text-stone-800 tabular-nums">{formatNumber(Number(row?.denomination) || 0)}</td>
                      <td className="px-3 py-3">{row?.currency || '—'}</td>
                      <td className="px-3 py-3 tabular-nums">{formatNumber(Number(row?.availableCount) || 0)}</td>
                      <td className="px-3 py-3 tabular-nums">{formatNumber(Number(row?.reservedCount) || 0)}</td>
                      <td className="px-3 py-3 tabular-nums">{formatNumber(Number(row?.soldCount) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!hasSnapshot && !loading && !error && (
        <p className="text-xs text-muted mt-2">
          لا تتوفر وثيقة مخزون بعد؛ ستظهر الأعداد هنا بعد أول مزامنة ناجحة من تطبيق Android.
        </p>
      )}
    </Section>
  );
}
