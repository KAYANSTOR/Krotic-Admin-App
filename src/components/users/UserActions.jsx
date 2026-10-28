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
import { isUserPhoneVerified } from '../../lib/accessStatus.js';

const TONES = {
  emerald: {
    bg: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
    icon: 'text-emerald-600',
  },
  brand: {
    bg: 'bg-brand-soft/40 text-brand-deep hover:bg-brand-soft/60',
    icon: 'text-brand',
  },
  neutral: {
    bg: 'bg-surface-sunken text-ink hover:bg-line/40',
    icon: 'text-muted',
  },
  rose: {
    bg: 'bg-rose-50 text-rose-800 hover:bg-rose-100',
    icon: 'text-rose-600',
  },
  amber: {
    bg: 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200',
    icon: 'text-amber-600',
  },
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
  const name = user.networkName || user.network_name || 'المستخدم';

  const buttons = [
    { key: 'billing', onClick: onBilling, Icon: DollarSign, label: 'الفوترة', tone: 'emerald', title: 'الفوترة والدفعات' },
    { key: 'renew', onClick: onRenew, Icon: CalendarPlus, label: 'تجديد', tone: 'brand', title: 'تجديد الاشتراك' },
    { key: 'edit', onClick: onEdit, Icon: Edit, label: 'تعديل', tone: 'neutral', title: 'تعديل بيانات المشترك' },
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
      title: isBlocked ? 'إلغاء الحظر' : 'حظر المشترك',
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
            className={`row-action rounded-lg transition-colors ${TONES[tone].bg}`}
            title={title}
            aria-label={`${title}: ${name}`}
          >
            <Icon className={`w-3.5 h-3.5 ${TONES[tone].icon}`} aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 pt-1 border-t border-line/60">
      {buttons.map(({ key, onClick, Icon, tone, label, title }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          className={`flex flex-col items-center justify-center min-h-11 p-2 rounded-xl transition-colors text-[11px] font-bold gap-1 active:scale-95 ${TONES[tone].bg}`}
          title={title}
          aria-label={`${title}: ${name}`}
        >
          <Icon className={`w-4 h-4 ${TONES[tone].icon}`} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
