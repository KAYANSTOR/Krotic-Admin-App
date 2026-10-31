import { formatNumber } from '../../lib/format.js';

export default function DashSettlement({
  commissionDue,
  commissionOutstanding,
  commissionSettled,
  settlementPercent,
}) {
  return (
    <section className="dash-progress" aria-labelledby="settlement-title">
      <div className="dash-progress__head">
        <div className="dash-progress__heading">
          <p className="dash-progress__eyebrow">الملخص الثانوي</p>
          <h2 className="dash-progress__title" id="settlement-title">تسوية عمولة الإدارة</h2>
        </div>
        {commissionDue > 0 && (
          <span className="dash-progress__percent">{settlementPercent}%</span>
        )}
      </div>

      {commissionDue > 0 ? (
        <>
          <div
            className="dash-progress__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={settlementPercent}
            aria-valuetext={`${settlementPercent} بالمئة`}
            aria-label="نسبة تسوية عمولة الإدارة"
          >
            <span
              className="dash-progress__fill"
              style={{ width: `${settlementPercent}%`, transition: 'width 350ms ease' }}
            />
          </div>
          <p className="dash-progress__caption">
            المسوّى {formatNumber(commissionSettled)} من {formatNumber(commissionDue)} ريال يمني
          </p>
          <p className="dash-progress__note">
            المتبقي غير المسوّى {formatNumber(commissionOutstanding)} ريال يمني.
          </p>
        </>
      ) : (
        <p className="dash-progress__caption">لا توجد عمولات مستحقة مسجّلة حتى الآن.</p>
      )}
    </section>
  );
}
