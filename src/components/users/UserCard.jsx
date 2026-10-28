import { useNavigate } from 'react-router-dom';
import { Phone, ArrowUpLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import UserActions from './UserActions.jsx';
import { formatDate, formatNumber, isExpired } from '../../lib/format.js';
import { isUserPhoneVerified } from '../../lib/accessStatus.js';

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
  const expiry = user.subscriptionEndsAt ?? user.subscription_end_date;
  const expired = isExpired(expiry);
  const networkTitle = user.networkName || user.network_name || user.name
    || user.networkTitle || `شبكة ${user.networkId || String(user.uid || '').slice(0, 8)}`;
  const phoneStr = user.phoneNumber || user.phone || '';
  const isVerified = isUserPhoneVerified(user);
  const billing = user;

  return (
    <article className="p-3 sm:p-3.5 rounded-2xl bg-surface border border-line shadow-xs space-y-2.5 hover:border-brand/40 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/users/${user.uid}`)}
            className="flex items-start gap-2.5 min-w-0 text-right"
            aria-label={`فتح ملف ${networkTitle}`}
          >
            <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 text-brand-deep flex items-center justify-center font-black text-base flex-shrink-0">
              {String(networkTitle).charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-extrabold text-ink truncate leading-tight">{networkTitle}</span>
                <ArrowUpLeft className="w-3.5 h-3.5 text-muted opacity-60 flex-shrink-0" aria-hidden="true" />
              </span>
              <span className="block font-mono text-[10px] text-muted mt-1">{String(user.uid || '').slice(0, 10)}…</span>
            </span>
          </button>
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

      <div className="flex items-center gap-2 flex-wrap min-h-5">
        {phoneStr ? (
          <a
            href={`tel:${phoneStr}`}
            className="text-xs text-muted hover:text-brand flex items-center gap-1"
            dir="ltr"
          >
            <Phone className="w-3 h-3 text-muted" aria-hidden="true" />
            <span>{phoneStr}</span>
          </a>
        ) : (
          <span className="text-xs text-muted">بدون هاتف</span>
        )}
        {isVerified ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
            title="الحساب موثّق برقم الهاتف"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-600" aria-hidden="true" />
            <span>مفعّل بالهاتف</span>
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
            title="غير مفعّل برقم الهاتف"
          >
            <ShieldAlert className="w-3 h-3 text-amber-600" aria-hidden="true" />
            <span>غير مفعّل</span>
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate(`/users/${user.uid}`)}
        className="w-full grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-surface-sunken/60 border border-line/60 text-xs text-right"
        aria-label={`عرض مبيعات واشتراك ${networkTitle}`}
      >
        <span>
          <span className="text-[10px] text-muted block font-semibold">نسبة العمولة</span>
          <span className="font-bold text-ink">
            {hasCustomCommission(user)
              ? <span className="text-brand font-black">{user.commission_rate}% (خاصة)</span>
              : `${defaultCommission}% (عامة)`}
          </span>
        </span>
        <span className="text-left">
          <span className="text-[10px] text-muted block font-semibold">تاريخ الانتهاء</span>
          <span className={`font-bold ${expired ? 'text-rose-600 font-black' : 'text-ink-soft'}`}>
            {formatDate(expiry)}
          </span>
        </span>
        <span className="pt-1 border-t border-line/40">
          <span className="text-[10px] text-muted block font-semibold">المبيعات المكتملة</span>
          <span className="font-mono font-black text-ink">{formatNumber(billing.reportedSalesValue || 0)} ر.ي</span>
          <span className="flex items-center gap-1 text-[10px] mt-0.5">
            <span className="text-emerald-700 font-bold">{formatNumber(billing.verifiedTransactions || 0)} معتمدة</span>
            {billing.legacyTransactions > 0 && (
              <>
                <span className="text-muted">•</span>
                <span className="text-amber-800 font-semibold">{formatNumber(billing.legacyTransactions)} قديمة</span>
              </>
            )}
          </span>
        </span>
        <span className="pt-1 border-t border-line/40 text-left">
          <span className="text-[10px] text-muted block font-semibold">العمولة المعتمدة خادمياً</span>
          <span className="font-mono font-black text-emerald-600">{formatNumber(billing.verifiedOutstandingCommission ?? 0)} ر.ي</span>
          {billing.legacyEstimatedCommission > 0 && (
            <span className="text-[10px] text-amber-800 block truncate" title="عمولات تقديرية لسجلات قديمة للمراجعة والتسوية اليدوية">
              + {formatNumber(billing.legacyEstimatedCommission)} ر.ي قديمة
            </span>
          )}
        </span>
      </button>

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
