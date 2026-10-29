import {
  DollarSign,
  CalendarPlus,
  Edit,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  Ban,
  Trash2,
} from 'lucide-react';
import { isUserPhoneVerified } from '../../lib/accessStatus';

const TONES = {
  emerald: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  brand: 'bg-brand/10 text-brand-deep hover:bg-brand/20',
  neutral: 'bg-surface-sunken text-ink hover:bg-line/40',
  rose: 'bg-rose-50 text-rose-800 hover:bg-rose-100',
  amber: 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200',
};

const ICON_TONES = {
  emerald: 'text-emerald-600',
  brand: 'text-brand',
  neutral: 'text-muted',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
};

export default function UserActions({
  user,
  layout = 'grid',
  onBilling,
  onRenew,
  onEdit,
  onAuth,
  onVerify,
  onToggle,
  onDelete,
}) {
  const isVerified = isUserPhoneVerified(user);
  const isBlocked = user.is_active === false;
  const labelForUser = user.networkName || user.phoneNumber || user.uid;

  const buttons = [
    { key: 'billing', onClick: onBilling, Icon: DollarSign, label: 'الفوترة', tone: 'emerald', title: 'الفوترة والدفعات' },
    { key: 'renew', onClick: onRenew, Icon: CalendarPlus, label: 'تجديد', tone: 'brand', title: 'تجديد الاشتراك' },
    { key: 'edit', onClick: onEdit, Icon: Edit, label: 'تعديل', tone: 'neutral', title: 'تعديل الإعدادات' },
    { key: 'auth', onClick: onAuth, Icon: KeyRound, label: 'الدخول', tone: 'neutral', title: 'بيانات الدخول وكلمة المرور' },
    {
      key: 'verify',
      onClick: onVerify,
      Icon: isVerified ? ShieldCheck : ShieldAlert,
      label: isVerified ? 'الهاتف مفعّل' : 'تفعيل يدوي',
      tone: isVerified ? 'emerald' : 'amber',
      title: isVerified ? 'إلغاء توثيق الهاتف' : 'تفعيل الحساب يدوياً برقم الهاتف (للدعم الفني)',
    },
    {
      key: 'toggle',
      onClick: onToggle,
      Icon: isBlocked ? UserCheck : Ban,
      label: isBlocked ? 'تفعيل' : 'حظر',
      tone: isBlocked ? 'emerald' : 'rose',
      title: isBlocked ? 'إلغاء الحظر' : 'حظر',
    },
    { key: 'delete', onClick: onDelete, Icon: Trash2, label: 'حذف', tone: 'rose', title: 'حذف الحساب نهائياً' },
  ];

  if (layout === 'row') {
    return (
      <div className="flex items-center justify-center gap-1">
        {buttons.map(({ key, onClick, Icon, tone, title }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className={`p-1.5 rounded-lg transition-colors min-h-[36px] min-w-[36px] grid place-items-center ${TONES[tone]}`}
            title={title}
            aria-label={`${title}: {labelForUser}`}
          >
            <Icon className={`w-3.5 h-3.5 ${ICON_TONES[tone]}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pt-2 border-t border-line/60"
      onClick={(event) => event.stopPropagation()}
    >
      {buttons.map(({ key, onClick, Icon, label, tone, title }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className={`flex flex-col items-center justify-center p-2 rounded-xl text-[11px] font-bold gap-1 active:scale-95 transition-transform min-h-[48px] ${TONES[tone]}`}
          title={title}
          aria-label={`${title}: {labelForUser}`}
        >
          <Icon className={`w-4 h-4 ${ICON_TONES[tone]}`} aria-hidden="true" />
          <span className="text-center leading-tight">{label}</span>
        </button>
      ))}
    </div>
  );
}
