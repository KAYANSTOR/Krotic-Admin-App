import { useNavigate } from 'react-router-dom';
import { Phone, ArrowUpLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import UserActions from './UserActions';
import { formatNumber, formatDate, isExpired } from '../../lib/format';
import { isUserPhoneVerified } from '../../lib/accessStatus';

export default function UserCard({
  user,
  defaultCommission,
  hasCustomCommission,
  onBilling,
  onRenew,
  onEdit,
  onAuth,
  onVerify,
  onToggle,
  onDelete,
}) {
  const navigate = useNavigate();
  const expired = isExpired(user.subscription_end_date);
  const networkTitle = user.networkName
    || user.network_name
    || user.name
    || user.networkTitle
    || `شبكة ${user.networkId || user.uid.slice(0, 8)}`;
  const phoneStr = user.phoneNumber || user.phone || '';
  const isVerified = isUserPhoneVerified(user);

  return (
    <article className="p-3.5 sm:p-4 rounded-2xl bg-surface border border-line shadow-xs space-y-3 hover:border-brand/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/users/${user.uid}`)}
            className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 text-brand-deep flex items-center justify-center font-black text-base flex-shrink-0"
            aria-label={`فتح ملف ${networkTitle}`}
          >
            {networkTitle.charAt(0)}
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => navigate(`/users/${user.uid}`)}
              className="flex items-center gap-1.5 text-right max-w-full group"
            >
              <h3 className="text-sm font-extrabold text-ink truncate leading-tight">
                {networkTitle}
              </h3>
              <ArrowUpLeft className="w-3.5 h-3.5 text-muted opacity-60 flex-shrink-0" aria-hidden="true" />
            </button>
            {phoneStr ? (
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <a
                  href={`tel:${phoneStr}`}
                  className="text-xs text-muted hover:text-brand flex items-center gap-1"
                  dir="ltr"
                >
                  <Phone className="w-3 h-3" aria-hidden="true" />
                  <span>{phoneStr}</span>
                </a>
                {isVerified ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
                    title="الحساب مفعّل برقم الهاتف"
                  >
                    <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                    <span>مفعّل بالهاتف</span>
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                    title="الحساب غير مفعّل برقم الهاتف"
                  >
                    <ShieldAlert className="w-3 h-3 text-amber-600" aria-hidden="true" />
                    <span>غير مفعّل</span>
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted">بدون هاتف</p>
                <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 rounded border border-amber-200">
                  غير مفعّل
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            user.is_trial
              ? 'bg-amber-100 text-amber-800 border border-amber-300'
              : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
          }`}>
            {user.is_trial ? 'تجريبي' : 'رسمي'}
          </span>
          {user.is_active === false && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
              محظور
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-surface-sunken/60 border border-line/60 text-xs">
        <div>
          <span className="text-[10px] text-muted block font-semibold">نسبة العمولة</span>
          <span className="font-bold text-ink">
            {hasCustomCommission(user)
              ? <span className="text-brand font-black">{user.commission_rate}% (خاصة)</span>
              : `{defaultCommission}% (عامة)`}
          </span>
        </div>
        <div className="text-left">
          <span className="text-[10px] text-muted block font-semibold">تاريخ الانتهاء</span>
          <span className={`font-bold ${expired ? 'text-rose-600 font-black' : 'text-ink-soft'}`}>
            {formatDate(user.subscription_end_date)}
          </span>
        </div>
        <div className="pt-1 border-t border-line/40">
          <span className="text-[10px] text-muted block font-semibold">المبيعات المكتملة</span>
          <span className="font-mono font-black text-ink">
            {formatNumber(user.reportedSalesValue || 0)} ر.ي
          </span>
          <div className="flex items-center gap-1 text-[10px] mt-0.5">
            <span className="text-emerald-700 font-bold">
              {formatNumber(user.verifiedTransactions || 0)} معتمدة
            </span>
            {(user.legacyTransactions > 0) && (
              <>
                <span className="text-muted">•</span>
                <span className="text-amber-800 font-semibold">
                  {formatNumber(user.legacyTransactions)} قديمة
                </span>
              </>
            )}
          </div>
        </div>
        <div className="pt-1 border-t border-line/40 text-left">
          <span className="text-[10px] text-muted block font-semibold">العمولة المعتمدة خادمياً</span>
          <span className="font-mono font-black text-emerald-600">
            {formatNumber(user.verifiedOutstandingCommission ?? 0)} ر.ي
          </span>
          {(user.legacyEstimatedCommission > 0) && (
            <span className="text-[10px] text-amber-800 block truncate" title="عمولات تقديرية لسجلات قديمة للمراجعة والتسوية">
              + {formatNumber(user.legacyEstimatedCommission)} ر.ي قديمة
            </span>
          )}
        </div>
      </div>

      <UserActions
        user={user}
        layout="grid"
        onBilling={onBilling}
        onRenew={onRenew}
        onEdit={onEdit}
        onAuth={onAuth}
        onVerify={onVerify}
        onToggle={onToggle}
        onDelete={onDelete}
      />
    </article>
  );
}
