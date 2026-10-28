import { useNavigate } from 'react-router-dom';
import { Phone, ArrowUpLeft, ShieldCheck, ShieldAlert } from 'lucide-react';
import UserActions from './UserActions.jsx';
import { formatDate, formatNumber, isExpired } from '../../lib/format.js';
import { isUserPhoneVerified } from '../../lib/accessStatus.js';

export default function UserTableRow({
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
  const billing = user;
  const expiry = user.subscriptionEndsAt ?? user.subscription_end_date;
  const expired = isExpired(expiry);
  const networkTitle = user.networkName || user.network_name || user.name
    || user.networkTitle || `شبكة ${user.networkId || String(user.uid || '').slice(0, 8)}`;
  const phoneStr = user.phoneNumber || user.phone || '';
  const isVerified = isUserPhoneVerified(user);

  return (
    <tr className="hover:bg-surface-sunken/40 transition-colors">
      <td className="p-3">
        <button
          type="button"
          onClick={() => navigate(`/users/${user.uid}`)}
          className="flex items-center gap-2 text-right group"
          aria-label={`فتح ملف ${networkTitle}`}
        >
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand/20 to-brand/5 border border-brand/20 text-brand-deep flex items-center justify-center font-black text-xs flex-shrink-0">
            {String(networkTitle).charAt(0)}
          </span>
          <span>
            <span className="font-extrabold text-ink group-hover:text-brand transition-colors flex items-center gap-1">
              <span>{networkTitle}</span>
              <ArrowUpLeft className="w-3 h-3 text-muted opacity-60" aria-hidden="true" />
            </span>
            <span className="block font-mono text-[10px] text-muted">{String(user.uid || '').slice(0, 10)}…</span>
          </span>
        </button>
      </td>

      <td className="p-3 font-mono" dir="ltr">
        {phoneStr ? (
          <a href={`tel:${phoneStr}`} className="text-xs text-muted hover:text-brand flex items-center gap-1 justify-end">
            <Phone className="w-3 h-3 text-muted" aria-hidden="true" />
            <span>{phoneStr}</span>
          </a>
        ) : (
          <span className="text-muted text-[11px]">—</span>
        )}
      </td>

      <td className="p-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {isVerified ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>مفعّل</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
              <span>غير مفعّل</span>
            </span>
          )}
          <button
            type="button"
            onClick={onVerify}
            className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold transition-all border ${
              isVerified
                ? 'bg-surface-sunken text-muted hover:text-rose-600 border-line hover:border-rose-300'
                : 'bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600 shadow-xs'
            }`}
            title={isVerified ? 'إلغاء توثيق الهاتف' : 'تفعيل يدوي برقم الهاتف'}
            aria-label={`${isVerified ? 'إلغاء توثيق الهاتف' : 'تفعيل الهاتف يدوياً'}: ${networkTitle}`}
          >
            {isVerified ? 'إلغاء التوثيق' : 'تفعيل يدوي'}
          </button>
        </div>
      </td>

      <td className="p-3 whitespace-nowrap">
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
          user.is_trial
            ? 'bg-amber-100 text-amber-800 border border-amber-300'
            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
        }`}>
          {user.is_trial ? 'تجريبي' : 'رسمي'}
        </span>
      </td>

      <td className="p-3 whitespace-nowrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          user.is_active === false
            ? 'bg-rose-100 text-rose-800 border border-rose-300'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
        }`}>
          {user.is_active === false ? 'محظور' : 'نشط'}
        </span>
      </td>

      <td className="p-3 whitespace-nowrap font-bold text-ink">
        {hasCustomCommission(user)
          ? <span className="text-brand font-black">{user.commission_rate}%</span>
          : `${defaultCommission}%`}
      </td>

      <td className={`p-3 whitespace-nowrap font-bold ${expired ? 'text-rose-600 font-black' : 'text-ink-soft'}`}>
        {formatDate(expiry)}
      </td>

      <td className="p-3 whitespace-nowrap font-mono">
        <div className="font-bold text-ink">{formatNumber(billing.reportedSalesValue || 0)} ر.ي</div>
        <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
          <span className="text-emerald-700 font-bold">{formatNumber(billing.verifiedTransactions || 0)} معتمدة</span>
          {(billing.legacyTransactions > 0 || billing.legacySalesValue > 0) && (
            <>
              <span className="text-muted">•</span>
              <span className="text-amber-800 font-semibold">{formatNumber(billing.legacyTransactions || 0)} قديمة</span>
            </>
          )}
        </div>
      </td>

      <td className="p-3 whitespace-nowrap font-mono">
        <div className="font-bold text-emerald-600">{formatNumber(billing.verifiedOutstandingCommission ?? 0)} ر.ي</div>
        {billing.legacyEstimatedCommission > 0 && (
          <div className="text-[10px] text-amber-800 font-semibold mt-0.5">
            + {formatNumber(billing.legacyEstimatedCommission)} ر.ي قديمة
          </div>
        )}
      </td>

      <td className="p-3 whitespace-nowrap text-center">
        <UserActions
          user={user}
          layout="row"
          onBilling={onBilling}
          onRenew={onRenew}
          onEdit={onEdit}
          onAuth={onAuth}
          onVerify={onVerify}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}
