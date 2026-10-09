import { cn } from '../../lib/cn';

/**
 * مخطط أعمدة بسيط بـ SVG فقط (بدون مكتبة خارجية).
 * data: [{ label, value, hint }]
 */
export default function BarChart({ data, height = 180, tone = 'brand', valueFormatter, className }) {
  const points = Array.isArray(data) ? data : [];
  const max = points.reduce((peak, point) => Math.max(peak, Number(point.value) || 0), 0);
  const format = valueFormatter || ((value) => String(value));
  const hasValues = max > 0;

  return (
    <div className={cn('bar-chart', `bar-chart--${tone}`, className)}>
      <div className="bar-chart__plot" style={{ height: `${height}px` }} role="img" aria-label="مخطط أعمدة">
        {points.map((point) => {
          const value = Number(point.value) || 0;
          const ratio = hasValues ? value / max : 0;
          const percent = hasValues ? Math.max(ratio * 100, value > 0 ? 4 : 0) : 0;
          return (
            <div className="bar-chart__col" key={point.label}>
              <span className="bar-chart__value" title={`${point.label}: ${format(value)}`}>
                {format(value)}
              </span>
              <div className="bar-chart__track">
                <div
                  className="bar-chart__bar"
                  style={{ height: `${percent}%` }}
                  title={point.hint || `${point.label}: ${format(value)}`}
                />
              </div>
              <span className="bar-chart__label">{point.label}</span>
            </div>
          );
        })}
      </div>
      {!hasValues && <p className="bar-chart__empty">لا توجد مبيعات في هذه الفترة</p>}
    </div>
  );
}
